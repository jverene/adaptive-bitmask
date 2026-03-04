import { beforeEach, describe, expect, it } from 'vitest';
import { BITMASK_WIDTH, SchemaManager } from '../index.js';

describe('SchemaManager', () => {
  let schema: SchemaManager;

  beforeEach(() => {
    schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
  });

  it('registers regular and emergency features in expected ranges', () => {
    expect(schema.register('price_up')).toBe(0);
    const emergencyBit = schema.register('EMERGENCY_halt');
    expect(emergencyBit).toBeGreaterThanOrEqual(56);
    expect(emergencyBit).toBeLessThanOrEqual(63);
  });

  it('does not duplicate registrations', () => {
    const bit1 = schema.register('feature_a');
    const bit2 = schema.register('feature_a');
    expect(bit1).toBe(bit2);
    expect(schema.activeFeatureCount).toBe(1);
  });

  it('returns -1 when regular or emergency ranges overflow', () => {
    for (let i = 0; i < 56; i++) schema.register(`feat_${i}`);
    expect(schema.register('one_too_many')).toBe(-1);

    for (let i = 0; i < 8; i++) {
      expect(schema.register(`EMERGENCY_${i}`)).toBe(56 + i);
    }
    expect(schema.register('EMERGENCY_overflow')).toBe(-1);
  });

  it('respects maxFeatures guardrail', () => {
    const limited = new SchemaManager({ maxFeatures: 2, emergencyPrefix: 'EMERGENCY_' });
    expect(limited.register('a')).toBe(0);
    expect(limited.register('b')).toBe(1);
    expect(limited.register('c')).toBe(-1);
    expect(limited.activeFeatureCount).toBe(2);
  });

  it('prune retains high-frequency regular features and emergency features', () => {
    for (let i = 0; i < 60; i++) schema.register(`feat_${i}`);
    schema.register('EMERGENCY_halt');

    for (let round = 0; round < 100; round++) {
      const active: string[] = [];
      for (let i = 0; i < 10; i++) active.push(`feat_${i}`);
      if (round % 20 === 0) {
        for (let i = 50; i < 60; i++) active.push(`feat_${i}`);
      }
      schema.recordActivations(active);
    }

    const result = schema.prune();
    expect(result.retained).toBeLessThanOrEqual(BITMASK_WIDTH);
    for (let i = 0; i < 10; i++) {
      expect(schema.featureToBit.has(`feat_${i}`)).toBe(true);
    }
    expect(schema.featureToBit.has('EMERGENCY_halt')).toBe(true);
  });

  it('prune is deterministic for equal-frequency ties', () => {
    const schemaA = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    const schemaB = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });

    schemaA.registerAll(['c', 'a', 'b', 'EMERGENCY_x']);
    schemaB.registerAll(['b', 'c', 'a', 'EMERGENCY_x']);

    for (let i = 0; i < 5; i++) {
      schemaA.recordActivations(['a', 'b', 'c']);
      schemaB.recordActivations(['c', 'b', 'a']);
    }

    schemaA.prune();
    schemaB.prune();
    expect([...schemaA.featureToBit.entries()].sort()).toEqual(
      [...schemaB.featureToBit.entries()].sort()
    );
  });

  it('prune does not bump version when mapping is unchanged', () => {
    schema.registerAll(['alpha', 'beta', 'EMERGENCY_stop']);
    schema.recordActivations(['alpha', 'beta', 'EMERGENCY_stop']);
    schema.prune();
    const v1 = schema.version;
    schema.prune();
    expect(schema.version).toBe(v1);
  });

  it('snapshot returns expected counters', () => {
    schema.registerAll(['a', 'b', 'EMERGENCY_x']);
    const snap = schema.snapshot();
    expect(snap.activeFeatures).toBe(3);
    expect(snap.emergencyCount).toBe(1);
    expect(snap.version).toBeGreaterThan(0);
  });

  it('exports/imports schema with stable fingerprint', () => {
    schema.registerAll(['price_up', 'momentum', 'EMERGENCY_halt']);
    schema.recordActivations(['price_up', 'momentum']);
    schema.prune();

    const exported = schema.exportSchema();
    const restored = new SchemaManager();
    restored.importSchema(exported);

    expect(restored.version).toBe(schema.version);
    expect([...restored.featureToBit.entries()].sort()).toEqual(
      [...schema.featureToBit.entries()].sort()
    );
    expect(restored.fingerprint).toBe(schema.fingerprint);
  });

  it('rejects import when fingerprint is tampered', () => {
    schema.registerAll(['a', 'EMERGENCY_x']);
    const exported = schema.exportSchema();
    const restored = new SchemaManager();
    expect(() =>
      restored.importSchema({ ...exported, fingerprint: 'deadbeefdeadbeef' })
    ).toThrow();
  });
});
