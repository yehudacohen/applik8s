import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ApplicationWorkflowRun, setApplicationWorkflowRuntimeFactory } from '@applik8s/applik8s';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createHatchetWorkflowRuntime } from '../../applik8s/src/workflow-runtime-hatchet.js';
import { assertExpectedKubectlContext, describeLive, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-workflow-${process.pid}`;
const stackName = `workflow-proof-${process.pid}`;
const credentialsSecret = 'hatchet-admin';
const engineName = 'hatchet';
const workerName = 'workflow-proof';
const effectServiceName = 'workflow-effect-api';
const storageClass = process.env.APPLIK8S_E2E_STORAGE_CLASS ?? 'csi-hostpath-sc';
const testEmail = `applik8s-workflow-${process.pid}@example.test`;
const testPassword = `Applik8sWorkflowE2e-${process.pid}-Only`;

let tempDir: string | undefined;
let outDir: string | undefined;
let composition: KroDeletableComposition | undefined;
let durableProof: WorkflowBinding | undefined;
let instanceDeployed = false;

describeLive('v0.5 Hatchet durable workflow proof', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await assertClusterPrerequisites();
    await exec('bun', ['run', 'build:packages'], process.cwd());
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-live-'));
    outDir = join(tempDir, 'dist');
    await ensureNamespace(namespace);
    await installEffectService();
    await createCredentialsSecret();
    const entrypoint = join(tempDir, 'workflow-live.ts');
    await writeFile(entrypoint, workflowEntrypointSource());
    // static-import-exception: the test authors this bounded entrypoint immediately before importing its known exports. typecast: the test validates both expected exports immediately below.
    const exports = await import(entrypoint) as { readonly workflowProof?: KroDeletableComposition; readonly durableProof?: WorkflowBinding };
    if (!exports.workflowProof || !exports.durableProof) throw new Error('Generated workflow proof entrypoint did not export its composition and workflow binding.');
    composition = exports.workflowProof;
    durableProof = exports.durableProof;
    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'workflowProof', '--out-dir', outDir], process.cwd());
    await exec('sh', [join(outDir, 'typekro', 'apply.sh')], process.cwd());
    instanceDeployed = true;
  }, 300_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await deleteApplicationWithTypeKro();
      await deleteTestFixtures();
      await deleteDisposableNamespace();
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') await rm(tempDir, { recursive: true, force: true });
  }, 600_000);

  it('retries idempotent effects, survives worker replacement and durable waits, propagates correlation, compensates, reports intervention, and cancels', async () => {
    await waitForCnpgReady();
    await waitForHelmReleaseReady();
    const apiForward = await startPortForward(`service/${engineName}-api`, 8080);
    let workerForward: PortForward | undefined;
    let restoreRuntime: (() => void) | undefined;
    const previousToken = process.env.HATCHET_CLIENT_TOKEN;
    try {
      const token = await generatedWorkerToken();
      process.env.HATCHET_CLIENT_TOKEN = token;
      await waitForDeploymentReady(workerName);
      const engineForward = await startPortForward(`service/${engineName}-engine`, 7070);
      workerForward = engineForward;
      const hatchet = HatchetClient.init({
        token,
        host_port: `127.0.0.1:${engineForward.port}`,
        api_url: apiForward.endpoint,
        tls_config: { tls_strategy: 'none' },
      });
      restoreRuntime = setApplicationWorkflowRuntimeFactory(async () => createHatchetWorkflowRuntime({
        kind: 'hatchet',
        provision: false,
        hostPort: `127.0.0.1:${engineForward.port}`,
        apiUrl: apiForward.endpoint,
        tls: false,
      }));

      const binding = requiredWorkflowBinding();
      const run = await binding.start(workflowInput('restart-proof', false), {
        idempotencyKey: `restart-proof-${process.pid}`,
        correlationId: `correlation-${process.pid}`,
        causationId: `cause-${process.pid}`,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      });
      await waitForEffectCount('provision:restart-proof', 2);
      const oldPod = await runningWorkerPod();
      const previousWorkerIds = await activeWorkflowWorkerIds(hatchet);
      const replacementStartedAt = Date.now();
      await kubectl(['delete', `pod/${oldPod}`, '--namespace', namespace, '--wait=false', '--grace-period=30']);
      await waitForReplacementWorker(oldPod);
      await waitForRegisteredReplacementWorker(hatchet, previousWorkerIds, replacementStartedAt);
      await binding.signal(run.id, 'approval', { approved: true, reviewer: 'live-test' });
      await expect(run.result()).resolves.toMatchObject({ phase: 'Ready', attempts: 2 });

      const state = await effectState();
      expect(state.records).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'provision:restart-proof', correlationId: `correlation-${process.pid}` }),
        expect.objectContaining({ key: 'commit:restart-proof', correlationId: `correlation-${process.pid}` }),
      ]));

      const compensated = await binding.start(workflowInput('compensated', false), { idempotencyKey: `compensated-${process.pid}` });
      await waitForEffectCount('provision:compensated', 2);
      await binding.signal(compensated.id, 'approval', { approved: false, reviewer: 'live-test' });
      await expect(compensated.result()).resolves.toMatchObject({ phase: 'Compensated', attempts: 2 });
      await waitForEffectCount('compensate:compensated', 1);

      const intervention = await binding.start(workflowInput('intervention', true), { idempotencyKey: `intervention-${process.pid}` });
      await waitForEffectCount('provision:intervention', 2);
      await binding.signal(intervention.id, 'approval', { approved: false, reviewer: 'live-test' });
      await expect(intervention.result()).resolves.toMatchObject({ phase: 'NeedsIntervention', attempts: 2 });
      await waitForEffectCount('compensate:intervention', 2);

      const cancelled = await binding.start(workflowInput('cancelled', false), { idempotencyKey: `cancelled-${process.pid}` });
      await waitForEffectCount('provision:cancelled', 2);
      await cancelled.cancel();
      await expect(cancelled.result()).rejects.toThrow();
    } finally {
      restoreRuntime?.();
      if (previousToken === undefined) delete process.env.HATCHET_CLIENT_TOKEN;
      else process.env.HATCHET_CLIENT_TOKEN = previousToken;
      await workerForward?.close();
      await apiForward.close();
    }
  }, 900_000);
});

interface KroDeletableComposition {
  factory(mode: 'kro', options: { readonly namespace: string; readonly waitForReady: boolean; readonly timeout: number }): {
    getInstances(): Promise<readonly { readonly metadata?: { readonly name?: string } }[]>;
    deleteInstance(name: string): Promise<void>;
    dispose(): Promise<void>;
  };
}

interface WorkflowBinding {
  start(input: WorkflowInput, metadata?: { readonly idempotencyKey?: string; readonly correlationId?: string; readonly causationId?: string; readonly traceparent?: string }): Promise<ApplicationWorkflowRun<WorkflowOutput>>;
  signal(runId: string, name: string, payload: { readonly approved: boolean; readonly reviewer: string }): Promise<void>;
}

interface WorkflowInput {
  readonly effectEndpoint: string;
  readonly proofId: string;
  readonly compensationFails: boolean;
}

interface WorkflowOutput {
  readonly phase: 'Ready' | 'Compensated' | 'NeedsIntervention';
  readonly attempts: number;
}

interface EffectState {
  readonly counts: Readonly<Record<string, number>>;
  readonly records: readonly { readonly key: string; readonly correlationId?: string }[];
}

interface PortForward {
  readonly endpoint: string;
  readonly port: number;
  close(): Promise<void>;
}

function workflowInput(proofId: string, compensationFails: boolean): WorkflowInput {
  return { effectEndpoint: `http://${effectServiceName}.${namespace}.svc:8080`, proofId, compensationFails };
}

