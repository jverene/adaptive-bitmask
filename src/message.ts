/**
 * BitmaskMessage — Wire format for agent coordination.
 *
 * Layout (24 bytes):
 *   [0..7]   uint64  mask            — 64-bit feature bitmask
 *   [8..11]  uint32  agentId         — Unique agent identifier
 *   [12..19] int64   timestampMs     — Unix timestamp (millis)
 *   [20..23] uint32  schemaVersion   — Schema epoch for validation
 *
 * All fields little-endian for consistency with x86-64.
 */

import type { Bitmask } from './bitmask.js';

export const MESSAGE_SIZE_BYTES = 24;
const UINT32_MAX = 0xFFFFFFFF;
const UINT64_MAX = (1n << 64n) - 1n;

export interface BitmaskMessageData {
  /** 64-bit feature bitmask. */
  mask: Bitmask;
  /** Unique agent identifier. */
  agentId: number;
  /** Unix timestamp in milliseconds. */
  timestampMs: number;
  /** Schema version this mask was encoded against. */
  schemaVersion: number;
}

export class BitmaskMessage implements BitmaskMessageData {
  readonly mask: Bitmask;
  readonly agentId: number;
  readonly timestampMs: number;
  readonly schemaVersion: number;

  constructor(data: BitmaskMessageData) {
    this._assertValid(data);
    this.mask = data.mask;
    this.agentId = data.agentId;
    this.timestampMs = data.timestampMs;
    this.schemaVersion = data.schemaVersion;
  }

  /** Create a message with current timestamp. */
  static now(mask: Bitmask, agentId: number, schemaVersion: number): BitmaskMessage {
    return new BitmaskMessage({
      mask,
      agentId,
      timestampMs: Date.now(),
      schemaVersion,
    });
  }

  /** Wire size in bytes. */
  get sizeBytes(): number {
    return MESSAGE_SIZE_BYTES;
  }

  /**
   * Serialize to 24-byte ArrayBuffer (little-endian).
   *
   * This is the canonical wire format. gRPC/WebSocket transports
   * should send these bytes directly.
   */
  serialize(): ArrayBuffer {
    const buf = new ArrayBuffer(MESSAGE_SIZE_BYTES);
    const view = new DataView(buf);

    // mask: uint64 at offset 0 (little-endian)
    view.setBigUint64(0, this.mask, true);
    // agentId: uint32 at offset 8
    view.setUint32(8, this.agentId, true);
    // timestampMs: int64 at offset 12 (as BigInt)
    view.setBigInt64(12, BigInt(this.timestampMs), true);
    // schemaVersion: uint32 at offset 20
    view.setUint32(20, this.schemaVersion, true);

    return buf;
  }

  /** Serialize to Uint8Array. */
  toBytes(): Uint8Array {
    return new Uint8Array(this.serialize());
  }

  /**
   * Deserialize from ArrayBuffer or Uint8Array.
   * Validates length before parsing.
   */
  static deserialize(data: ArrayBuffer | Uint8Array): BitmaskMessage {
    const buf = data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;

    if (buf.byteLength !== MESSAGE_SIZE_BYTES) {
      throw new Error(
        `Invalid message: expected exactly ${MESSAGE_SIZE_BYTES} bytes, got ${buf.byteLength}`
      );
    }

    const view = new DataView(buf);

    return new BitmaskMessage({
      mask: view.getBigUint64(0, true),
      agentId: view.getUint32(8, true),
      timestampMs: Number(view.getBigInt64(12, true)),
      schemaVersion: view.getUint32(20, true),
    });
  }

  /**
   * JSON-equivalent size for comparison.
   * Useful for demonstrating compression ratio.
   */
  get jsonSize(): number {
    return JSON.stringify({
      mask: this.mask.toString(),
      agentId: this.agentId,
      timestampMs: this.timestampMs,
      schemaVersion: this.schemaVersion,
    }).length;
  }

  /** Compression ratio vs JSON encoding. */
  get compressionVsJson(): number {
    return this.jsonSize / MESSAGE_SIZE_BYTES;
  }

  /** Human-readable string for debugging. */
  toString(): string {
    return (
      `BitmaskMessage(agent=${this.agentId}, v=${this.schemaVersion}, ` +
      `bits=${this.mask.toString(2).padStart(64, '0')}, t=${this.timestampMs})`
    );
  }

  private _assertValid(data: BitmaskMessageData): void {
    if (typeof data.mask !== 'bigint') {
      throw new TypeError(`mask must be bigint, got ${typeof data.mask}`);
    }
    if (data.mask < 0n || data.mask > UINT64_MAX) {
      throw new RangeError(`mask out of uint64 range: ${data.mask.toString()}`);
    }
    this._assertUint32('agentId', data.agentId);
    this._assertUint32('schemaVersion', data.schemaVersion);
    if (!Number.isSafeInteger(data.timestampMs)) {
      throw new RangeError(
        `timestampMs must be a safe integer, got ${data.timestampMs}`
      );
    }
  }

  private _assertUint32(field: 'agentId' | 'schemaVersion', value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new RangeError(
        `${field} must be an integer in [0, ${UINT32_MAX}], got ${value}`
      );
    }
  }
}
