import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  BitmaskMessage,
  Coordinator,
  SchemaManager,
  createFinancialArbiter,
  encode,
  setBit,
} from '../dist/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselinePath = process.env.BENCH_BASELINE_PATH
  ? path.resolve(process.cwd(), process.env.BENCH_BASELINE_PATH)
  : path.join(__dirname, 'baseline.json');
const latestPath = path.join(__dirname, 'latest.json');

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 1000);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 200);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function runBenchmark(name, fn) {
  for (let i = 0; i < WARMUP; i++) fn();

  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    fn();
    samples.push((performance.now() - t0) * 1000); // microseconds
  }

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  return {
    meanUs: mean,
    p99Us: percentile(samples, 99),
  };
}

function formatUs(value) {
  return `${value.toFixed(2)}us`;
}

function formatDelta(current, baseline) {
  if (!baseline || baseline === 0) return 'n/a';
  const delta = ((current - baseline) / baseline) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

const schema = new SchemaManager({ emergencyPrefix: 'EMERGENCY_' });
schema.registerAll([
  'price_up',
  'price_down',
  'vol_high',
  'vol_low',
  'volume_spike',
  'volume_drop',
  'momentum',
  'breakout',
  'trend',
  'mean_reversion',
  'EMERGENCY_halt',
]);

const encodeFeatures = ['price_up', 'momentum', 'volume_spike', 'breakout'];
const encoded = encode(encodeFeatures, schema.featureToBit);
const message = BitmaskMessage.now(encoded.mask, 1, schema.version);
const coordinator = new Coordinator({ deadlineMs: 100, schemaVersion: schema.version });
const arbiter = createFinancialArbiter();

const aggregateMessages = Array.from({ length: 10 }, (_, i) => {
  let mask = 0n;
  mask = setBit(mask, i % 12);
  mask = setBit(mask, (i + 3) % 16);
  return new BitmaskMessage({
    mask,
    agentId: i,
    timestampMs: Date.now(),
    schemaVersion: schema.version,
  });
});

const pipelineObservations = [
  ['price_up', 'momentum', 'volume_spike'],
  ['price_up', 'breakout'],
  ['price_up', 'momentum', 'volume_spike', 'breakout'],
  ['vol_low', 'momentum'],
  ['price_up', 'volume_spike'],
  ['price_up', 'momentum'],
  ['momentum', 'breakout', 'volume_spike'],
  ['price_up', 'vol_low'],
  ['price_up', 'momentum', 'volume_spike'],
  ['breakout', 'momentum', 'volume_spike'],
];

const scoringMask = aggregateMessages.reduce((mask, msg) => mask | msg.mask, 0n);
const scoringConfidence = new Map([
  [0, 0.8],
  [1, 0.6],
  [2, 0.5],
  [3, 0.7],
  [4, 0.4],
  [5, 0.3],
]);

const results = {
  encodeFeatures: runBenchmark('encodeFeatures', () => {
    encode(encodeFeatures, schema.featureToBit);
  }),
  serializeMessage: runBenchmark('serializeMessage', () => {
    message.toBytes();
  }),
  aggregate10Agents: runBenchmark('aggregate10Agents', () => {
    coordinator.startRound();
    coordinator.receiveAll(aggregateMessages);
    coordinator.aggregate();
  }),
  scoreWeighted: runBenchmark('scoreWeighted', () => {
    arbiter.score(scoringMask, scoringConfidence);
  }),
  fullPipelineNoLlm: runBenchmark('fullPipelineNoLlm', () => {
    coordinator.startRound();
    for (let i = 0; i < pipelineObservations.length; i++) {
      const { mask } = encode(pipelineObservations[i], schema.featureToBit);
      coordinator.receive(
        new BitmaskMessage({
          mask,
          agentId: i,
          timestampMs: Date.now(),
          schemaVersion: schema.version,
        })
      );
    }
    const aggregation = coordinator.aggregate();
    arbiter.score(aggregation.aggregatedMask, aggregation.confidence);
  }),
};

const payload = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  iterations: ITERATIONS,
  warmup: WARMUP,
  results,
};

fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

let baseline = null;
if (fs.existsSync(baselinePath)) {
  baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

console.log(`adaptive-bitmask benchmark (${ITERATIONS} iterations)`);
console.log('');
console.log('Operation                 Mean        p99        vs baseline');
console.log('-------------------------------------------------------------');
for (const [name, metrics] of Object.entries(results)) {
  const baselineMean = baseline?.results?.[name]?.meanUs;
  const delta = formatDelta(metrics.meanUs, baselineMean);
  const label = name.padEnd(24, ' ');
  const mean = formatUs(metrics.meanUs).padEnd(10, ' ');
  const p99 = formatUs(metrics.p99Us).padEnd(10, ' ');
  console.log(`${label} ${mean} ${p99} ${delta}`);
}
console.log('');
console.log(`Wrote benchmark output to ${latestPath}`);
