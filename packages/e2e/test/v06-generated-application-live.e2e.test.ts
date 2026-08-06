// typecast-file-boundary: live Kubernetes and HTTP responses are narrowed before their fields are inspected.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from '../../../scripts/v06-evidence';
import {
  assertExpectedKubectlContext,
  describeLive,
  exec,
  formatSettledOutput,
  kubectl,
  sleep,
  waitForKubernetesResourceDeleted,
} from './live-e2e-helpers';

const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
// Process IDs are reused, especially across persistent local clusters. Include
// run entropy so an abandoned definition from an interrupted historical run
// cannot be mistaken for the current candidate's deployment graph.
const liveRunSuffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-v06-generated-${liveRunSuffix}`;
// Production deployments keep the root Application CR in a shared, retained
// control-plane namespace and give the workload its own lifecycle. The
// deployment lifecycle suite separately proves same-namespace instance-first
// teardown; this fixture proves that deleting an application removes its owned
// workload namespace without trying to remove the shared control plane.
const controlPlaneNamespace =
  process.env.APPLIK8S_E2E_CONTROL_NAMESPACE ?? 'typekro-system';
const stackName = process.env.APPLIK8S_E2E_STACK_NAME ?? `v06-generated-proof-${liveRunSuffix}`;
const fixture = join(process.cwd(), 'packages/e2e/test/fixtures/v06-generated-app/app.ts');
const org1 = '00000000-0000-0000-0000-000000000001';
const org2 = '00000000-0000-0000-0000-000000000002';
const cardId = '10000000-0000-0000-0000-000000000001';
const gatewayName = `${stackName}-public`;
const commandProcessorName = 'card-commands';
const projectionName = `${stackName}-card-history`;
const applicationKind = pascalCase(stackName);
const applicationResource = `${applicationKind.toLowerCase()}s.${stackName}.applik8s.dev`;

let tempDir: string | undefined;
let outDir: string | undefined;
let instancePath: string | undefined;
let deploymentAttempted = false;
let proofComplete = false;
let observedMigrationJob: string | undefined;
const evidencePath = join(process.cwd(), '.applik8s-tmp/evidence/v0.6/orbstack.json');
const evidenceRunId = randomUUID();
const evidenceStartedAt = new Date().toISOString();

describeLive('v0.6 generated application lifecycle on OrbStack', () => {
  beforeAll(async () => {
    await discardV06Evidence(evidencePath);
    await assertExpectedKubectlContext();
    await assertPrerequisites();
    await exec('bun', ['run', 'build:packages'], process.cwd());
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-v06-generated-live-'));
    outDir = join(tempDir, 'dist');
    instancePath = join(tempDir, 'instance.yaml');
    await writeFile(instancePath, `apiVersion: ${stackName}.applik8s.dev/v1alpha1
kind: ${applicationKind}
metadata:
  name: ${stackName}
  namespace: ${controlPlaneNamespace}
