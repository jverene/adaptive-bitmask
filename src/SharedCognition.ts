import { SchemaManager, type SchemaConfig } from './schema.js';
import { Coordinator, type CoordinatorConfig } from './coordinator.js';
import { Arbiter, type ArbiterConfig, type ArbiterResult } from './arbiter.js';
import { encode, decode } from './bitmask.js';
import { BitmaskMessage } from './message.js';

export interface SharedCognitionConfig {
  schema?: SchemaConfig;
  coordinator?: CoordinatorConfig;
  arbiter?: ArbiterConfig;
  /** Automatically register unknown features when they are observed. Default: true. */
  autoRegister?: boolean;
}

export interface SwarmTickResult {
  /** The final decision: EXECUTE, SYNTHESIZE, or REJECT */
  decision: ArbiterResult['decision'];
  /** Final confidence-adjusted composite score [0, 1] */
  finalScore: number;
  /** End-to-end latency in milliseconds */
  latencyMs: number;
  /** Array of features that were active in the consensus mask */
  activeFeatures: string[];
  /** Full result from the Arbiter for advanced inspection */
  arbiterResult: ArbiterResult;
}

/**
 * SharedCognition
 * 
 * The high-level wrapper that sits on top of the adaptive-bitmask core engine.
 * Tailored for instant multi-agent coordination without boilerplate.
 */
export class SharedCognition {
  public schema: SchemaManager;
  public coordinator: Coordinator;
  public arbiter: Arbiter;
  public autoRegister: boolean;

  constructor(config: SharedCognitionConfig = {}) {
    this.schema = new SchemaManager(config.schema);
    this.coordinator = new Coordinator(config.coordinator);
    this.arbiter = new Arbiter(config.arbiter);
    this.autoRegister = config.autoRegister ?? true;
  }

  /**
   * Process a single coordination tick across the entire swarm.
   * 
   * 1. Encodes all agent string observations into 64-bit masks
   * 2. Routes through the Meta-Coordinator
   * 3. Arbitrates a final decision
   * 
   * @param agentObservations Array of string feature arrays, one per agent
   * @returns The unified swarm decision and latency
   */
  processSwarmTick(agentObservations: string[][]): SwarmTickResult {
    const startMs = performance.now();

    // Flatten all features to register/record them if needed
    if (this.autoRegister) {
      const uniqueFeatures = new Set<string>();
      for (const obs of agentObservations) {
        for (const feature of obs) {
          uniqueFeatures.add(feature);
        }
      }
      this.schema.registerAll(Array.from(uniqueFeatures));
    }
    
    // Record activations for frequency-based pruning
    for (const obs of agentObservations) {
      this.schema.recordActivations(obs);
    }

    this.coordinator.startRound();
    this.coordinator.schemaVersion = this.schema.version;

    // Encode observations and dispatch to coordinator
    let agentId = 0;
    for (const obs of agentObservations) {
      const { mask } = encode(obs, this.schema.featureToBit);
      const msg = BitmaskMessage.now(mask, agentId++, this.schema.version);
      this.coordinator.receive(msg);
    }

    // Aggregate swarm consensus
    const { aggregatedMask, confidence } = this.coordinator.aggregate();

    // Decide
    const arbiterResult = this.arbiter.score(aggregatedMask, confidence);

    // Decode back to human-readable features
    const activeFeatures = decode(aggregatedMask, this.schema.bitToFeatures);

    const latencyMs = performance.now() - startMs;

    return {
      decision: arbiterResult.decision,
      finalScore: arbiterResult.finalScore,
      latencyMs,
      activeFeatures,
      arbiterResult,
    };
  }
}
