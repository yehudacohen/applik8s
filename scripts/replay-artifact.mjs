import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const options = parseArgs(args);
const artifact = readJson(options.artifactPath);
validateReplayArtifact(artifact, options.artifactPath);

const summary = summarizeReplayArtifact(artifact, options.bundleDir);
if (options.execute) {
  summary.execution = await executeReplay(artifact, options.bundleDir);
  if (!summary.execution.ok) {
    summary.errors.push(summary.execution.error);
  }
}
if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  printSummary(summary);
}

if (summary.errors.length > 0) {
  process.exit(1);
}

function parseArgs(values) {
  const parsed = { artifactPath: undefined, bundleDir: undefined, json: false, execute: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--json') {
      parsed.json = true;
      continue;
    }
    if (value === '--execute') {
      parsed.execute = true;
      continue;
    }
    if (value === '--bundle-dir') {
      const bundleDir = values[index + 1];
      if (!bundleDir) {
        fail('--bundle-dir requires a path.');
      }
      parsed.bundleDir = bundleDir;
      index += 1;
      continue;
    }
    if (value.startsWith('--')) {
      fail(`Unknown option ${value}.`);
    }
    if (parsed.artifactPath) {
      fail(`Unexpected extra argument ${value}.`);
    }
    parsed.artifactPath = value;
  }
  if (!parsed.artifactPath) {
    fail('Missing replay artifact path.');
  }
  if (parsed.execute && !parsed.bundleDir) {
    fail('--execute requires --bundle-dir so the local generated JavaScript bundle can be loaded.');
  }
  return parsed;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Failed to read replay artifact ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateReplayArtifact(artifact, path) {
  if (!artifact || typeof artifact !== 'object') {
    fail(`${path} is not a JSON object.`);
  }
  if (artifact.kind !== 'ReplayArtifact') {
    fail(`${path} is not an applik8s ReplayArtifact.`);
  }
  if (artifact.apiVersion !== 'applik8s.dev/v1alpha1') {
    fail(`${path} has unsupported apiVersion ${String(artifact.apiVersion)}.`);
  }
}

function summarizeReplayArtifact(artifact, bundleDir) {
  const debugArtifacts = debugArtifactsFor(artifact);
  const verification = bundleDir ? verifyDebugArtifacts(debugArtifacts, bundleDir) : [];
  return {
    replayId: stringAt(artifact, '/metadata/replayId'),
    createdAt: stringAt(artifact, '/metadata/createdAt'),
    redactionPolicy: stringAt(artifact, '/metadata/redaction/policy'),
    fullPayloadsPresent: stringAt(artifact, '/metadata/redaction/policy') === 'full-payload',
    operatorName: stringAt(artifact, '/runtime/operatorName'),
    handlerId: stringAt(artifact, '/handler/handlerId'),
    event: stringAt(artifact, '/handler/event'),
    reconcileId: stringAt(artifact, '/runtime/reconcileId'),
    bundleDigest: stringAt(artifact, '/runtime/bundleDigest'),
    runtimeVersion: stringAt(artifact, '/runtime/runtimeVersion'),
    handlerAbi: stringAt(artifact, '/runtime/handlerAbi'),
    objectRef: artifact.objectRef ?? null,
    failure: {
      phase: stringAt(artifact, '/failure/phase'),
      reason: stringAt(artifact, '/failure/reason'),
      detailsType: stringAt(artifact, '/failure/details/type'),
    },
    debugArtifacts,
    verification,
    replayReady: stringAt(artifact, '/metadata/redaction/policy') === 'full-payload',
    notes: notesFor(artifact, debugArtifacts, Boolean(bundleDir)),
    errors: verification.filter((entry) => entry.status === 'missing' || entry.status === 'digestMismatch').map((entry) => `${entry.kind} ${entry.path}: ${entry.status}`),
  };
}

async function executeReplay(artifact, bundleDir) {
  if (stringAt(artifact, '/metadata/redaction/policy') !== 'full-payload') {
    return { ok: false, error: 'Replay execution requires a full-payload artifact.' };
  }
  if (!artifact.input || typeof artifact.input !== 'object') {
    return { ok: false, error: 'Replay artifact is missing full handler input.' };
  }
  const bundleArtifact = debugArtifactsFor(artifact).find((entry) => entry.kind === 'javascript-bundle');
  if (!bundleArtifact) {
    return { ok: false, error: 'Replay artifact does not identify a javascript-bundle debug artifact.' };
  }
  const bundlePath = artifactPath(bundleArtifact.path, bundleDir);
  if (!existsSync(bundlePath) || !statSync(bundlePath).isFile()) {
    return { ok: false, error: `Generated JavaScript bundle is missing: ${bundlePath}` };
  }
  const sourceMapRuntime = enableNodeSourceMaps();
  try {
    // static-import-exception: replay execution loads the generated bundle path recorded in the artifact.
    const module = await import(`${pathToFileURL(bundlePath).href}?replay=${Date.now()}`);
    if (typeof module.handle !== 'function') {
      return { ok: false, error: `Generated JavaScript bundle ${bundlePath} does not export handle(inputJson).` };
    }
    const outputJson = await module.handle(JSON.stringify(artifact.input));
    const plan = JSON.parse(outputJson);
    const expectedPlan = artifact.plan ?? null;
    const matchesCapturedPlan = expectedPlan ? stableJson(plan) === stableJson(expectedPlan) : undefined;
    return {
      ok: matchesCapturedPlan !== false,
      bundlePath,
      sourceMapRuntime,
      operationCount: Array.isArray(plan.operations) ? plan.operations.length : undefined,
      matchesCapturedPlan,
      ...(matchesCapturedPlan === false ? { error: 'Deterministic replay produced a plan that differs from the captured plan.' } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      bundlePath,
      sourceMapRuntime,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 12) : undefined,
    };
  }
}

