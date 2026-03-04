import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baselinePath = path.join(__dirname, 'baseline.json');
const latestPath = path.join(__dirname, 'latest.json');

const maxRegressionPct = Number(process.env.BENCH_MAX_REGRESSION_PCT ?? 40);
const maxAbsRegressionUs = Number(process.env.BENCH_MAX_ABS_REGRESSION_US ?? 1.5);

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing baseline file: ${baselinePath}`);
  process.exit(1);
}

if (!fs.existsSync(latestPath)) {
  console.error(`Missing latest benchmark file: ${latestPath}`);
  console.error('Run `npm run benchmark:run` first.');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));

const failures = [];
const checks = [];

for (const [op, baseMetrics] of Object.entries(baseline.results ?? {})) {
  const latestMetrics = latest.results?.[op];
  if (!latestMetrics) {
    failures.push(`[${op}] missing in latest results`);
    continue;
  }

  const baseMean = Number(baseMetrics.meanUs);
  const latestMean = Number(latestMetrics.meanUs);

  if (!Number.isFinite(baseMean) || !Number.isFinite(latestMean)) {
    failures.push(`[${op}] invalid mean values`);
    continue;
  }

  const absDelta = latestMean - baseMean;
  const pctDelta = baseMean > 0 ? (absDelta / baseMean) * 100 : 0;
  const regressed =
    absDelta > maxAbsRegressionUs && pctDelta > maxRegressionPct;

  checks.push({
    op,
    baseline: baseMean,
    latest: latestMean,
    absDelta,
    pctDelta,
    regressed,
  });

  if (regressed) {
    failures.push(
      `[${op}] mean regression ${pctDelta.toFixed(1)}% (${absDelta.toFixed(2)}us): ` +
        `${baseMean.toFixed(2)}us -> ${latestMean.toFixed(2)}us`
    );
  }
}

console.log(
  `Benchmark regression check (threshold: +${maxRegressionPct}% and +${maxAbsRegressionUs}us)`
);
for (const check of checks) {
  const status = check.regressed ? 'FAIL' : 'PASS';
  const sign = check.pctDelta >= 0 ? '+' : '';
  console.log(
    `${status.padEnd(5)} ${check.op.padEnd(24)} ` +
      `${check.baseline.toFixed(2)}us -> ${check.latest.toFixed(2)}us ` +
      `(${sign}${check.pctDelta.toFixed(1)}%, ${check.absDelta.toFixed(2)}us)`
  );
}

if (failures.length > 0) {
  console.error('\nBenchmark regression failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nBenchmark regression check passed.');
