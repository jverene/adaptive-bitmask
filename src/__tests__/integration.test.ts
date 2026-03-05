import { describe, expect, it } from 'vitest';
import {
  Arbiter,
  BitmaskMessage,
  Coordinator,
  SchemaManager,
  createFinancialArbiter,
  encode,
} from '../index.js';

describe('Full pipeline integration', () => {
  it('runs a complete coordination round', () => {
    const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    schema.registerAll([
      'price_up',
      'price_down',
      'vol_high',
      'vol_low',
      'volume_spike',
      'momentum',
      'breakout',
      'EMERGENCY_halt',
      'EMERGENCY_breach',
    ]);

    const arbiter = createFinancialArbiter();
    const coordinator = new Coordinator({ deadlineMs: 100 });

    const agentObservations: string[][] = [
      ['price_up', 'momentum', 'volume_spike'],
      ['price_up', 'breakout', 'volume_spike'],
      ['price_up', 'momentum'],
      ['vol_low', 'momentum'],
      ['price_up', 'volume_spike', 'breakout'],
    ];

    coordinator.startRound();

    for (let i = 0; i < agentObservations.length; i++) {
      const { mask } = encode(agentObservations[i], schema.featureToBit);
      const msg = BitmaskMessage.now(mask, i, schema.version);
      const bytes = msg.toBytes();
      expect(bytes.length).toBe(24);
      const restored = BitmaskMessage.deserialize(bytes);
      expect(restored.mask).toBe(msg.mask);
      coordinator.receive(msg);
    }

    const { aggregatedMask, confidence, messageCount } = coordinator.aggregate();
    expect(messageCount).toBe(5);

    const result = arbiter.score(aggregatedMask, confidence);
    expect(['EXECUTE', 'SYNTHESIZE', 'REJECT']).toContain(result.decision);
    expect(result.scoringTimeUs).toBeDefined();
    expect(result.activeBitCount).toBeGreaterThan(0);

    for (const obs of agentObservations) schema.recordActivations(obs);
  });

  it('rejects emergency scenario via override', () => {
    const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    schema.registerAll(['normal_feat', 'EMERGENCY_halt']);

    const arbiter = createFinancialArbiter();
    const coordinator = new Coordinator();
    coordinator.startRound();

    const { mask } = encode(['normal_feat', 'EMERGENCY_halt'], schema.featureToBit);
    coordinator.receive(BitmaskMessage.now(mask, 0, schema.version));

    const { aggregatedMask, confidence } = coordinator.aggregate();
    const result = arbiter.score(aggregatedMask, confidence);
    expect(result.decision).toBe('REJECT');
    expect(result.hasEmergency).toBe(true);
  });

  it('maintains compression ratio claim baseline', () => {
    const msg = BitmaskMessage.now(0xFFFFFFFFFFFFFFFFn, 1, 1);
    expect(msg.sizeBytes).toBe(24);
    const nlBaseline = 2048;
    const compressionRatio = nlBaseline / msg.sizeBytes;
    expect(compressionRatio).toBeCloseTo(85.3, 0);
  });

  it('supports paper-canonical strategy ranking flow', () => {
    const weights = new Array(64).fill(0);
    weights[0] = 0.42;
    weights[1] = 0.30;
    weights[2] = 0.28;
    const arbiter = new Arbiter({ weights });

    const result = arbiter.scoreStrategies([
      { id: 's1', mask: 0b11n }, // bits 0,1
      { id: 's2', mask: 0b101n }, // bits 0,2
      { id: 's3', mask: 0b1001n }, // bits 0,3
    ]);

    expect(result.decision).toBe('SYNTHESIZE');
    expect(result.synthesizedMask).toBe(1n);
  });
});
