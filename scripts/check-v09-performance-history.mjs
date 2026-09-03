import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const baseline = JSON.parse(await readFile(resolve(root, 'benchmarks/v0.9/baseline.json'), 'utf8'));
const historyRoot = resolve(root, 'benchmarks/v0.9/history');
const files = (await readdir(historyRoot)).filter((path) => path.endsWith('.json')).sort();
const reports = await Promise.all(files.map(async (path) =>
  JSON.parse(await readFile(resolve(historyRoot, path), 'utf8'))));
const failures = [];
if (reports.length < 1) failures.push('v0.9 performance history has no durable observation');
for (const [label, report] of [
  ['baseline', baseline],
  ...reports.map((report, index) => [`history[${index}]`, report]),
]) {
  if (report.schemaVersion !== 1 || report.release !== 'v0.9' || report.evidenceClass !== 'synthetic-local') {
    failures.push(`${label} has an invalid evidence contract`);
  }
  if (!Array.isArray(report.limitations) || report.limitations.length < 4) {
    failures.push(`${label} does not disclose its limitations`);
  }
  for (const key of ['jobs', 'events', 'managedModels', 'queryBatches']) {
    if (!report[key]) failures.push(`${label} lacks ${key} evidence`);
  }
}
if (failures.length > 0) {
  throw new Error(`v0.9 performance history failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
}
console.log(
  `v0.9 performance history passed for ${reports.length} observation(s) plus the baseline; `
  + 'PostgreSQL, Kubernetes, and AWS latency remain separate provider evidence lanes.',
);
