/**
 * SchemaManager — Dynamic feature-to-bit mapping with frequency-based pruning.
 *
 * Implements Section 3.2-3.4 of the Adaptive Bitmask Protocol:
 * - Deterministic surjection Φ_t: S_t → {0..63}
 * - Frequency-based pruning (power-law: 20% of features → 80% of activations)
 * - Emergency bit reservation (bits 56-63, never pruned)
 * - Collision-aware schema evolution with versioned epochs
 */

import {
  BITMASK_WIDTH,
  EMERGENCY_RANGE,
  HIGH_FREQ_RANGE,
  MED_FREQ_RANGE,
  type Bitmask,
} from './bitmask.js';

export interface SchemaConfig {
  /** Maximum features before triggering a prune. Default: BITMASK_WIDTH */
  maxFeatures?: number;
  /** Emergency feature prefix. Features starting with this are pinned to bits 56-63. */
  emergencyPrefix?: string;
  /** Custom emergency features (alternative to prefix matching). */
  emergencyFeatures?: string[];
}

export interface PruneResult {
  /** Number of features removed from active schema. */
  pruned: number;
  /** Number of features retained. */
  retained: number;
  /** Schema version after pruning. */
  version: number;
  /** Features that were excluded. */
  excludedFeatures: string[];
}

export interface SchemaSnapshot {
  /** Current version (incremented on every schema change). */
  version: number;
  /** Feature → bit position mapping. */
  featureToBit: ReadonlyMap<string, number>;
  /** Bit position → feature(s) mapping (reverse lookup). */
  bitToFeatures: ReadonlyMap<number, string[]>;
  /** Total features tracked (including inactive). */
  totalTracked: number;
  /** Number of active (mapped) features. */
  activeFeatures: number;
  /** Number of emergency features mapped. */
  emergencyCount: number;
}

export class SchemaManager {
  private _version = 0;
  private _featureToBit = new Map<string, number>();
  private _bitToFeatures = new Map<number, string[]>();
  private _activationCounts = new Map<string, number>();
  private _totalActivations = 0;
  private _emergencyFeatures: Set<string>;
  private _emergencyPrefix: string;
  private _maxFeatures: number;

  constructor(config: SchemaConfig = {}) {
    this._maxFeatures = config.maxFeatures ?? BITMASK_WIDTH;
    this._emergencyPrefix = config.emergencyPrefix ?? 'EMERGENCY_';
    this._emergencyFeatures = new Set(config.emergencyFeatures ?? []);
  }

  /** Current schema version. */
  get version(): number {
    return this._version;
  }

  /** Read-only view of feature → bit mapping. */
  get featureToBit(): ReadonlyMap<string, number> {
    return this._featureToBit;
  }

  /** Read-only view of bit → features mapping. */
  get bitToFeatures(): ReadonlyMap<number, string[]> {
    return this._bitToFeatures;
  }

  /** Number of actively mapped features. */
  get activeFeatureCount(): number {
    return this._featureToBit.size;
  }

  /** Check if a feature is an emergency feature. */
  isEmergency(feature: string): boolean {
    return (
      this._emergencyFeatures.has(feature) ||
      feature.startsWith(this._emergencyPrefix)
    );
  }

  /**
   * Register a feature in the schema.
   * Emergency features are pinned to bits 56-63.
   * Regular features fill bits 0-55 in order.
   *
   * Returns the assigned bit position, or -1 if schema is full.
   */
  register(feature: string): number {
    // Already registered
    const existing = this._featureToBit.get(feature);
    if (existing !== undefined) return existing;

    if (this.isEmergency(feature)) {
      return this._registerEmergency(feature);
    }

    return this._registerRegular(feature);
  }