spec: {}
`);
    process.env.APPLIK8S_E2E_NAMESPACE = namespace;
    process.env.APPLIK8S_E2E_STACK_NAME = stackName;
    deploymentAttempted = true;
    await exec('bun', [
      'run', 'packages/cli/src/bin.ts', 'deploy', fixture,
      '--context', context,
      '--composition-name', 'v06GeneratedApp',
      '--out-dir', outDir,
      '--instance', instancePath,
      '--skip-app-build',
    ], process.cwd());
  }, 1_200_000);

  afterAll(async () => {
    let cleanupFailure: unknown;
    try {
      if (deploymentAttempted && outDir && await access(join(outDir, 'typekro', 'application-deployment-graph.json')).then(() => true).catch(() => false)) {
        await exec('bun', [
          'run', 'packages/cli/src/bin.ts', 'delete', fixture,
          '--context', context,
          '--composition-name', 'v06GeneratedApp',
          '--out-dir', outDir,
          '--instance-name', stackName,
          '--control-plane-namespace', controlPlaneNamespace,
        ], process.cwd());
        await expect(kubectl(['get', `${applicationResource}/${stackName}`, '--namespace', controlPlaneNamespace])).rejects.toThrow();
        await waitForKubernetesResourceDeleted(`namespace/${namespace}`, 900_000);
        await expect(kubectl(['get', `resourcegraphdefinition/${stackName}`])).rejects.toThrow();
        if (proofComplete) await writeEvidenceReceipt();
      }
    } catch (cause) {
      cleanupFailure = cause;
    } finally {
      delete process.env.APPLIK8S_E2E_NAMESPACE;
      delete process.env.APPLIK8S_E2E_STACK_NAME;
      if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') await rm(tempDir, { recursive: true, force: true });
    }
    if (cleanupFailure) throw cleanupFailure;
  }, 1_500_000);

  it('runs command admission, PostgreSQL/outbox, JetStream, SSE/requery, ClickHouse, restart recovery, and TypeKro lifecycle', async () => {
    try {
      await waitForInfrastructure();
      await Promise.all([
        waitForDeployment(gatewayName, 600_000),
        waitForDeployment(commandProcessorName, 600_000),
        waitForDeployment(projectionName, 600_000),
      ]);
      await assertApplicationReady();
      const gateway = await startPortForward(`service/${gatewayName}`, 8080);
      const clickhouse = await startPortForward('service/clickhouse-v06-analytics', 8123);
      try {
        await expect(waitForJson(`${gateway.endpoint}/ready`, {}, (value) => value.ready === true)).resolves.toMatchObject({ ready: true, stopping: false });

        const empty = await snapshot(gateway.endpoint, org1);
        expect(empty.value).toEqual([]);
        await expect(snapshot(gateway.endpoint, org2)).resolves.toMatchObject({ value: [] });

        const createdInvalidation = waitForSseEvent(
          `${gateway.endpoint}/queries/cards.for-organization.v1/subscribe`,
          { input: { organizationId: org1 }, cursor: empty.cursor },
          identityHeaders(org1),
          'invalidate',
        );
        const created = await submitCommand(gateway.endpoint, 'models.Card.create.v1', {
          id: cardId,
          organizationId: org1,
          name: 'First',
        }, 'card-create', org1);
        expect(created).toMatchObject({ durableResult: 'succeeded', modelRevision: expect.any(String) });
        await expect(createdInvalidation).resolves.toContain('event: invalidate');
        await expect(snapshot(gateway.endpoint, org1)).resolves.toMatchObject({
          value: [expect.objectContaining({ id: cardId, organizationId: org1, name: 'First' })],
        });

        const beforeUpdate = await snapshot(gateway.endpoint, org1);
        const updatedInvalidation = waitForSseEvent(
          `${gateway.endpoint}/queries/cards.for-organization.v1/subscribe`,
          { input: { organizationId: org1 }, cursor: beforeUpdate.cursor },
          identityHeaders(org1),
          'invalidate',
        );
        const updated = await submitCommand(gateway.endpoint, 'models.Card.update.v1', {
          identity: cardId,
          patch: { name: 'First updated' },
        }, 'card-update', org1, stringField(created, 'modelRevision'));
        await expect(updatedInvalidation).resolves.toContain('event: invalidate');
        await expect(snapshot(gateway.endpoint, org1)).resolves.toMatchObject({
          value: [expect.objectContaining({ id: cardId, name: 'First updated' })],
        });

        const replay = await postJson(`${gateway.endpoint}/streams/card-events/replay`, {}, identityHeaders(org1));
        const replayItems = arrayField(replay, 'items');
        expect(replayItems).toHaveLength(2);
        expect(replayItems).toEqual(expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ cardId, name: 'First' }) }),
          expect.objectContaining({ payload: expect.objectContaining({ cardId, name: 'First updated' }) }),
        ]));
        const firstCheckpoint = await waitForClickHouse(clickhouse.endpoint, 2, 0);

        const oldPod = await deploymentPod(projectionName);
        await kubectl(['delete', `pod/${oldPod}`, '--namespace', namespace, '--wait=false']);
        await waitForReplacementPod(projectionName, oldPod);
        await waitForDeployment(projectionName, 600_000);

        const beforeResume = await snapshot(gateway.endpoint, org1);
        const resumedInvalidation = waitForSseEvent(
          `${gateway.endpoint}/queries/cards.for-organization.v1/subscribe`,
          { input: { organizationId: org1 }, cursor: beforeResume.cursor },
          identityHeaders(org1),
          'invalidate',
        );
        const resumed = await submitCommand(gateway.endpoint, 'models.Card.update.v1', {
          identity: cardId,
          patch: { name: 'First resumed' },
        }, 'card-resume', org1, stringField(updated, 'modelRevision'));
        expect(resumed).toMatchObject({ durableResult: 'succeeded', modelRevision: expect.any(String) });
        await expect(resumedInvalidation).resolves.toContain('event: invalidate');
        await expect(snapshot(gateway.endpoint, org1)).resolves.toMatchObject({
          value: [expect.objectContaining({ id: cardId, name: 'First resumed' })],
        });
        await expect(waitForClickHouse(clickhouse.endpoint, 3, firstCheckpoint)).resolves.toBeGreaterThan(firstCheckpoint);
        proofComplete = true;
      } finally {
        await Promise.all([gateway.close(), clickhouse.close()]);
      }
    } catch (cause) {
      const diagnostics = await Promise.allSettled([
        kubectl(['get', 'pods,deployments,services,networkpolicies,cluster.postgresql.cnpg.io,clickhouseinstallation.clickhouse.altinity.com,helmrelease', '--namespace', namespace, '--output=wide']),
        kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
        kubectl(['logs', '--namespace', namespace, `deployment/${gatewayName}`, '--all-containers=true', '--tail=500']),
        kubectl(['logs', '--namespace', namespace, `deployment/${commandProcessorName}`, '--all-containers=true', '--tail=500']),
        kubectl(['logs', '--namespace', namespace, `deployment/${projectionName}`, '--all-containers=true', '--tail=500']),
      ]);
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
    }
  }, 900_000);
});

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

interface Snapshot {
  readonly value: readonly unknown[];
  readonly cursor: string;
}

async function assertPrerequisites(): Promise<void> {
  await Promise.all([
    kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']),
    kubectl(['get', 'crd/helmreleases.helm.toolkit.fluxcd.io']),
    kubectl(['get', 'crd/clusters.postgresql.cnpg.io']),
    kubectl(['get', 'crd/clickhouseinstallations.clickhouse.altinity.com']),
    kubectl(['get', 'storageclass/local-path']),
    kubectl(['get', 'service/harbor', '--namespace', 'typekro-harbor-registry']),
    kubectl(['get', 'secret/typekro-harbor-admin', '--namespace', 'typekro-harbor-registry']),
  ]);
}

async function assertApplicationReady(): Promise<void> {
  const value = jsonObject((await kubectl([
    'get', `${applicationResource}/${stackName}`, '--namespace', controlPlaneNamespace, '--output=json',
  ])).stdout);
  const status = objectField(value, 'status');
  expect(status.state).toBe('ACTIVE');
  expect(arrayField(status, 'conditions')).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'Ready', status: 'True' }),
  ]));
}

async function waitForInfrastructure(): Promise<void> {
  try {
    await waitForResource('cluster.postgresql.cnpg.io/catalog', 300_000);
    await kubectl(['wait', 'cluster.postgresql.cnpg.io/catalog', '--namespace', namespace, '--for=condition=Ready', '--timeout=300s']);
    observedMigrationJob = await waitForMigrationJob(300_000);
    await kubectl(['wait', `job/${observedMigrationJob}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=300s']);
    await waitForJsonResource('clickhouseinstallation.clickhouse.altinity.com/v06-analytics', (value) => {
      const status = value.status;
      return typeof status === 'object' && status !== null && Reflect.get(status, 'status') === 'Completed';
    }, 600_000);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', 'all,cluster.postgresql.cnpg.io,clickhouseinstallation.clickhouse.altinity.com,helmrelease', '--namespace', namespace, '--output=wide']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
      observedMigrationJob
        ? kubectl(['logs', '--namespace', namespace, `job/${observedMigrationJob}`, '--all-containers=true', '--tail=300'])
        : kubectl(['get', 'jobs', '--namespace', namespace, '--selector=app.kubernetes.io/component=migration', '--output=wide']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForMigrationJob(timeout: number): Promise<string> {
  const started = Date.now();
  let last = '';
  const baseName = `${stackName}-catalog-migration`;
  while (Date.now() - started < timeout) {
    try {
      const value = jsonObject((await kubectl([
        'get', 'jobs', '--namespace', namespace,
        '--selector=app.kubernetes.io/component=migration', '--output=json',
      ])).stdout);
      const names = arrayField(value, 'items')
        .map((item) => objectField(unknownObject(item), 'metadata'))
        .map((metadata) => metadata.name)
        .filter((name): name is string => typeof name === 'string' && (name === baseName || name.startsWith(`${baseName}-`)));
      last = JSON.stringify(names);
      const [name] = names;
      if (names.length === 1 && name) return name;
      if (names.length > 1) throw new Error(`Expected one generated catalog migration Job, found: ${names.join(', ')}`);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for the generated catalog migration Job. Last observation: ${last}`);
}

async function waitForResource(resource: string, timeout: number): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      await kubectl(['get', resource, '--namespace', namespace]);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for ${resource} to be created. Last error: ${last}`);
}

async function waitForDeployment(name: string, timeout: number): Promise<void> {
  await kubectl(['rollout', 'status', `deployment/${name}`, '--namespace', namespace, `--timeout=${Math.floor(timeout / 1_000)}s`]);
}

async function waitForJsonResource(
  resource: string,
  predicate: (value: Record<string, unknown>) => boolean,
  timeout: number,
): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      const value = jsonObject((await kubectl(['get', resource, '--namespace', namespace, '--output=json'])).stdout);
      last = JSON.stringify(value.status ?? {});
      if (predicate(value)) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for ${resource}. Last status: ${last}`);
}

async function snapshot(endpoint: string, organizationId: string): Promise<Snapshot> {
  const value = await postJson(
    `${endpoint}/queries/cards.for-organization.v1/snapshot`,
    { input: { organizationId } },
    identityHeaders(organizationId),
  );
  if (!Array.isArray(value.value) || typeof value.cursor !== 'string') {
    throw new Error(`Unexpected snapshot response: ${JSON.stringify(value)}`);
  }
  return { value: value.value, cursor: value.cursor };
}

async function submitCommand(
  endpoint: string,
  command: string,
  input: object,
  suffix: string,
  organizationId: string,
  expectedRevision?: string,
): Promise<Record<string, unknown>> {
  const commandId = `${stackName}-${suffix}-${Date.now()}`;
  const submission = await postJson(`${endpoint}/commands/${command}/submit`, {
    input,
    commandId,
    idempotencyKey: commandId,
    ...(expectedRevision ? { expectedRevision } : {}),
  }, identityHeaders(organizationId));
  expect(submission).toMatchObject({ command, durableResult: 'pending', transport: 'acknowledged' });
  return waitForCommand(endpoint, command, stringField(submission, 'progressCursor'), organizationId);
}

async function waitForCommand(
  endpoint: string,
  command: string,
  cursor: string,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    last = await postJson(`${endpoint}/commands/${command}/progress`, { cursor }, identityHeaders(organizationId));
    if (last.durableResult === 'succeeded') return last;
    if (last.durableResult === 'rejected') throw new Error(`Generated application command was rejected: ${JSON.stringify(last)}`);
    if (last.durableResult === 'failed') throw new Error(`Generated application command failed after bounded processing attempts: ${JSON.stringify(last)}`);
    await sleep(500);
  }
  throw new Error(`Timed out waiting for generated application command ${command}: ${JSON.stringify(last)}`);
}

function identityHeaders(organizationId: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-principal': organizationId,
    'x-organization': organizationId,
    'x-authorization-version': 'v1',
  };
}

async function postJson(url: string, body: object, headers: HeadersInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`);
  return jsonObject(text);
}

