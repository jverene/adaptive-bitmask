/**
 * adaptive-bitmask
 * ================
 * Sub-10ms coordination protocol for multi-agent systems.
 * 85× bandwidth reduction through semantic bitmask encoding.
 *
 * @example
 * ```ts
 * import { SchemaManager, BitmaskMessage, Arbiter, encode } from 'adaptive-bitmask';
 *
 * // 1. Define schema
 * const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
 * schema.registerAll(['price_up', 'volume_spike', 'EMERGENCY_halt']);
 *
 * // 2. Encode agent observations
 * const { mask } = encode(['price_up', 'volume_spike'], schema.featureToBit);
 * const msg = BitmaskMessage.now(mask, agentId, schema.version);
 *
 * // 3. Coordinate
 * coordinator.receive(msg);
 * const { aggregatedMask, confidence } = coordinator.aggregate();
 *
 * // 4. Decide
 * const { decision, finalScore } = arbiter.score(aggregatedMask, confidence);
 * ```
 *
 * @packageDocumentation
 */

// ── High-Level Wrapper ──
export {
  SharedCognition,
  type SharedCognitionConfig,
  type SwarmTickResult,
} from './SharedCognition.js';

// ── Bitmask primitives ──
export {
  type Bitmask,
  type EncodeOptions,
  BITMASK_WIDTH,
  EMERGENCY_RANGE,
  HIGH_FREQ_RANGE,
  MED_FREQ_RANGE,
  empty,
  setBit,
  clearBit,
  testBit,
  popcount,
  activeBits,
  forEachSetBit,
  merge,
  intersect,
  delta,
  hammingDistance,
  hasEmergency,
  emergencyBits,
  toBytes,
  fromBytes,
  encode,
  decode,
} from './bitmask.js';

// ── Schema management ──
export {
  SchemaManager,
  type SchemaConfig,
  type PruneResult,
  type SchemaSnapshot,
  type ExportedSchema,
} from './schema.js';

// ── Wire format ──
export {
  BitmaskMessage,
  MESSAGE_SIZE_BYTES,
  type BitmaskMessageData,
} from './message.js';

// ── Decision synthesis ──
export {
  Arbiter,
  createFinancialArbiter,
  createRoboticArbiter,
  type ArbiterConfig,
  type ArbiterResult,
  type StrategyCandidate,
  type ScoreStrategiesOptions,
  type StrategyScore,
  type StrategyDecisionResult,
  type BitConfidence,
  type Decision,
  type ArbiterTelemetryEvent,
} from './arbiter.js';

// ── Coordination ──
export {
  Coordinator,
  type CoordinatorConfig,
  type AggregationResult,
  type StaleMessagePolicy,
  type CoordinatorDropReason,
  type CoordinatorTelemetryEvent,
} from './coordinator.js';

// ── Transport envelope ──
export {
  createEnvelope,
  decodeEnvelope,
  type TransportEnvelope,
} from './envelope.js';
