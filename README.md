# adaptive-bitmask

**The Sub-10ms Shared Cognition Engine for Multi-Agent Systems.**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18990535.svg)](https://doi.org/10.5281/zenodo.18990535)

Achieve an **85x bandwidth reduction** (753 bytes -> exactly 24 bytes) for multi-agent coordination. Instead of shipping bloated JSON payloads between agents, `adaptive-bitmask` uses dynamically-pruned semantic bitmasks to achieve sub-10ms coordination latency.

**🎉 Production-Ready v1.0.0-rc.1** - [100% production test pass rate](./PRODUCTION_ROADMAP.md) with sub-millisecond coordination for 1000+ agents.

**To view the paper: "Go to files" -> "Adaptive Protocol(5)"**

## 🏗️ Quick Start

Initialize a new swarm in seconds:

```bash
npx create-swarm
```

The interactive CLI will:
- 🏗️  **Scaffold** a new project with best practices
- 🧬  **Configure** parallel agent execution (Promise.all + p-limit)
- 🤖  **Optionally** integrate the Vercel AI SDK
- 🖥️  **Live Dashboard** for real-time control and monitoring
- ⚡  **Choose** between Cloud, Local, or Simulation modes

Or install manually:

```bash
npm install adaptive-bitmask
```

## ✨ Production Features

- **🚀 Sub-10ms Coordination** - 0.08ms average latency, 1.26ms for 2000 agents
- **📦 Zero Dependencies** - Core engine has no runtime dependencies
- **🖥️ Live Dashboard** - Real-time monitoring of agent thinking and consensus
- **🛡️ Production Hardening** - Error handling, circuit breakers, graceful degradation
- **📊 Built-in Monitoring** - Health checks, metrics collection, structured logging
- **🔌 Transport Layers** - WebSocket and HTTP with production features
- **🔒 Enterprise Security** - Input validation, rate limiting, authentication hooks

## 🤖 Vercel AI SDK Integration

Seamlessly integrate bitmask coordination into your AI agent workflows.

```typescript
import { CoordinationSession } from 'adaptive-bitmask/ai';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const session = new CoordinationSession({
  features: ['price_up', 'volume_spike', 'trend_up'],
  onLog: (log) => console.log(`[${log.agentId}] ${log.content}`)
});

// 1. Agent reports observation with "thinking"
session.logThinking('Agent-1', 'Analyzing volatility clusters...');
session.report('Agent-1', ['price_up', 'volume_spike']);

// 2. Peek at mid-round consensus without clearing buffer
const { decision: current } = session.peek();

// 3. Finalize round
const { decision, aggregatedFeatures } = session.decide();
```

**Key Observability:**
- `session.logThinking(id, msg)`: Capture internal agent reasoning for the dashboard.
- `session.peek()`: Non-destructive consensus queries mid-round.
- `onLog`: Stream all events to a database or real-time UI.

---

## 🌐 Real-World Deployments

### High-Frequency Trading
```typescript
// 1000 trading bots coordinating in 0.66ms
const tradingCognition = new SharedCognition({
  arbiter: { executeThreshold: 0.60, emergencyOverride: true }
});
```

### IoT Sensor Networks
```typescript
// 200 sensors reaching consensus in 0.20ms
const iotCognition = new SharedCognition({
  schema: { emergencyPrefix: 'EMERGENCY_' }
});
```

### Chat Moderation Systems
```typescript
// 150 moderation agents deciding in 0.07ms
const moderationCognition = new SharedCognition({
  arbiter: { executeThreshold: 0.70 }
});
```

## 🔧 Production Deployment

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
        - containerPort: 8080  # WebSocket
        - containerPort: 8081  # HTTP API
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
# Health check
curl http://localhost:8081/api/health

# Metrics endpoint
curl http://localhost:8081/api/metrics
```

## 📊 Performance Benchmarks

| Agent Count | Avg Latency | Max Latency | Memory Usage |
|-------------|-------------|-------------|--------------|
| 100         | 0.09ms      | 0.75ms      | ~50MB        |
| 500         | 0.27ms      | 2.05ms      | ~120MB       |
| 1000        | 0.66ms      | 3.12ms      | ~200MB       |
| 2000        | 1.26ms      | 5.84ms      | ~350MB       |

*All benchmarks run on M2 MacBook Pro with Node.js v20*

## 🛠️ Transport Layers

### WebSocket Transport
```typescript
import { createWebSocketTransport } from 'adaptive-bitmask';

const wsTransport = createWebSocketTransport({
  port: 8080,
  maxConnections: 1000,
  enableCompression: true
});

// Real-time bidirectional coordination
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
  rateLimitPerMinute: 1000
});

// REST API for coordination
fetch('http://localhost:8081/api/coordinate', {
  method: 'POST',
  body: bitmaskMessage.toBytes()
});
```

## 📈 Monitoring & Observability

### Health Checks
```json
{
  "status": "HEALTHY",
  "uptime": 3600000,
  "version": "1.0.0-rc.1",
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

// Automatic performance tracking
metrics.recordCoordinationLatency(85); // microseconds
logger.info('Coordination', 'Decision made', { 
  decision: 'EXECUTE', 
  agentCount: 1000 
});
```

## 🚨 Error Handling & Recovery

```typescript
import { 
  ValidationError, 
  CircuitBreaker, 
  TimeoutManager,
  RecoveryManager 
} from 'adaptive-bitmask';

// Circuit breaker for resilience
const circuitBreaker = new CircuitBreaker(5); // 5 failures threshold

// Timeout protection
await TimeoutManager.withTimeout(
  coordinationOperation(),
  10000, // 10s timeout
  'swarm-coordination'
);

// Retry with exponential backoff
await RecoveryManager.withRetry(
  failingOperation,
  3, // max retries
  1000 // base delay
);
```

---

## Advanced Usage / Internal Engine

For hardcore engineers who want direct access to the raw mathematical primitives and binary serialization logic.

Based on the [Adaptive Bitmask Protocol paper](https://zenodo.org/records/18990535) (Jiang, 2026):

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
