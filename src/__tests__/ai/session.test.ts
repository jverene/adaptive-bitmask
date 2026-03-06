import { beforeEach, describe, expect, it } from 'vitest';
import { CoordinationSession } from '../../ai/session.js';

describe('CoordinationSession', () => {
  let session: CoordinationSession;

  beforeEach(() => {
    session = new CoordinationSession({
      features: ['price_up', 'price_down', 'vol_high', 'EMERGENCY_halt'],
      emergencyPrefix: 'EMERGENCY_',
    });
  });

  it('registers all features in the schema', () => {
    expect(session.schema.featureToBit.has('price_up')).toBe(true);
    expect(session.schema.featureToBit.has('price_down')).toBe(true);
    expect(session.schema.featureToBit.has('vol_high')).toBe(true);
    expect(session.schema.featureToBit.has('EMERGENCY_halt')).toBe(true);
  });

  it('generates deterministic agent IDs from names', () => {
    const id1 = session.agentId('agent-alpha');
    const id2 = session.agentId('agent-alpha');
    const id3 = session.agentId('agent-beta');
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toBeGreaterThanOrEqual(0);
    expect(id1).toBeLessThanOrEqual(0xFFFFFFFF);
  });

  it('reports observations and receives them in coordinator', () => {
    session.startRound();
    const result = session.report('agent-1', ['price_up', 'vol_high']);
    expect(result.accepted).toBe(true);
    expect(result.mapped).toBe(2);
    expect(result.unmapped).toBe(0);
  });

  it('tracks unmapped features', () => {
    session.startRound();
    const result = session.report('agent-1', ['price_up', 'unknown_feat']);
    expect(result.mapped).toBe(1);
    expect(result.unmapped).toBe(1);
  });

  it('runs full report → decide cycle', () => {
    session.startRound();
    session.report('agent-1', ['price_up', 'vol_high']);
    session.report('agent-2', ['price_up', 'price_down']);
    session.report('agent-3', ['price_up']);

    const { decision, aggregatedFeatures, confidence, result } = session.decide();
    expect(['EXECUTE', 'SYNTHESIZE', 'REJECT']).toContain(decision);
    expect(aggregatedFeatures).toContain('price_up');
    expect(confidence).toBeInstanceOf(Map);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('detects emergency features in decision', () => {
    session.startRound();
    session.report('agent-1', ['EMERGENCY_halt', 'price_up']);

    const { result } = session.decide();
    expect(result.hasEmergency).toBe(true);
  });

  it('uses custom coordinator config', () => {
    const custom = new CoordinationSession({
      features: ['feat_a'],
      coordinatorConfig: { deadlineMs: 500 },
    });
    // should not throw — just verifying construction works
    custom.startRound();
    custom.report('agent', ['feat_a']);
    const { decision } = custom.decide();
    expect(['EXECUTE', 'SYNTHESIZE', 'REJECT']).toContain(decision);
  });

  it('uses custom arbiter config', () => {
    const custom = new CoordinationSession({
      features: ['feat_a', 'feat_b'],
      arbiterConfig: { executeThreshold: 0.99 },
    });
    custom.startRound();
    custom.report('agent', ['feat_a']);
    const { decision } = custom.decide();
    // With threshold 0.99, single agent unlikely to reach EXECUTE
    expect(['SYNTHESIZE', 'REJECT']).toContain(decision);
  });
});
