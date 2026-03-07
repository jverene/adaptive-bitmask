# adaptive-bitmask

**To view the paper: "Go to files" -> "Adaptive Protocol(5)"**

Sub-10ms coordination protocol for multi-agent systems. 85× bandwidth reduction through semantic bitmask encoding.

```bash
npm install adaptive-bitmask
```

## What is this?

When you coordinate hundreds of AI agents, each one needs to share its state with a coordinator. Natural language messages are ~2KB each. At 1,000 agents running at 100Hz, that's 200MB/s of bandwidth just for coordination.

`adaptive-bitmask` encodes agent state as 64-bit bitmasks (24 bytes with metadata). Same semantic information, 85× less bandwidth, sub-millisecond processing.

```
Natural Language:  "Agent observes price trending up with strong momentum and volume spike"  → 753 bytes
Bitmask Protocol:  0b...0000010100000101  →  24 bytes
```

## Quick Start

```typescript
import {
  SchemaManager,
  BitmaskMessage,
  Coordinator,
  Arbiter,
  encode,
} from 'adaptive-bitmask';

// 1. Define your feature vocabulary
const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll([
  'price_up', 'vol_high', 'momentum', 'breakout',
  'EMERGENCY_halt',  // pinned to bits 56-63, never pruned
]);

// 2. Encode agent observations as bitmasks
const { mask } = encode(['price_up', 'momentum'], schema.featureToBit);
const msg = BitmaskMessage.now(mask, agentId, schema.version);
// msg.sizeBytes === 24  (vs ~2KB natural language)

// 3. Aggregate across agents
const coordinator = new Coordinator({ deadlineMs: 15 });
coordinator.startRound();
coordinator.receive(msg);
// ... receive from other agents ...
const { aggregatedMask, confidence } = coordinator.aggregate();

// 4. Make a decision
const arbiter = new Arbiter({ executeThreshold: 0.55 });
const { decision, finalScore } = arbiter.score(aggregatedMask, confidence);
// decision: 'EXECUTE' | 'SYNTHESIZE' | 'REJECT'
```

## Architecture

