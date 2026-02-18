/**
 * Basic multi-agent coordination example.
 *
 * 10 trading agents observe market features, encode as bitmasks,
 * and coordinate a decision in one round.
 */
import {
  SchemaManager,
  BitmaskMessage,
  Coordinator,
  createFinancialArbiter,
  encode,
} from 'adaptive-bitmask';

// 1. Define feature vocabulary
const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll([
  'price_trend_up', 'price_trend_down',
  'volatility_high', 'volatility_low',
  'volume_spike', 'volume_dry',
  'momentum_strong', 'momentum_weak',
  'breakout_detected', 'mean_reversion_signal',
  'EMERGENCY_halt_trading',
  'EMERGENCY_risk_limit_breach',
]);

// 2. Create coordinator and arbiter
const coordinator = new Coordinator({ deadlineMs: 15 });
const arbiter = createFinancialArbiter();

// 3. Simulate 10 agents observing different market signals
const observations: string[][] = [
  ['price_trend_up', 'momentum_strong', 'volume_spike'],
  ['price_trend_up', 'breakout_detected'],
  ['price_trend_up', 'momentum_strong', 'volume_spike', 'breakout_detected'],
  ['volatility_low', 'momentum_strong'],
  ['price_trend_up', 'volume_spike'],
  ['price_trend_up', 'momentum_strong'],
  ['momentum_strong', 'breakout_detected', 'volume_spike'],
  ['price_trend_up', 'volatility_low'],
  ['price_trend_up', 'momentum_strong', 'volume_spike'],
  ['breakout_detected', 'momentum_strong', 'volume_spike'],
];

// 4. Encode and send
coordinator.startRound();

for (let i = 0; i < observations.length; i++) {
  const { mask, mapped, unmapped } = encode(observations[i], schema.featureToBit);
  const msg = BitmaskMessage.now(mask, i, schema.version);

  // 24 bytes per agent instead of ~2KB natural language
  console.log(`Agent ${i}: ${mapped} features → ${msg.sizeBytes} bytes`);

  coordinator.receive(msg);
}

// 5. Aggregate and decide
const { aggregatedMask, confidence, messageCount } = coordinator.aggregate();
const result = arbiter.score(aggregatedMask, confidence);

console.log(`\n--- Coordination Round ---`);
console.log(`Agents: ${messageCount}`);
console.log(`Decision: ${result.decision}`);
console.log(`Score: ${(result.finalScore * 100).toFixed(1)}%`);
console.log(`Active bits: ${result.activeBitCount}`);
console.log(`Scoring time: ${result.scoringTimeUs.toFixed(1)}μs`);
console.log(`Emergency: ${result.hasEmergency}`);
console.log(`Total bandwidth: ${messageCount * 24} bytes (vs ${messageCount * 2048} bytes NL)`);