function enableNodeSourceMaps() {
  if (typeof nodeModule.setSourceMapsEnabled !== 'function') {
    return { status: 'unavailable', mapper: 'node:module.setSourceMapsEnabled' };
  }
  nodeModule.setSourceMapsEnabled(true);
  return { status: 'enabled', mapper: 'node:module.setSourceMapsEnabled' };
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]));
}

function debugArtifactsFor(artifact) {
  const artifacts = artifact.debugArtifacts?.sourceMapping?.artifacts;
  if (!Array.isArray(artifacts)) {
    return [];
  }
  return artifacts
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      kind: typeof entry.kind === 'string' ? entry.kind : '<unknown>',
      path: typeof entry.path === 'string' ? entry.path : '<unknown>',
      digest: typeof entry.digest === 'string' ? entry.digest : '<unknown>',
    }));
}

function verifyDebugArtifacts(artifacts, bundleDir) {
  return artifacts.map((artifact) => {
    const path = artifactPath(artifact.path, bundleDir);
    if (!existsSync(path) || !statSync(path).isFile()) {
      return { ...artifact, resolvedPath: path, status: 'missing' };
    }
    const digest = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    return {
      ...artifact,
      resolvedPath: path,
      actualDigest: digest,
      status: digest === artifact.digest ? 'verified' : 'digestMismatch',
    };
  });
}

function artifactPath(path, bundleDir) {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(join(bundleDir, path));
}

function notesFor(artifact, debugArtifacts, bundleDirProvided) {
  const notes = [];
  if (stringAt(artifact, '/metadata/redaction/policy') !== 'full-payload') {
    notes.push('Artifact is metadata-only. It can diagnose and correlate failures, but cannot replay full handler input locally.');
  }
  if (debugArtifacts.length === 0) {
    notes.push('No source-map debug artifact identities were recorded. Rebuild with current compiler artifacts to improve source correlation.');
  } else if (!bundleDirProvided) {
    notes.push('Pass --bundle-dir to verify local javascript-bundle, javascript-source-map, and esbuild-metafile digests.');
  }
  return notes;
}

function stringAt(value, pointer) {
  const found = pointer
    .split('/')
    .slice(1)
    .reduce((current, part) => current?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], value);
  return typeof found === 'string' ? found : undefined;
}

function printSummary(summary) {
  process.stdout.write(`Replay artifact: ${summary.replayId ?? '<unknown>'}\n`);
  process.stdout.write(`Operator: ${summary.operatorName ?? '<unknown>'}\n`);
  process.stdout.write(`Handler: ${summary.handlerId ?? '<unknown>'} (${summary.event ?? '<unknown>'})\n`);
  process.stdout.write(`Reconcile: ${summary.reconcileId ?? '<unknown>'}\n`);
  process.stdout.write(`Failure: ${summary.failure.reason ?? '<unknown>'} during ${summary.failure.phase ?? '<unknown>'}\n`);
  process.stdout.write(`Redaction: ${summary.redactionPolicy ?? '<unknown>'}\n`);
  process.stdout.write(`Replay-ready: ${summary.replayReady ? 'yes' : 'no'}\n`);
  if (summary.execution) {
    process.stdout.write(`Execution: ${summary.execution.ok ? 'passed' : 'failed'}\n`);
    if (summary.execution.operationCount !== undefined) {
      process.stdout.write(`Replay operations: ${summary.execution.operationCount}\n`);
    }
    if (summary.execution.matchesCapturedPlan !== undefined) {
      process.stdout.write(`Plan match: ${summary.execution.matchesCapturedPlan ? 'yes' : 'no'}\n`);
    }
    if (summary.execution.error) {
      process.stdout.write(`Execution error: ${summary.execution.error}\n`);
    }
    if (summary.execution.sourceMapRuntime) {
      process.stdout.write(`Source maps: ${summary.execution.sourceMapRuntime.status}\n`);
    }
  }
  if (summary.debugArtifacts.length > 0) {
    process.stdout.write('Debug artifacts:\n');
    for (const artifact of summary.debugArtifacts) {
      process.stdout.write(`- ${artifact.kind} ${artifact.digest} ${artifact.path}\n`);
    }
  }
  if (summary.verification.length > 0) {
    process.stdout.write('Verification:\n');
    for (const artifact of summary.verification) {
      process.stdout.write(`- ${artifact.kind} ${artifact.status} ${artifact.resolvedPath}\n`);
    }
  }
  for (const note of summary.notes) {
    process.stdout.write(`Note: ${note}\n`);
  }
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/replay-artifact.mjs <artifact.json> [--bundle-dir <dir>] [--execute] [--json]\n\n`);
  process.stdout.write('Inspects an applik8s ReplayArtifact, summarizes failure correlation metadata, verifies debug artifact digests, and can deterministically execute full-payload handler replay without applying Kubernetes effects.\n');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
