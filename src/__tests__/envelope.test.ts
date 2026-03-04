import { describe, expect, it } from 'vitest';
import {
  BitmaskMessage,
  SchemaManager,
  createEnvelope,
  decodeEnvelope,
  setBit,
} from '../index.js';

describe('Transport envelope', () => {
  it('wraps and unwraps messages with schema fingerprint', () => {
    const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
    schema.registerAll(['a', 'EMERGENCY_stop']);

    const message = BitmaskMessage.now(setBit(0n, 1), 42, schema.version);
    const envelope = createEnvelope(message, schema.fingerprint, 'round-1');
    const restored = decodeEnvelope(envelope, schema.fingerprint);

    expect(envelope.payload.length).toBe(24);
    expect(restored.mask).toBe(message.mask);
    expect(restored.agentId).toBe(message.agentId);
  });

  it('rejects fingerprint mismatch', () => {
    const message = BitmaskMessage.now(1n, 1, 1);
    const envelope = createEnvelope(message, 'schema-a');
    expect(() => decodeEnvelope(envelope, 'schema-b')).toThrow();
  });
});