function requiredWorkflowBinding(): WorkflowBinding {
  if (!durableProof) throw new Error('Workflow binding is unavailable.');
  return durableProof;
}

function workflowEntrypointSource(): string {
  return `
import { app, task, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';

const Effect = task('proof.effect.v1', {
  input: type({ effectEndpoint: 'string', proofId: 'string', operation: "'provision' | 'commit' | 'compensate'", compensationFails: 'boolean' }),
  output: type({ attempts: 'number' }),
});
const DurableProof = workflow('proof.durable.v1', {
  input: type({ effectEndpoint: 'string', proofId: 'string', compensationFails: 'boolean' }),
  output: type({ phase: "'Ready' | 'Compensated' | 'NeedsIntervention'", attempts: 'number' }),
  signals: { approval: type({ approved: 'boolean', reviewer: 'string' }) },
});

const platform = app(${JSON.stringify(stackName)}, { namespace: ${JSON.stringify(namespace)}, status: type({ ready: 'boolean?' }) });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
  name: ${JSON.stringify(engineName)},
  namespace: ${JSON.stringify(namespace)},
  adminCredentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: ${JSON.stringify(credentialsSecret)}, namespace: ${JSON.stringify(namespace)} },
  database: { clusterName: 'hatchet-db', database: 'hatchet', instances: 1, storageSize: '1Gi', storageClass: ${JSON.stringify(storageClass)} },
  worker: { replicas: 1, taskSlots: 4, durableSlots: 8, gracefulShutdownSeconds: 30, scaling: { mode: 'fixed' } },
}));
const effect = platform.task(Effect, { retries: 1, retryBackoff: { factor: 1, maxSeconds: 2 }, executionTimeoutSeconds: 30, idempotencyKey: (input) => input.proofId + ':' + input.operation, worker: { group: ${JSON.stringify(workerName)}, replicas: 1, taskSlots: 4, durableSlots: 8 } }, async (input, context) => {
  const body = new URLSearchParams({ proofId: input.proofId, operation: input.operation, compensationFails: String(input.compensationFails) });
  const response = await fetch(input.effectEndpoint + '/effect', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': input.proofId + ':' + input.operation, ...(context.correlationId ? { 'x-correlation-id': context.correlationId } : {}) }, body, signal: context.signal });
  if (!response.ok) throw new Error('effect failed with HTTP ' + response.status);
  return await response.json();
});
export const durableProof = platform.workflow(DurableProof, { tasks: { effect }, worker: { group: ${JSON.stringify(workerName)}, replicas: 1, taskSlots: 4, durableSlots: 8 } }, async (input, context) => {
  const provisioned = await context.task('effect', { ...input, operation: 'provision' }, { idempotencyKey: input.proofId + ':provision', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
  await context.sleep('1s');
  const approval = await context.waitFor('approval', { lookback: '5m' });
  if (!approval.approved) {
    try {
      await context.task('effect', { ...input, operation: 'compensate' }, { idempotencyKey: input.proofId + ':compensate', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
      return { phase: 'Compensated', attempts: provisioned.attempts };
    } catch {
      return { phase: 'NeedsIntervention', attempts: provisioned.attempts };
    }
  }
  await context.task('effect', { ...input, operation: 'commit' }, { idempotencyKey: input.proofId + ':commit', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
  return { phase: 'Ready', attempts: provisioned.attempts };
});
export const workflowProof = platform.composition;
`.trimStart();
}

