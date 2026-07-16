import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationAdmittedContextDigest } from '@applik8s/applik8s';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertExpectedKubectlContext, describeLive, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-v06-generated-${process.pid}`;
const stackName = process.env.APPLIK8S_E2E_STACK_NAME ?? `v06-generated-proof-${process.pid}`;
const fixture = join(process.cwd(), 'packages/e2e/test/fixtures/v06-generated-app/app.ts');
const cursorSecret = 'v06-generated-live-cursor-secret-at-least-32-bytes';
const org1 = '00000000-0000-0000-0000-000000000001';
const org2 = '00000000-0000-0000-0000-000000000002';
const gatewayName = `${stackName}-public`;
const projectionName = `${stackName}-card-history`;
const migrationJob = `${stackName}-catalog-migration`;

let tempDir: string | undefined;
let outDir: string | undefined;
let composition: DeletableComposition | undefined;
let instanceApplied = false;
let proofComplete = false;
let emptyCrdRecoveryUsed = false;
let orphanedJobPodRecoveryUsed = false;

describeLive('v0.6 generated application lifecycle on OrbStack', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await assertPrerequisites();
    await exec('bun', ['run', 'build:packages'], process.cwd());
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-v06-generated-live-'));
    outDir = join(tempDir, 'dist');
    await ensureNamespace();
    await installCursorSecret();
    process.env.APPLIK8S_E2E_NAMESPACE = namespace;
    process.env.APPLIK8S_E2E_STACK_NAME = stackName;
    // static-import-exception: this known local fixture is imported only to obtain its TypeKro lifecycle factory after the environment-scoped identity is fixed.
    const fixtureUrl = `${pathToFileURL(fixture).href}?live=${Date.now()}`;
    // static-import-exception: environment-scoped graph identity requires loading after setup; typecast: the fixture's narrow lifecycle-only contract is checked immediately below.
    const loaded = await import(/* @vite-ignore */ fixtureUrl) as { readonly v06GeneratedApp?: { readonly composition?: DeletableComposition } };
    composition = loaded.v06GeneratedApp?.composition;
    if (!composition) throw new Error('v0.6 generated application fixture did not export its TypeKro composition.');
    await exec('bun', ['run', 'applik8s', 'build', fixture, '--typekro', '--composition-name', 'v06GeneratedApp', '--out-dir', outDir], process.cwd());
    await exec('sh', [join(outDir, 'typekro', 'apply.sh')], process.cwd());
    instanceApplied = true;
  }, 300_000);

  afterAll(async () => {
    let cleanupComplete = false;
    let cleanupFailure: unknown;
    try {
      await deleteApplicationThroughTypeKro();
      await cleanKroOrphanedGeneratedWorkloads();
      await ensureGeneratedCrdDeletionCompletes();
      await deleteFixtures();
      await deleteNamespaceAndWait();
      cleanupComplete = true;
      if (proofComplete) await writeEvidenceReceipt();
    } catch (cause) {
      cleanupFailure = cause;
    } finally {
      if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') await rm(tempDir, { recursive: true, force: true });
    }
    if (cleanupFailure) throw cleanupFailure;
    if (proofComplete && !cleanupComplete) throw new Error('v0.6 live proof passed behavior assertions but failed lifecycle cleanup; no evidence receipt was written.');
  }, 720_000);

  it('serves isolated snapshots/SSE, projects durably, resumes after restart, and reports dependency readiness', async () => {
    await waitForInfrastructure();
    await waitForDeployment(gatewayName, 600_000);
    await waitForDeployment(projectionName, 600_000);
    const gateway = await startPortForward(`service/${gatewayName}`, 8080);
    const clickhouse = await startPortForward('service/clickhouse-v06-analytics', 8123);
    try {
      await expect(waitForJson(`${gateway.endpoint}/ready`, {}, (value) => value.ready === true)).resolves.toMatchObject({ ready: true, stopping: false });
      await seedSql(initialSeedSql());

      const first = await snapshot(gateway.endpoint, org1);
      expect(first.value).toEqual([expect.objectContaining({ id: '10000000-0000-0000-0000-000000000001', organizationId: org1, name: 'First' })]);
      await expect(snapshot(gateway.endpoint, org2)).resolves.toMatchObject({ value: [] });

      await seedSql(eventSql(1, 'First updated'));
      const queryEvent = await waitForSseEvent(`${gateway.endpoint}/queries/cards.for-organization.v1/subscribe`, {
        input: { organizationId: org1 }, cursor: first.cursor,
      }, identityHeaders(org1), 'invalidate');
      expect(queryEvent).toContain('event: invalidate');

      const replay = await postJson(`${gateway.endpoint}/streams/card-events/replay`, {}, identityHeaders(org1));
      expect(replay).toMatchObject({ kind: 'replay', items: [expect.objectContaining({ id: 'event-1', payload: expect.objectContaining({ name: 'First updated' }) })] });
      await waitForClickHouse(clickhouse.endpoint, 1, 1);

      const oldPod = await deploymentPod(projectionName);
      await kubectl(['delete', `pod/${oldPod}`, '--namespace', namespace, '--wait=false']);
      await seedSql(eventSql(2, 'First resumed'));
      await waitForReplacementPod(projectionName, oldPod);
      await waitForDeployment(projectionName, 600_000);
      await waitForClickHouse(clickhouse.endpoint, 2, 2);
      proofComplete = true;
    } catch (cause) {
      const diagnostics = await Promise.allSettled([
        kubectl(['get', 'pods,deployments,services,networkpolicies,cluster.postgresql.cnpg.io,clickhouseinstallation.clickhouse.altinity.com', '--namespace', namespace, '--output=wide']),
        kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
        kubectl(['logs', '--namespace', namespace, `deployment/${gatewayName}`, '--all-containers=true', '--tail=500']),
        kubectl(['logs', '--namespace', namespace, `deployment/${projectionName}`, '--all-containers=true', '--tail=500']),
      ]);
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
    } finally {
      await gateway.close();
      await clickhouse.close();
    }
  }, 900_000);
});

interface DeletableComposition {
  factory(mode: 'kro', options: { readonly namespace: string; readonly waitForReady: boolean; readonly timeout: number }): {
    getInstances(): Promise<readonly { readonly metadata?: { readonly name?: string } }[]>;
    deleteInstance(name: string): Promise<void>;
    dispose(): Promise<void>;
  };
}
interface PortForward { readonly endpoint: string; close(): Promise<void> }
interface Snapshot { readonly value: readonly unknown[]; readonly cursor: string }

async function assertPrerequisites(): Promise<void> {
  await Promise.all([
    kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']),
    kubectl(['get', 'crd/helmreleases.helm.toolkit.fluxcd.io']),
    kubectl(['get', 'crd/clusters.postgresql.cnpg.io']),
    kubectl(['get', 'crd/clickhouseinstallations.clickhouse.altinity.com']),
    kubectl(['get', 'storageclass/local-path']),
  ]);
}

async function ensureNamespace(): Promise<void> {
  try { await kubectl(['get', `namespace/${namespace}`]); } catch { await kubectl(['create', 'namespace', namespace]); }
}

async function installCursorSecret(): Promise<void> {
  const manifest = await exec('kubectl', ['create', 'secret', 'generic', 'v06-gateway-cursor', '--namespace', namespace, `--from-literal=secret=${cursorSecret}`, '--dry-run=client', '--output=yaml'], process.cwd());
  const path = join(requiredTempDir(), 'cursor-secret.yaml');
  await writeFile(path, manifest.stdout);
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-v06-live-fixture', '--filename', path]);
}

async function waitForInfrastructure(): Promise<void> {
  try {
    await waitForResource('cluster.postgresql.cnpg.io/catalog', 300_000);
    await kubectl(['wait', 'cluster.postgresql.cnpg.io/catalog', '--namespace', namespace, '--for=condition=Ready', '--timeout=300s']);
    await waitForResource(`job/${migrationJob}`, 300_000);
    await kubectl(['wait', `job/${migrationJob}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=300s']);
    await waitForJsonResource('clickhouseinstallation.clickhouse.altinity.com/v06-analytics', (value) => {
      const status = value.status;
      return typeof status === 'object' && status !== null && 'status' in status && status.status === 'Completed';
    }, 600_000);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', 'all,cluster.postgresql.cnpg.io,clickhouseinstallation.clickhouse.altinity.com,helmrelease', '--namespace', namespace, '--output=wide']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
      kubectl(['logs', '--namespace', namespace, `job/${migrationJob}`, '--all-containers=true', '--tail=300']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
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

async function waitForJsonResource(resource: string, predicate: (value: Record<string, unknown>) => boolean, timeout: number): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      const output = (await kubectl(['get', resource, '--namespace', namespace, '--output=json'])).stdout;
      // typecast: kubectl's JSON response is untyped at this boundary and all inspected fields are narrowed by predicates.
      const value = JSON.parse(output) as Record<string, unknown>;
      last = JSON.stringify(value.status ?? {});
      if (predicate(value)) return;
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for ${resource}. Last status: ${last}`);
}

async function seedSql(sql: string): Promise<void> {
  const name = `v06-seed-${Date.now().toString(36)}`;
  const configMap = `${name}-sql`;
  const path = join(requiredTempDir(), `${name}.yaml`);
  await writeFile(path, `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${configMap}\n  namespace: ${namespace}\ndata:\n  script.sql: |\n${indent(sql.trimEnd(), 4)}\n---\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: ${name}\n  namespace: ${namespace}\nspec:\n  backoffLimit: 1\n  ttlSecondsAfterFinished: 600\n  template:\n    spec:\n      restartPolicy: Never\n      containers:\n        - name: psql\n          image: postgres:17-alpine\n          command: [sh, -c, 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/script.sql']\n          env:\n            - name: DATABASE_URL\n              valueFrom:\n                secretKeyRef:\n                  name: catalog-app\n                  key: uri\n          volumeMounts:\n            - name: sql\n              mountPath: /sql\n      volumes:\n        - name: sql\n          configMap:\n            name: ${configMap}\n`);
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-v06-live-fixture', '--filename', path]);
  await kubectl(['wait', `job/${name}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=180s']);
}

function initialSeedSql(): string {
  return `SELECT set_config('applik8s.context.organizationId', '${org1}', false);\nINSERT INTO cards (id, organization_id, name, revision) VALUES ('10000000-0000-0000-0000-000000000001', '${org1}', 'First', 'r1');`;
}

function eventSql(sequence: number, name: string): string {
  const digest = applicationAdmittedContextDigest({ values: { organizationId: org1 }, digestSecret: cursorSecret });
  const recordedAt = new Date(Date.now() + sequence * 1_000).toISOString();
  return `SELECT set_config('applik8s.context.organizationId', '${org1}', false);\nUPDATE cards SET name = '${name.replaceAll("'", "''")}', revision = 'r${sequence + 1}' WHERE id = '10000000-0000-0000-0000-000000000001';\nINSERT INTO applik8s_model_changes (model, operation, identity, revision, context_digest, changed_fields, recorded_at) VALUES ('Card', 'invalidate', '"10000000-0000-0000-0000-000000000001"'::jsonb, 'r${sequence + 1}', '${digest}', '["name"]'::jsonb, '${recordedAt}');\nINSERT INTO applik8s_public_stream_events (id, contract_name, contract_version, partition_key, envelope, payload, context_digest, recorded_at) VALUES ('event-${sequence}', 'cards.changed', 'v1', '10000000-0000-0000-0000-000000000001', '{}'::jsonb, '{"cardId":"10000000-0000-0000-0000-000000000001","organizationId":"${org1}","name":"${name.replaceAll("'", "''")}","revision":"r${sequence + 1}"}'::jsonb, '${digest}', '${recordedAt}');`;
}

async function snapshot(endpoint: string, organizationId: string): Promise<Snapshot> {
  const value = await postJson(`${endpoint}/queries/cards.for-organization.v1/snapshot`, { input: { organizationId } }, identityHeaders(organizationId));
  if (!Array.isArray(value.value) || typeof value.cursor !== 'string') throw new Error(`Unexpected snapshot response: ${JSON.stringify(value)}`);
  return { value: value.value, cursor: value.cursor };
}

function identityHeaders(organizationId: string): HeadersInit { return { 'content-type': 'application/json', 'x-principal': organizationId, 'x-organization': organizationId, 'x-authorization-version': 'v1' }; }
// typecast: JSON.parse is validated as an object by the endpoint-specific callers before field access.
async function postJson(url: string, body: object, headers: HeadersInit): Promise<Record<string, unknown>> { const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); const text = await response.text(); if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text}`); return JSON.parse(text) as Record<string, unknown>; }

async function waitForSseEvent(url: string, body: object, headers: HeadersInit, event: string): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 30_000;
  let pending = '';
  const observedEvents = new Set<string>();
  try {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const result = await Promise.race([
        reader.read().then((next) => ({ next })),
        sleep(remainingMs).then(() => ({ timeout: true })),
      ]);
      if ('timeout' in result) throw new Error(`Timed out waiting for SSE event ${event} from ${url}; observed ${JSON.stringify([...observedEvents])}.`);
      const { next } = result;
      if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) observedEvents.add(line.slice('event: '.length));
        }
      }
      const match = frames.find((frame) => frame.split('\n').some((line) => line === `event: ${event}`));
      if (match !== undefined) return `${match}\n\n`;
    }
    throw new Error(`SSE stream from ${url} ended before event ${event}; observed ${JSON.stringify([...observedEvents])}.`);
  } finally { controller.abort(); await reader.cancel().catch(() => undefined); }
}

async function waitForJson(url: string, init: RequestInit, predicate: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  const started = Date.now(); let last = '';
  // typecast: the caller's predicate is the runtime validator for each polled JSON endpoint response.
  while (Date.now() - started < 120_000) { try { const response = await fetch(url, init); last = await response.text(); if (response.ok) { const value = JSON.parse(last) as Record<string, unknown>; if (predicate(value)) return value; } } catch (error) { last = error instanceof Error ? error.message : String(error); } await sleep(1_000); }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function waitForClickHouse(endpoint: string, rows: number, checkpoint: number): Promise<void> {
  await waitForJson(`${endpoint}/?query=${encodeURIComponent(`SELECT count() AS rows FROM default.card_history FINAL FORMAT JSONEachRow`)}`, { method: 'POST' }, (value) => Number(value.rows) === rows);
  await waitForJson(`${endpoint}/?query=${encodeURIComponent(`SELECT coalesce(max(\`sequence\`), 0) AS sequence FROM default.applik8s_projection_checkpoints FINAL WHERE \`projection\` = 'card-history' AND \`stream\` = 'cards.changed.v1' FORMAT JSONEachRow`)}`, { method: 'POST' }, (value) => Number(value.sequence) === checkpoint);
}

async function deploymentPod(name: string): Promise<string> { const output = (await kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${name}`, '--output=jsonpath={.items[0].metadata.name}'])).stdout.trim(); if (!output) throw new Error(`No pod found for ${name}.`); return output; }
async function waitForReplacementPod(name: string, oldPod: string): Promise<void> { const started = Date.now(); while (Date.now() - started < 300_000) { const current = await deploymentPod(name).catch(() => ''); if (current && current !== oldPod) return; await sleep(1_000); } throw new Error(`Timed out waiting for replacement pod for ${name}.`); }

