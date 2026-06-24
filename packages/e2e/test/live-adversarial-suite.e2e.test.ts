import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';

import {
  assertExpectedKubectlContext,
  describeLive,
  docker,
  formatSettledOutput,
  generatedManifestPaths,
  kubectl,
  sleep,
} from './live-e2e-helpers';

const runId = process.env.APPLIK8S_E2E_RUN_ID ?? String(process.pid);
const namespacePrefix = process.env.APPLIK8S_E2E_NAMESPACE;
const tempDirs: string[] = [];
const namespaces: string[] = [];
const crds: string[] = [];

describeLive('live adversarial reconciliation suite', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await Promise.allSettled(namespaces.map((namespace) => kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false'])));
      await Promise.allSettled(crds.map((crd) => kubectl(['delete', 'crd', crd, '--ignore-not-found=true', '--wait=false'])));
    }
    await Promise.allSettled(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
  });

  it('reconciles cluster-scoped owners with generated ClusterRole RBAC and no invalid namespaced owner reference', async () => {
    const namespace = testNamespace('cluster');
    const group = `advcluster${runId}.applik8s.dev`;
    const plural = 'clusterwidgets';
    await createTrackedNamespace(namespace);
    crds.push(`${plural}.${group}`);

    const { tempDir, artifactDir } = await compileAndInstallOperator({
      tempPrefix: 'applik8s-live-adv-cluster-',
      entrypointName: 'cluster-pipeline.ts',
      source: clusterScopedSource(group, namespace),
      crd: `${plural}.${group}`,
      fieldManager: 'applik8s-adv-cluster-e2e',
    });
    const samplePath = join(tempDir, 'cluster-widget.yaml');
    await writeFile(samplePath, `apiVersion: ${group}/v1alpha1
kind: ClusterWidget
metadata:
  name: global-widget
spec:
  targetNamespace: ${namespace}
`);

    expect((await kubectl(['get', 'clusterrole/cluster-pipeline-controller', '--output=jsonpath={.rules[0].resources[0]}'])).stdout.trim()).toBe(plural);
    expect((await kubectl(['get', 'clusterrolebinding/cluster-pipeline-controller', '--output=jsonpath={.subjects[0].namespace}'])).stdout.trim()).toBe(namespace);
    expect(artifactDir).toContain(tempDir);

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-cluster-e2e', '--filename', samplePath]);
    await waitForReadyCondition(`clusterwidgets.${group}/global-widget`, undefined, 'True', 'ReconcileSucceeded');
    expect((await kubectl(['get', 'configmap/global-widget-cluster-output', '--namespace', namespace, '--output=jsonpath={.data.scope}'])).stdout.trim()).toBe('cluster');
    expect((await kubectl(['get', 'configmap/global-widget-cluster-output', '--namespace', namespace, '--output=jsonpath={.metadata.ownerReferences}'])).stdout.trim()).toBe('');
  }, 420_000);

  it('applies cross-namespace children only with explicit live RBAC and without defaulting cross-namespace owner references', async () => {
    const operatorNamespace = testNamespace('multi-op');
    const childNamespace = testNamespace('multi-child');
    const group = `advmulti${runId}.applik8s.dev`;
    const plural = 'multijobs';
    await createTrackedNamespace(operatorNamespace);
    await createTrackedNamespace(childNamespace);
    crds.push(`${plural}.${group}`);

    const { tempDir } = await compileAndInstallOperator({
      tempPrefix: 'applik8s-live-adv-multi-',
      entrypointName: 'multi-pipeline.ts',
      source: multiNamespaceSource(group, operatorNamespace),
      crd: `${plural}.${group}`,
      fieldManager: 'applik8s-adv-multi-e2e',
      extraManifests: [multiNamespaceChildRbacYaml(operatorNamespace, childNamespace)],
    });
    const samplePath = join(tempDir, 'multi-job.yaml');
    await writeFile(samplePath, `apiVersion: ${group}/v1alpha1
kind: MultiJob
metadata:
  name: cross-child
  namespace: ${operatorNamespace}
spec:
  targetNamespace: ${childNamespace}
`);

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-multi-e2e', '--filename', samplePath]);
    await waitForReadyCondition(`multijobs.${group}/cross-child`, operatorNamespace, 'True', 'ReconcileSucceeded');
    expect((await kubectl(['get', 'configmap/cross-child-output', '--namespace', childNamespace, '--output=jsonpath={.data.ownerNamespace}'])).stdout.trim()).toBe(operatorNamespace);
    expect((await kubectl(['get', 'configmap/cross-child-output', '--namespace', childNamespace, '--output=jsonpath={.metadata.ownerReferences}'])).stdout.trim()).toBe('');
  }, 420_000);

  it('fails undeclared-permission plans before effects even when live Kubernetes RBAC would allow them', async () => {
    const namespace = testNamespace('undeclared');
    const group = `advundeclared${runId}.applik8s.dev`;
    const plural = 'preflightjobs';
    await createTrackedNamespace(namespace);
    crds.push(`${plural}.${group}`);

    const { tempDir } = await compileAndInstallOperator({
      tempPrefix: 'applik8s-live-adv-undeclared-',
      entrypointName: 'undeclared-pipeline.ts',
      source: undeclaredPermissionSource(group, namespace),
      crd: `${plural}.${group}`,
      fieldManager: 'applik8s-adv-undeclared-e2e',
      extraManifests: [undeclaredSupplementalRbacYaml(namespace)],
    });
    const samplePath = join(tempDir, 'preflight-job.yaml');
    await writeFile(samplePath, `apiVersion: ${group}/v1alpha1
kind: PreflightJob
metadata:
  name: denied-before-effects
  namespace: ${namespace}
spec:
  value: should-not-apply
`);

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-undeclared-e2e', '--filename', samplePath]);
    await waitForLogs('undeclared-pipeline', namespace, (logs) => logs.includes('UndeclaredPermission') && logs.includes('resource=configmaps'));
    await waitForReadyCondition(`preflightjobs.${group}/denied-before-effects`, namespace, 'False', 'UndeclaredPermission');
    expect((await kubectl(['get', 'configmap/denied-before-effects-output', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `preflightjobs.${group}/denied-before-effects`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `preflightjobs.${group}/denied-before-effects`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
  }, 420_000);

  it('fails over leader-elected controllers and reconciles generation changes after deleting the lease holder', async () => {
    const namespace = testNamespace('leader');
    const group = `advleader${runId}.applik8s.dev`;
    const plural = 'leaderjobs';
    await createTrackedNamespace(namespace);
    crds.push(`${plural}.${group}`);

    const { tempDir } = await compileAndInstallOperator({
      tempPrefix: 'applik8s-live-adv-leader-',
      entrypointName: 'leader-pipeline.ts',
      source: leaderElectionSource(group, namespace),
      crd: `${plural}.${group}`,
      fieldManager: 'applik8s-adv-leader-e2e',
      deployment: 'leader-pipeline',
      readyReplicas: 1,
    });
    const samplePath = join(tempDir, 'leader-job.yaml');
    await writeFile(samplePath, `apiVersion: ${group}/v1alpha1
kind: LeaderJob
metadata:
  name: failover-job
  namespace: ${namespace}
spec:
  value: before-failover
`);

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-leader-e2e', '--filename', samplePath]);
    await waitForConfigMapData('failover-job-output', namespace, 'value', 'before-failover');
    const oldHolder = await waitForLeaseHolder('leader-pipeline', namespace);
    await kubectl(['delete', `pod/${oldHolder}`, '--namespace', namespace, '--wait=false']);
    const newHolder = await waitForLeaseHolder('leader-pipeline', namespace, oldHolder);
    expect(newHolder).not.toBe(oldHolder);

    await kubectl(['patch', `leaderjobs.${group}/failover-job`, '--namespace', namespace, '--type=merge', '--patch', '{"spec":{"value":"after-failover"}}']);
    await waitForConfigMapData('failover-job-output', namespace, 'value', 'after-failover');
  }, 480_000);

  it('executes host-routed HTTP capabilities with SecretRef auth and fails closed when the Secret disappears', async () => {
    const namespace = testNamespace('cap');
    const group = `advcap${runId}.applik8s.dev`;
    const plural = 'capabilityjobs';
    await createTrackedNamespace(namespace);
    crds.push(`${plural}.${group}`);
    const tempDir = await createTrackedTempDir('applik8s-live-adv-cap-fixture-');
    const echoPath = join(tempDir, 'capability-echo.yaml');
    const secretPath = join(tempDir, 'processor-token.yaml');
    await writeFile(echoPath, capabilityEchoYaml(namespace));
    await writeFile(secretPath, `apiVersion: v1
kind: Secret
metadata:
  name: processor-token
  namespace: ${namespace}
type: Opaque
stringData:
  token: secret-token
`);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-cap-e2e', '--filename', echoPath]);
    await kubectl(['rollout', 'status', 'deployment/capability-echo', '--namespace', namespace, '--timeout=180s']);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-cap-e2e', '--filename', secretPath]);

    const { tempDir: operatorTempDir } = await compileAndInstallOperator({
      tempPrefix: 'applik8s-live-adv-cap-',
      entrypointName: 'capability-pipeline.ts',
      source: capabilitySource(group, namespace),
      crd: `${plural}.${group}`,
      fieldManager: 'applik8s-adv-cap-e2e',
    });
    const successPath = join(operatorTempDir, 'capability-success.yaml');
    const missingSecretPath = join(operatorTempDir, 'capability-missing-secret.yaml');
    await writeFile(successPath, capabilityJobYaml(group, namespace, 'capability-success', 's3://bucket/capability-success.png'));
    await writeFile(missingSecretPath, capabilityJobYaml(group, namespace, 'capability-missing-secret', 's3://bucket/capability-missing.png'));

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-cap-e2e', '--filename', successPath]);
    await waitForReadyCondition(`capabilityjobs.${group}/capability-success`, namespace, 'True', 'ReconcileSucceeded');
    expect((await kubectl(['get', `capabilityjobs.${group}/capability-success`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('Processed');
    expect((await kubectl(['get', `capabilityjobs.${group}/capability-success`, '--namespace', namespace, '--output=jsonpath={.status.authorized}'])).stdout.trim()).toBe('true');
    expect((await kubectl(['get', `capabilityjobs.${group}/capability-success`, '--namespace', namespace, '--output=jsonpath={.status.idempotencyKey}'])).stdout.trim()).toBe('capability-success');
    expect((await kubectl(['get', `capabilityjobs.${group}/capability-success`, '--namespace', namespace, '--output=jsonpath={.status.requestSource}'])).stdout.trim()).toBe('s3://bucket/capability-success.png');

    await kubectl(['delete', 'secret/processor-token', '--namespace', namespace]);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-adv-cap-e2e', '--filename', missingSecretPath]);
    await waitForReadyCondition(`capabilityjobs.${group}/capability-missing-secret`, namespace, 'False', 'HandlerRuntimeFailed');
    expect((await kubectl(['get', `capabilityjobs.${group}/capability-missing-secret`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
    const logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=capability-pipeline', '--all-containers=true', '--tail=1000'])).stdout;
    expect(logs).toContain('capability-missing-secret');
    expect(logs).not.toContain('secret-token');
    expect(logs).not.toContain('Bearer secret-token');
  }, 540_000);
});

interface CompileInstallRequest {
  readonly tempPrefix: string;
  readonly entrypointName: string;
  readonly source: string;
  readonly crd: string;
  readonly fieldManager: string;
  readonly extraManifests?: readonly string[];
  readonly deployment?: string;
  readonly rolloutTimeoutSeconds?: number;
  readonly readyReplicas?: number;
}

interface CompileInstallResult {
  readonly tempDir: string;
  readonly artifactDir: string;
}

async function compileAndInstallOperator(request: CompileInstallRequest): Promise<CompileInstallResult> {
  const tempDir = await createTrackedTempDir(request.tempPrefix);
  const entrypoint = join(tempDir, request.entrypointName);
  await writeFile(entrypoint, request.source);

  const compiled = await createCompilerPipeline().run({
    entrypoint,
    outDir: join(tempDir, 'dist'),
    runtimeVersionRange: '^0.1.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: false,
      allowedHostImports: [],
      sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
    },
  });
  if (!compiled.ok) {
    throw new Error(compiled.error.message);
  }
  const image = await buildImplicitRuntimeImage({ manifest: compiled.value.manifest });
  if (!image.ok) {
    throw new Error(image.error.message);
  }

  const artifactDir = join(tempDir, 'dist/kubernetes');
  for (const manifestPath of await generatedManifestPaths(artifactDir)) {
    await kubectl(['apply', '--server-side', '--field-manager', request.fieldManager, '--filename', manifestPath]);
  }
  for (const [index, manifest] of (request.extraManifests ?? []).entries()) {
    const path = join(tempDir, `extra-${index}.yaml`);
    await writeFile(path, manifest);
    await kubectl(['apply', '--server-side', '--field-manager', `${request.fieldManager}-extra`, '--filename', path]);
  }
  await kubectl(['wait', `crd/${request.crd}`, '--for=condition=Established', '--timeout=60s']);
  const deployment = request.deployment ?? operatorNameFromEntrypoint(request.entrypointName);
  const namespace = operatorNamespaceFromSource(request.source);
  if (request.readyReplicas) {
    await waitForReadyReplicas(deployment, namespace, request.readyReplicas, request.rolloutTimeoutSeconds ?? 180);
  } else {
    await rolloutStatusWithDiagnostics(deployment, namespace, request.rolloutTimeoutSeconds ?? 180);
  }
  return { tempDir, artifactDir };
}

async function waitForReadyReplicas(deployment: string, namespace: string, readyReplicas: number, timeoutSeconds: number): Promise<void> {
  const started = Date.now();
  let lastReady = '';
  while (Date.now() - started < timeoutSeconds * 1000) {
    lastReady = (await kubectl(['get', `deployment/${deployment}`, '--namespace', namespace, '--output=jsonpath={.status.readyReplicas}'])).stdout.trim();
    if (Number(lastReady || 0) >= readyReplicas) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['describe', `deployment/${deployment}`, '--namespace', namespace]),
    kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--output=wide']),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected deployment/${deployment} to have at least ${readyReplicas} ready replica(s), got ${lastReady || '0'}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function rolloutStatusWithDiagnostics(deployment: string, namespace: string, timeoutSeconds: number): Promise<void> {
  try {
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, `--timeout=${timeoutSeconds}s`]);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `deployment/${deployment}`, '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`]),
      kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForReadyCondition(resource: string, namespace: string | undefined, status: 'True' | 'False' | 'Unknown', reason: string): Promise<void> {
  const started = Date.now();
  let lastCondition = '<missing>';
  while (Date.now() - started < 150_000) {
    const args = ['get', resource, ...(namespace ? ['--namespace', namespace] : []), '--output=json'];
    // typecast: kubectl returns untyped JSON; this helper only reads optional Ready condition fields.
    const object = JSON.parse((await kubectl(args)).stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly reason?: string; readonly message?: string }[] } };
    const ready = object.status?.conditions?.find((condition) => condition.type === 'Ready');
    lastCondition = JSON.stringify(ready ?? null);
    if (ready?.status === status && ready.reason === reason && ready.message) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', resource, ...(namespace ? ['--namespace', namespace] : []), '--output=yaml']),
    ...(namespace ? [kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp'])] : []),
  ]);
  throw new Error(`Expected ${resource} Ready=${status} reason ${reason}, got ${lastCondition}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForLogs(deployment: string, namespace: string, predicate: (logs: string) => boolean): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${deployment}`, '--all-containers=true', '--tail=1000'])).stdout;
    if (predicate(logs)) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Expected logs predicate for deployment/${deployment}.\n${logs}`);
}

async function waitForConfigMapData(name: string, namespace: string, key: string, expected: string): Promise<void> {
  const started = Date.now();
  let value = '';
  while (Date.now() - started < 150_000) {
    value = (await kubectl(['get', `configmap/${name}`, '--namespace', namespace, `--output=jsonpath={.data.${key}}`, '--ignore-not-found=true'])).stdout.trim();
    if (value === expected) {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Expected configmap/${name} .data.${key}=${expected}, got ${value || '<missing>'}.`);
}

async function waitForLeaseHolder(leaseName: string, namespace: string, previousHolder?: string): Promise<string> {
  const started = Date.now();
  let holder = '';
  while (Date.now() - started < 180_000) {
    holder = (await kubectl(['get', `lease/${leaseName}`, '--namespace', namespace, '--output=jsonpath={.spec.holderIdentity}', '--ignore-not-found=true'])).stdout.trim();
    if (holder && holder !== previousHolder) {
      return holder;
    }
    await sleep(2_000);
  }
  throw new Error(`Expected lease/${leaseName} holder${previousHolder ? ` different from ${previousHolder}` : ''}, got ${holder || '<missing>'}.`);
}

async function createTrackedNamespace(namespace: string): Promise<void> {
  namespaces.push(namespace);
  await kubectl(['create', 'namespace', namespace]);
}

async function createTrackedTempDir(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function testNamespace(suffix: string): string {
  return namespacePrefix ? `${namespacePrefix}-${suffix}` : `applik8s-${suffix}-${runId}`;
}

function operatorNameFromEntrypoint(entrypointName: string): string {
  return entrypointName.replace(/\.ts$/, '');
}

function operatorNamespaceFromSource(source: string): string {
  const match = source.match(/const OPERATOR_NAMESPACE = "([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('Test operator source must contain a literal deployment namespace.');
  }
  return match[1];
}

function capabilityJobYaml(group: string, namespace: string, name: string, sourceUrl: string): string {
  return `apiVersion: ${group}/v1alpha1
kind: CapabilityJob
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  sourceUrl: ${sourceUrl}
`;
}

function commonSchemas(kind: string): string {
  return `const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: '${kind}Spec' },
  schema: { type: 'object', properties: { targetNamespace: { type: 'string' }, value: { type: 'string' }, sourceUrl: { type: 'string' } } },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: '${kind}Status' },
  schema: { type: 'object', properties: { phase: { type: 'string' }, scope: { type: 'string' }, childNamespace: { type: 'string' }, authorized: { type: 'boolean' }, idempotencyKey: { type: 'string' }, requestSource: { type: 'string' } } },
};`;
}

function runtimeConfig(name: string, leaderElection = false, replicas = 1): string {
  return `deployment: { namespace: OPERATOR_NAMESPACE, replicas: ${replicas} },
  runtime: {
    handlerTimeoutSeconds: 10,
    leaderElection: { enabled: ${leaderElection}, leaseName: '${name}', leaseDurationSeconds: 15, renewDeadlineSeconds: 10, retryPeriodSeconds: 2 },
    concurrency: { workerCount: 1, maxInFlightPerResource: 1 },
    rateLimit: { baseDelayMs: 1000, maxDelayMs: 5000 },
    health: { enabled: true, path: '/healthz', port: 8080 },
    metrics: { enabled: true, path: '/metrics', port: 9090, labels: [] },
  }`;
}

function clusterScopedSource(apiGroup: string, namespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const OPERATOR_NAMESPACE = ${JSON.stringify(namespace)};
interface ClusterWidgetSpec { targetNamespace: string }
interface ClusterWidgetStatus { phase?: string; scope?: string }
${commonSchemas('ClusterWidget')}
export const ClusterWidget = sdk.crd<ClusterWidgetSpec, ClusterWidgetStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'ClusterWidget', plural: 'clusterwidgets', scope: 'Cluster', spec, status, statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' } });
export const clusterPipeline = sdk.operator({
  name: 'cluster-pipeline',
  ${runtimeConfig('cluster-pipeline')},
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['clusterwidgets'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['clusterwidgets/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
  ],
  resources: { ClusterWidget },
  handlers: [ClusterWidget.on.created((widget) => {
    widget.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: widget.names.dnsSafe(widget.metadata.name + '-cluster-output'), namespace: widget.spec.targetNamespace }, data: { scope: 'cluster' } });
    widget.status.phase = 'Processed';
    widget.status.scope = 'Cluster';
  })],
});
`;
}

function multiNamespaceSource(apiGroup: string, namespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const OPERATOR_NAMESPACE = ${JSON.stringify(namespace)};
interface MultiJobSpec { targetNamespace: string }
interface MultiJobStatus { phase?: string; childNamespace?: string }
${commonSchemas('MultiJob')}
export const MultiJob = sdk.crd<MultiJobSpec, MultiJobStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'MultiJob', plural: 'multijobs', spec, status, statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' } });
export const multiPipeline = sdk.operator({
  name: 'multi-pipeline',
  ${runtimeConfig('multi-pipeline')},
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['multijobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['multijobs/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
  ],
  resources: { MultiJob },
  handlers: [MultiJob.on.created((job) => {
    job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: job.names.dnsSafe(job.metadata.name + '-output'), namespace: job.spec.targetNamespace }, data: { ownerNamespace: job.metadata.namespace ?? '' } });
    job.status.phase = 'Processed';
    job.status.childNamespace = job.spec.targetNamespace;
  })],
});
`;
}

function undeclaredPermissionSource(apiGroup: string, namespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const OPERATOR_NAMESPACE = ${JSON.stringify(namespace)};
interface PreflightJobSpec { value: string }
interface PreflightJobStatus { phase?: string }
${commonSchemas('PreflightJob')}
export const PreflightJob = sdk.crd<PreflightJobSpec, PreflightJobStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'PreflightJob', plural: 'preflightjobs', spec, status, statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' } });
export const undeclaredPipeline = sdk.operator({
  name: 'undeclared-pipeline',
  ${runtimeConfig('undeclared-pipeline')},
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['preflightjobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['preflightjobs/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['preflightjobs/finalizers'], verbs: ['get', 'patch', 'update'] },
  ],
  resources: { PreflightJob },
  handlers: [PreflightJob.on.created((job) => {
    job.finalizers.add('adversarial.applik8s.dev/preflight');
    job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: job.names.dnsSafe(job.metadata.name + '-output'), namespace: job.metadata.namespace }, data: { value: job.spec.value } });
    job.status.phase = 'Processed';
  })],
});
`;
}

function leaderElectionSource(apiGroup: string, namespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const OPERATOR_NAMESPACE = ${JSON.stringify(namespace)};
interface LeaderJobSpec { value: string }
interface LeaderJobStatus { phase?: string }
${commonSchemas('LeaderJob')}
export const LeaderJob = sdk.crd<LeaderJobSpec, LeaderJobStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'LeaderJob', plural: 'leaderjobs', spec, status, statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' } });
function reconcile(job: any) {
  job.apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: job.names.dnsSafe(job.metadata.name + '-output'), namespace: job.metadata.namespace }, data: { value: job.spec.value } });
  job.status.phase = 'Processed';
}
export const leaderPipeline = sdk.operator({
  name: 'leader-pipeline',
  ${runtimeConfig('leader-pipeline', true, 2)},
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['leaderjobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['leaderjobs/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
  ],
  resources: { LeaderJob },
  handlers: [LeaderJob.on.created(reconcile), LeaderJob.on.updated(reconcile)],
});
`;
}

function capabilitySource(apiGroup: string, namespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
const OPERATOR_NAMESPACE = ${JSON.stringify(namespace)};
interface CapabilityJobSpec { sourceUrl: string }
interface CapabilityJobStatus { phase?: string; authorized?: boolean; idempotencyKey?: string; requestSource?: string }
${commonSchemas('CapabilityJob')}
export const CapabilityJob = sdk.crd<CapabilityJobSpec, CapabilityJobStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'CapabilityJob', plural: 'capabilityjobs', spec, status, statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' } });
const descriptor = sdk.external.http({ baseUrl: ${JSON.stringify(`http://capability-echo.${namespace}.svc.cluster.local:8080`)}, auth: sdk.secretRef('processor-token', 'token', OPERATOR_NAMESPACE), timeoutMs: 5000 });
export const capabilityPipeline = sdk.operator({
  name: 'capability-pipeline',
  ${runtimeConfig('capability-pipeline')},
  capabilities: { processor: { ...descriptor, execution: { liveExecution: 'hostProtocol', protocol: 'applik8s.capability/v1alpha1', audit: { recordRequests: true, recordResponses: true, includePayloads: false }, redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' }, idempotency: { requiredForMutations: true, keySource: 'handlerProvided' } } } },
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['capabilityjobs'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['capabilityjobs/status'], verbs: ['get', 'patch', 'update'] },
  ],
  resources: { CapabilityJob },
  handlers: [CapabilityJob.on.context.created(async (job, context) => {
    const response = await context.capabilities.processor.post('/process', { sourceUrl: job.spec.sourceUrl }, { idempotencyKey: job.metadata.name });
    const typed = response as { authorization?: string; idempotencyKey?: string; body?: { sourceUrl?: string } };
    return context.apply({ status: { phase: 'Processed', authorized: typed.authorization === 'Bearer secret-token', idempotencyKey: typed.idempotencyKey, requestSource: typed.body?.sourceUrl } });
  })],
});
`;
}

function multiNamespaceChildRbacYaml(operatorNamespace: string, childNamespace: string): string {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: multi-pipeline-child-writer
  namespace: ${childNamespace}
rules:
  - apiGroups: ['']
    resources: [configmaps]
    verbs: [get, create, update, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: multi-pipeline-child-writer
  namespace: ${childNamespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: multi-pipeline-child-writer
subjects:
  - kind: ServiceAccount
    name: multi-pipeline-controller
    namespace: ${operatorNamespace}
`;
}

function undeclaredSupplementalRbacYaml(namespace: string): string {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: undeclared-pipeline-live-configmap-writer
  namespace: ${namespace}
rules:
  - apiGroups: ['']
    resources: [configmaps]
    verbs: [get, create, update, patch, delete]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: undeclared-pipeline-live-configmap-writer
  namespace: ${namespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: undeclared-pipeline-live-configmap-writer
subjects:
  - kind: ServiceAccount
    name: undeclared-pipeline-controller
    namespace: ${namespace}
`;
}

function capabilityEchoYaml(namespace: string): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: capability-echo
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: capability-echo
  template:
    metadata:
      labels:
        app: capability-echo
    spec:
      containers:
        - name: echo
          image: node:22-alpine
          imagePullPolicy: IfNotPresent
          command: [node, -e]
          args:
            - |
              const http = require('http');
              http.createServer((req, res) => {
                let body = '';
                req.on('data', (chunk) => { body += chunk; });
                req.on('end', () => {
                  res.setHeader('content-type', 'application/json');
                  res.end(JSON.stringify({
                    method: req.method,
                    path: req.url,
                    authorization: req.headers.authorization || '',
                    idempotencyKey: req.headers['idempotency-key'] || '',
                    body: body ? JSON.parse(body) : null,
                  }));
                });
              }).listen(8080, '0.0.0.0');
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: capability-echo
  namespace: ${namespace}
spec:
  selector:
    app: capability-echo
  ports:
    - port: 8080
      targetPort: 8080
`;
}
