// typecast-file-boundary: The checked-in telemetry matrix is untrusted JSON and is validated before source-policy checks.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

interface SourceMarker {
  readonly path?: string;
  readonly marker?: string;
}

interface BoundaryEntry {
  readonly kind?: string;
  readonly state?: string;
  readonly relationship?: string;
  readonly producer?: string;
  readonly consumer?: string;
  readonly carrierPlacement?: string;
  readonly owners?: readonly string[];
  readonly sourceMarkers?: readonly SourceMarker[];
  readonly regression?: string | null;
  readonly remaining?: string;
}

interface TelemetryBoundaryMatrix {
  readonly schemaVersion?: number;
  readonly release?: string;
  readonly status?: string;
  readonly carrier?: string;
  readonly instrumentedSourceFiles?: readonly string[];
  readonly carrierCaptureSourceFiles?: readonly string[];
  readonly boundaries?: readonly BoundaryEntry[];
}

const root = process.cwd();
const findings: string[] = [];
const matrix = JSON.parse(
  await readFile(join(root, 'docs/v0.8-telemetry-boundary-matrix.json'), 'utf8'),
) as TelemetryBoundaryMatrix;
const coreTelemetrySource = await readFile(
  join(root, 'packages/core/src/application-telemetry.ts'),
  'utf8',
);
const kindDeclaration = coreTelemetrySource.match(
  /export type ApplicationTelemetryBoundaryKind\s*=([\s\S]*?);/u,
)?.[1] ?? '';
const expectedKinds = new Set(
  [...kindDeclaration.matchAll(/"([a-z]+)"/gu)].map((match) => match[1]),
);
const allowedStates = new Set(['not-started', 'in-progress', 'implemented']);
const allowedRelationships = new Set(['asynchronous', 'mixed', 'synchronous']);

if (matrix.schemaVersion !== 1
  || matrix.release !== '0.8.0'
  || matrix.status !== 'active'
  || matrix.carrier !== 'applik8s.telemetry/v1alpha1') {
  findings.push('Telemetry boundary matrix identity is invalid.');
}
if (expectedKinds.size === 0) {
  findings.push('ApplicationTelemetryBoundaryKind could not be read from the canonical core contract.');
}

const boundaries = matrix.boundaries ?? [];
const boundaryKinds = new Set(boundaries.map(({ kind }) => kind));
if (boundaryKinds.size !== boundaries.length) {
  findings.push('Telemetry boundary matrix contains duplicate boundary kinds.');
}
for (const kind of expectedKinds) {
  if (!boundaryKinds.has(kind)) findings.push(`Telemetry boundary matrix lacks ${kind}.`);
}
for (const boundary of boundaries) {
  const label = boundary.kind ?? '<missing>';
  if (!boundary.kind || !expectedKinds.has(boundary.kind)) {
    findings.push(`Telemetry boundary matrix contains unknown kind ${label}.`);
  }
  if (!allowedStates.has(boundary.state ?? '')) {
    findings.push(`Telemetry boundary ${label} has invalid state ${boundary.state ?? '<missing>'}.`);
  }
  if (!allowedRelationships.has(boundary.relationship ?? '')) {
    findings.push(`Telemetry boundary ${label} has invalid relationship ${boundary.relationship ?? '<missing>'}.`);
  }
  for (const [field, value] of [
    ['producer', boundary.producer],
    ['consumer', boundary.consumer],
    ['carrierPlacement', boundary.carrierPlacement],
    ['remaining', boundary.remaining],
  ] as const) {
    if (!value?.trim()) findings.push(`Telemetry boundary ${label} lacks ${field}.`);
  }
  if ((boundary.owners?.length ?? 0) === 0) {
    findings.push(`Telemetry boundary ${label} lacks an owner.`);
  }
  if (boundary.state === 'implemented'
    && ((boundary.sourceMarkers?.length ?? 0) === 0 || !boundary.regression?.trim())) {
    findings.push(`Implemented telemetry boundary ${label} lacks source and regression evidence.`);
  }
  if (boundary.state === 'not-started'
    && ((boundary.sourceMarkers?.length ?? 0) > 0 || boundary.regression !== null)) {
    findings.push(`Not-started telemetry boundary ${label} claims implementation evidence.`);
  }
  for (const marker of boundary.sourceMarkers ?? []) {
    if (!marker.path?.trim() || !marker.marker?.trim()) {
      findings.push(`Telemetry boundary ${label} has an incomplete source marker.`);
      continue;
    }
    const source = await readFile(join(root, marker.path), 'utf8').catch(() => undefined);
    if (source === undefined) {
      findings.push(`Telemetry boundary ${label} source ${marker.path} does not exist.`);
    } else if (!source.includes(marker.marker)) {
      findings.push(`Telemetry boundary ${label} source ${marker.path} lacks marker ${JSON.stringify(marker.marker)}.`);
    }
  }
}