Based on the [Adaptive Bitmask Protocol paper](https://arxiv.org/abs/TODO) (Jiang, 2026):

```
Layer 0: SchemaManager    ← Feature-to-bit mappings, frequency pruning
Layer 1: Worker Agents    ← Encode observations as 64-bit bitmasks
Layer 2: Coordinator      ← OR-aggregate, compute per-bit confidence
Layer 3: Arbiter          ← Weighted scoring → EXECUTE / SYNTHESIZE / REJECT
```

**24-byte wire format:**
| Offset | Type | Field |
|--------|------|-------|
| 0-7 | uint64 | Feature bitmask |
| 8-11 | uint32 | Agent ID |
| 12-19 | int64 | Timestamp (ms) |
| 20-23 | uint32 | Schema version |

## Key Features

**Schema Management** — Dynamic feature-to-bit mapping with frequency-based pruning. Emergency features (bits 56-63) are never pruned regardless of activation frequency.

```typescript
const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll(myFeatures);
schema.recordActivations(observedFeatures);
schema.prune();  // retains top-56 by frequency + all emergency features

// Paper-aligned collision math utilities
const p = schema.theoreticalCollisionRate;
// p = 1 - (1 - 1/64)^(m - 1), where m = activeFeatureCount

const excluded = schema.expectedExcludedFeatures(80);
// E[excluded] = m - 64 * (1 - (1 - 1/64)^m)
```

**Schema Distribution** — Deterministic schema export/import with fingerprinting for cross-node compatibility checks.

```typescript
const exported = schema.exportSchema();
// Send exported JSON through your control plane

const replica = new SchemaManager();
replica.importSchema(exported);
// replica.fingerprint === schema.fingerprint
```

**Binary Serialization** — Messages serialize to exactly 24 bytes. Round-trips through `serialize()` / `deserialize()` for any transport layer.

```typescript
const bytes = msg.toBytes();     // Uint8Array(24)
const restored = BitmaskMessage.deserialize(bytes);
```

**Weighted Scoring** — Configurable importance weights per bit position. Domain-specific presets included.

```typescript
import { createFinancialArbiter, createRoboticArbiter } from 'adaptive-bitmask';

const arbiter = createFinancialArbiter();  // emergency bits weighted 0.45
const arbiter = createRoboticArbiter();    // obstacle detection weighted 0.30
```

**Paper-Canonical Strategy Arbitration (Section 6)** — Rank strategy candidates by `s_final = 0.6*s_raw + 0.4*c`, then apply lead/synthesis thresholds.

```typescript
const result = arbiter.scoreStrategies([
  { id: 'trend', mask: trendMask, confidence: trendConf },
  { id: 'mean_revert', mask: mrMask, confidence: mrConf },
  { id: 'breakout', mask: boMask, confidence: boConf },
], {
  leadThreshold: 0.15,
  rejectThreshold: 0.40,
});
```

Legacy compatibility: `arbiter.score(mask, confidence?)` remains unchanged for existing integrations.

**Bitwise Primitives** — Full suite of 64-bit operations using BigInt for precision.

```typescript
import { setBit, popcount, merge, delta, hammingDistance } from 'adaptive-bitmask';
```

**Strict Encoding Mode** — Fail fast on unknown features to catch schema drift at ingestion time.

```typescript
const { mask } = encode(features, schema.featureToBit, {
  throwOnUnknownFeatures: true,
});
```

**Stale Schema Policy** — Choose how coordinators handle version-mismatched messages.

```typescript
const coordinator = new Coordinator({
  schemaVersion: schema.version,
  staleMessagePolicy: 'drop', // 'accept' | 'warn' | 'drop'
});
```

**Telemetry Hooks** — Attach runtime callbacks for coordination and decision metrics.

```typescript
const coordinator = new Coordinator({
  onTelemetry: (event) => {
    if (event.type === 'round_aggregated') {
      console.log(event.result.aggregationTimeUs);
    }
  },
});

const arbiter = new Arbiter({
  onTelemetry: (event) => {
    if (event.type === 'decision') {
      console.log(event.result.finalScore);
    }
  },
});
```

## Performance

Measured on the protocol simulation (1,000 trials):

| Operation | Mean | p99 |
|-----------|------|-----|
| Encode features | 2.0μs | 3.9μs |
| Serialize message | 0.5μs | 0.8μs |
| Aggregate (10 agents) | 84μs | 122μs |
| Score (weighted linear) | 15μs | 26μs |
| **Full pipeline (no LLM)** | **110μs** | **159μs** |

The protocol overhead is negligible. LLM inference (6.8ms) accounts for 97.7% of end-to-end latency.

## Migration Notes (`0.1.x` -> `0.2.0-rc.0`)

`BitmaskMessage` validation is now strict:
- `deserialize()` now requires exactly `24` bytes (not "at least 24")
- constructor throws for out-of-range `mask`, `agentId`, `schemaVersion`, or unsafe `timestampMs`

Coordinator behavior adds explicit stale handling:
- new config: `staleMessagePolicy: 'accept' | 'warn' | 'drop'`
- aggregate output now includes `droppedStaleMessages`

Schema coordination helpers are now available:
- `schema.exportSchema()` / `schema.importSchema(...)`
- deterministic `schema.fingerprint` for compatibility checks

## Transport

This library is **transport-agnostic**. The 24-byte message format works with any transport layer:

```typescript
// WebSocket
ws.send(msg.toBytes());

// gRPC (as bytes field)
grpcStream.write({ payload: msg.toBytes() });

// HTTP (base64 or raw body)
fetch('/coordinate', { body: msg.serialize() });

// Vercel AI SDK (coming soon)
```

Optional helper for control-plane metadata:

```typescript
import { createEnvelope, decodeEnvelope } from 'adaptive-bitmask';

const envelope = createEnvelope(msg, schema.fingerprint, 'round-42');
const restored = decodeEnvelope(envelope, schema.fingerprint);
```

See [examples/transport.ts](/Users/hjiang/Developer/adaptive-bitmask/examples/transport.ts) for end-to-end transport payload patterns.

## Benchmarking

```bash
npm run benchmark
```

Writes benchmark results to `benchmarks/latest.json`.

```bash
npm run benchmark:run
npm run benchmark:check
```

`benchmark:check` fails if an operation regresses beyond both thresholds:
- relative: `BENCH_MAX_REGRESSION_PCT` (default `40`)
- absolute: `BENCH_MAX_ABS_REGRESSION_US` (default `1.5`)
- baseline file: `BENCH_BASELINE_PATH` (default `benchmarks/baseline.json`)

## API Reference

### Bitmask Primitives

`empty()` · `setBit(mask, pos)` · `clearBit(mask, pos)` · `testBit(mask, pos)` · `popcount(mask)` · `activeBits(mask)` · `forEachSetBit(mask, fn)` · `merge(a, b)` · `intersect(a, b)` · `delta(prev, next)` · `hammingDistance(a, b)` · `hasEmergency(mask)` · `toBytes(mask)` · `fromBytes(buf)` · `encode(features, schema, options?)` · `decode(mask, reverseSchema)`

### SchemaManager

`new SchemaManager(config?)` · `.register(feature)` · `.registerAll(features)` · `.recordActivations(features)` · `.prune()` · `.snapshot()` · `.exportSchema()` · `.importSchema(exported)` · `.expectedExcludedFeatures(featureCount?)` · `.theoreticalCollisionRate` · `.fingerprint` · `.featureToBit` · `.bitToFeatures` · `.version`

### BitmaskMessage

`new BitmaskMessage(data)` · `BitmaskMessage.now(mask, agentId, version)` · `.serialize()` · `.toBytes()` · `BitmaskMessage.deserialize(buf)` · `.sizeBytes` · `.compressionVsJson`

### Arbiter

`new Arbiter(config?)` · `.score(mask, confidence?)` (legacy) · `.scoreStrategies(candidates, options?)` (paper-canonical) · `.scoreMessages(messages, version?)` · `.setWeight(pos, weight)` · `createFinancialArbiter()` · `createRoboticArbiter()` (`onTelemetry`)

### Coordinator

`new Coordinator(config?)` · `.startRound()` · `.receive(msg)` · `.receiveAll(msgs)` · `.aggregate()` · `.schemaVersion` (`staleMessagePolicy`: `'accept' | 'warn' | 'drop'`, `onTelemetry`)

### Transport Envelope

`createEnvelope(msg, schemaFingerprint, roundId?)` · `decodeEnvelope(envelope, expectedSchemaFingerprint?)`

## License

MIT
