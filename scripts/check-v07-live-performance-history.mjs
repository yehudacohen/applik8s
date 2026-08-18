import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const directory = resolve(root, 'benchmarks/v0.7/live');
const baseline = JSON.parse(await readFile(resolve(directory, 'baseline.json'), 'utf8'));
const history = await readdir(resolve(directory, 'history'));
const reports = await Promise.all(
  history.filter(path => path.endsWith('.json')).sort().map(async path =>
    JSON.parse(await readFile(resolve(directory, 'history', path), 'utf8'))),
);
const failures = [];
if (reports.length < 1) failures.push('no append-only live observation exists');
for (const [label, report] of [['baseline', baseline], ...reports.map((report, index) => [`history[${index}]`, report])]) {
  if (report.schemaVersion !== 1 || report.release !== 'v0.7' || report.evidenceClass !== 'live-orbstack') {
    failures.push(`${label} has an unsupported live benchmark contract`);
  }
  if (!Array.isArray(report.limitations) || report.limitations.length < 5) {
    failures.push(`${label} does not disclose its live measurement boundaries`);
  }
  if ((report.database?.sameKey?.operations ?? 0) < 1 || (report.database?.distinctKeys?.operations ?? 0) < 1) {
    failures.push(`${label} lacks PostgreSQL contention evidence`);
  }
  if (!Array.isArray(report.jetStream?.scenarios) || report.jetStream.scenarios.map(({ replicas }) => replicas).join(',') !== '1,2,4') {
    failures.push(`${label} lacks one/two/four-consumer JetStream evidence`);
  }
  if ((report.http?.operations ?? 0) < 1 || (report.http?.errors ?? 1) !== 0) {
    failures.push(`${label} lacks a successful generated SSR sample`);
  }
  if ((report.kubernetes?.podCount ?? 0) < 1 || (report.kubernetes?.readyPodSamples ?? 0) < 1) {
    failures.push(`${label} lacks Kubernetes readiness and footprint evidence`);
  }
  if ((report.kubernetes?.capacity?.requestedMemoryMiB ?? 0) < 1) {
    failures.push(`${label} lacks portable resource/cost proxy evidence`);
  }
}
if (failures.length > 0) {
  throw new Error(`v0.7 live performance history failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
}
console.log(`v0.7 live performance history passed for ${reports.length} append-only observation(s) plus the current baseline.`);
