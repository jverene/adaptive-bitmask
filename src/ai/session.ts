/**
 * CoordinationSession — Lifecycle manager for bitmask-based agent coordination.
 *
 * Wraps SchemaManager + Coordinator + Arbiter into a single object
 * that AI SDK tools and middleware can reference.
 */

import {
  SchemaManager,
  Coordinator,
  Arbiter,
  BitmaskMessage,
  encode,
  decode,
  hasEmergency,
} from '../index.js';
import type {
  CoordinatorConfig,
  ArbiterConfig,
  ArbiterResult,
  Decision,
} from '../index.js';

export interface CoordinationSessionConfig {
  /** Initial feature vocabulary to register. */
  features: string[];
  /** Prefix for emergency features. Default: 'EMERGENCY_' */
  emergencyPrefix?: string;
  /** Explicit emergency features (alternative to prefix). */
  emergencyFeatures?: string[];
  /** Coordinator configuration overrides. */
  coordinatorConfig?: Partial<CoordinatorConfig>;
  /** Arbiter configuration overrides. */
  arbiterConfig?: Partial<ArbiterConfig>;
}

export interface ReportResult {
  accepted: boolean;
  mapped: number;
  unmapped: number;
}

export interface DecisionResult {
  decision: Decision;
  aggregatedFeatures: string[];
  confidence: Map<number, number>;
  result: ArbiterResult;
}

export class CoordinationSession {
  readonly schema: SchemaManager;
  readonly coordinator: Coordinator;
  readonly arbiter: Arbiter;

  private readonly _agentIds = new Map<string, number>();

  constructor(config: CoordinationSessionConfig) {
    this.schema = new SchemaManager({
      emergencyPrefix: config.emergencyPrefix ?? 'EMERGENCY_',
      emergencyFeatures: config.emergencyFeatures,
    });
    this.schema.registerAll(config.features);

    this.coordinator = new Coordinator({
      ...config.coordinatorConfig,
      schemaVersion: this.schema.version,
    });

    this.arbiter = new Arbiter(config.arbiterConfig);
  }

  /** Deterministic agent ID: FNV-1a hash of name → uint32. */
  agentId(name: string): number {
    const cached = this._agentIds.get(name);
    if (cached !== undefined) return cached;

    let hash = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const id = hash >>> 0; // ensure uint32
    this._agentIds.set(name, id);
    return id;
  }

  /** Start a new coordination round. Clears the coordinator buffer. */
  startRound(): void {
    this.coordinator.startRound();
  }

  /** Encode features + create message + receive in one call. */
  report(agentName: string, features: string[]): ReportResult {
    const { mask, mapped, unmapped } = encode(
      features,
      this.schema.featureToBit,
    );
    const msg = BitmaskMessage.now(
      mask,
      this.agentId(agentName),
      this.schema.version,
    );
    const accepted = this.coordinator.receive(msg);
    return { accepted, mapped, unmapped };
  }

  /** Aggregate current buffer + score via arbiter. */
  decide(): DecisionResult {
    const { aggregatedMask, confidence } = this.coordinator.aggregate();
    const aggregatedFeatures = decode(aggregatedMask, this.schema.bitToFeatures);
    const result = this.arbiter.score(aggregatedMask, confidence);
    return {
      decision: result.decision,
      aggregatedFeatures,
      confidence,
      result,
    };
  }
}