const maintainedSources = await sourceFiles(join(root, 'packages'));
const instrumentedSourceFiles = new Set(
  maintainedSources
    .filter(({ source, path }) => path !== 'packages/applik8s/src/application-telemetry-runtime.ts'
      && /\brunApplicationTelemetryBoundary\s*\(/u.test(source))
    .map(({ path }) => path),
);
const carrierCaptureSourceFiles = new Set(
  maintainedSources
    .filter(({ source, path }) => path !== 'packages/applik8s/src/application-telemetry-runtime.ts'
      && /\bcaptureApplicationTelemetryContext\s*\(/u.test(source))
    .map(({ path }) => path),
);
compareSourceSet('instrumented boundary', instrumentedSourceFiles, matrix.instrumentedSourceFiles ?? []);
compareSourceSet('carrier capture', carrierCaptureSourceFiles, matrix.carrierCaptureSourceFiles ?? []);

const ownedSources = new Set(boundaries.flatMap(({ owners }) => owners ?? []));
for (const path of instrumentedSourceFiles) {
  if (!ownedSources.has(path)) findings.push(`Instrumented source ${path} has no telemetry boundary owner.`);
}

const reconcilerHostPath = 'crates/applik8s-operator-host/src/lib.rs';
const reconcilerHostSource = await readFile(join(root, reconcilerHostPath), 'utf8');
for (const marker of [
  '"applik8s.boundary.kind", "reconciler"',
  '"applik8s.operation.count"',
  '"applik8s.operation.duration"',
  '"applik8s.retry.count"',
  'ReconcileOtelSpan',
  'guest_host_telemetry_envelope',
  'ReconcileInterrupted',
]) {
  if (!reconcilerHostSource.includes(marker)) {
    findings.push(`Reconciler host lacks canonical telemetry marker ${JSON.stringify(marker)}.`);
  }
}
for (const forbidden of [
  '"applik8s.failure.reason"',
  '"exception.message"',
  'Some(&error.to_string())',
]) {
  if (reconcilerHostSource.includes(forbidden)) {
    findings.push(`Reconciler host contains unsafe telemetry marker ${JSON.stringify(forbidden)}.`);
  }
}

if (findings.length > 0) {
  throw new Error(`v0.8 telemetry boundary matrix failed:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: matrix.release,
  boundaries: boundaries.length,
  implemented: boundaries.filter(({ state }) => state === 'implemented').length,
  inProgress: boundaries.filter(({ state }) => state === 'in-progress').length,
  notStarted: boundaries.filter(({ state }) => state === 'not-started').length,
  instrumentedSourceFiles: instrumentedSourceFiles.size,
  carrierCaptureSourceFiles: carrierCaptureSourceFiles.size,
}, null, 2));

function compareSourceSet(label: string, actual: ReadonlySet<string>, recorded: readonly string[]): void {
  const expected = new Set(recorded);
  if (expected.size !== recorded.length) findings.push(`Telemetry ${label} source inventory contains duplicates.`);
  for (const path of actual) if (!expected.has(path)) findings.push(`Telemetry ${label} source ${path} is not inventoried.`);
  for (const path of expected) if (!actual.has(path)) findings.push(`Telemetry ${label} inventory contains stale source ${path}.`);
}

async function sourceFiles(directory: string): Promise<readonly { readonly path: string; readonly source: string }[]> {
  const files: { path: string; source: string }[] = [];
  for (const entry of await readdir(directory)) {
    const absolute = join(directory, entry);
    const metadata = await stat(absolute);
    if (metadata.isDirectory()) {
      if (['dist', 'node_modules', 'test', 'tests'].includes(entry)) continue;
      files.push(...await sourceFiles(absolute));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    files.push({ path: relative(root, absolute), source: await readFile(absolute, 'utf8') });
  }
  return files;
}