async function assertClusterPrerequisites(): Promise<void> {
  await Promise.all([
    kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']),
    kubectl(['get', 'crd/helmreleases.helm.toolkit.fluxcd.io']),
    kubectl(['get', 'crd/clusters.postgresql.cnpg.io']),
    kubectl(['get', `storageclass/${storageClass}`]),
  ]);
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', `namespace/${name}`]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function createCredentialsSecret(): Promise<void> {
  const secretPath = join(requiredTempDir(), 'hatchet-secret.yaml');
  const generated = await exec('kubectl', ['create', 'secret', 'generic', credentialsSecret, '--namespace', namespace, `--from-literal=adminEmail=${testEmail}`, `--from-literal=adminPassword=${testPassword}`, '--dry-run=client', '--output=yaml'], process.cwd());
  await writeFile(secretPath, generated.stdout);
  await kubectl(['apply', '--filename', secretPath]);
}

async function installEffectService(): Promise<void> {
  const source = `const http=require('node:http');const counts={};const records=[];http.createServer((req,res)=>{if(req.method==='GET'&&req.url==='/state'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({counts,records}));}let body='';req.on('data',c=>body+=c);req.on('end',()=>{const p=new URLSearchParams(body);const proofId=p.get('proofId');const operation=p.get('operation');const key=operation+':'+proofId;counts[key]=(counts[key]||0)+1;records.push({key,correlationId:req.headers['x-correlation-id']});const fail=(operation==='provision'&&counts[key]===1)||(operation==='compensate'&&p.get('compensationFails')==='true');res.writeHead(fail?503:200,{'content-type':'application/json'});res.end(JSON.stringify({attempts:counts[key]}));});}).listen(8080,'0.0.0.0');`;
  const manifest = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${effectServiceName}\n  namespace: ${namespace}\ndata:\n  server.js: ${JSON.stringify(source)}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${effectServiceName}\n  namespace: ${namespace}\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: ${effectServiceName}\n  template:\n    metadata:\n      labels:\n        app: ${effectServiceName}\n    spec:\n      containers:\n        - name: server\n          image: node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2\n          command: [node, /app/server.js]\n          ports:\n            - containerPort: 8080\n          volumeMounts:\n            - name: source\n              mountPath: /app\n              readOnly: true\n      volumes:\n        - name: source\n          configMap:\n            name: ${effectServiceName}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${effectServiceName}\n  namespace: ${namespace}\nspec:\n  selector:\n    app: ${effectServiceName}\n  ports:\n    - port: 8080\n      targetPort: 8080\n`;
  const path = join(requiredTempDir(), 'effect-service.yaml');
  await writeFile(path, manifest);
  await kubectl(['apply', '--filename', path]);
  await waitForDeploymentReady(effectServiceName);
}

async function waitForCnpgReady(): Promise<void> {
  await waitForResourceExists('cluster.postgresql.cnpg.io/hatchet-db');
  await kubectl(['wait', 'cluster.postgresql.cnpg.io/hatchet-db', '--namespace', namespace, '--for=condition=Ready', '--timeout=300s']);
}

async function waitForHelmReleaseReady(): Promise<void> {
  try {
    await waitForResourceExists(`helmrelease.helm.toolkit.fluxcd.io/${engineName}`);
    await kubectl(['wait', `helmrelease.helm.toolkit.fluxcd.io/${engineName}`, '--namespace', namespace, '--for=condition=Ready', '--timeout=600s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `helmrelease/${engineName}`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'pods', '--namespace', namespace, '--output=wide']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForResourceExists(resource: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', resource, '--namespace', namespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for ${resource} in ${namespace}.`);
}

