/**
 * Coordinator — Aggregates bitmasks from multiple agents.
 *
 * Implements the Meta-Coordinator layer:
 * - Collects BitmaskMessages from worker agents
 * - OR-aggregates into unified consensus mask
 * - Computes per-bit confidence (vote fraction)
 * - Provides deadline-based collection with timeout
 */

import { type Bitmask, BITMASK_WIDTH } from './bitmask.js';
import { BitmaskMessage } from './message.js';
import type { BitConfidence } from './arbiter.js';

export interface AggregationResult {
  /** OR-aggregated mask (union of all agent observations). */
  aggregatedMask: Bitmask;
  /** Per-bit confidence: fraction of agents that set each bit. */
  confidence: BitConfidence;
  /** Number of messages aggregated. */
  messageCount: number;
  /** Number of unique agents represented. */
  uniqueAgents: number;
  /** Number of schema-stale messages (mismatched version). */
  staleMessages: number;
  /** Aggregation time in microseconds. */
  aggregationTimeUs: number;
}

export interface CoordinatorConfig {
  /** Expected number of agents (for pre-allocation). */
  expectedAgents?: number;
  /** Deadline in ms — messages arriving after this are dropped. */
  deadlineMs?: number;
  /** Expected schema version. Messages with different versions are flagged. */
  schemaVersion?: number;
}

export class Coordinator {
  private _buffer: BitmaskMessage[] = [];
  private _seenAgents = new Set<number>();
  private _schemaVersion: number | undefined;
  private _deadlineMs: number;
  private _roundStartTime = 0;
  private _aggregationCount = 0;

  constructor(config: CoordinatorConfig = {}) {
    this._deadlineMs = config.deadlineMs ?? 15; // gRPC default from paper
    this._schemaVersion = config.schemaVersion;
  }

  /** Number of messages in current buffer. */
  get bufferedCount(): number {
    return this._buffer.length;
  }

  /** Total aggregation rounds performed. */
  get aggregationCount(): number {
    return this._aggregationCount;
  }

  /** Update expected schema version. */
  set schemaVersion(version: number) {
    this._schemaVersion = version;
  }

  /** Start a new coordination round. Clears the buffer. */
  startRound(): void {
    this._buffer = [];
    this._seenAgents.clear();
    this._roundStartTime = performance.now();
  }

  /**
   * Receive a message from an agent.
   * Returns false if the message was dropped (deadline exceeded or duplicate agent).
   */
  receive(message: BitmaskMessage): boolean {
    // Deadline check
    if (this._roundStartTime > 0) {
      const elapsed = performance.now() - this._roundStartTime;
      if (elapsed > this._deadlineMs) {
        return false; // past deadline
      }
    }

    // Duplicate agent check (keep latest)
    if (this._seenAgents.has(message.agentId)) {
      // Replace existing message from this agent
      const idx = this._buffer.findIndex((m) => m.agentId === message.agentId);
      if (idx !== -1) {
        this._buffer[idx] = message;
      }
      return true;
    }

    this._seenAgents.add(message.agentId);
    this._buffer.push(message);
    return true;
  }

  /**
   * Receive multiple messages at once.
   * Returns number of messages accepted.
   */
  receiveAll(messages: BitmaskMessage[]): number {
    let accepted = 0;
    for (const msg of messages) {
      if (this.receive(msg)) accepted++;
    }
    return accepted;
  }

  /**
   * Aggregate all buffered messages into a consensus result.
   * Clears the buffer after aggregation.
   */
  aggregate(): AggregationResult {
    const t0 = performance.now();

    let aggregated = 0n;
    const bitVotes = new Map<number, number>();
    let staleCount = 0;
    const uniqueAgents = new Set<number>();

    for (const msg of this._buffer) {
      uniqueAgents.add(msg.agentId);

      // Schema version check
      if (
        this._schemaVersion !== undefined &&
        msg.schemaVersion !== this._schemaVersion
      ) {
        staleCount++;
      }

      // OR-aggregate
      aggregated |= msg.mask;

      // Per-bit vote counting
      for (let bit = 0; bit < BITMASK_WIDTH; bit++) {
        if (msg.mask & (1n << BigInt(bit))) {
          bitVotes.set(bit, (bitVotes.get(bit) ?? 0) + 1);
        }
      }
    }

    // Convert votes to confidence [0, 1]
    const messageCount = this._buffer.length;
    const confidence: BitConfidence = new Map();
    for (const [bit, votes] of bitVotes) {
      confidence.set(bit, messageCount > 0 ? votes / messageCount : 0);
    }

    const elapsed = (performance.now() - t0) * 1000; // microseconds
    this._aggregationCount++;

    // Clear buffer for next round
    this._buffer = [];
    this._seenAgents.clear();

    return {
      aggregatedMask: aggregated,
      confidence,
      messageCount,
      uniqueAgents: uniqueAgents.size,
      staleMessages: staleCount,
      aggregationTimeUs: elapsed,
    };
  }
}
