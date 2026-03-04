import { describe, expect, it, vi } from 'vitest';
import {
  Arbiter,
  BitmaskMessage,
  createFinancialArbiter,
  createRoboticArbiter,
  empty,
  setBit,
} from '../index.js';

describe('Arbiter', () => {
  it('rejects empty mask', () => {
    const arbiter = new Arbiter();
    const result = arbiter.score(0n);
    expect(result.decision).toBe('REJECT');
    expect(result.rawScore).toBe(0);
  });

  it('executes on high-weight bits above threshold', () => {
    const weights = new Array(64).fill(0);
    weights[0] = 1;
    weights[1] = 1;
    const arbiter = new Arbiter({ weights, executeThreshold: 0.5 });
    const result = arbiter.score(setBit(setBit(empty(), 0), 1));
    expect(result.decision).toBe('EXECUTE');
    expect(result.rawScore).toBe(1);
  });

  it('returns SYNTHESIZE in middle range', () => {
    const weights = new Array(64).fill(0.1);
    weights[0] = 1;
    const arbiter = new Arbiter({
      weights,
      executeThreshold: 0.55,
      synthesizeThreshold: 0.10,
    });
    expect(arbiter.score(setBit(empty(), 0)).decision).toBe('SYNTHESIZE');
  });

  it('emergency override forces reject by default', () => {
    const arbiter = new Arbiter({ emergencyOverride: true });
    const result = arbiter.score(setBit(empty(), 56));
    expect(result.decision).toBe('REJECT');
    expect(result.hasEmergency).toBe(true);
  });

  it('emergency override can be disabled', () => {
    const weights = new Array(64).fill(0);
    weights[56] = 1;
    const arbiter = new Arbiter({
      weights,
      emergencyOverride: false,
      executeThreshold: 0.5,
    });
    expect(arbiter.score(setBit(empty(), 56)).decision).toBe('EXECUTE');
  });

  it('confidence input changes final score', () => {
    const weights = new Array(64).fill(0);
    weights[0] = 1;
    const arbiter = new Arbiter({ weights, executeThreshold: 0.5 });
    const mask = setBit(empty(), 0);
    const high = arbiter.score(mask, new Map([[0, 1]]));
    const low = arbiter.score(mask, new Map([[0, 0.1]]));
    expect(high.finalScore).toBeGreaterThan(low.finalScore);
  });

  it('scoreMessages aggregates and counts stale messages', () => {
    const arbiter = new Arbiter();
    const messages = [
      BitmaskMessage.now(setBit(empty(), 0), 1, 1),
      BitmaskMessage.now(setBit(empty(), 1), 2, 1),
      BitmaskMessage.now(setBit(empty(), 0), 3, 2),
    ];
    const result = arbiter.scoreMessages(messages, 1);
    expect(result.activeBitCount).toBeGreaterThanOrEqual(2);
    expect(result.staleCount).toBe(1);
  });

  it('tracks decision count', () => {
    const arbiter = new Arbiter();
    arbiter.score(0n);
    arbiter.score(0n);
    arbiter.score(0n);
    expect(arbiter.decisionCount).toBe(3);
  });

  it('maintains score bounds in [0,1]', () => {
    const arbiter = createFinancialArbiter();
    const result = arbiter.score((1n << 64n) - 1n, new Map([[0, 0.75]]));
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(1);
  });

  it('factory arbiters expose expected defaults', () => {
    const financial = createFinancialArbiter();
    const robotic = createRoboticArbiter();
    expect(financial.weights[56]).toBe(0.45);
    expect(financial.weights[0]).toBe(0.25);
    expect(robotic.score(setBit(empty(), 56)).decision).toBe('REJECT');
  });

  it('emits telemetry events', () => {
    const onTelemetry = vi.fn();
    const arbiter = new Arbiter({ onTelemetry });

    arbiter.score(setBit(empty(), 0));
    arbiter.scoreMessages(
      [BitmaskMessage.now(setBit(empty(), 1), 1, 1)],
      1
    );

    expect(onTelemetry).toHaveBeenCalled();
    const eventTypes = onTelemetry.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toContain('decision');
    expect(eventTypes).toContain('score_messages');
  });
});