async function waitForSseEvent(
  url: string,
  body: object,
  headers: HeadersInit,
  event: string,
): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 60_000;
  let pending = '';
  const observedEvents = new Set<string>();
  const observedFrames: string[] = [];
  try {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const result = await Promise.race([
        reader.read().then((next) => ({ next })),
        sleep(remainingMs).then(() => ({ timeout: true as const })),
      ]);
      if ('timeout' in result) {
        throw new Error(`Timed out waiting for SSE event ${event} from ${url}; observed ${JSON.stringify([...observedEvents])}.`);
      }
      const { next } = result;
      if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';
      for (const frame of frames) {
        observedFrames.push(frame);
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) observedEvents.add(line.slice('event: '.length));
        }
      }
      const match = frames.find((frame) => frame.split('\n').some((line) => line === `event: ${event}`));
      if (match !== undefined) return `${match}\n\n`;
    }
    throw new Error(
      `SSE stream from ${url} ended before event ${event}; observed events `
      + `${JSON.stringify([...observedEvents])} and frames ${JSON.stringify(observedFrames)}.`,
    );
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}

async function waitForJson(
  url: string,
  init: RequestInit,
  predicate: (value: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(url, init);
      last = await response.text();
      if (response.ok) {
        const value = jsonObject(last);
        if (predicate(value)) return value;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function waitForClickHouse(endpoint: string, rows: number, afterCheckpoint: number): Promise<number> {
  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const count = await clickHouseValue(endpoint, 'SELECT count() AS value FROM default.card_history FINAL FORMAT JSONEachRow');
      const checkpoint = await clickHouseValue(endpoint, "SELECT coalesce(max(`sequence`), 0) AS value FROM default.applik8s_projection_checkpoints FINAL WHERE `projection` = 'card-history' AND `stream` = 'cards.changed.v1' FORMAT JSONEachRow");
      last = JSON.stringify({ count, checkpoint });
      if (count === rows && checkpoint > afterCheckpoint) return checkpoint;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ClickHouse card-history rows=${rows} checkpoint>${afterCheckpoint}: ${last}`);
}

async function clickHouseValue(endpoint: string, query: string): Promise<number> {
  const response = await fetch(`${endpoint}/?query=${encodeURIComponent(query)}`, { method: 'POST' });
  const text = await response.text();
  if (!response.ok) throw new Error(`ClickHouse returned ${response.status}: ${text}`);
  const value = Number(jsonObject(text).value);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ClickHouse returned an invalid numeric value: ${text}`);
  return value;
}

async function deploymentPod(name: string): Promise<string> {
  const output = (await kubectl([
    'get', 'pods', '--namespace', namespace,
    '--selector', `app.kubernetes.io/name=${name}`,
    '--output=jsonpath={.items[0].metadata.name}',
  ])).stdout.trim();
  if (!output) throw new Error(`No pod found for ${name}.`);
  return output;
}

async function waitForReplacementPod(name: string, oldPod: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 300_000) {
    const current = await deploymentPod(name).catch(() => '');
    if (current && current !== oldPod) return;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for replacement pod for ${name}.`);
}

async function startPortForward(resource: string, remotePort: number): Promise<PortForward> {
  const child = spawn('kubectl', [
    '--context', context,
    'port-forward', '--namespace', namespace, resource, `0:${remotePort}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/);
    if (match?.[1]) {
      return {
        endpoint: `http://127.0.0.1:${match[1]}`,
        async close() {
          if (!child.killed) child.kill('SIGTERM');
          await new Promise((resolve) => child.once('exit', resolve));
        },
      };
    }
    if (child.exitCode !== null) throw new Error(`kubectl port-forward ${resource} exited: ${output}`);
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out starting port-forward for ${resource}: ${output}`);
}

async function writeEvidenceReceipt(): Promise<void> {
  if (!outDir) throw new Error('Generated application output directory is unavailable for evidence.');
  const deploymentGraphPath = join(outDir, 'typekro', 'application-deployment-graph.json');
  const deploymentGraph = jsonObject(await readFile(deploymentGraphPath, 'utf8'));
  const completedAt = new Date().toISOString();
  const assertions = [
    'harbor-digest-images',
    'typekro-apply',
    'schema-complete-ready',
    'gateway-ready',
    'command-create-update',
    'postgres-transactional-outbox',
    'jetstream-delivery',
    'sse-invalidation',
    'authoritative-requery',
    'clickhouse-projection',
    'projection-restart-resume',
    'alchemy-typekro-destroy',
    'graph-owned-resources-removed',
    'generated-rgd-removed',
    'namespaces-removed',
  ];
  await writeV06EvidenceReceipt(evidencePath, {
    suite: 'orbstack',
    run: { id: evidenceRunId, startedAt: evidenceStartedAt, completedAt },
    candidate: {
      git: await collectV06GitIdentity(),
      cluster: await collectV06ClusterIdentity(context),
    },
    environment: { context, namespace, controlPlaneNamespace, deployment: 'generated-typekro-harbor' },
    assertionEvidence: createV06AssertionEvidence(
      assertions.map((assertion) => ({ assertion, test: 'generated application live lifecycle', observedAt: completedAt })),
      evidenceRunId,
    ),
    deploymentGraph,
  });
}

function jsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return unknownObject(parsed);
}

function unknownObject(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Expected a JSON object, received ${JSON.stringify(parsed)}.`);
  return parsed as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const nested = value[field];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new Error(`Expected object field ${field}: ${JSON.stringify(value)}`);
  return nested as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const nested = value[field];
  if (typeof nested !== 'string' || !nested) throw new Error(`Expected string field ${field}: ${JSON.stringify(value)}`);
  return nested;
}

function arrayField(value: Record<string, unknown>, field: string): readonly unknown[] {
  const nested = value[field];
  if (!Array.isArray(nested)) throw new Error(`Expected array field ${field}: ${JSON.stringify(value)}`);
  return nested;
}

function pascalCase(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join('');
}