async function waitForDeploymentReady(name: string): Promise<void> {
  await waitForResourceExists(`deployment/${name}`);
  await kubectl(['rollout', 'status', `deployment/${name}`, '--namespace', namespace, '--timeout=300s']);
}

async function generatedWorkerToken(): Promise<string> {
  const token = (await kubectl(['get', `secret/${engineName}-client-config`, '--namespace', namespace, '--output=jsonpath={.data.HATCHET_CLIENT_TOKEN}'])).stdout.trim();
  if (!token) throw new Error('Hatchet chart generated no worker token.');
  return Buffer.from(token, 'base64').toString('utf8');
}

async function waitForEffectCount(key: string, expected: number): Promise<void> {
  const started = Date.now();
  let last: EffectState | undefined;
  while (Date.now() - started < 180_000) {
    last = await effectState();
    if ((last.counts[key] ?? 0) >= expected) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for effect ${key} count ${expected}: ${JSON.stringify(last)}`);
}

async function effectState(): Promise<EffectState> {
  const output = (await kubectl(['exec', '--namespace', namespace, `deployment/${effectServiceName}`, '--', 'node', '-e', "fetch('http://127.0.0.1:8080/state').then(r=>r.text()).then(console.log)"])).stdout;
  // typecast: the private fixture endpoint owns this JSON shape and callers assert its counters and records.
  return JSON.parse(output.trim()) as EffectState;
}

async function runningWorkerPod(): Promise<string> {
  const output = JSON.parse((await kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${workerName}`, '--output=json'])).stdout);
  const pod = output.items?.find((item: { readonly status?: { readonly phase?: string } }) => item.status?.phase === 'Running');
  if (!pod?.metadata?.name) throw new Error(`No running workflow worker pod in ${namespace}.`);
  return String(pod.metadata.name);
}

async function waitForReplacementWorker(previous: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      const current = await runningWorkerPod();
      if (current !== previous) {
        await waitForDeploymentReady(workerName);
        return;
      }
    } catch {
      // Replacement is still scheduling.
    }
    await sleep(1_000);
  }
  throw new Error(`Workflow worker ${previous} was not replaced.`);
}

async function activeWorkflowWorkerIds(client: Pick<HatchetClient, 'workers'>): Promise<ReadonlySet<string>> {
  const workers = await client.workers.list();
  const active = (workers.rows ?? []).filter((worker) => worker.name === workerName && worker.status === 'ACTIVE');
  if (active.length === 0) throw new Error(`Hatchet reports no active ${workerName} worker before replacement.`);
  return new Set(active.map((worker) => worker.metadata.id));
}

