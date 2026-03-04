import { BitmaskMessage } from './message.js';

export interface TransportEnvelope {
  /** Schema fingerprint expected by sender. */
  schemaFingerprint: string;
  /** Optional round identifier from transport layer. */
  roundId?: string;
  /** 24-byte bitmask payload. */
  payload: Uint8Array;
}

/**
 * Wrap a bitmask message with schema metadata for transport-level validation.
 * Payload stays exactly the protocol 24-byte message.
 */
export function createEnvelope(
  message: BitmaskMessage,
  schemaFingerprint: string,
  roundId?: string
): TransportEnvelope {
  if (!schemaFingerprint) {
    throw new Error('schemaFingerprint is required');
  }
  return {
    schemaFingerprint,
    roundId,
    payload: message.toBytes(),
  };
}

/**
 * Validate an envelope and decode the underlying 24-byte message.
 */
export function decodeEnvelope(
  envelope: TransportEnvelope,
  expectedSchemaFingerprint?: string
): BitmaskMessage {
  if (!envelope.schemaFingerprint) {
    throw new Error('Envelope schemaFingerprint is required');
  }
  if (
    expectedSchemaFingerprint &&
    envelope.schemaFingerprint !== expectedSchemaFingerprint
  ) {
    throw new Error(
      `Schema fingerprint mismatch: expected ${expectedSchemaFingerprint}, got ${envelope.schemaFingerprint}`
    );
  }
  return BitmaskMessage.deserialize(envelope.payload);
}
