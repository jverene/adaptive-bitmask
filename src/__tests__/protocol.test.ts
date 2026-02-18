import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Bitmask primitives
  empty, setBit, clearBit, testBit, popcount, activeBits,
  merge, intersect, delta, hammingDistance,
  hasEmergency, emergencyBits, toBytes, fromBytes,
  encode, decode,
  BITMASK_WIDTH, EMERGENCY_RANGE,
  // Schema
  SchemaManager,
  // Message
  BitmaskMessage, MESSAGE_SIZE_BYTES,
  // Arbiter
  Arbiter, createFinancialArbiter, createRoboticArbiter,
  // Coordinator
  Coordinator,
} from '../index.js';

// ═══════════════════════════════════════════════════════════════
// BITMASK PRIMITIVES
// ═══════════════════════════════════════════════════════════════

describe('Bitmask', () => {
  it('empty returns 0n', () => {
    expect(empty()).toBe(0n);
  });

  it('setBit and testBit work for all 64 positions', () => {
    for (let i = 0; i < 64; i++) {
      let mask = empty();
      mask = setBit(mask, i);
      expect(testBit(mask, i)).toBe(true);
      // Only the bit we just set should be active
      for (let j = 0; j < 64; j++) {
        if (j !== i) expect(testBit(mask, j)).toBe(false);
      }
    }
  });

  it('clearBit removes a set bit', () => {
    let mask = setBit(empty(), 10);
    expect(testBit(mask, 10)).toBe(true);
    mask = clearBit(mask, 10);
    expect(testBit(mask, 10)).toBe(false);
  });

  it('throws on out-of-range positions', () => {
    expect(() => setBit(0n, -1)).toThrow(RangeError);
    expect(() => setBit(0n, 64)).toThrow(RangeError);
    expect(() => testBit(0n, 100)).toThrow(RangeError);
  });

  it('popcount counts set bits correctly', () => {
    expect(popcount(0n)).toBe(0);
    expect(popcount(1n)).toBe(1);
    expect(popcount(0b1111n)).toBe(4);
    // All 64 bits set
    const allSet = (1n << 64n) - 1n;
    expect(popcount(allSet)).toBe(64);
  });

  it('activeBits returns correct positions', () => {
    let mask = empty();
    mask = setBit(mask, 0);
    mask = setBit(mask, 5);
    mask = setBit(mask, 63);
    expect(activeBits(mask)).toEqual([0, 5, 63]);
  });

  it('merge OR-combines masks', () => {
    const a = setBit(empty(), 0);
    const b = setBit(empty(), 1);
    const merged = merge(a, b);
    expect(testBit(merged, 0)).toBe(true);
    expect(testBit(merged, 1)).toBe(true);
    expect(popcount(merged)).toBe(2);
  });

  it('intersect AND-combines masks', () => {
    let a = setBit(setBit(empty(), 0), 1);
    let b = setBit(setBit(empty(), 1), 2);
    const common = intersect(a, b);
    expect(activeBits(common)).toEqual([1]);
  });

  it('delta returns XOR of two masks', () => {
    let prev = setBit(setBit(empty(), 0), 1);
    let next = setBit(setBit(empty(), 1), 2);
    const d = delta(prev, next);
    expect(activeBits(d)).toEqual([0, 2]); // bits that changed
  });

  it('hammingDistance counts differing bits', () => {
    const a = setBit(empty(), 0);
    const b = setBit(empty(), 1);
    expect(hammingDistance(a, b)).toBe(2);
    expect(hammingDistance(a, a)).toBe(0);
  });

  it('hasEmergency detects bits 56-63', () => {
    expect(hasEmergency(empty())).toBe(false);
    expect(hasEmergency(setBit(empty(), 55))).toBe(false);
    expect(hasEmergency(setBit(empty(), 56))).toBe(true);
    expect(hasEmergency(setBit(empty(), 63))).toBe(true);
  });

  it('byte serialization roundtrips', () => {
    const original = setBit(setBit(setBit(empty(), 0), 31), 63);
    const bytes = toBytes(original);
    expect(bytes.length).toBe(8);
    const restored = fromBytes(bytes);
    expect(restored).toBe(original);
  });

  it('encode maps features to bits', () => {
    const schema = new Map([['a', 0], ['b', 5], ['c', 10]]);
    const { mask, mapped, unmapped } = encode(['a', 'c', 'unknown'], schema);
    expect(testBit(mask, 0)).toBe(true);
    expect(testBit(mask, 10)).toBe(true);
    expect(testBit(mask, 5)).toBe(false);
    expect(mapped).toBe(2);
    expect(unmapped).toBe(1);
  });

  it('decode reverses encoding', () => {
    const schema = new Map([['a', 0], ['b', 5]]);
    const reverse = new Map([[0, ['a']], [5, ['b']]]);
    const { mask } = encode(['a', 'b'], schema);
    const features = decode(mask, reverse);
    expect(features).toEqual(['a', 'b']);
  });
});

