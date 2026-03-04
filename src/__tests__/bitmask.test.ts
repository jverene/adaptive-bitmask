import { describe, it, expect } from 'vitest';
import {
  BITMASK_WIDTH,
  clearBit,
  decode,
  delta,
  empty,
  encode,
  fromBytes,
  forEachSetBit,
  hammingDistance,
  hasEmergency,
  intersect,
  merge,
  popcount,
  setBit,
  testBit,
  toBytes,
  activeBits,
} from '../index.js';

function createRng(seed = 0x12345678): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

function randomMask(rng: () => number): bigint {
  const lo = BigInt(rng());
  const hi = BigInt(rng());
  return (hi << 32n) | lo;
}

describe('Bitmask primitives', () => {
  it('empty returns 0n', () => {
    expect(empty()).toBe(0n);
  });

  it('setBit and testBit work across all positions', () => {
    for (let i = 0; i < BITMASK_WIDTH; i++) {
      let mask = empty();
      mask = setBit(mask, i);
      expect(testBit(mask, i)).toBe(true);
      for (let j = 0; j < BITMASK_WIDTH; j++) {
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

  it('supports merge, intersect, delta, and hamming distance', () => {
    const a = setBit(setBit(empty(), 0), 1);
    const b = setBit(setBit(empty(), 1), 2);

    expect(activeBits(merge(a, b))).toEqual([0, 1, 2]);
    expect(activeBits(intersect(a, b))).toEqual([1]);
    expect(activeBits(delta(a, b))).toEqual([0, 2]);
    expect(hammingDistance(a, b)).toBe(2);
  });

  it('popcount and activeBits are consistent', () => {
    const mask = setBit(setBit(setBit(empty(), 0), 31), 63);
    expect(popcount(mask)).toBe(3);
    expect(activeBits(mask)).toEqual([0, 31, 63]);
  });

  it('forEachSetBit iterates active positions in ascending order', () => {
    const mask = setBit(setBit(setBit(empty(), 4), 1), 63);
    const visited: number[] = [];
    forEachSetBit(mask, (bit) => visited.push(bit));
    expect(visited).toEqual([1, 4, 63]);
  });

  it('detects emergency bits', () => {
    expect(hasEmergency(empty())).toBe(false);
    expect(hasEmergency(setBit(empty(), 55))).toBe(false);
    expect(hasEmergency(setBit(empty(), 56))).toBe(true);
    expect(hasEmergency(setBit(empty(), 63))).toBe(true);
  });

  it('toBytes and fromBytes roundtrip known masks', () => {
    const mask = setBit(setBit(setBit(empty(), 0), 31), 63);
    const bytes = toBytes(mask);
    expect(bytes.length).toBe(8);
    expect(fromBytes(bytes)).toBe(mask);
  });

  it('toBytes and fromBytes roundtrip randomized masks', () => {
    const rng = createRng();
    for (let i = 0; i < 500; i++) {
      const mask = randomMask(rng);
      expect(fromBytes(toBytes(mask))).toBe(mask);
    }
  });

  it('encode maps features and tracks unmapped', () => {
    const schema = new Map([
      ['a', 0],
      ['b', 5],
      ['c', 10],
    ]);
    const { mask, mapped, unmapped } = encode(['a', 'c', 'unknown'], schema);
    expect(testBit(mask, 0)).toBe(true);
    expect(testBit(mask, 10)).toBe(true);
    expect(mapped).toBe(2);
    expect(unmapped).toBe(1);
  });

  it('decode reverses encoding for non-colliding schema', () => {
    const schema = new Map([
      ['a', 0],
      ['b', 5],
    ]);
    const reverse = new Map<number, string[]>([
      [0, ['a']],
      [5, ['b']],
    ]);
    const { mask } = encode(['a', 'b'], schema);
    expect(decode(mask, reverse)).toEqual(['a', 'b']);
  });

  it('encode/decode invariants hold across randomized feature sets', () => {
    const schema = new Map<string, number>();
    const reverse = new Map<number, string[]>();
    for (let i = 0; i < 32; i++) {
      const feature = `f_${i}`;
      schema.set(feature, i);
      reverse.set(i, [feature]);
    }

    const rng = createRng(0x89abcdef);
    for (let t = 0; t < 200; t++) {
      const features: string[] = [];
      for (let i = 0; i < 20; i++) {
        const pick = rng() % 40;
        if (pick < 32) features.push(`f_${pick}`);
        else features.push(`x_${pick}`);
      }

      const { mask, mapped } = encode(features, schema);
      const decoded = decode(mask, reverse);
      const expected = [...new Set(features.filter((f) => schema.has(f)))].sort();
      expect(mapped).toBeGreaterThanOrEqual(0);
      expect([...new Set(decoded)].sort()).toEqual(expected);
    }
  });
});
