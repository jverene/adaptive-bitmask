/**
 * Transport integration example:
 * - wraps 24-byte messages in a schema-aware envelope
 * - demonstrates WebSocket, gRPC, and HTTP-style usage
 */

import {
  BitmaskMessage,
  SchemaManager,
  createEnvelope,
  decodeEnvelope,
  encode,
} from 'adaptive-bitmask';

const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll([
  'price_up',
  'momentum',
  'volume_spike',
  'EMERGENCY_halt',
]);

const { mask } = encode(
  ['price_up', 'momentum'],
  schema.featureToBit,
  { throwOnUnknownFeatures: true }
);
const message = BitmaskMessage.now(mask, 101, schema.version);
const envelope = createEnvelope(message, schema.fingerprint, 'round-42');

// WebSocket (payload + envelope metadata in JSON)
const wsPayload = JSON.stringify({
  schemaFingerprint: envelope.schemaFingerprint,
  roundId: envelope.roundId,
  payloadBase64: Buffer.from(envelope.payload).toString('base64'),
});
console.log('WebSocket payload bytes:', wsPayload.length);

// gRPC-like transport (binary payload field + metadata fields)
const grpcPayload = {
  schemaFingerprint: envelope.schemaFingerprint,
  roundId: envelope.roundId,
  payload: envelope.payload,
};
console.log('gRPC payload bytes:', grpcPayload.payload.length);

// HTTP fetch-style body
const httpBody = JSON.stringify({
  schemaFingerprint: envelope.schemaFingerprint,
  roundId: envelope.roundId,
  payloadBase64: Buffer.from(envelope.payload).toString('base64'),
});
console.log('HTTP body bytes:', httpBody.length);

// Receiver validates schema compatibility before decode
const restored = decodeEnvelope(envelope, schema.fingerprint);
console.log('Restored agent:', restored.agentId, 'schemaVersion:', restored.schemaVersion);
