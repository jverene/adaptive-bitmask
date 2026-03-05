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
} from './bitmask.js';

const MAX_EMERGENCY_FEATURES = EMERGENCY_RANGE[1] - EMERGENCY_RANGE[0] + 1;
const MAX_REGULAR_FEATURES = HIGH_FREQ_RANGE[1] - HIGH_FREQ_RANGE[0] + 1 + (MED_FREQ_RANGE[1] - MED_FREQ_RANGE[0] + 1);
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

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

export interface ExportedSchema {
  /** Schema version. */
  version: number;
  /** Canonical mapping entries (feature -> bit). */
  entries: Array<[feature: string, bit: number]>;
  /** Emergency feature prefix. */
  emergencyPrefix: string;
  /** Explicit emergency features. */
  emergencyFeatures: string[];
  /** Deterministic fingerprint for compatibility checks. */
  fingerprint: string;
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

  /** Deterministic fingerprint of current schema mapping and version. */
  get fingerprint(): string {
    return this._computeFingerprint(
      this._version,
      this._featureToBit,
      this._emergencyPrefix,
      this._emergencyFeatures
    );
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
    if (this._featureToBit.size >= this._maxFeatures) return -1;

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
    const knownFeatures = this._collectKnownFeatures();
    const emergencyList = knownFeatures
      .filter((feature) => this.isEmergency(feature))
      .sort((a, b) => this._compareByFrequencyThenName(a, b));
    const regularList = knownFeatures
      .filter((feature) => !this.isEmergency(feature))
      .sort((a, b) => this._compareByFrequencyThenName(a, b));

    const newFeatureToBit = new Map<string, number>();
    const newBitToFeatures = new Map<number, string[]>();

    // Emergency: bits 56-63, ranked by frequency + stable name tie-break.
    const [emergStart] = EMERGENCY_RANGE;
    for (let i = 0; i < Math.min(emergencyList.length, MAX_EMERGENCY_FEATURES); i++) {
      const bit = emergStart + i;
      const feature = emergencyList[i];
      newFeatureToBit.set(feature, bit);
      newBitToFeatures.set(bit, [feature]);
    }

    // Regular: top 48 to high-frequency range.
    const [highStart] = HIGH_FREQ_RANGE;
    const highCount = HIGH_FREQ_RANGE[1] - HIGH_FREQ_RANGE[0] + 1;
    for (let i = 0; i < Math.min(regularList.length, highCount); i++) {
      const bit = highStart + i;
      const feature = regularList[i];
      newFeatureToBit.set(feature, bit);
      newBitToFeatures.set(bit, [feature]);
    }

    // Regular: next 8 to medium-frequency range.
    const [medStart] = MED_FREQ_RANGE;
    for (let i = highCount; i < Math.min(regularList.length, MAX_REGULAR_FEATURES); i++) {
      const bit = medStart + (i - highCount);
      const feature = regularList[i];
      newFeatureToBit.set(feature, bit);
      newBitToFeatures.set(bit, [feature]);
    }

    const excludedFeatures = [
      ...regularList.slice(MAX_REGULAR_FEATURES),
      ...emergencyList.slice(MAX_EMERGENCY_FEATURES),
    ];

    const mappingChanged = !this._mapsEqual(this._featureToBit, newFeatureToBit);
    if (mappingChanged) {
      this._featureToBit = newFeatureToBit;
      this._bitToFeatures = newBitToFeatures;
      this._version++;
    }

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

  /**
   * Export canonical schema state for distribution.
   * Entries are sorted by bit (then feature) for deterministic serialization.
   */
  exportSchema(): ExportedSchema {
    const entries = [...this._featureToBit.entries()]
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
      .map(([feature, bit]) => [feature, bit] as [string, number]);

    return {
      version: this._version,
      entries,
      emergencyPrefix: this._emergencyPrefix,
      emergencyFeatures: [...this._emergencyFeatures].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      ),
      fingerprint: this.fingerprint,
    };
  }