// ═══════════════════════════════════════════════════════════════
// SCHEMA MANAGER
// ═══════════════════════════════════════════════════════════════

describe('SchemaManager', () => {
  let schema: SchemaManager;

  beforeEach(() => {
    schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
  });

  it('registers regular features to bits 0-47', () => {
    const bit = schema.register('price_up');
    expect(bit).toBe(0);
    expect(schema.featureToBit.get('price_up')).toBe(0);
  });

  it('registers emergency features to bits 56-63', () => {
    const bit = schema.register('EMERGENCY_halt');
    expect(bit).toBeGreaterThanOrEqual(56);
    expect(bit).toBeLessThanOrEqual(63);
  });

  it('does not duplicate registrations', () => {
    const bit1 = schema.register('feature_a');
    const bit2 = schema.register('feature_a');
    expect(bit1).toBe(bit2);
    expect(schema.activeFeatureCount).toBe(1);
  });

  it('registerAll maps multiple features', () => {
    const result = schema.registerAll(['a', 'b', 'c', 'EMERGENCY_x']);
    expect(result.size).toBe(4);
    expect(result.get('EMERGENCY_x')!).toBeGreaterThanOrEqual(56);
    expect(schema.activeFeatureCount).toBe(4);
  });

  it('returns -1 when schema is full', () => {
    // Fill all 56 regular slots (0-47 high, 48-55 med)
    for (let i = 0; i < 56; i++) {
      schema.register(`feat_${i}`);
    }
    const overflow = schema.register('one_too_many');
    expect(overflow).toBe(-1);
  });

  it('emergency slots fill independently from regular', () => {
    // Fill all 8 emergency slots
    for (let i = 0; i < 8; i++) {
      const bit = schema.register(`EMERGENCY_${i}`);
      expect(bit).toBe(56 + i);
    }
    // 9th emergency should fail
    expect(schema.register('EMERGENCY_overflow')).toBe(-1);
    // But regular slots still work
    expect(schema.register('regular_feature')).toBe(0);
  });

  it('prune retains high-frequency features', () => {
    // Register 60 regular features
    for (let i = 0; i < 60; i++) {
      schema.register(`feat_${i}`);
    }
    schema.register('EMERGENCY_halt');

    // Make first 10 features high-frequency
    for (let round = 0; round < 100; round++) {
      const active = [];
      for (let i = 0; i < 10; i++) active.push(`feat_${i}`);
      // Low-frequency features only activate occasionally
      if (round % 20 === 0) {
        for (let i = 50; i < 60; i++) active.push(`feat_${i}`);
      }
      schema.recordActivations(active);
    }

    const result = schema.prune();
    expect(result.retained).toBeLessThanOrEqual(BITMASK_WIDTH);

    // High-frequency features should be retained
    for (let i = 0; i < 10; i++) {
      expect(schema.featureToBit.has(`feat_${i}`)).toBe(true);
    }

    // Emergency feature preserved regardless
    expect(schema.featureToBit.has('EMERGENCY_halt')).toBe(true);

    // Version incremented
    expect(result.version).toBeGreaterThan(0);
  });

  it('emergency features survive pruning even without activations', () => {
    schema.registerAll([
      'EMERGENCY_halt', 'EMERGENCY_breach', 'EMERGENCY_fail',
      'regular_1', 'regular_2',
    ]);

    // Only activate regular features
    for (let i = 0; i < 50; i++) {
      schema.recordActivations(['regular_1', 'regular_2']);
    }

    schema.prune();

    // All emergency features still mapped
    expect(schema.featureToBit.has('EMERGENCY_halt')).toBe(true);
    expect(schema.featureToBit.has('EMERGENCY_breach')).toBe(true);
    expect(schema.featureToBit.has('EMERGENCY_fail')).toBe(true);
  });

  it('snapshot returns consistent state', () => {
    schema.registerAll(['a', 'b', 'EMERGENCY_x']);
    const snap = schema.snapshot();
    expect(snap.activeFeatures).toBe(3);
    expect(snap.emergencyCount).toBe(1);
    expect(snap.version).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// BITMASK MESSAGE
// ═══════════════════════════════════════════════════════════════

describe('BitmaskMessage', () => {
  it('has correct wire size', () => {
    const msg = BitmaskMessage.now(42n, 1, 1);
    expect(msg.sizeBytes).toBe(MESSAGE_SIZE_BYTES);
    expect(MESSAGE_SIZE_BYTES).toBe(24);
  });

  it('serializes and deserializes correctly', () => {
    const original = new BitmaskMessage({
      mask: (1n << 63n) | (1n << 0n), // bits 0 and 63
      agentId: 12345,
      timestampMs: Date.now(),
      schemaVersion: 7,
    });

    const bytes = original.toBytes();
    expect(bytes.length).toBe(24);

    const restored = BitmaskMessage.deserialize(bytes);
    expect(restored.mask).toBe(original.mask);
    expect(restored.agentId).toBe(original.agentId);
    expect(restored.timestampMs).toBe(original.timestampMs);
    expect(restored.schemaVersion).toBe(original.schemaVersion);
  });

  it('handles edge case masks', () => {
    // All zeros
    const zero = new BitmaskMessage({ mask: 0n, agentId: 0, timestampMs: 0, schemaVersion: 0 });
    const restored0 = BitmaskMessage.deserialize(zero.toBytes());
    expect(restored0.mask).toBe(0n);

    // All ones
    const allOnes = (1n << 64n) - 1n;
    const full = new BitmaskMessage({ mask: allOnes, agentId: 0xFFFFFFFF, timestampMs: 0, schemaVersion: 0 });
    const restoredFull = BitmaskMessage.deserialize(full.toBytes());
    expect(restoredFull.mask).toBe(allOnes);
    expect(restoredFull.agentId).toBe(0xFFFFFFFF);
  });

  it('throws on undersized buffer', () => {
    expect(() => BitmaskMessage.deserialize(new Uint8Array(10))).toThrow();
  });

  it('compressionVsJson is > 1', () => {
    const msg = BitmaskMessage.now(0xFFFFn, 1, 1);
    expect(msg.compressionVsJson).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// ARBITER
// ═══════════════════════════════════════════════════════════════

describe('Arbiter', () => {
  it('REJECT on empty mask', () => {
    const arbiter = new Arbiter();
    const result = arbiter.score(0n);
    expect(result.decision).toBe('REJECT');
    expect(result.rawScore).toBe(0);
  });

  it('EXECUTE on high-weight bits with sufficient score', () => {
    const weights = new Array(64).fill(0);
    weights[0] = 1.0;
    weights[1] = 1.0;
    const arbiter = new Arbiter({ weights, executeThreshold: 0.5 });

    // Both high-weight bits set
    const mask = setBit(setBit(empty(), 0), 1);
    const result = arbiter.score(mask);
    expect(result.decision).toBe('EXECUTE');
    expect(result.rawScore).toBe(1.0);
  });

  it('SYNTHESIZE in the middle range', () => {
    const weights = new Array(64).fill(0.1);
    weights[0] = 1.0;
    const arbiter = new Arbiter({
      weights,
      executeThreshold: 0.55,
      synthesizeThreshold: 0.10,
    });

    // Only one high-weight bit
    const mask = setBit(empty(), 0);
    const result = arbiter.score(mask);
    expect(result.decision).toBe('SYNTHESIZE');
  });

  it('emergency override forces REJECT', () => {
    const arbiter = new Arbiter({ emergencyOverride: true });
    const mask = setBit(empty(), 56); // emergency bit
    const result = arbiter.score(mask);
    expect(result.decision).toBe('REJECT');
    expect(result.hasEmergency).toBe(true);
  });

  it('emergency override can be disabled', () => {
    const weights = new Array(64).fill(0);
    weights[56] = 1.0;
    const arbiter = new Arbiter({
      weights,
      emergencyOverride: false,
      executeThreshold: 0.5,
    });
    const mask = setBit(empty(), 56);
    const result = arbiter.score(mask);
    expect(result.decision).toBe('EXECUTE');
  });

  it('confidence affects scoring', () => {
    const weights = new Array(64).fill(0);
    weights[0] = 1.0;
    const arbiter = new Arbiter({ weights, executeThreshold: 0.5 });

    const mask = setBit(empty(), 0);

    // High confidence
    const highConf = new Map([[0, 1.0]]);
    const resultHigh = arbiter.score(mask, highConf);

    // Low confidence
    const lowConf = new Map([[0, 0.1]]);
    const resultLow = arbiter.score(mask, lowConf);

    expect(resultHigh.finalScore).toBeGreaterThan(resultLow.finalScore);
  });

  it('scoreMessages aggregates and scores', () => {
    const arbiter = new Arbiter();
    const messages = [
      BitmaskMessage.now(setBit(empty(), 0), 1, 1),
      BitmaskMessage.now(setBit(empty(), 1), 2, 1),
      BitmaskMessage.now(setBit(empty(), 0), 3, 1),
    ];
    const result = arbiter.scoreMessages(messages, 1);
    expect(result.activeBitCount).toBeGreaterThanOrEqual(2); // bits 0 and 1
    expect(result.staleCount).toBe(0);
  });

  it('scoreMessages detects stale schema versions', () => {
    const arbiter = new Arbiter();
    const messages = [
      BitmaskMessage.now(setBit(empty(), 0), 1, 1),
      BitmaskMessage.now(setBit(empty(), 0), 2, 2), // stale
    ];
    const result = arbiter.scoreMessages(messages, 1);
    expect(result.staleCount).toBe(1);
  });

  it('tracks decision count', () => {
    const arbiter = new Arbiter();
    arbiter.score(0n);
    arbiter.score(0n);
    arbiter.score(0n);
    expect(arbiter.decisionCount).toBe(3);
  });

  it('createFinancialArbiter has correct emergency weights', () => {
    const arbiter = createFinancialArbiter();
    const w = arbiter.weights;
    expect(w[56]).toBe(0.45); // emergency bits
    expect(w[0]).toBe(0.25);  // price_trend_up
  });

  it('createRoboticArbiter exists and has emergency override', () => {
    const arbiter = createRoboticArbiter();
    const mask = setBit(empty(), 56);
    const result = arbiter.score(mask);
    expect(result.decision).toBe('REJECT'); // emergency override
  });
});

// ═══════════════════════════════════════════════════════════════
// COORDINATOR
// ═══════════════════════════════════════════════════════════════

describe('Coordinator', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    coordinator = new Coordinator({ deadlineMs: 100 }); // generous deadline for tests
  });

  it('receives and aggregates messages', () => {
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 1, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 5), 2, 1));

    const result = coordinator.aggregate();
    expect(result.messageCount).toBe(2);
    expect(result.uniqueAgents).toBe(2);
    expect(testBit(result.aggregatedMask, 0)).toBe(true);
    expect(testBit(result.aggregatedMask, 5)).toBe(true);
  });

  it('computes per-bit confidence correctly', () => {
    coordinator.startRound();
    // 3 agents: 2 set bit 0, 1 sets bit 5
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 1, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 2, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 5), 3, 1));

    const result = coordinator.aggregate();
    expect(result.confidence.get(0)).toBeCloseTo(2 / 3);
    expect(result.confidence.get(5)).toBeCloseTo(1 / 3);
  });

  it('deduplicates agent messages (keeps latest)', () => {
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 1, 1)); // first from agent 1
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 5), 1, 1)); // update from agent 1

    const result = coordinator.aggregate();
    expect(result.messageCount).toBe(1);
    expect(result.uniqueAgents).toBe(1);
  });

  it('detects stale schema versions', () => {
    coordinator.schemaVersion = 2;
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(0n, 1, 1)); // stale v1
    coordinator.receive(BitmaskMessage.now(0n, 2, 2)); // current v2

    const result = coordinator.aggregate();
    expect(result.staleMessages).toBe(1);
  });

  it('receiveAll returns accepted count', () => {
    coordinator.startRound();
    const messages = Array.from({ length: 10 }, (_, i) =>
      BitmaskMessage.now(setBit(empty(), i), i, 1)
    );
    const accepted = coordinator.receiveAll(messages);
    expect(accepted).toBe(10);
    expect(coordinator.bufferedCount).toBe(10);
  });

  it('clears buffer after aggregation', () => {
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(0n, 1, 1));
    expect(coordinator.bufferedCount).toBe(1);

    coordinator.aggregate();
    expect(coordinator.bufferedCount).toBe(0);
  });

  it('tracks aggregation count', () => {
    coordinator.startRound();
    coordinator.aggregate();
    coordinator.startRound();
    coordinator.aggregate();
    expect(coordinator.aggregationCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: FULL PIPELINE
// ═══════════════════════════════════════════════════════════════

describe('Full Pipeline Integration', () => {
  it('runs a complete coordination round', () => {
    // Setup
    const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    schema.registerAll([
      'price_up', 'price_down', 'vol_high', 'vol_low',
      'volume_spike', 'momentum', 'breakout',
      'EMERGENCY_halt', 'EMERGENCY_breach',
    ]);

    const arbiter = createFinancialArbiter();
    const coordinator = new Coordinator({ deadlineMs: 100 });

    // Simulate 5 agents observing market
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

      // Verify wire format
      const bytes = msg.toBytes();
      expect(bytes.length).toBe(24);
      const restored = BitmaskMessage.deserialize(bytes);
      expect(restored.mask).toBe(msg.mask);

      coordinator.receive(msg);
    }

    // Aggregate
    const { aggregatedMask, confidence, messageCount } = coordinator.aggregate();
    expect(messageCount).toBe(5);

    // Arbiter decision
    const result = arbiter.score(aggregatedMask, confidence);
    expect(['EXECUTE', 'SYNTHESIZE', 'REJECT']).toContain(result.decision);
    expect(result.scoringTimeUs).toBeDefined();
    expect(result.activeBitCount).toBeGreaterThan(0);

    // Track activations for schema evolution
    for (const obs of agentObservations) {
      schema.recordActivations(obs);
    }
  });

  it('handles emergency scenario correctly', () => {
    const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    schema.registerAll(['normal_feat', 'EMERGENCY_halt']);

    const arbiter = createFinancialArbiter(); // has emergency override
    const coordinator = new Coordinator();

    coordinator.startRound();

    // Agent reports emergency
    const { mask } = encode(['normal_feat', 'EMERGENCY_halt'], schema.featureToBit);
    coordinator.receive(BitmaskMessage.now(mask, 0, schema.version));

    const { aggregatedMask, confidence } = coordinator.aggregate();
    const result = arbiter.score(aggregatedMask, confidence);

    // Should REJECT due to emergency override
    expect(result.decision).toBe('REJECT');
    expect(result.hasEmergency).toBe(true);
  });

  it('compression ratio matches paper claims', () => {
    const msg = BitmaskMessage.now(0xFFFFFFFFFFFFFFFFn, 1, 1);

    // Wire format: 24 bytes
    expect(msg.sizeBytes).toBe(24);

    // NL baseline: ~2KB per agent (paper claim)
    const nlBaseline = 2048;
    const compressionRatio = nlBaseline / msg.sizeBytes;

    // Paper claims 85× compression
    expect(compressionRatio).toBeCloseTo(85.3, 0);
  });
});
