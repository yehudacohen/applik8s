import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { buildImplicitRuntimeImage, createCompilerPipeline } from '@applik8s/compiler';
import { assertExpectedKubectlContext, describeLive, docker, formatSettledOutput, generatedManifestPaths, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-typekro-target-${process.pid}`;
const group = `platform${process.pid}.applik8s.dev`;
let tempDir: string | undefined;
let artifactDir: string | undefined;
let tenantPath: string | undefined;
let deniedTenantPath: string | undefined;

describeLive('live TypeKro operation target reconciliation', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await kubectl(['create', 'namespace', namespace]);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-typekro-target-'));
    const entrypoint = join(tempDir, 'tenant-operator.ts');
    await writeFile(entrypoint, tenantOperatorSource(group, namespace));

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

    artifactDir = join(tempDir, 'dist/kubernetes');
    tenantPath = join(tempDir, 'tenant-a.yaml');
    deniedTenantPath = join(tempDir, 'denied-tenant.yaml');
    await writeFile(tenantPath, tenantYaml('tenant-a'));
    await writeFile(deniedTenantPath, tenantYaml('denied-tenant'));

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-target-e2e', '--filename', manifestPath]);
    }
    await kubectl(['wait', `crd/tenants.${group}`, '--for=condition=Established', '--timeout=60s']);
    await rolloutStatusWithDiagnostics();
  }, 600_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'crd', `tenants.${group}`, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('applies and deletes TypeKro operation targets through the live runtime', async () => {
    if (!tenantPath) {
      throw new Error('Tenant fixture was not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-target-e2e', '--filename', tenantPath]);

    await waitForTenantPhase('tenant-a', 'Provisioning');
    expect((await kubectl(['get', 'configmap/tenant-a-config', '--namespace', namespace, '--output=jsonpath={.data.plan}'])).stdout.trim()).toBe('pro');
    expect((await kubectl(['get', 'configmap/tenant-a-app', '--namespace', namespace, '--output=jsonpath={.data.tenant}'])).stdout.trim()).toBe('tenant-a');
    expect((await kubectl(['get', `tenants.${group}/tenant-a`, '--namespace', namespace, '--output=jsonpath={.metadata.finalizers[0]}'])).stdout.trim()).toBe('platform.applik8s.dev/tenant');

    await kubectl(['delete', `tenants.${group}/tenant-a`, '--namespace', namespace, '--wait=false']);
    await waitForTenantDeletion('tenant-a');
  }, 300_000);

  it('surfaces TypeKro target operation failures through live runtime diagnostics', async () => {
    if (!deniedTenantPath) {
      throw new Error('Denied tenant fixture was not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-typekro-target-e2e', '--filename', deniedTenantPath]);

    await waitForTypeKroTargetPermissionDiagnostics();
    await waitForReadyCondition('denied-tenant', 'False', 'UndeclaredPermission');
    expect((await kubectl(['get', 'configmap/denied-tenant-config', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', 'secret/denied-tenant-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', `tenants.${group}/denied-tenant`, '--namespace', namespace, '--output=jsonpath={.status.phase}'])).stdout.trim()).toBe('');
    expect((await kubectl(['get', 'events', '--namespace', namespace, '--field-selector', 'involvedObject.name=denied-tenant,reason=TenantStackApplied', '--output=jsonpath={.items[*].reason}'])).stdout.trim()).toBe('');
  }, 300_000);
});

async function rolloutStatusWithDiagnostics(): Promise<void> {
  try {
    await kubectl(['rollout', 'status', 'deployment/tenant-operator', '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', 'deployment/tenant-operator', '--namespace', namespace]),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--all-containers=true', '--tail=200']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Rollout failed.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForTenantPhase(name: string, phase: string): Promise<void> {
  try {
    await kubectl(['wait', `tenants.${group}/${name}`, '--namespace', namespace, `--for=jsonpath={.status.phase}=${phase}`, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `tenants.${group}/${name}`, '--namespace', namespace, '--output=yaml']),
      kubectl(['get', 'configmaps', '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `Expected tenant ${name} phase ${phase}.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForTenantDeletion(name: string): Promise<void> {
  try {
    await kubectl(['wait', '--for=delete', `configmap/${name}-app`, '--namespace', namespace, '--timeout=180s']);
    await kubectl(['wait', '--for=delete', `configmap/${name}-config`, '--namespace', namespace, '--timeout=180s']);
    await kubectl(['wait', '--for=delete', `tenants.${group}/${name}`, '--namespace', namespace, '--timeout=180s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `tenants.${group}/${name}`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'configmaps', '--namespace', namespace, '--output=yaml']),
      kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--all-containers=true', '--tail=300']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `Expected tenant ${name} cleanup.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForTypeKroTargetPermissionDiagnostics(): Promise<void> {
  const started = Date.now();
  let logs = '';
  while (Date.now() - started < 120_000) {
    logs = (await kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--all-containers=true', '--tail=700'])).stdout;
    if (logs.includes('UndeclaredPermission') && logs.includes('resource=secrets')) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `tenants.${group}/denied-tenant`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'configmap/denied-tenant-config', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'secret/denied-tenant-secret', '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected TypeKro target permission diagnostics in operator logs.\n${logs}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForReadyCondition(name: string, status: 'True' | 'False' | 'Unknown', reason: string): Promise<void> {
  const started = Date.now();
  let lastCondition = '<missing>';
  while (Date.now() - started < 120_000) {
    // typecast: kubectl returns untyped JSON; this helper only reads the optional status condition fields it validates.
    const object = JSON.parse((await kubectl(['get', `tenants.${group}/${name}`, '--namespace', namespace, '--output=json'])).stdout) as { readonly status?: { readonly conditions?: readonly { readonly type?: string; readonly status?: string; readonly reason?: string; readonly message?: string }[] } };
    const ready = object.status?.conditions?.find((condition) => condition.type === 'Ready');
    lastCondition = JSON.stringify(ready ?? null);
    if (ready?.status === status && ready.reason === reason && ready.message) {
      return;
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `tenants.${group}/${name}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['logs', '--namespace', namespace, '--selector', 'app.kubernetes.io/name=tenant-operator', '--all-containers=true', '--tail=900']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected ${name} Ready=${status} reason ${reason}, got ${lastCondition}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

function tenantYaml(name: string): string {
  return `apiVersion: ${group}/v1alpha1
kind: Tenant
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  plan: pro
`;
}

function tenantOperatorSource(apiGroup: string, operatorNamespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};
import { operationTarget } from '@applik8s/typekro-adapter/targets';

interface TenantSpec { plan: 'free' | 'pro' }
interface TenantStatus { phase?: 'Provisioning' }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'TenantSpec' },
  schema: {
    type: 'object',
    required: ['plan'],
    properties: { plan: { type: 'string', enum: ['free', 'pro'] } },
  },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'TenantStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string', enum: ['Provisioning'] } } },
};

export const Tenant = sdk.crd<TenantSpec, TenantStatus>({
  apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)},
  kind: 'Tenant',
  spec,
  status,
  statusConvention: { observedGenerationField: 'observedGeneration', conditionsField: 'conditions' },
});

export const tenantOperator = sdk.operator({
  name: 'tenant-operator',
  deployment: { namespace: ${JSON.stringify(operatorNamespace)}, replicas: 1 },
  permissions: [
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['tenants'], verbs: ['get', 'list', 'watch', 'patch'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['tenants/status'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [${JSON.stringify(apiGroup)}], resources: ['tenants/finalizers'], verbs: ['get', 'patch', 'update'] },
    { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] },
    { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] },
  ],
  resources: { Tenant },
  handlers: [Tenant.on.created((tenant) => {
    const stack = tenantStack(tenant.metadata.name, tenant.metadata.namespace ?? 'default', tenant.spec.plan, tenant.metadata.name === 'denied-tenant');
    tenant.finalizers.add('platform.applik8s.dev/tenant');
    tenant.apply(stack, { fieldManager: 'tenant-stack' });
    tenant.status.phase = 'Provisioning';
    tenant.events.normal('TenantStackApplied', 'Tenant stack apply requested');
  }), Tenant.on.finalize((tenant) => {
    const stack = tenantStack(tenant.metadata.name, tenant.metadata.namespace ?? 'default', tenant.spec.plan, false);
    tenant.delete(stack, { propagationPolicy: 'Foreground' });
    tenant.finalizers.remove('platform.applik8s.dev/tenant');
  }, { finalizer: 'platform.applik8s.dev/tenant' })],
});

function tenantStack(name: string, namespace: string, plan: 'free' | 'pro', includeSecret: boolean) {
  const graph = {
    name: name + '-stack',
    resources: [
      { id: 'config', apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: name + '-config', namespace }, data: { plan } },
      ...(includeSecret ? [{ id: 'secret', apiVersion: 'v1', kind: 'Secret', metadata: { name: name + '-secret', namespace }, stringData: { token: 'denied' } }] : []),
      { id: 'app', apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: name + '-app', namespace }, data: { tenant: name } },
    ],
    dependencyGraph: {
      getTopologicalOrder() { return includeSecret ? ['config', 'secret', 'app'] : ['config', 'app']; },
      getDependencies(id: string) { return id === 'app' ? includeSecret ? ['secret'] : ['config'] : id === 'secret' ? ['config'] : []; },
    },
    factory(mode: 'direct' | 'kro') { return { mode }; },
    toYaml() { return ''; },
  };
  return operationTarget(graph, { name, namespace, plan });
}
`;
}
