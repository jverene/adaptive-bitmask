/**
 * Coordinator — Aggregates bitmasks from multiple agents.
 *
 * Implements the Meta-Coordinator layer:
 * - Collects BitmaskMessages from worker agents
 * - OR-aggregates into unified consensus mask
 * - Computes per-bit confidence (vote fraction)
 * - Provides deadline-based collection with timeout
 */

import { type Bitmask, forEachSetBit } from './bitmask.js';
import { BitmaskMessage } from './message.js';
import type { BitConfidence } from './arbiter.js';

export type StaleMessagePolicy = 'accept' | 'warn' | 'drop';
export type CoordinatorDropReason = 'deadline' | 'stale';

export type CoordinatorTelemetryEvent =
  | {
      type: 'message_accepted';
      agentId: number;
      stale: boolean;
      replaced: boolean;
    }
  | {
      type: 'message_dropped';
      agentId: number;
      reason: CoordinatorDropReason;
    }
  | {
      type: 'round_aggregated';
      result: AggregationResult;
    };

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
  /** Number of stale messages dropped at receive-time. */
  droppedStaleMessages: number;
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
  /** Policy when schema versions mismatch. Default: 'accept'. */
  staleMessagePolicy?: StaleMessagePolicy;
  /** Optional telemetry callback for runtime observability. */
  onTelemetry?: (event: CoordinatorTelemetryEvent) => void;
}

export class Coordinator {
  private _buffer: BitmaskMessage[] = [];
  private _seenAgents = new Set<number>();
  private _schemaVersion: number | undefined;
  private _deadlineMs: number;
  private _staleMessagePolicy: StaleMessagePolicy;
  private _onTelemetry: ((event: CoordinatorTelemetryEvent) => void) | undefined;
  private _roundStartTime = 0;
  private _aggregationCount = 0;
  private _droppedStaleMessages = 0;

  constructor(config: CoordinatorConfig = {}) {
    this._deadlineMs = config.deadlineMs ?? 15; // gRPC default from paper
    this._schemaVersion = config.schemaVersion;
    this._staleMessagePolicy = config.staleMessagePolicy ?? 'accept';
    this._onTelemetry = config.onTelemetry;
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
    this._droppedStaleMessages = 0;
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
        this._emitTelemetry({
          type: 'message_dropped',
          agentId: message.agentId,
          reason: 'deadline',
        });
        return false; // past deadline
      }
    }

    const isStale =
      this._schemaVersion !== undefined &&
      message.schemaVersion !== this._schemaVersion;
    if (isStale) {
      if (this._staleMessagePolicy === 'drop') {
        this._droppedStaleMessages++;
        this._emitTelemetry({
          type: 'message_dropped',
          agentId: message.agentId,
          reason: 'stale',
        });
        return false;
      }
      if (this._staleMessagePolicy === 'warn') {
        console.warn(
          `adaptive-bitmask: stale schema version from agent ${message.agentId} (expected ${this._schemaVersion}, got ${message.schemaVersion})`
        );
      }
    }

    // Duplicate agent check (keep latest)
    if (this._seenAgents.has(message.agentId)) {
      // Replace existing message from this agent
      const idx = this._buffer.findIndex((m) => m.agentId === message.agentId);
      if (idx !== -1) {
        this._buffer[idx] = message;
      }
      this._emitTelemetry({
        type: 'message_accepted',
        agentId: message.agentId,
        stale: isStale,
        replaced: true,
      });
      return true;
    }

    this._seenAgents.add(message.agentId);
    this._buffer.push(message);
    this._emitTelemetry({
      type: 'message_accepted',
      agentId: message.agentId,
      stale: isStale,
      replaced: false,
    });
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
   * Peek at current consensus state without clearing the buffer.
   * Useful for mid-round status queries by AI agents.
   */
  peekAggregate(): AggregationResult {
    if (this._buffer.length === 0) {
      return {
        aggregatedMask: 0n,
        confidence: new Map(),
        messageCount: 0,
        uniqueAgents: 0,
        staleMessages: 0,
        droppedStaleMessages: this._droppedStaleMessages,
        aggregationTimeUs: 0,
      };
    }

    const t0 = performance.now();
    let aggregated = 0n;
    const bitVotes = new Map<number, number>();
    const uniqueAgents = new Set<number>();
    let staleCount = 0;

    for (const msg of this._buffer) {
      uniqueAgents.add(msg.agentId);

      if (this._schemaVersion !== undefined && msg.schemaVersion !== this._schemaVersion) {
        staleCount++;
      }

      aggregated |= msg.mask;

      forEachSetBit(msg.mask, (bit) => {
        bitVotes.set(bit, (bitVotes.get(bit) ?? 0) + 1);
      });
    }

    const confidence = new Map<number, number>();
    for (const [bit, count] of bitVotes) {
      confidence.set(bit, count / this._buffer.length);
    }

    const elapsed = (performance.now() - t0) * 1000;

    return {
      aggregatedMask: aggregated,
      confidence,
      messageCount: this._buffer.length,
      uniqueAgents: uniqueAgents.size,
      staleMessages: staleCount,
      droppedStaleMessages: this._droppedStaleMessages,
      aggregationTimeUs: elapsed,
    };
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
      forEachSetBit(msg.mask, (bit) => {
        bitVotes.set(bit, (bitVotes.get(bit) ?? 0) + 1);
      });
    }

    // Convert votes to confidence [0, 1]
    const messageCount = this._buffer.length;
    const confidence: BitConfidence = new Map();
    for (const [bit, votes] of bitVotes) {
      confidence.set(bit, messageCount > 0 ? votes / messageCount : 0);
    }

    const elapsed = (performance.now() - t0) * 1000; // microseconds
    this._aggregationCount++;

    const result: AggregationResult = {
      aggregatedMask: aggregated,
      confidence,
      messageCount,
      uniqueAgents: uniqueAgents.size,
      staleMessages: staleCount,
      droppedStaleMessages: this._droppedStaleMessages,
      aggregationTimeUs: elapsed,
    };

    // Clear buffer for next round
    this._buffer = [];
    this._seenAgents.clear();
    this._roundStartTime = 0;
    this._droppedStaleMessages = 0;

    this._emitTelemetry({ type: 'round_aggregated', result });

    return result;
  }

  private _emitTelemetry(event: CoordinatorTelemetryEvent): void {
    this._onTelemetry?.(event);
  }
}