  /**
   * Register multiple features at once.
   * Returns a map of feature → assigned bit position.
   */
  registerAll(features: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const feature of features) {
      result.set(feature, this.register(feature));
    }
    return result;
  }

  /**
   * Record feature activations for frequency tracking.
   * Call this every coordination round with the observed features.
   */
  recordActivations(features: string[]): void {
    for (const feature of features) {
      const count = this._activationCounts.get(feature) ?? 0;
      this._activationCounts.set(feature, count + 1);
      this._totalActivations++;
    }
  }

  /**
   * Frequency-based pruning (Section 3.3).
   *
   * Sorts features by activation frequency, retains:
   * - All emergency features in bits 56-63 (never pruned)
   * - Top 48 regular features in bits 0-47 (high-frequency)
   * - Next 8 regular features in bits 48-55 (medium-frequency)
   *
   * Increments schema version.
   */
  prune(): PruneResult {
    // Collect all known emergency features (from vocab, not just activated)
    const emergencyList: string[] = [];
    const regularWithFreq: [string, number][] = [];

    // Include emergency features from explicit set
    for (const feat of this._emergencyFeatures) {
      emergencyList.push(feat);
    }

    // Include emergency features by prefix (from activation history)
    for (const [feat] of this._activationCounts) {
      if (this.isEmergency(feat) && !this._emergencyFeatures.has(feat)) {
        emergencyList.push(feat);
      }
    }

    // Also include currently mapped emergency features not yet activated
    for (const [feat, bit] of this._featureToBit) {
      if (
        this.isEmergency(feat) &&
        !emergencyList.includes(feat)
      ) {
        emergencyList.push(feat);
      }
    }

    // Collect regular features sorted by frequency
    for (const [feat, count] of this._activationCounts) {
      if (!this.isEmergency(feat)) {
        regularWithFreq.push([feat, count]);
      }
    }
    regularWithFreq.sort((a, b) => b[1] - a[1]); // descending frequency

    // Clear and rebuild mappings
    const oldFeatures = new Set(this._featureToBit.keys());
    this._featureToBit.clear();
    this._bitToFeatures.clear();

    // Map emergency features to bits 56-63
    const [emergStart] = EMERGENCY_RANGE;
    for (let i = 0; i < Math.min(emergencyList.length, 8); i++) {
      const bit = emergStart + i;
      this._featureToBit.set(emergencyList[i], bit);
      this._bitToFeatures.set(bit, [emergencyList[i]]);
    }

    // Map top-48 regular features to high-freq bits 0-47
    const [highStart] = HIGH_FREQ_RANGE;
    for (let i = 0; i < Math.min(regularWithFreq.length, 48); i++) {
      const bit = highStart + i;
      this._featureToBit.set(regularWithFreq[i][0], bit);
      this._bitToFeatures.set(bit, [regularWithFreq[i][0]]);
    }

    // Map next 8 to medium-freq bits 48-55
    const [medStart] = MED_FREQ_RANGE;
    for (let i = 48; i < Math.min(regularWithFreq.length, 56); i++) {
      const bit = medStart + (i - 48);
      this._featureToBit.set(regularWithFreq[i][0], bit);
      this._bitToFeatures.set(bit, [regularWithFreq[i][0]]);
    }

    // Determine what got excluded
    const excludedFeatures: string[] = [];
    for (let i = 56; i < regularWithFreq.length; i++) {
      excludedFeatures.push(regularWithFreq[i][0]);
    }

    this._version++;

    return {
      pruned: excludedFeatures.length,
      retained: this._featureToBit.size,
      version: this._version,
      excludedFeatures,
    };
  }

  /** Get a serializable snapshot of the current schema state. */
  snapshot(): SchemaSnapshot {
    let emergencyCount = 0;
    for (const [feat] of this._featureToBit) {
      if (this.isEmergency(feat)) emergencyCount++;
    }

    return {
      version: this._version,
      featureToBit: new Map(this._featureToBit),
      bitToFeatures: new Map(
        [...this._bitToFeatures].map(([k, v]) => [k, [...v]])
      ),
      totalTracked: this._activationCounts.size,
      activeFeatures: this._featureToBit.size,
      emergencyCount,
    };
  }

  /** Get activation frequency for a feature. */
  getFrequency(feature: string): number {
    return this._activationCounts.get(feature) ?? 0;
  }

  /** Get all features ranked by activation frequency. */
  getRankedFeatures(): Array<{ feature: string; count: number; bit: number | undefined }> {
    const ranked: Array<{ feature: string; count: number; bit: number | undefined }> = [];
    for (const [feature, count] of this._activationCounts) {
      ranked.push({
        feature,
        count,
        bit: this._featureToBit.get(feature),
      });
    }
    ranked.sort((a, b) => b.count - a.count);
    return ranked;
  }

  /** Reset all activation counts (but keep schema mappings). */
  resetCounts(): void {
    this._activationCounts.clear();
    this._totalActivations = 0;
  }

  /** Collision rate: (m - 1) / 64 for current feature count. */
  get theoreticalCollisionRate(): number {
    const m = this._featureToBit.size;
    if (m <= 1) return 0;
    return (m - 1) / BITMASK_WIDTH;
  }

  // ── Private ──

  private _registerEmergency(feature: string): number {
    const [start, end] = EMERGENCY_RANGE;
    for (let bit = start; bit <= end; bit++) {
      if (!this._bitToFeatures.has(bit)) {
        this._featureToBit.set(feature, bit);
        this._bitToFeatures.set(bit, [feature]);
        this._version++;
        return bit;
      }
    }
    // Emergency range full — this is a design error
    return -1;
  }

  private _registerRegular(feature: string): number {
    // Try high-freq range first (0-47)
    const [highStart, highEnd] = HIGH_FREQ_RANGE;
    for (let bit = highStart; bit <= highEnd; bit++) {
      if (!this._bitToFeatures.has(bit)) {
        this._featureToBit.set(feature, bit);
        this._bitToFeatures.set(bit, [feature]);
        this._version++;
        return bit;
      }
    }

    // Try medium-freq range (48-55)
    const [medStart, medEnd] = MED_FREQ_RANGE;
    for (let bit = medStart; bit <= medEnd; bit++) {
      if (!this._bitToFeatures.has(bit)) {
        this._featureToBit.set(feature, bit);
        this._bitToFeatures.set(bit, [feature]);
        this._version++;
        return bit;
      }
    }

    // Schema full
    return -1;
  }
}
