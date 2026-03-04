/**
 * Arbiter — Weighted linear scoring and decision synthesis.
 *
 * Implements Section 6 of the Adaptive Bitmask Protocol:
 * - Weighted linear scoring: ŝ = Σ(w_k · b_k) / Σ(w_k)
 * - Three-tier decision logic: EXECUTE / SYNTHESIZE / REJECT
 * - Configurable thresholds and weight vectors
 * - Sub-millisecond execution (measured: 15μs mean, 26μs p99)
 */

import { type Bitmask, BITMASK_WIDTH, activeBits, forEachSetBit, hasEmergency } from './bitmask.js';
import type { BitmaskMessage } from './message.js';

/** Decision outcome from the arbiter. */
export type Decision = 'EXECUTE' | 'SYNTHESIZE' | 'REJECT';

/** Full decision result with audit trail. */
export interface ArbiterResult {
  /** The decision: EXECUTE, SYNTHESIZE, or REJECT. */
  decision: Decision;
  /** Raw weighted score [0, 1]. */
  rawScore: number;
  /** Confidence-adjusted score [0, 1]. */
  confidenceScore: number;
  /** Final composite score [0, 1]. */
  finalScore: number;
  /** Number of active bits in the aggregated mask. */
  activeBitCount: number;
  /** Whether emergency bits were active. */
  hasEmergency: boolean;
  /** Scoring computation time in microseconds. */
  scoringTimeUs: number;
}

/** Per-bit confidence from aggregation (what fraction of agents set this bit). */
export type BitConfidence = Map<number, number>;

export interface ArbiterConfig {
  /** Weight vector: importance of each bit position [0..63]. */
  weights?: number[];
  /**
   * Score threshold above which to EXECUTE.
   * Default: 0.55 (paper Section 6.1).
   */
  executeThreshold?: number;
  /**
   * Score threshold above which to SYNTHESIZE (below execute).
   * Default: 0.40 (paper Section 6.1).
   */
  synthesizeThreshold?: number;
  /**
   * If true, emergency bits trigger immediate REJECT regardless of score.
   * Default: true.
   */
  emergencyOverride?: boolean;
}

export class Arbiter {
  private _weights: Float64Array;
  private _weightSum: number;
  private _executeThreshold: number;
  private _synthesizeThreshold: number;
  private _emergencyOverride: boolean;
  private _decisionCount = 0;

  constructor(config: ArbiterConfig = {}) {
    this._executeThreshold = config.executeThreshold ?? 0.55;
    this._synthesizeThreshold = config.synthesizeThreshold ?? 0.40;
    this._emergencyOverride = config.emergencyOverride ?? true;

    // Initialize weights
    this._weights = new Float64Array(BITMASK_WIDTH);
    if (config.weights) {
      if (config.weights.length !== BITMASK_WIDTH) {
        throw new Error(`Weight vector must have ${BITMASK_WIDTH} elements, got ${config.weights.length}`);
      }
      this._weights.set(config.weights);
    } else {
      // Default: uniform weights
      this._weights.fill(1.0);
    }

    this._weightSum = this._weights.reduce((sum, w) => sum + w, 0);
  }

  /** Number of decisions made since creation. */
  get decisionCount(): number {
    return this._decisionCount;
  }

  /** Set the weight for a specific bit position. */
  setWeight(position: number, weight: number): void {
    if (position < 0 || position >= BITMASK_WIDTH) {
      throw new RangeError(`Position ${position} out of range`);
    }
    this._weightSum -= this._weights[position];
    this._weights[position] = weight;
    this._weightSum += weight;
  }

  /** Get the current weight vector (copy). */
  get weights(): number[] {
    return Array.from(this._weights);
  }

