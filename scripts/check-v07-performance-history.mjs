import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const budgets = JSON.parse(
  await readFile(resolve(root, 'benchmarks/v0.7/budgets.json'), 'utf8'),
);
const baseline = JSON.parse(
  await readFile(resolve(root, 'benchmarks/v0.7/baseline.json'), 'utf8'),
);
const historyRoot = resolve(root, 'benchmarks/v0.7/history');
const historyFiles = (await readdir(historyRoot))
  .filter((path) => path.endsWith('.json'))
  .sort();
const reports = await Promise.all(
  historyFiles.map(async (path) =>
    JSON.parse(await readFile(resolve(historyRoot, path), 'utf8'))),
);
const failures = [];

if (reports.length < 5) {
  failures.push('fewer than five durable v0.7 benchmark observations exist');
}
for (const [label, report] of [
  ['baseline', baseline],
  ...reports.map((report, index) => [`history[${index}]`, report]),
]) {
  if (report.schemaVersion !== 1 || report.release !== 'v0.7') {
    failures.push(`${label} has an unsupported benchmark contract`);
    continue;
  }
  if (report.evidenceClass !== 'synthetic-local') {
    failures.push(`${label} does not identify its evidence class`);
  }
  if (!Array.isArray(report.limitations) || report.limitations.length < 4) {
    failures.push(`${label} does not disclose its measurement limitations`);
  }
  for (const violation of performanceViolations(report, budgets)) {
    failures.push(`${label}: ${violation}`);
  }
}

const generatedAt = new Set(reports.map((report) => report.generatedAt));
if (generatedAt.size !== reports.length) {
  failures.push('performance history contains duplicate observation timestamps');
}
const environments = new Set(
  reports.map((report) =>
    `${report.environment?.platform}/${report.environment?.architecture}`),
);
if (environments.size < 1 || environments.has('undefined/undefined')) {
  failures.push('performance history lacks environment identity');
}

if (failures.length > 0) {
  throw new Error(
    `v0.7 performance history failed:\n${
      failures.map((failure) => `- ${failure}`).join('\n')
    }`,
  );
}

console.log(
  `v0.7 performance history passed for ${reports.length} tracked observations plus the current baseline across ${environments.size} environment class(es).`,
);

function performanceViolations(report, trackedBudgets) {
  return [
    report.authority?.decisionsPerSecond
        < trackedBudgets.authority.minimumDecisionsPerSecond
      ? 'authority throughput is below budget'
      : '',
    report.authority?.latencyMs?.p95
        > trackedBudgets.authority.maximumP95Ms
      ? 'authority p95 exceeds budget'
      : '',
    report.authority?.rssGrowthBytes
        > trackedBudgets.authority.maximumRssGrowthBytes
      ? 'authority RSS exceeds budget'
      : '',
    report.signals?.issuesPerSecond
        < trackedBudgets.signals.minimumIssuesPerSecond
      ? 'signal issuance throughput is below budget'
      : '',
    report.signals?.resolutionsPerSecond
        < trackedBudgets.signals.minimumResolutionsPerSecond
      ? 'signal resolution throughput is below budget'
      : '',
    report.signals?.issueLatencyMs?.p95
        > trackedBudgets.signals.maximumIssueP95Ms
      ? 'signal issuance p95 exceeds budget'
      : '',
    report.signals?.resolutionLatencyMs?.p95
        > trackedBudgets.signals.maximumResolutionP95Ms
      ? 'signal resolution p95 exceeds budget'
      : '',
    report.signals?.rssGrowthBytes
        > trackedBudgets.signals.maximumRssGrowthBytes
      ? 'signal RSS exceeds budget'
      : '',
    report.frozenBatches?.eventsPerSecond
        < trackedBudgets.frozenBatches.minimumEventsPerSecond
      ? 'frozen-batch throughput is below budget'
      : '',
    report.frozenBatches?.convergenceMs
        > trackedBudgets.frozenBatches.maximumConvergenceMs
      ? 'frozen-batch convergence exceeds budget'
      : '',
    report.frozenBatches?.rssGrowthBytes
        > trackedBudgets.frozenBatches.maximumRssGrowthBytes
      ? 'frozen-batch RSS exceeds budget'
      : '',
  ].filter(Boolean);
}