async function waitForRegisteredReplacementWorker(client: Pick<HatchetClient, 'workers'>, previousIds: ReadonlySet<string>, replacementStartedAt: number): Promise<void> {
  const started = Date.now();
  let consecutiveReadyObservations = 0;
  let lastWorkers: unknown;
  while (Date.now() - started < 180_000) {
    try {
      const workers = await client.workers.list();
      lastWorkers = workers.rows;
      const replacement = (workers.rows ?? []).find((worker) => {
        const lastHeartbeatAt = Date.parse(worker.lastHeartbeatAt ?? '');
        const hasWorkflow = worker.actions?.some((action) => action.startsWith('proof.durable.v1:')) === true;
        const hasCapacity = Object.values(worker.slotConfig ?? {}).some((slot) => slot.limit > 0 && (slot.available ?? 0) > 0);
        return worker.name === workerName
          && worker.status === 'ACTIVE'
          && !previousIds.has(worker.metadata.id)
          && Number.isFinite(lastHeartbeatAt)
          && lastHeartbeatAt >= replacementStartedAt - 5_000
          && hasWorkflow
          && hasCapacity;
      });
      consecutiveReadyObservations = replacement ? consecutiveReadyObservations + 1 : 0;
      if (consecutiveReadyObservations >= 2) return;
    } catch {
      consecutiveReadyObservations = 0;
    }
    await sleep(1_000);
  }
  throw new Error(`Hatchet did not register a stable replacement ${workerName} worker: ${JSON.stringify(lastWorkers)}`);
}

async function startPortForward(resource: string, remotePort: number): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', '--namespace', namespace, resource, `0:${remotePort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/);
    if (match?.[1]) {
      const port = Number(match[1]);
      return { endpoint: `http://127.0.0.1:${port}`, port, async close() { if (!child.killed) child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); } };
    }
    if (child.exitCode !== null) throw new Error(`kubectl port-forward ${resource} exited: ${output}`);
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out starting port-forward for ${resource}: ${output}`);
}

async function deleteApplicationWithTypeKro(): Promise<void> {
  if (!composition || !instanceDeployed) return;
  const factory = composition.factory('kro', { namespace, waitForReady: true, timeout: 600_000 });
  try {
    const instances = await factory.getInstances();
    const names = instances.map((instance) => instance.metadata?.name).filter((name): name is string => Boolean(name));
    if (!names.includes(stackName)) throw new Error(`Expected generated TypeKro instance ${namespace}/${stackName}, found ${JSON.stringify(names)}.`);
    await factory.deleteInstance(stackName);
    instanceDeployed = false;
  } finally {
    await factory.dispose();
  }
}

async function deleteTestFixtures(): Promise<void> {
  await kubectl([
    'delete',
    `deployment/${effectServiceName}`,
    `service/${effectServiceName}`,
    `configmap/${effectServiceName}`,
    `secret/${credentialsSecret}`,
    '--namespace',
    namespace,
    '--ignore-not-found=true',
    '--wait=true',
    '--timeout=120s',
  ]);
}

async function deleteDisposableNamespace(): Promise<void> {
  if (!namespace.startsWith('applik8s-workflow-')) throw new Error(`Refusing bounded cleanup for non-disposable namespace ${namespace}.`);
  await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  const started = Date.now();
  while (Date.now() - started < 300_000) {
    try {
      await kubectl(['get', `namespace/${namespace}`]);
    } catch {
      return;
    }
    await sleep(1_000);
  }
  const resourceTypes = (await kubectl(['api-resources', '--verbs=list', '--namespaced', '--output=name'])).stdout.split('\n').map((value) => value.trim()).filter(Boolean);
  const remaining = resourceTypes.length > 0
    ? (await kubectl(['get', resourceTypes.join(','), '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()
    : '';
  if (remaining) throw new Error(`Refusing to finalize namespace/${namespace}; resources remain:\n${remaining}`);
  const namespaceState = JSON.parse((await kubectl(['get', `namespace/${namespace}`, '--output=json'])).stdout);
  namespaceState.spec = { ...(namespaceState.spec ?? {}), finalizers: [] };
  const path = join(requiredTempDir(), 'namespace-finalize.json');
  await writeFile(path, JSON.stringify(namespaceState));
  await kubectl(['replace', '--raw', `/api/v1/namespaces/${namespace}/finalize`, '--filename', path]);
  await kubectl(['wait', '--for=delete', `namespace/${namespace}`, '--timeout=60s']);
}

function requiredTempDir(): string {
  if (!tempDir) throw new Error('Temporary directory is unavailable.');
  return tempDir;
}
