import { describe, expect, it } from 'vitest';
import { BitmaskMessage, MESSAGE_SIZE_BYTES } from '../index.js';

function createRng(seed = 0x41c64e6d): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

describe('BitmaskMessage', () => {
  it('has exact 24-byte wire size', () => {
    const msg = BitmaskMessage.now(42n, 1, 1);
    expect(msg.sizeBytes).toBe(MESSAGE_SIZE_BYTES);
    expect(MESSAGE_SIZE_BYTES).toBe(24);
  });

  it('serializes and deserializes known values', () => {
    const original = new BitmaskMessage({
      mask: (1n << 63n) | 1n,
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

  it('roundtrips randomized messages', () => {
    const rng = createRng();
    for (let i = 0; i < 500; i++) {
      const lo = BigInt(rng());
      const hi = BigInt(rng());
      const mask = (hi << 32n) | lo;
      const agentId = rng();
      const schemaVersion = rng();
      const timestampMs = Number((BigInt(rng()) << 20n) | BigInt(rng() & 0xFFFFF));

      const original = new BitmaskMessage({
        mask,
        agentId,
        timestampMs,
        schemaVersion,
      });
      const restored = BitmaskMessage.deserialize(original.toBytes());
      expect(restored.mask).toBe(original.mask);
      expect(restored.agentId).toBe(original.agentId);
      expect(restored.timestampMs).toBe(original.timestampMs);
      expect(restored.schemaVersion).toBe(original.schemaVersion);
    }
  });

  it('rejects undersized and oversized payloads', () => {
    expect(() => BitmaskMessage.deserialize(new Uint8Array(10))).toThrow();
    expect(() => BitmaskMessage.deserialize(new Uint8Array(25))).toThrow();
    expect(() => BitmaskMessage.deserialize(new ArrayBuffer(32))).toThrow();
  });

  it('validates uint32 ranges and timestamp bounds', () => {
    expect(
      () =>
        new BitmaskMessage({
          mask: 1n,
          agentId: -1,
          timestampMs: Date.now(),
          schemaVersion: 1,
        })
    ).toThrow(RangeError);

    expect(
      () =>
        new BitmaskMessage({
          mask: 1n,
          agentId: 1,
          timestampMs: Date.now(),
          schemaVersion: 0x1_0000_0000,
        })
    ).toThrow(RangeError);

    expect(
      () =>
        new BitmaskMessage({
          mask: 1n,
          agentId: 1,
          timestampMs: Number.MAX_SAFE_INTEGER + 1,
          schemaVersion: 1,
        })
    ).toThrow(RangeError);
  });

  it('validates uint64 mask range', () => {
    expect(
      () =>
        new BitmaskMessage({
          mask: -1n,
          agentId: 1,
          timestampMs: Date.now(),
          schemaVersion: 1,
        })
    ).toThrow(RangeError);

    expect(
      () =>
        new BitmaskMessage({
          mask: 1n << 64n,
          agentId: 1,
          timestampMs: Date.now(),
          schemaVersion: 1,
        })
    ).toThrow(RangeError);
  });

  it('reports compression ratio vs JSON', () => {
    const msg = BitmaskMessage.now(0xFFFFn, 1, 1);
    expect(msg.compressionVsJson).toBeGreaterThan(1);
  });
});
