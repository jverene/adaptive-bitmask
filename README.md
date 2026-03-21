# adaptive-bitmask

`adaptive-bitmask` is a low-latency coordination protocol for multi-agent systems. It reduces coordination payloads to a fixed 24-byte binary format using dynamically pruned semantic bitmasks, with published benchmarks showing up to an 85x reduction versus JSON-based messaging.

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18990535.svg)](https://doi.org/10.5281/zenodo.18990535)
Current package version: `2.0.0`.

## Overview

- Fixed 24-byte wire format for coordination messages
- Sub-10ms coordination targets for multi-agent workloads
- Core package with no runtime dependencies
- Optional AI workflow integration through `adaptive-bitmask/ai`
- Built-in support for telemetry, transport helpers, and schema versioning

See `PRODUCTION_ROADMAP.md` for production validation details.

## Installation

Create a new project with the CLI:

```bash
npx create-swarm
```

The CLI can scaffold a project, configure parallel agent execution, add optional Vercel AI SDK integration, and set up a live dashboard.

Install the package directly:

```bash
npm install adaptive-bitmask
```

## Quick Start

```typescript
import { CoordinationSession } from 'adaptive-bitmask/ai';

const session = new CoordinationSession({
  features: ['price_up', 'volume_spike', 'trend_up'],
  onLog: (log) => console.log(`[${log.agentId}] ${log.content}`),
});

session.logThinking('Agent-1', 'Analyzing volatility clusters...');
session.report('Agent-1', ['price_up', 'volume_spike']);

const { decision: current } = session.peek();
const { decision, aggregatedFeatures } = session.decide();
```

Key observability hooks:

- `session.logThinking(id, msg)` captures agent reasoning for dashboards or logs.
- `session.peek()` inspects mid-round consensus without clearing the buffer.
- `onLog` streams coordination events to a UI, logger, or database sink.

## Features

- Sub-10ms coordination with benchmarked averages as low as `0.08ms`
- Zero runtime dependencies in the core engine
- Live dashboard support for monitoring agent reasoning and consensus
- Production-oriented error handling, circuit breakers, and graceful degradation
- Built-in health checks, metrics collection, and structured logging
- WebSocket and HTTP transport layers
- Security-oriented hooks for validation, rate limiting, and authentication

## Formal Verification (Lean 4)

The core mathematical foundations of the `adaptive-bitmask` protocol are mechanically proven using the Lean 4 theorem prover. This ensures absolute correctness for mission-critical properties.

**Benefits:**
- **Mathematical Certainty:** Core operations like bitwise consensus and threshold logic are proven correct for all possible inputs.
- **Protocol Safety:** Prevents integer overflow, undefined behavior, and logical inconsistencies in distributed decision-making.
- **Algorithmic Trust:** Provides formal guarantees that threshold calculations and aggregation functions strictly adhere to their specifications.

**Running the Verification:**
To run the Lean proofs locally, ensure you have Lean 4 and Lake installed (via `elan`), then run:

```bash
cd lean
lake build
```

See the [Lean Verification Guide](LEAN_VERIFICATION.md) for full details on the formalized properties.

## Deployment Examples

### High-Frequency Trading

```typescript
const tradingCognition = new SharedCognition({
  arbiter: { executeThreshold: 0.60, emergencyOverride: true },
});
```

### IoT Sensor Networks

```typescript
const iotCognition = new SharedCognition({
  schema: { emergencyPrefix: 'EMERGENCY_' },
});
```

### Chat Moderation Systems

```typescript
const moderationCognition = new SharedCognition({
  arbiter: { executeThreshold: 0.70 },
});
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
EXPOSE 8080 8081
CMD ["node", "dist/index.js"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: adaptive-bitmask
spec:
  replicas: 3
  selector:
    matchLabels:
      app: adaptive-bitmask
  template:
    spec:
      containers:
        - name: adaptive-bitmask
          image: adaptive-bitmask:latest
          ports:
            - containerPort: 8080
            - containerPort: 8081
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
```

### Monitoring

```bash
curl http://localhost:8081/api/health
curl http://localhost:8081/api/metrics
```

## Performance Benchmarks

### Coordination Benchmarks

| Agent Count | Avg Latency | Max Latency | Memory Usage |
| --- | --- | --- | --- |
| 100 | 0.09ms | 0.75ms | ~50MB |
| 500 | 0.27ms | 2.05ms | ~120MB |
| 1000 | 0.66ms | 3.12ms | ~200MB |
| 2000 | 1.26ms | 5.84ms | ~350MB |

Benchmarks were run on an M2 MacBook Pro with Node.js 20.

### Protocol Simulation

Measured on the protocol simulation across 1,000 trials:

| Operation | Mean | p99 |
| --- | --- | --- |
| Encode features | 2.0us | 3.9us |
| Serialize message | 0.5us | 0.8us |
| Aggregate (10 agents) | 84us | 122us |
| Score (weighted linear) | 15us | 26us |
| Full pipeline (no LLM) | 110us | 159us |

The protocol overhead is negligible relative to LLM inference; a representative run measured LLM latency at `6.8ms`, or `97.7%` of end-to-end time.

## Transport Layers

### WebSocket Transport

```typescript
import { createWebSocketTransport } from 'adaptive-bitmask';

const wsTransport = createWebSocketTransport({
  port: 8080,
  maxConnections: 1000,
  enableCompression: true,
});

wsTransport.on('message', ({ agentId, message }) => {
  console.log(`Agent ${agentId}:`, message);
});
```

### HTTP Transport

```typescript
import { createHttpTransport } from 'adaptive-bitmask';

const httpTransport = createHttpTransport({
  port: 8081,
  enableCors: true,
  rateLimitPerMinute: 1000,
});

fetch('http://localhost:8081/api/coordinate', {
  method: 'POST',
  body: bitmaskMessage.toBytes(),
});
```

### Transport-Agnostic Usage

The protocol is transport-agnostic. The 24-byte message format can be sent over WebSocket, gRPC, HTTP, or any other byte-capable transport.

```typescript
ws.send(msg.toBytes());
grpcStream.write({ payload: msg.toBytes() });
fetch('/coordinate', { body: msg.serialize() });
```

Optional helper for control-plane metadata:

```typescript
import { createEnvelope, decodeEnvelope } from 'adaptive-bitmask';

const envelope = createEnvelope(msg, schema.fingerprint, 'round-42');
const restored = decodeEnvelope(envelope, schema.fingerprint);
```

See [`examples/transport.ts`](./examples/transport.ts) for an end-to-end example.

## Monitoring and Observability

### Health Checks

```json
{
  "status": "HEALTHY",
  "uptime": 3600000,
  "version": "1.1.1",
  "metrics": {
    "messagesProcessed": 1000000,
    "memoryUsageMB": 256,
    "avgLatencyUs": 85
  }
}
```

### Metrics Collection

```typescript
import { MetricsCollector, Logger } from 'adaptive-bitmask';

const metrics = new MetricsCollector();
const logger = Logger.getInstance();

metrics.recordCoordinationLatency(85);
logger.info('Coordination', 'Decision made', {
  decision: 'EXECUTE',
  agentCount: 1000,
});
```

## Error Handling and Recovery

```typescript
import {
  ValidationError,
  CircuitBreaker,
  TimeoutManager,
  RecoveryManager,
} from 'adaptive-bitmask';

const circuitBreaker = new CircuitBreaker(5);

await TimeoutManager.withTimeout(
  coordinationOperation(),
  10000,
  'swarm-coordination'
);

await RecoveryManager.withRetry(
  failingOperation,
  3,
  1000
);
```

## Advanced Usage

For lower-level access to the protocol internals, the package exposes schema management, binary serialization, arbitration primitives, and transport helpers.

Protocol model:

Based on the [Adaptive Bitmask Protocol paper](https://zenodo.org/records/18990535) (Jiang, 2026):
```text
Layer 0: SchemaManager
Layer 1: Worker Agents
Layer 2: Coordinator
Layer 3: Arbiter
```

### 24-Byte Wire Format

| Offset | Type | Field |
| --- | --- | --- |
| 0-7 | uint64 | Feature bitmask |
| 8-11 | uint32 | Agent ID |
| 12-19 | int64 | Timestamp (ms) |
| 20-23 | uint32 | Schema version |

### Schema Management

Dynamic feature-to-bit mapping supports frequency-based pruning. Emergency features in bits `56-63` are never pruned regardless of activation frequency.

```typescript
const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll(myFeatures);
schema.recordActivations(observedFeatures);
schema.prune();

const p = schema.theoreticalCollisionRate;
const excluded = schema.expectedExcludedFeatures(80);
```

### Schema Distribution

Deterministic schema export and import allow compatibility checks across nodes.

```typescript
const exported = schema.exportSchema();

const replica = new SchemaManager();
replica.importSchema(exported);
```

### Binary Serialization

Messages serialize to exactly 24 bytes and round-trip through `serialize()` and `deserialize()`.

```typescript
const bytes = msg.toBytes();
const restored = BitmaskMessage.deserialize(bytes);
```

### Weighted Scoring

Importance weights can be configured by bit position, and domain-specific presets are included.

```typescript
import { createFinancialArbiter, createRoboticArbiter } from 'adaptive-bitmask';

const financialArbiter = createFinancialArbiter();
const roboticArbiter = createRoboticArbiter();
```

### Strategy Arbitration

Strategy candidates can be ranked with `scoreStrategies()` using threshold-based lead and rejection criteria.

```typescript
const result = arbiter.scoreStrategies(
  [
    { id: 'trend', mask: trendMask, confidence: trendConf },
    { id: 'mean_revert', mask: mrMask, confidence: mrConf },
    { id: 'breakout', mask: boMask, confidence: boConf },
  ],
  {
    leadThreshold: 0.15,
    rejectThreshold: 0.40,
  }
);
```

Legacy compatibility is preserved through `arbiter.score(mask, confidence?)`.

### Bitwise Primitives

```typescript
import { setBit, popcount, merge, delta, hammingDistance } from 'adaptive-bitmask';
```

### Strict Encoding

```typescript
const { mask } = encode(features, schema.featureToBit, {
  throwOnUnknownFeatures: true,
});
```

### Stale Schema Policy

```typescript
const coordinator = new Coordinator({
  schemaVersion: schema.version,
  staleMessagePolicy: 'drop',
});
```

### Telemetry Hooks

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

## Benchmarking

```bash
npm run benchmark
```

This writes benchmark results to `benchmarks/latest.json`.

```bash
npm run benchmark:run
npm run benchmark:check
```

`benchmark:check` fails if an operation regresses beyond both thresholds:

- Relative: `BENCH_MAX_REGRESSION_PCT` (default `40`)
- Absolute: `BENCH_MAX_ABS_REGRESSION_US` (default `1.5`)
- Baseline file: `BENCH_BASELINE_PATH` (default `benchmarks/baseline.json`)

## Migration Notes

Changes introduced in the `0.2.0-rc.0` line:

- `BitmaskMessage.deserialize()` now requires exactly `24` bytes.
- Constructors throw for out-of-range `mask`, `agentId`, `schemaVersion`, or unsafe `timestampMs`.
- Coordinators support `staleMessagePolicy: 'accept' | 'warn' | 'drop'`.
- Aggregate output now includes `droppedStaleMessages`.
- `schema.exportSchema()` and `schema.importSchema(...)` are available.
- `schema.fingerprint` provides deterministic compatibility checks.

## API Reference

### Bitmask Primitives

`empty()`, `setBit(mask, pos)`, `clearBit(mask, pos)`, `testBit(mask, pos)`, `popcount(mask)`, `activeBits(mask)`, `forEachSetBit(mask, fn)`, `merge(a, b)`, `intersect(a, b)`, `delta(prev, next)`, `hammingDistance(a, b)`, `hasEmergency(mask)`, `toBytes(mask)`, `fromBytes(buf)`, `encode(features, schema, options?)`, `decode(mask, reverseSchema)`

### SchemaManager

`new SchemaManager(config?)`, `.register(feature)`, `.registerAll(features)`, `.recordActivations(features)`, `.prune()`, `.snapshot()`, `.exportSchema()`, `.importSchema(exported)`, `.expectedExcludedFeatures(featureCount?)`, `.theoreticalCollisionRate`, `.fingerprint`, `.featureToBit`, `.bitToFeatures`, `.version`

### BitmaskMessage

`new BitmaskMessage(data)`, `BitmaskMessage.now(mask, agentId, version)`, `.serialize()`, `.toBytes()`, `BitmaskMessage.deserialize(buf)`, `.sizeBytes`, `.compressionVsJson`

### Arbiter

`new Arbiter(config?)`, `.score(mask, confidence?)`, `.scoreStrategies(candidates, options?)`, `.scoreMessages(messages, version?)`, `.setWeight(pos, weight)`, `createFinancialArbiter()`, `createRoboticArbiter()`

### Coordinator

`new Coordinator(config?)`, `.startRound()`, `.receive(msg)`, `.receiveAll(msgs)`, `.aggregate()`, `.schemaVersion`

### Transport Envelope

`createEnvelope(msg, schemaFingerprint, roundId?)`, `decodeEnvelope(envelope, expectedSchemaFingerprint?)`

## License

MIT