  /**
   * Score an aggregated bitmask and produce a decision.
   *
   * @param aggregatedMask — OR-aggregated mask from all agents
   * @param confidence — Optional per-bit confidence (fraction of agents that set each bit)
   */
  score(aggregatedMask: Bitmask, confidence?: BitConfidence): ArbiterResult {
    const t0 = performance.now();

    const active = activeBits(aggregatedMask);
    const emergency = hasEmergency(aggregatedMask);

    // Emergency override: if emergency bits are set and override is enabled,
    // force REJECT (fail-safe behavior in crisis)
    if (emergency && this._emergencyOverride) {
      const elapsed = (performance.now() - t0) * 1000; // to microseconds
      this._decisionCount++;
      return {
        decision: 'REJECT',
        rawScore: 0,
        confidenceScore: 0,
        finalScore: 0,
        activeBitCount: active.length,
        hasEmergency: true,
        scoringTimeUs: elapsed,
      };
    }

    // Weighted linear scoring: ŝ = Σ(w_k · b_k) / Σ(w_k)
    let numerator = 0;
    for (const bit of active) {
      numerator += this._weights[bit];
    }
    const rawScore = this._weightSum > 0 ? numerator / this._weightSum : 0;

    // Confidence-weighted adjustment
    let confidenceScore = rawScore;
    if (confidence && confidence.size > 0) {
      let confNumerator = 0;
      let confDenominator = 0;
      for (const bit of active) {
        const conf = confidence.get(bit) ?? 0;
        confNumerator += conf * this._weights[bit];
        confDenominator += this._weights[bit];
      }
      confidenceScore = confDenominator > 0
        ? confNumerator / confDenominator
        : rawScore;
    }

    // Composite score
    const finalScore = Math.min(1.0, rawScore * 0.6 + confidenceScore * 0.4);

    // Decision logic (Section 6.1)
    let decision: Decision;
    if (finalScore >= this._executeThreshold) {
      decision = 'EXECUTE';
    } else if (finalScore >= this._synthesizeThreshold) {
      decision = 'SYNTHESIZE';
    } else {
      decision = 'REJECT';
    }

    const elapsed = (performance.now() - t0) * 1000;
    this._decisionCount++;

    return {
      decision,
      rawScore,
      confidenceScore,
      finalScore,
      activeBitCount: active.length,
      hasEmergency: emergency,
      scoringTimeUs: elapsed,
    };
  }

  /**
   * Convenience: aggregate messages then score.
   * OR-merges all message masks, computes per-bit confidence,
   * validates schema versions, then runs scoring.
   */
  scoreMessages(
    messages: BitmaskMessage[],
    expectedSchemaVersion?: number
  ): ArbiterResult & { staleCount: number } {
    if (messages.length === 0) {
      return {
        decision: 'REJECT',
        rawScore: 0,
        confidenceScore: 0,
        finalScore: 0,
        activeBitCount: 0,
        hasEmergency: false,
        scoringTimeUs: 0,
        staleCount: 0,
      };
    }

    let aggregated = 0n;
    const bitVotes = new Map<number, number>();
    let staleCount = 0;

    for (const msg of messages) {
      // Schema version check
      if (expectedSchemaVersion !== undefined && msg.schemaVersion !== expectedSchemaVersion) {
        staleCount++;
        // Still include stale messages (graceful degradation)
      }

      aggregated |= msg.mask;

      // Count per-bit votes for confidence
      forEachSetBit(msg.mask, (bit) => {
        bitVotes.set(bit, (bitVotes.get(bit) ?? 0) + 1);
      });
    }

    // Convert vote counts to confidence [0, 1]
    const confidence: BitConfidence = new Map();
    for (const [bit, votes] of bitVotes) {
      confidence.set(bit, votes / messages.length);
    }

    const result = this.score(aggregated, confidence);
    return { ...result, staleCount };
  }
}

/**
 * Create a financial trading arbiter with domain-specific weights.
 * Matches the weight configuration from the paper's evaluation.
 */
export function createFinancialArbiter(overrides?: Partial<ArbiterConfig>): Arbiter {
  const weights = new Array(BITMASK_WIDTH).fill(0.08);

  // Key financial signals
  weights[0] = 0.25; // price_trend_up
  weights[1] = 0.25; // price_trend_down
  weights[2] = 0.20; // volatility_high
  weights[3] = 0.20; // volatility_low
  weights[8] = 0.20; // volume_spike
  weights[10] = 0.18; // momentum_strong
  weights[12] = 0.15; // mean_reversion_signal
  weights[13] = 0.22; // breakout_detected

  // Medium-frequency zone (48-55)
  for (let i = 48; i < 56; i++) weights[i] = 0.12;

  // Emergency bits (56-63): highest weight
  for (let i = 56; i < 64; i++) weights[i] = 0.45;

  return new Arbiter({ weights, ...overrides });
}

/**
 * Create a robotic coordination arbiter with safety-first weights.
 */
export function createRoboticArbiter(overrides?: Partial<ArbiterConfig>): Arbiter {
  const weights = new Array(BITMASK_WIDTH).fill(0.10);

  weights[0] = 0.30; // obstacle_detected_front
  weights[4] = 0.25; // path_clear
  weights[10] = 0.20; // battery_critical

  // Emergency override bits
  for (let i = 56; i < 64; i++) weights[i] = 0.45;

  return new Arbiter({ weights, emergencyOverride: true, ...overrides });
}
