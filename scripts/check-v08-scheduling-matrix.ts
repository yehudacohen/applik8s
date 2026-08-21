// typecast-file-boundary: The checked-in scheduling matrix is untrusted JSON and is validated before release policy checks.
import { readFile } from 'node:fs/promises';

interface MatrixEntry {
  readonly id?: string;
  readonly state?: string;
}

interface ProviderEntry extends MatrixEntry {
  readonly target?: string;
  readonly capabilities?: Readonly<Record<string, string>>;
  readonly remaining?: string;
}

interface SchedulingMatrix {
  readonly schemaVersion?: number;
  readonly release?: string;
  readonly status?: string;
  readonly semantics?: readonly string[];
  readonly sources?: readonly (MatrixEntry & { readonly disposition?: string; readonly notes?: string })[];
  readonly providers?: readonly ProviderEntry[];
}

const requireRelease = process.argv.includes('--require-release');
const matrix = JSON.parse(await readFile('docs/v0.8-scheduling-semantic-matrix.json', 'utf8')) as SchedulingMatrix;
const findings: string[] = [];
const allowedStates = new Set(['not-started', 'in-progress', 'implemented', 'live-qualified']);
const expectedSources = new Set([
  'function-native-schedule', 'static-workflow-cron', 'delayed-workflow-start',
  'dynamic-reconcile-schedule', 'stream-processor-schedule', 'actor-alarm', 'raw-kubernetes-cron',
]);
const expectedProviders = new Set([
  'deterministic-local', 'kubernetes-cronjob', 'hatchet-shared', 'eventbridge-scheduler',
]);

if (matrix.schemaVersion !== 1 || matrix.release !== '0.8.0' || matrix.status !== 'active') {
  findings.push('Scheduling matrix identity is invalid.');
}
const semantics = new Set(matrix.semantics ?? []);
if (semantics.size !== (matrix.semantics?.length ?? 0) || semantics.size < 10) {
  findings.push('Scheduling matrix semantics are missing, duplicated, or incomplete.');
}
validateIdentities(matrix.sources ?? [], expectedSources, 'source');
validateIdentities(matrix.providers ?? [], expectedProviders, 'provider');

for (const source of matrix.sources ?? []) {
  if (!source.disposition?.trim() || !source.notes?.trim()) {
    findings.push(`Scheduling source ${source.id ?? '<missing>'} lacks a disposition or explanation.`);
  }
}
for (const provider of matrix.providers ?? []) {
  if (!provider.target?.trim() || !provider.remaining?.trim()) {
    findings.push(`Scheduling provider ${provider.id ?? '<missing>'} lacks target or remaining-work evidence.`);
  }
  for (const semantic of semantics) {
    if (!provider.capabilities?.[semantic]?.trim()) {
      findings.push(`Scheduling provider ${provider.id ?? '<missing>'} lacks ${semantic}.`);
    }
  }
  for (const capability of Object.keys(provider.capabilities ?? {})) {
    if (!semantics.has(capability)) findings.push(`Scheduling provider ${provider.id ?? '<missing>'} declares unknown semantic ${capability}.`);
  }
}

if (requireRelease) {
  for (const source of matrix.sources ?? []) {
    if (source.state !== 'implemented' && source.state !== 'live-qualified') {
      findings.push(`Release scheduling source ${source.id} remains ${source.state}.`);
    }
  }
  for (const provider of matrix.providers ?? []) {
    if (provider.state !== 'live-qualified') {
      findings.push(`Release scheduling provider ${provider.id} remains ${provider.state}.`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`v0.8 scheduling matrix failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: matrix.release,
  mode: requireRelease ? 'release' : 'contract',
  semantics: semantics.size,
  sources: matrix.sources?.length ?? 0,
  providers: matrix.providers?.length ?? 0,
  liveQualifiedProviders: matrix.providers?.filter(({ state }) => state === 'live-qualified').length ?? 0,
}, null, 2));

function validateIdentities(entries: readonly MatrixEntry[], expected: ReadonlySet<string>, label: string): void {
  const actual = new Set(entries.map(({ id }) => id));
  if (actual.size !== entries.length) findings.push(`Scheduling ${label} identities are duplicated.`);
  for (const id of expected) if (!actual.has(id)) findings.push(`Scheduling matrix lacks ${label} ${id}.`);
  for (const entry of entries) {
    if (!entry.id || !expected.has(entry.id)) findings.push(`Scheduling matrix contains unknown ${label} ${entry.id ?? '<missing>'}.`);
    if (!allowedStates.has(entry.state ?? '')) findings.push(`Scheduling ${label} ${entry.id ?? '<missing>'} has invalid state ${entry.state ?? '<missing>'}.`);
  }
}