  /**
   * Import an exported schema state.
   * Replaces active mappings and resets activation counters.
   */
  importSchema(schema: ExportedSchema): void {
    this._assertExportedSchema(schema);

    const newFeatureToBit = new Map<string, number>();
    const newBitToFeatures = new Map<number, string[]>();

    for (const [feature, bit] of schema.entries) {
      newFeatureToBit.set(feature, bit);
      newBitToFeatures.set(bit, [feature]);
    }

    const expectedFingerprint = this._computeFingerprint(
      schema.version,
      newFeatureToBit,
      schema.emergencyPrefix,
      new Set(schema.emergencyFeatures)
    );
    if (schema.fingerprint !== expectedFingerprint) {
      throw new Error(
        `Schema fingerprint mismatch: expected ${expectedFingerprint}, got ${schema.fingerprint}`
      );
    }

    this._featureToBit = newFeatureToBit;
    this._bitToFeatures = newBitToFeatures;
    this._emergencyPrefix = schema.emergencyPrefix;
    this._emergencyFeatures = new Set(schema.emergencyFeatures);
    this._activationCounts.clear();
    this._totalActivations = 0;
    this._version = schema.version;
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

  /**
   * Collision probability for a specific feature:
   * P(collision) = 1 - (1 - 1/64)^(m - 1)
   * where m is active feature count.
   */
  get theoreticalCollisionRate(): number {
    const m = this._featureToBit.size;
    if (m <= 1) return 0;
    return 1 - Math.pow(1 - 1 / BITMASK_WIDTH, m - 1);
  }

  /**
   * Expected excluded feature count under uniform assignment:
   * E[excluded] = m - 64 * (1 - (1 - 1/64)^m)
   */
  expectedExcludedFeatures(featureCount = this._featureToBit.size): number {
    if (!Number.isInteger(featureCount) || featureCount < 0) {
      throw new RangeError(
        `featureCount must be a non-negative integer, got ${featureCount}`
      );
    }
    if (featureCount === 0) return 0;
    return (
      featureCount -
      BITMASK_WIDTH * (1 - Math.pow(1 - 1 / BITMASK_WIDTH, featureCount))
    );
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

  private _collectKnownFeatures(): string[] {
    const all = new Set<string>();
    for (const feature of this._activationCounts.keys()) all.add(feature);
    for (const feature of this._featureToBit.keys()) all.add(feature);
    for (const feature of this._emergencyFeatures) all.add(feature);
    return [...all];
  }

  private _compareByFrequencyThenName(a: string, b: string): number {
    const countA = this._activationCounts.get(a) ?? 0;
    const countB = this._activationCounts.get(b) ?? 0;
    if (countA !== countB) return countB - countA;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  private _mapsEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [feature, bit] of a) {
      if (b.get(feature) !== bit) return false;
    }
    return true;
  }

  private _assertExportedSchema(schema: ExportedSchema): void {
    if (!Number.isInteger(schema.version) || schema.version < 0) {
      throw new RangeError(`Schema version must be a non-negative integer, got ${schema.version}`);
    }
    if (typeof schema.fingerprint !== 'string' || schema.fingerprint.length === 0) {
      throw new TypeError('Schema fingerprint must be a non-empty string');
    }
    const seenFeatures = new Set<string>();
    const seenBits = new Set<number>();
    for (const [feature, bit] of schema.entries) {
      if (!feature || typeof feature !== 'string') {
        throw new TypeError(`Invalid feature name in schema export: ${String(feature)}`);
      }
      if (!Number.isInteger(bit) || bit < 0 || bit >= BITMASK_WIDTH) {
        throw new RangeError(`Invalid bit position in schema export: ${bit}`);
      }
      if (seenFeatures.has(feature)) {
        throw new Error(`Duplicate feature in schema export: ${feature}`);
      }
      if (seenBits.has(bit)) {
        throw new Error(`Duplicate bit in schema export: ${bit}`);
      }
      seenFeatures.add(feature);
      seenBits.add(bit);
    }
  }

  private _computeFingerprint(
    version: number,
    mapping: ReadonlyMap<string, number>,
    emergencyPrefix: string,
    emergencyFeatures: ReadonlySet<string>
  ): string {
    const canonicalEntries = [...mapping.entries()]
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        return 0;
      })
      .map(([feature, bit]) => `${bit}:${feature}`)
      .join('|');
    const canonicalEmergency = [...emergencyFeatures]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join('|');
    const canonical = `v=${version};ep=${emergencyPrefix};ef=${canonicalEmergency};m=${canonicalEntries}`;

    let hash = FNV_OFFSET_64;
    for (const char of canonical) {
      hash ^= BigInt(char.codePointAt(0) ?? 0);
      hash = (hash * FNV_PRIME_64) & MASK_64;
    }
    return hash.toString(16).padStart(16, '0');
  }
}
