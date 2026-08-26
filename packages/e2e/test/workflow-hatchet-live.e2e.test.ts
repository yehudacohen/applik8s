import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ApplicationWorkflowRun, setApplicationWorkflowRuntimeFactory } from '@applik8s/applik8s';
import { createHatchetWorkflowRuntime } from '@applik8s/runtime-hatchet';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assertExpectedKubectlContext, describeLive, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-workflow-${process.pid}`;
const stackName = `workflow-proof-${process.pid}`;
const credentialsSecret = 'hatchet-admin';
const engineName = 'hatchet';
const workerName = 'workflow-proof';
const workflowApiGroup = 'workflow-proof-live.applik8s.dev';
const workflowApiVersion = `${workflowApiGroup}/v1alpha1`;
const workflowJobResource = `workflowjobs.${workflowApiGroup}`;
const effectServiceName = 'workflow-effect-api';
const telemetryCollectorName = 'workflow-otel';
const telemetrySecretName = 'workflow-otel-tls';
const storageClass = process.env.APPLIK8S_E2E_STORAGE_CLASS ?? 'csi-hostpath-sc';
const testEmail = `applik8s-workflow-${process.pid}@example.test`;
const testPassword = `Applik8sWorkflowE2e-${process.pid}-Only`;

let tempDir: string | undefined;
let outDir: string | undefined;
let entrypointPath: string | undefined;
let kubeContext: string | undefined;
let durableProof: WorkflowBinding | undefined;
let instanceDeployed = false;

describeLive('v0.5 Hatchet durable workflow proof', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    kubeContext = (await kubectl(['config', 'current-context'])).stdout.trim();
    if (!kubeContext) throw new Error('The live workflow proof requires an explicit current Kubernetes context.');
    await assertClusterPrerequisites();
    await exec('bun', ['run', 'build:packages'], process.cwd());
    // The Node deployment host imports this authored entrypoint to hand the
    // composition to TypeKro/Alchemy. Keep the fixture under the workspace
    // package root so ordinary package resolution matches a real application.
    tempDir = await mkdtemp(join(process.cwd(), '.applik8s-workflow-live-'));
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({
      name: `applik8s-workflow-live-${process.pid}`,
      private: true,
      type: 'module',
    }));
    outDir = join(tempDir, 'dist');
    await ensureNamespace(namespace);
    await installTelemetryCollector();
    await installEffectService();
    await createCredentialsSecret();
    entrypointPath = join(tempDir, 'workflow-live.ts');
    await writeFile(entrypointPath, workflowEntrypointSource());
    // static-import-exception: the test authors this bounded entrypoint immediately before importing its known exports. typecast: the test validates both expected exports immediately below.
    const exports = await import(entrypointPath) as { readonly workflowProof?: unknown; readonly durableProof?: WorkflowBinding };
    if (!exports.workflowProof || !exports.durableProof) throw new Error('Generated workflow proof entrypoint did not export its composition and workflow binding.');
    durableProof = exports.durableProof;
    await deployApplicationWithAlchemy();
    instanceDeployed = true;
  }, 900_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (process.env.APPLIK8S_E2E_LIVE === '1') {
        for (const cleanup of [
          deleteResourceWorkflowFixtures,
          deleteApplicationWithTypeKro,
          deleteTestFixtures,
          deleteNamespaceEvents,
          deleteDisposableNamespace,
        ]) {
          try {
            await cleanup();
          } catch (cause) {
            cleanupErrors.push(cause);
          }
        }
      }
    } finally {
      if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch (cause) {
          cleanupErrors.push(cause);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Hatchet live proof cleanup did not complete.');
    }
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

      await waitForDeploymentReady('workflow-job-controller');
      await runResourceWorkflowProof('resource-gateway-proof');
      await waitForEffectCount('provision:resource-gateway-proof', 2);
      await assertSingleGatewayAdmission(hatchet, 'resource-gateway-proof');

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
      await waitForWorkflowTelemetryEvidence();
    } finally {
      restoreRuntime?.();
      if (previousToken === undefined) delete process.env.HATCHET_CLIENT_TOKEN;
      else process.env.HATCHET_CLIENT_TOKEN = previousToken;
      await workerForward?.close();
      await apiForward.close();
    }
  }, 900_000);
});

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

interface GatewayAdmissionLease {
  readonly metadata?: {
    readonly annotations?: Readonly<Record<string, string>>;
  };
}

interface OtlpAttributeValue {
  readonly stringValue?: string;
  readonly intValue?: string | number;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
}

interface OtlpSpan {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly name?: string;
  readonly attributes?: readonly {
    readonly key?: string;
    readonly value?: OtlpAttributeValue;
  }[];
  readonly links?: readonly {
    readonly traceId?: string;
    readonly spanId?: string;
  }[];
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
import { app, Observability, Scheduler, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';

const Effect = workflow('proof.effect.v1', {
  input: type({ effectEndpoint: 'string', proofId: 'string', operation: "'provision' | 'commit' | 'compensate'", compensationFails: 'boolean' }),
  output: type({ attempts: 'number' }),
});
const DurableProof = workflow('proof.durable.v1', {
  input: type({ effectEndpoint: 'string', proofId: 'string', compensationFails: 'boolean' }),
  output: type({ phase: "'Ready' | 'Compensated' | 'NeedsIntervention'", attempts: 'number' }),
  signals: { approval: type({ approved: 'boolean', reviewer: 'string' }) },
});
const ResourceProof = workflow('proof.resource.v1', {
  input: type({ effectEndpoint: 'string', proofId: 'string' }),
  output: type({ phase: "'Ready'", attempts: 'number' }),
});

const platform = app(${JSON.stringify(stackName)}, { namespace: ${JSON.stringify(namespace)}, status: type({ ready: 'boolean?' }) });
platform.provide(Observability, Observability.otlp({
  endpoint: ${JSON.stringify(`https://${telemetryCollectorName}.${namespace}.svc:4318`)},
  signals: ['traces'],
  tls: {
    trust: 'custom-ca',
    certificateAuthority: { apiVersion: 'v1', kind: 'Secret', name: ${JSON.stringify(telemetrySecretName)}, namespace: ${JSON.stringify(namespace)} },
    key: 'ca.crt',
    serverName: ${JSON.stringify(`${telemetryCollectorName}.${namespace}.svc`)},
  },
}));
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
  name: ${JSON.stringify(engineName)},
  namespace: ${JSON.stringify(namespace)},
  adminCredentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: ${JSON.stringify(credentialsSecret)}, namespace: ${JSON.stringify(namespace)} },
  database: { clusterName: 'hatchet-db', database: 'hatchet', instances: 1, storageSize: '1Gi', storageClass: ${JSON.stringify(storageClass)} },
  worker: { replicas: 1, taskSlots: 4, durableSlots: 8, gracefulShutdownSeconds: 30, scaling: { mode: 'fixed' } },
}));
platform.provide(Scheduler, Scheduler.hatchet());
const effect = platform.workflow(Effect, { retries: 1, retryBackoff: { factor: 1, maxSeconds: 2 }, executionTimeoutSeconds: 30, idempotencyKey: (input) => input.proofId + ':' + input.operation, worker: { group: ${JSON.stringify(workerName)}, replicas: 1, taskSlots: 4, durableSlots: 8 } }, async (input, context) => {
  const body = new URLSearchParams({ proofId: input.proofId, operation: input.operation, compensationFails: String(input.compensationFails) });
  const response = await fetch(input.effectEndpoint + '/effect', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': input.proofId + ':' + input.operation, ...(context.correlationId ? { 'x-correlation-id': context.correlationId } : {}) }, body, signal: context.signal });
  if (!response.ok) throw new Error('effect failed with HTTP ' + response.status);
  return await response.json();
});
export const durableProof = platform.workflow(DurableProof, { worker: { group: ${JSON.stringify(workerName)}, replicas: 1, taskSlots: 4, durableSlots: 8 } }, async (input, context) => {
  const provisioned = await effect({ ...input, operation: 'provision' }, { idempotencyKey: input.proofId + ':provision', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
  await context.sleep('1s');
  const approval = await context.waitFor('approval', { lookback: '5m' });
  if (!approval.approved) {
    try {
      await effect({ ...input, operation: 'compensate' }, { idempotencyKey: input.proofId + ':compensate', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
      return { phase: 'Compensated', attempts: provisioned.attempts };
    } catch {
      return { phase: 'NeedsIntervention', attempts: provisioned.attempts };
    }
  }
  await effect({ ...input, operation: 'commit' }, { idempotencyKey: input.proofId + ':commit', correlationId: context.correlationId, causationId: context.invocationId, traceparent: context.traceparent });
  return { phase: 'Ready', attempts: provisioned.attempts };
});
const resourceProof = platform.workflow(ResourceProof, { worker: { group: ${JSON.stringify(workerName)}, replicas: 1, taskSlots: 4, durableSlots: 8 } }, async (input, context) => {
  const provisioned = await effect({ ...input, operation: 'provision', compensationFails: false }, { idempotencyKey: input.proofId + ':provision', causationId: context.invocationId });
  return { phase: 'Ready', attempts: provisioned.attempts };
});
const WorkflowJob = platform.resource('WorkflowJob', {
  apiVersion: ${JSON.stringify(workflowApiVersion)},
  spec: type({ proofId: 'string', effectEndpoint: 'string' }),
  status: type({ 'phase?': 'string', 'resultPhase?': 'string', 'attempts?': 'number' }),
});
WorkflowJob.on.reconcile(async (job) => {
  const run = await resourceProof.start({
    effectEndpoint: job.spec.effectEndpoint,
    proofId: job.spec.proofId,
  }, { idempotencyKey: job.spec.proofId });
  const observation = await job.track('resource-proof', run, {
    onGenerationChange: 'supersede',
    onDelete: { action: 'cancel', timeout: '30s', onTimeout: 'detach' },
  });
  job.status.phase = observation.phase;
  if (observation.result) {
    job.status.resultPhase = observation.result.phase;
    job.status.attempts = observation.result.attempts;
  }
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

async function installTelemetryCollector(): Promise<void> {
  const directory = requiredTempDir();
  const certificatePath = join(directory, 'workflow-otel.crt');
  const privateKeyPath = join(directory, 'workflow-otel.key');
  await exec('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
    '-days',
    '1',
    '-subj',
    `/CN=${telemetryCollectorName}.${namespace}.svc`,
    '-addext',
    `subjectAltName=DNS:${telemetryCollectorName}.${namespace}.svc`,
  ], process.cwd());
  const secretPath = join(directory, 'workflow-otel-secret.yaml');
  const generatedSecret = await exec('kubectl', [
    'create',
    'secret',
    'generic',
    telemetrySecretName,
    '--namespace',
    namespace,
    `--from-file=tls.crt=${certificatePath}`,
    `--from-file=tls.key=${privateKeyPath}`,
    `--from-file=ca.crt=${certificatePath}`,
    '--dry-run=client',
    '--output=yaml',
  ], process.cwd());
  await writeFile(secretPath, generatedSecret.stdout);
  await kubectl(['apply', '--filename', secretPath]);

  const manifest = `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${telemetryCollectorName}
  namespace: ${namespace}
data:
  collector.yaml: |
    receivers:
      otlp:
        protocols:
          http:
            endpoint: 0.0.0.0:4318
            tls:
              cert_file: /tls/tls.crt
              key_file: /tls/tls.key
    exporters:
      file:
        path: /var/lib/otel/traces.json
        format: json
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
    service:
      extensions: [health_check]
      pipelines:
        traces:
          receivers: [otlp]
          exporters: [file]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${telemetryCollectorName}
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${telemetryCollectorName}
  template:
    metadata:
      labels:
        app: ${telemetryCollectorName}
    spec:
      containers:
        - name: collector
          image: ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.153.0
          args: [--config=/conf/collector.yaml]
          ports:
            - name: otlp-http
              containerPort: 4318
            - name: health
              containerPort: 13133
          readinessProbe:
            httpGet:
              path: /
              port: health
            initialDelaySeconds: 1
            periodSeconds: 1
          volumeMounts:
            - name: config
              mountPath: /conf
              readOnly: true
            - name: tls
              mountPath: /tls
              readOnly: true
            - name: traces
              mountPath: /var/lib/otel
        - name: evidence-reader
          image: node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
          command: [sh, -c, 'sleep 86400']
          volumeMounts:
            - name: traces
              mountPath: /var/lib/otel
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: ${telemetryCollectorName}
        - name: tls
          secret:
            secretName: ${telemetrySecretName}
        - name: traces
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: ${telemetryCollectorName}
  namespace: ${namespace}
spec:
  selector:
    app: ${telemetryCollectorName}
  ports:
    - name: otlp-http
      port: 4318
      targetPort: otlp-http
`;
  const manifestPath = join(directory, 'workflow-otel.yaml');
  await writeFile(manifestPath, manifest);
  await kubectl(['apply', '--filename', manifestPath]);
  await waitForDeploymentReady(telemetryCollectorName);
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

async function assertSingleGatewayAdmission(client: Pick<HatchetClient, 'runs'>, proofId: string): Promise<void> {
  const leases = JSON.parse((await kubectl([
    'get',
    'leases.coordination.k8s.io',
    '--namespace',
    namespace,
    '--selector=applik8s.dev/workflow-admission=true',
    '--output=json',
  ])).stdout) as { readonly items?: readonly GatewayAdmissionLease[] };
  const admissions = (leases.items ?? []).filter(
    lease => lease.metadata?.annotations?.['applik8s.dev/workflow-contract'] === 'proof.resource.v1',
  );
  expect(admissions).toHaveLength(1);
  const annotations = admissions[0]?.metadata?.annotations;
  const admissionId = annotations?.['applik8s.dev/admission-id'];
  const providerRunId = annotations?.['applik8s.dev/provider-run-id'];
  if (!admissionId || !providerRunId) throw new Error('Workflow admission Lease did not persist its admission and provider run identities.');
  expect(admissionId).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(providerRunId).toMatch(/^[0-9a-f-]{36}$/);
  expect(annotations?.['applik8s.dev/admission-state']).toBe('admitted');

  const providerRuns = await client.runs.list({
    workflowNames: ['proof.resource.v1'],
    additionalMetadata: { 'applik8s.admission-id': admissionId },
    since: new Date(Date.now() - 24 * 60 * 60 * 1_000),
    onlyTasks: false,
    limit: 10,
  });
  const matchingRunIds = [...new Set((providerRuns.rows ?? [])
    .map(row => row.workflowRunExternalId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0))];
  expect(matchingRunIds).toEqual([providerRunId]);

  const state = await effectState();
  expect(state.counts[`provision:${proofId}`]).toBe(2);
}

async function waitForWorkflowTelemetryEvidence(): Promise<void> {
  const started = Date.now();
  let lastSummary = 'collector output is not available';
  while (Date.now() - started < 180_000) {
    try {
      const output = (await kubectl([
        'exec',
        '--namespace',
        namespace,
        `deployment/${telemetryCollectorName}`,
        '--container',
        'evidence-reader',
        '--',
        'cat',
        '/var/lib/otel/traces.json',
      ])).stdout;
      const spans = collectorSpans(output);
      const workflowSpans = spans.filter((span) => telemetryAttribute(span, 'applik8s.boundary.kind') === 'workflow');
      const taskSpans = spans.filter((span) => telemetryAttribute(span, 'applik8s.boundary.kind') === 'task');
      const linkedAttempts = workflowSpans.map((workflowSpan) => {
        const attempts = taskSpans
          .filter((taskSpan) => taskSpan.links?.some(
            (link) => link.traceId === workflowSpan.traceId && link.spanId === workflowSpan.spanId,
          ))
          .map((taskSpan) => Number(telemetryAttribute(taskSpan, 'applik8s.attempt')))
          .filter((attempt) => Number.isSafeInteger(attempt));
        return { workflowSpan, attempts };
      });
      const retryGraph = linkedAttempts.find(({ attempts }) => attempts.includes(1) && attempts.includes(2));
      lastSummary = JSON.stringify({
        workflows: workflowSpans.length,
        tasks: taskSpans.length,
        linkedAttempts: linkedAttempts.map(({ attempts }) => attempts),
      });
      if (workflowSpans.length > 0 && taskSpans.length > 0 && retryGraph) {
        const serialized = JSON.stringify(spans);
        expect(serialized).not.toContain(testPassword);
        expect(serialized).not.toContain('applik8s-workflow-causal-principal-invalid');
        return;
      }
    } catch (cause) {
      lastSummary = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['logs', '--namespace', namespace, `deployment/${telemetryCollectorName}`, '--tail=100']),
    kubectl(['logs', '--namespace', namespace, `deployment/${workerName}`, '--tail=100']),
  ]);
  throw new Error(
    `Timed out waiting for a collector-visible workflow/task retry graph: ${lastSummary}\n${diagnostics.map(formatSettledOutput).join('\n')}`,
  );
}

function collectorSpans(output: string): readonly OtlpSpan[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const payloads: unknown[] = [];
  try {
    payloads.push(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split('\n').map((candidate) => candidate.trim()).filter(Boolean)) {
      try {
        payloads.push(JSON.parse(line));
      } catch {
        // The file exporter can be observed between appends. Ignore only the
        // incomplete final record; complete records remain available below.
      }
    }
  }
  return payloads.flatMap(otlpSpans);
}

function otlpSpans(payload: unknown): readonly OtlpSpan[] {
  if (!payload || typeof payload !== 'object') return [];
  const resourceSpans = Reflect.get(payload, 'resourceSpans');
  if (!Array.isArray(resourceSpans)) return [];
  return resourceSpans.flatMap((resource) => {
    const scopeSpans = resource && typeof resource === 'object'
      ? Reflect.get(resource, 'scopeSpans')
      : undefined;
    if (!Array.isArray(scopeSpans)) return [];
    return scopeSpans.flatMap((scope) => {
      const spans = scope && typeof scope === 'object' ? Reflect.get(scope, 'spans') : undefined;
      return Array.isArray(spans)
        ? spans.filter((span): span is OtlpSpan => Boolean(span && typeof span === 'object'))
        : [];
    });
  });
}

function telemetryAttribute(span: OtlpSpan, key: string): string | number | boolean | undefined {
  const value = span.attributes?.find((candidate) => candidate.key === key)?.value;
  if (!value) return undefined;
  for (const field of ['stringValue', 'intValue', 'doubleValue', 'boolValue'] as const) {
    const candidate = value[field];
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') return candidate;
  }
  return undefined;
}

async function runResourceWorkflowProof(proofId: string): Promise<void> {
  const resourcePath = join(requiredTempDir(), 'workflow-job.yaml');
  await writeFile(resourcePath, `apiVersion: ${workflowApiVersion}
kind: WorkflowJob
metadata:
  name: ${proofId}
  namespace: ${namespace}
spec:
  proofId: ${proofId}
  effectEndpoint: http://${effectServiceName}.${namespace}.svc:8080
`);
  await kubectl(['apply', '--filename', resourcePath]);
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < 420_000) {
    try {
      lastStatus = (await kubectl([
        'get',
        `${workflowJobResource}/${proofId}`,
        '--namespace',
        namespace,
        '--output=jsonpath={.status.phase}|{.status.resultPhase}|{.status.attempts}',
      ])).stdout.trim();
      if (lastStatus === 'Succeeded|Ready|2') return;
      if (lastStatus.startsWith('Failed|')) {
        throw new Error(`WorkflowJob ${proofId} failed: ${lastStatus}`);
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes(' failed: ')) throw cause;
    }
    await sleep(1_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `${workflowJobResource}/${proofId}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, 'deployment/workflow-job-controller', '--tail=80']),
    kubectl(['logs', '--namespace', namespace, `deployment/${workerName}`, '--tail=80']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(
    `WorkflowJob ${proofId} did not complete through the private workflow gateway: ${lastStatus}\n${diagnostics.map(formatSettledOutput).join('\n')}`,
  );
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
  if (!instanceDeployed) return;
  await exec('bun', [
    'run',
    'applik8s',
    'destroy',
    requiredEntrypointPath(),
    '--context',
    requiredKubeContext(),
    '--composition-name',
    'workflowProof',
    '--out-dir',
    requiredOutDir(),
    '--instance-name',
    stackName,
    '--control-plane-namespace',
    namespace,
  ], process.cwd());
  instanceDeployed = false;
}

async function deployApplicationWithAlchemy(): Promise<void> {
  const entrypoint = requiredEntrypointPath();
  const output = requiredOutDir();
  await exec('bun', [
    'run',
    'applik8s',
    'build',
    entrypoint,
    '--typekro',
    '--composition-name',
    'workflowProof',
    '--out-dir',
    output,
  ], process.cwd());
  const generatedInstances = (await readdir(join(output, 'typekro', 'instances')))
    .filter((name) => name.endsWith('.yaml'))
    .sort();
  if (generatedInstances.length !== 1) {
    throw new Error(`Expected one generated workflow proof instance, found ${JSON.stringify(generatedInstances)}.`);
  }
  const generatedInstance = generatedInstances[0];
  if (!generatedInstance) throw new Error('Generated workflow proof instance disappeared during deployment staging.');
  const instancePath = join(requiredTempDir(), 'workflow-proof-instance.yaml');
  await copyFile(join(output, 'typekro', 'instances', generatedInstance), instancePath);
  await exec('bun', [
    'run',
    'applik8s',
    'deploy',
    entrypoint,
    '--context',
    requiredKubeContext(),
    '--composition-name',
    'workflowProof',
    '--out-dir',
    output,
    '--instance',
    instancePath,
    '--skip-app-build',
  ], process.cwd());
}

async function deleteTestFixtures(): Promise<void> {
  await kubectl([
    'delete',
    `deployment/${effectServiceName}`,
    `deployment/${telemetryCollectorName}`,
    `service/${effectServiceName}`,
    `service/${telemetryCollectorName}`,
    `configmap/${effectServiceName}`,
    `configmap/${telemetryCollectorName}`,
    `secret/${credentialsSecret}`,
    `secret/${telemetrySecretName}`,
    '--namespace',
    namespace,
    '--ignore-not-found=true',
    '--wait=true',
    '--timeout=120s',
  ]);
}

async function deleteResourceWorkflowFixtures(): Promise<void> {
  await kubectl([
    'delete',
    `${workflowJobResource}/resource-gateway-proof`,
    '--namespace',
    namespace,
    '--ignore-not-found=true',
    '--wait=true',
    '--timeout=120s',
  ]);
}

async function deleteNamespaceEvents(): Promise<void> {
  if (!namespace.startsWith('applik8s-workflow-')) throw new Error(`Refusing bounded cleanup for non-disposable namespace ${namespace}.`);
  // Long-running controller and workflow tests can produce thousands of Events.
  // Remove those ordinary namespaced resources before namespace deletion so a
  // persistent local cluster does not leave the namespace controller processing
  // a large, already-obsolete event backlog. This does not bypass finalizers.
  for (const resourceType of ['events', 'events.events.k8s.io']) {
    await kubectl([
      'delete',
      resourceType,
      '--all',
      '--namespace',
      namespace,
      '--ignore-not-found=true',
      '--wait=true',
      '--timeout=120s',
    ]);
  }
}

async function deleteDisposableNamespace(): Promise<void> {
  if (!namespace.startsWith('applik8s-workflow-')) throw new Error(`Refusing bounded cleanup for non-disposable namespace ${namespace}.`);
  await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  const started = Date.now();
  while (Date.now() - started < 420_000) {
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
  throw new Error(
    `Namespace/${namespace} did not finish Kubernetes-managed deletion within 420 seconds.`
    + (remaining ? ` Resources remain:\n${remaining}` : '')
    + ' The live gate will not bypass namespace-controller finalization.',
  );
}

function requiredTempDir(): string {
  if (!tempDir) throw new Error('Temporary directory is unavailable.');
  return tempDir;
}

function requiredOutDir(): string {
  if (!outDir) throw new Error('Generated output directory is unavailable.');
  return outDir;
}

function requiredEntrypointPath(): string {
  if (!entrypointPath) throw new Error('Generated workflow entrypoint is unavailable.');
  return entrypointPath;
}

function requiredKubeContext(): string {
  if (!kubeContext) throw new Error('Pinned Kubernetes context is unavailable.');
  return kubeContext;
}
