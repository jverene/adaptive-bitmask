/**
 * Bitmask — 64-bit semantic feature encoding.
 *
 * Core primitive of the Adaptive Bitmask Protocol.
 * Encodes boolean feature vectors as a single uint64,
 * enabling O(N) coordination with 85× bandwidth reduction.
 *
 * Uses BigInt for true 64-bit precision (no floating-point truncation).
 */

export const BITMASK_WIDTH = 64;
export const EMERGENCY_RANGE: [number, number] = [56, 63]; // bits 56-63
export const HIGH_FREQ_RANGE: [number, number] = [0, 47]; // bits 0-47
export const MED_FREQ_RANGE: [number, number] = [48, 55]; // bits 48-55

/** A 64-bit bitmask represented as BigInt. */
export type Bitmask = bigint;

const SINGLE_BIT_TO_POSITION = new Map<bigint, number>(
  Array.from({ length: BITMASK_WIDTH }, (_, i) => [1n << BigInt(i), i] as const)
);

/** Create an empty bitmask. */
export function empty(): Bitmask {
  return 0n;
}

/** Set a specific bit position (0-63). */
export function setBit(mask: Bitmask, position: number): Bitmask {
  if (position < 0 || position >= BITMASK_WIDTH) {
    throw new RangeError(`Bit position ${position} out of range [0, ${BITMASK_WIDTH - 1}]`);
  }
  return mask | (1n << BigInt(position));
}

/** Clear a specific bit position. */
export function clearBit(mask: Bitmask, position: number): Bitmask {
  if (position < 0 || position >= BITMASK_WIDTH) {
    throw new RangeError(`Bit position ${position} out of range [0, ${BITMASK_WIDTH - 1}]`);
  }
  return mask & ~(1n << BigInt(position));
}

/** Test if a specific bit is set. */
export function testBit(mask: Bitmask, position: number): boolean {
  if (position < 0 || position >= BITMASK_WIDTH) {
    throw new RangeError(`Bit position ${position} out of range [0, ${BITMASK_WIDTH - 1}]`);
  }
  return (mask & (1n << BigInt(position))) !== 0n;
}

/** Count set bits (population count). */
export function popcount(mask: Bitmask): number {
  let count = 0;
  let m = mask;
  while (m > 0n) {
    m &= m - 1n; // clear lowest set bit
    count++;
  }
  return count;
}

/** Get all set bit positions. */
export function activeBits(mask: Bitmask): number[] {
  const bits: number[] = [];
  forEachSetBit(mask, (bit) => bits.push(bit));
  return bits;
}

/** Invoke callback for each set bit position (ascending). */
export function forEachSetBit(
  mask: Bitmask,
  fn: (position: number) => void
): void {
  if (mask < 0n) {
    throw new RangeError('Bitmask must be non-negative');
  }

  let m = mask;
  while (m !== 0n) {
    const leastSignificantBit = m & -m;
    const position = SINGLE_BIT_TO_POSITION.get(leastSignificantBit);
    if (position === undefined) {
      throw new Error(`Invalid 64-bit mask: ${mask.toString()}`);
    }
    fn(position);
    m ^= leastSignificantBit;
  }
}

/** OR-merge two bitmasks (union of features). */
export function merge(a: Bitmask, b: Bitmask): Bitmask {
  return a | b;
}

/** AND-intersect two bitmasks (common features). */
export function intersect(a: Bitmask, b: Bitmask): Bitmask {
  return a & b;
}

/** XOR-delta between two bitmasks (changed features). */
export function delta(prev: Bitmask, next: Bitmask): Bitmask {
  return prev ^ next;
}

/** Hamming distance between two bitmasks. */
export function hammingDistance(a: Bitmask, b: Bitmask): number {
  return popcount(a ^ b);
}

/** Check if emergency bits (56-63) are active. */
export function hasEmergency(mask: Bitmask): boolean {
  const emergencyMask = 0xFFn << 56n; // bits 56-63
  return (mask & emergencyMask) !== 0n;
}

/** Extract only emergency bits. */
export function emergencyBits(mask: Bitmask): Bitmask {
  return mask & (0xFFn << 56n);
}

/**
 * Serialize bitmask to 8-byte Uint8Array (little-endian).
 * This is the raw bitmask without metadata.
 */
export function toBytes(mask: Bitmask): Uint8Array {
  const buf = new Uint8Array(8);
  let m = mask;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(m & 0xFFn);
    m >>= 8n;
  }
  return buf;
}

/** Deserialize 8-byte Uint8Array to bitmask. */
export function fromBytes(buf: Uint8Array): Bitmask {
  if (buf.length < 8) {
    throw new Error(`Expected 8 bytes, got ${buf.length}`);
  }
  let mask = 0n;
  for (let i = 7; i >= 0; i--) {
    mask = (mask << 8n) | BigInt(buf[i]);
  }
  return mask;
}

export interface EncodeOptions {
  /** Throw if any feature is not present in schema mapping. */
  throwOnUnknownFeatures?: boolean;
}

/**
 * Encode a set of features into a bitmask given a schema mapping.
 * Features not in the schema are silently ignored.
 * Returns the mask and count of mapped/unmapped features.
 */
export function encode(
  features: string[],
  schema: ReadonlyMap<string, number>,
  options: EncodeOptions = {}
): { mask: Bitmask; mapped: number; unmapped: number } {
  let mask = 0n;
  let mapped = 0;
  let unmapped = 0;
  const unknownFeatures: string[] = [];

  for (const feature of features) {
    const bit = schema.get(feature);
    if (bit !== undefined) {
      mask |= 1n << BigInt(bit);
      mapped++;
    } else {
      unmapped++;
      unknownFeatures.push(feature);
    }
  }

  if (options.throwOnUnknownFeatures && unknownFeatures.length > 0) {
    const uniqueUnknown = [...new Set(unknownFeatures)];
    throw new Error(
      `Unknown features (${uniqueUnknown.length}): ${uniqueUnknown.join(', ')}`
    );
  }

  return { mask, mapped, unmapped };
}

/**
 * Decode a bitmask back to feature names.
 * Ambiguous when collisions exist (multiple features per bit).
 */
export function decode(
  mask: Bitmask,
  reverseSchema: ReadonlyMap<number, string[]>
): string[] {
  const features: string[] = [];
  for (let i = 0; i < BITMASK_WIDTH; i++) {
    if (mask & (1n << BigInt(i))) {
      const feats = reverseSchema.get(i);
      if (feats) {
        features.push(...feats);
      }
    }
  }
  return features;
}