async function startPortForward(resource: string, remotePort: number): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', '--namespace', namespace, resource, `0:${remotePort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += String(chunk); }); child.stderr.on('data', (chunk) => { output += String(chunk); });
  const started = Date.now(); while (Date.now() - started < 30_000) { const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/); if (match?.[1]) return { endpoint: `http://127.0.0.1:${match[1]}`, async close() { if (!child.killed) child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); } }; if (child.exitCode !== null) throw new Error(`kubectl port-forward ${resource} exited: ${output}`); await sleep(100); }
  child.kill('SIGTERM'); throw new Error(`Timed out starting port-forward for ${resource}: ${output}`);
}

async function deleteApplicationThroughTypeKro(): Promise<void> {
  if (!composition || !instanceApplied) return;
  const factory = composition.factory('kro', { namespace, waitForReady: true, timeout: 600_000 });
  try {
    const names = (await factory.getInstances()).map((instance) => instance.metadata?.name).filter((name): name is string => Boolean(name));
    if (!names.includes(stackName)) throw new Error(`Expected TypeKro instance ${namespace}/${stackName}, found ${JSON.stringify(names)}.`);
    await factory.deleteInstance(stackName);
    instanceApplied = false;
  } finally { await factory.dispose(); }
}

async function cleanKroOrphanedGeneratedWorkloads(): Promise<void> {
  // KRO 0.9 deletes Jobs without a background propagation policy. Kubernetes
  // consequently orphans their completed Pods; KRO's propagation-control KREP
  // is not released yet. The root instance itself was still deleted through
  // TypeKro above. This recovery is deliberately fail-closed and limited to a
  // completed, ownerless Pod from this disposable migration Job.
  // typecast: the Kubernetes PodList is structurally narrowed before any deletion decision.
  const podList = JSON.parse((await kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/component=migration', '--output=json'])).stdout) as Record<string, unknown>;
  const items = Array.isArray(podList.items) ? podList.items : [];
  const orphanedNames: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('Migration PodList contained a non-object item.');
    const metadata = 'metadata' in item && item.metadata && typeof item.metadata === 'object' ? item.metadata : undefined;
    const status = 'status' in item && item.status && typeof item.status === 'object' ? item.status : undefined;
    const name = metadata && 'name' in metadata && typeof metadata.name === 'string' ? metadata.name : undefined;
    const owners = metadata && 'ownerReferences' in metadata && Array.isArray(metadata.ownerReferences) ? metadata.ownerReferences : [];
    const phase = status && 'phase' in status && typeof status.phase === 'string' ? status.phase : undefined;
    if (!name?.startsWith(`${migrationJob}-`) || owners.length > 0 || (phase !== 'Succeeded' && phase !== 'Failed')) {
      throw new Error(`Refusing KRO Job-Pod recovery for unexpected migration Pod ${JSON.stringify({ name, owners, phase })}.`);
    }
    orphanedNames.push(`pod/${name}`);
  }
  if (orphanedNames.length === 0) return;
  const jobStillExists = await kubectl(['get', `job/${migrationJob}`, '--namespace', namespace, '--output=name']).then(() => true, () => false);
  if (jobStillExists) throw new Error(`Refusing orphan recovery while job/${migrationJob} still exists.`);
  await kubectl(['delete', ...orphanedNames, '--namespace', namespace, '--wait=true', '--timeout=60s']);
  orphanedJobPodRecoveryUsed = true;
}

async function ensureGeneratedCrdDeletionCompletes(): Promise<void> {
  const crdName = `${stackName.toLowerCase().replaceAll(/[^a-z0-9]/g, '')}s.${stackName}.applik8s.dev`;
  const started = Date.now();
  let crd: Record<string, unknown> | undefined;
  while (Date.now() - started < 30_000) {
    try {
      // typecast: the generated CRD response is narrowed to metadata fields before recovery decisions.
      crd = JSON.parse((await kubectl(['get', `crd/${crdName}`, '--output=json'])).stdout) as Record<string, unknown>;
    } catch { return; }
    await sleep(2_000);
  }
  const metadata = crd?.metadata;
  if (!metadata || typeof metadata !== 'object' || !('deletionTimestamp' in metadata) || typeof metadata.deletionTimestamp !== 'string') {
    throw new Error(`Generated CRD ${crdName} remained after TypeKro cleanup without an active deletion timestamp.`);
  }
  const remainingInstances = (await kubectl(['get', crdName, '--all-namespaces', '--output=name'])).stdout.trim();
  if (remainingInstances) throw new Error(`Refusing empty-CRD finalizer recovery because instances still exist: ${remainingInstances}`);
  await kubectl(['patch', `crd/${crdName}`, '--type=merge', '--patch', '{"metadata":{"finalizers":[]}}']);
  emptyCrdRecoveryUsed = true;
  await kubectl(['wait', '--for=delete', `crd/${crdName}`, '--timeout=60s']);
}

async function deleteFixtures(): Promise<void> {
  await kubectl(['delete', 'secret/v06-gateway-cursor', '--namespace', namespace, '--ignore-not-found=true', '--wait=true', '--timeout=60s']);
  const jobs = (await kubectl(['get', 'jobs', '--namespace', namespace, '--output=name'])).stdout.split('\n').filter((name) => name.startsWith('job.batch/v06-seed-'));
  const configMaps = (await kubectl(['get', 'configmaps', '--namespace', namespace, '--output=name'])).stdout.split('\n').filter((name) => name.includes('v06-seed-'));
  if (jobs.length + configMaps.length > 0) await kubectl(['delete', ...jobs, ...configMaps, '--namespace', namespace, '--ignore-not-found=true', '--wait=true', '--timeout=120s']);
}

async function deleteNamespaceAndWait(): Promise<void> {
  if (!namespace.startsWith('applik8s-v06-generated-')) throw new Error(`Refusing cleanup for non-disposable namespace ${namespace}.`);
  await kubectl(['delete', `namespace/${namespace}`, '--wait=true', '--timeout=300s']);
}

async function writeEvidenceReceipt(): Promise<void> {
  const directory = join(process.cwd(), '.applik8s-tmp/evidence/v0.6');
  await mkdir(directory, { recursive: true });
  const assertions = ['typekro-apply', 'gateway-ready', 'projection-ready', 'restart-resume', 'factory-delete', 'generated-child-cleanup', 'generated-crd-removed', 'namespace-removed'];
  if (orphanedJobPodRecoveryUsed) assertions.push('kro-job-orphan-recovery');
  if (emptyCrdRecoveryUsed) assertions.push('orbstack-empty-crd-finalizer-recovery');
  await writeFile(join(directory, 'orbstack.json'), `${JSON.stringify({ schemaVersion: 1, suite: 'orbstack', completedAt: new Date().toISOString(), environment: { context: process.env.APPLIK8S_E2E_CONTEXT ?? 'unknown', namespace, deployment: 'generated-typekro' }, assertions }, null, 2)}\n`);
}

function indent(value: string, spaces: number): string { const prefix = ' '.repeat(spaces); return value.split('\n').map((line) => `${prefix}${line}`).join('\n'); }
function requiredTempDir(): string { if (!tempDir) throw new Error('Temporary directory is unavailable.'); return tempDir; }
