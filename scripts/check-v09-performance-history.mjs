import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const baseline = JSON.parse(await readFile(resolve(root, 'benchmarks/v0.9/baseline.json'), 'utf8'));
const historyRoot = resolve(root, 'benchmarks/v0.9/history');
const files = (await readdir(historyRoot)).filter((path) => path.endsWith('.json')).sort();
const reports = await Promise.all(files.map(async (path) =>
  JSON.parse(await readFile(resolve(historyRoot, path), 'utf8'))));
const failures = [];
const cleanReports = reports.filter((report) => report.git?.dirty === false);
const cleanCommits = new Set(cleanReports.map((report) => report.git?.commit).filter(Boolean));
if (cleanReports.length < 3) {
  failures.push(`v0.9 performance history has ${cleanReports.length} clean observation(s); at least 3 are required`);
}
if (cleanCommits.size < 2) {
  failures.push(`v0.9 performance history spans ${cleanCommits.size} clean commit(s); at least 2 are required`);
}
if (baseline.git?.dirty !== false) failures.push('the active v0.9 performance baseline was recorded from a dirty worktree');
if (!cleanReports.some((report) => report.generatedAt === baseline.generatedAt && report.git?.commit === baseline.git?.commit)) {
  failures.push('the active v0.9 performance baseline is not preserved as a clean history observation');
}
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
const compatibleEnvironments = new Set(cleanReports.map((report) => [
  report.environment?.platform,
  report.environment?.architecture,
  report.environment?.cpuModel,
  report.environment?.cpuCount,
  report.environment?.runtime,
].join('|')));
if (cleanReports.length >= 3 && compatibleEnvironments.size !== 1) {
  failures.push('clean v0.9 performance observations do not share one comparable environment fingerprint');
}
if (failures.length > 0) {
  throw new Error(`v0.9 performance history failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
}
console.log(
  `v0.9 performance history passed for ${cleanReports.length} clean observations across ${cleanCommits.size} commits plus the baseline; `
  + 'PostgreSQL, Kubernetes, and AWS latency remain separate provider evidence lanes.',
);
