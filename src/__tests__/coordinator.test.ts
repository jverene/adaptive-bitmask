import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitmaskMessage, Coordinator, empty, setBit, testBit } from '../index.js';

describe('Coordinator', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    coordinator = new Coordinator({ deadlineMs: 100 });
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

  it('computes per-bit confidence', () => {
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 1, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 2, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 5), 3, 1));
    const result = coordinator.aggregate();
    expect(result.confidence.get(0)).toBeCloseTo(2 / 3);
    expect(result.confidence.get(5)).toBeCloseTo(1 / 3);
  });

  it('deduplicates agent messages by keeping latest', () => {
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 0), 1, 1));
    coordinator.receive(BitmaskMessage.now(setBit(empty(), 5), 1, 1));
    const result = coordinator.aggregate();
    expect(result.messageCount).toBe(1);
    expect(result.uniqueAgents).toBe(1);
  });

  it('counts stale messages under default accept policy', () => {
    coordinator.schemaVersion = 2;
    coordinator.startRound();
    coordinator.receive(BitmaskMessage.now(0n, 1, 1));
    coordinator.receive(BitmaskMessage.now(0n, 2, 2));
    const result = coordinator.aggregate();
    expect(result.staleMessages).toBe(1);
    expect(result.droppedStaleMessages).toBe(0);
  });

  it('drops stale messages when policy is drop', () => {
    const dropCoordinator = new Coordinator({
      deadlineMs: 100,
      schemaVersion: 2,
      staleMessagePolicy: 'drop',
    });
    dropCoordinator.startRound();
    const acceptedStale = dropCoordinator.receive(BitmaskMessage.now(0n, 1, 1));
    const acceptedFresh = dropCoordinator.receive(BitmaskMessage.now(0n, 2, 2));
    const result = dropCoordinator.aggregate();
    expect(acceptedStale).toBe(false);
    expect(acceptedFresh).toBe(true);
    expect(result.messageCount).toBe(1);
    expect(result.staleMessages).toBe(0);
    expect(result.droppedStaleMessages).toBe(1);
  });

  it('warns on stale messages when policy is warn', () => {
    const warnCoordinator = new Coordinator({
      deadlineMs: 100,
      schemaVersion: 2,
      staleMessagePolicy: 'warn',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warnCoordinator.startRound();
    warnCoordinator.receive(BitmaskMessage.now(0n, 1, 1));
    const result = warnCoordinator.aggregate();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(result.staleMessages).toBe(1);
    expect(result.droppedStaleMessages).toBe(0);
    warnSpy.mockRestore();
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

  it('tracks aggregation rounds', () => {
    coordinator.startRound();
    coordinator.aggregate();
    coordinator.startRound();
    coordinator.aggregate();
    expect(coordinator.aggregationCount).toBe(2);
  });
});
