import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildImplicitRuntimeImage } from '@applik8s/compiler';
import type { OperatorManifest } from '@applik8s/core';
import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, docker, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-tenant-platform-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const apiGroup = process.env.APPLIK8S_E2E_TENANT_PLATFORM_API_GROUP ?? `tenant-platform-${process.pid}.applik8s.dev`;
const stackName = `tenant-platform-${process.pid}`;
const stackKind = `TenantPlatformE2e${process.pid}`;
const appPlural = pluralizeKubernetesKind(stackKind);
const databaseClusterName = 'tenant-platform-db';
// typecast: literal tuple keeps generated migration job names stable across wait/status assertions.
const migrationJobNames = ['account-migration', 'audit-record-migration', 'invitation-migration', 'usage-sample-migration'] as const;
const adminServerName = 'tenant-admin';
const statusReconcilerName = `${kubernetesNameSegment(stackKind)}-status-reconciler`;
const statusConfigMapName = `${statusReconcilerName}-status`;
const cnpgInstallUrl = process.env.APPLIK8S_E2E_CNPG_INSTALL_URL ?? 'https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.26/releases/cnpg-1.26.0.yaml';

let tempDir: string | undefined;
let outDir: string | undefined;

describeLive('live Tenant Platform pressure test', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureCnpgOperator();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-tenant-platform-live-'));
    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'tenant-platform-live.ts');
    await writeFile(entrypoint, tenantPlatformEntrypointSource());
    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'tenantPlatform', '--out-dir', outDir], process.cwd());
    for (const manifestPath of await nestedOperatorManifestPaths()) {
      const image = await buildImplicitRuntimeImage({ manifest: await readOperatorManifest(manifestPath) });
      if (!image.ok) {
        throw new Error(image.error.message);
      }
    }
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
      await kubectl(['delete', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('installs the control-plane substrate and serves Account data through the generated admin API', async () => {
    await runGeneratedTypeKroApplyScript();
    await waitForCnpgClusterReady();
    await waitForCnpgAppSecret();
    await waitForMigrationJobComplete();
    await rolloutStatusWithDiagnostics(statusReconcilerName);
    await waitForGeneratedMigrationStatusComplete();
    await waitForGeneratedMigrationStatusHistory();
    await rolloutStatusWithDiagnostics(adminServerName);

    const portForward = await startPortForward(['--namespace', namespace, `service/${adminServerName}`, '0:80']);
    try {
      const created = await postTenantAccount(portForward.endpoint, 'tenant-a', 'ada@example.com', 'Ada Lovelace');
      expect(created).toMatchObject({ spec: { tenant: 'tenant-a', email: 'ada@example.com', displayName: 'Ada Lovelace', role: 'owner' } });

      const queried = await waitForTenantAccount(portForward.endpoint, 'tenant-a', 'ada@example.com');
      expect(queried.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, spec: expect.objectContaining({ tenant: 'tenant-a', email: 'ada@example.com' }) })]));
    } finally {
      await portForward.close();
    }
  }, 420_000);
});

interface ModelObjectPayload {
  readonly id: string;
  readonly spec: Readonly<Record<string, unknown>>;
}

interface ModelQueryPayload {
  readonly items: readonly ModelObjectPayload[];
}

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

interface AppInstanceRef {
  readonly name: string;
  readonly namespace: string;
}

async function ensureKroRuntime(): Promise<void> {
  try {
    await kubectl(['get', 'crd/resourcegraphdefinitions.kro.run']);
    return;
  } catch {
    await ensureNamespace(runtimeNamespace);
    const bootstrap = typeKroRuntimeBootstrap({ namespace: runtimeNamespace, kroVersion: '0.9.0' });
    const factory = bootstrap.factory('direct', { namespace: runtimeNamespace, waitForReady: true, timeout: 300_000 });
    await factory.deploy({ namespace: runtimeNamespace });
    await kubectl(['wait', 'crd/resourcegraphdefinitions.kro.run', '--for=condition=Established', '--timeout=180s']);
  }
}

async function ensureCnpgOperator(): Promise<void> {
  try {
    await kubectl(['get', 'crd/clusters.postgresql.cnpg.io']);
    return;
  } catch {
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-tenant-platform-e2e', '--filename', cnpgInstallUrl]);
    await kubectl(['wait', 'crd/clusters.postgresql.cnpg.io', '--for=condition=Established', '--timeout=180s']);
    await kubectl(['rollout', 'status', 'deployment/cnpg-controller-manager', '--namespace', 'cnpg-system', '--timeout=300s']);
  }
}

async function ensureNamespace(name: string): Promise<void> {
  try {
    await kubectl(['get', 'namespace', name]);
  } catch {
    await kubectl(['create', 'namespace', name]);
  }
}

async function runGeneratedTypeKroApplyScript(): Promise<void> {
  await exec('sh', [join(requiredOutDir(), 'typekro', 'apply.sh')], process.cwd());
}

async function nestedOperatorManifestPaths(): Promise<readonly string[]> {
  const manifestPath = join(requiredOutDir(), 'typekro', 'typekro-composition.json');
  // typecast: composition bundle JSON is generated by applik8s; this test validates only nested operator manifest references.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly spec?: { readonly operators?: readonly { readonly manifest?: string }[] } };
  const paths = manifest.spec?.operators?.map((operator) => operator.manifest).filter((path): path is string => typeof path === 'string') ?? [];
  if (paths.length === 0) {
    throw new Error(`TypeKro composition manifest did not reference nested operator manifests: ${manifestPath}`);
  }
  return paths;
}

async function readOperatorManifest(path: string): Promise<OperatorManifest> {
  // typecast: nested operator manifest JSON is generated by the compiler and consumed immediately by the runtime image builder.
  return JSON.parse(await readFile(path, 'utf8')) as OperatorManifest;
}

async function waitForCnpgClusterReady(): Promise<void> {
  try {
    await waitForCnpgClusterExists();
    await kubectl(['wait', `clusters.postgresql.cnpg.io/${databaseClusterName}`, '--namespace', namespace, '--for=condition=Ready', '--timeout=300s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `clusters.postgresql.cnpg.io/${databaseClusterName}`, '--namespace', namespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'pods', '--namespace', namespace, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace]),
      kubectl(['logs', '--namespace', 'cnpg-system', '--selector', 'app.kubernetes.io/name=cloudnative-pg', '--all-containers=true', '--tail=500']),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'CNPG cluster did not become Ready.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForCnpgClusterExists(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', `clusters.postgresql.cnpg.io/${databaseClusterName}`, '--namespace', namespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for CNPG Cluster ${databaseClusterName} to be created in namespace ${namespace}.`);
}

async function waitForCnpgAppSecret(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const key = (await kubectl(['get', `secret/${databaseClusterName}-app`, '--namespace', namespace, '--output=jsonpath={.data.uri}'])).stdout.trim();
      if (key) {
        return;
      }
    } catch {
      // keep waiting
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', 'secrets', '--namespace', namespace, '--output=yaml']),
    kubectl(['get', `clusters.postgresql.cnpg.io/${databaseClusterName}`, '--namespace', namespace, '--output=yaml']),
  ]);
  throw new Error(`Timed out waiting for CNPG app Secret ${databaseClusterName}-app with key uri.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function waitForMigrationJobComplete(): Promise<void> {
  try {
    for (const migrationJobName of migrationJobNames) {
      await waitForJobExists(migrationJobName);
      await kubectl(['wait', `job/${migrationJobName}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=240s']);
    }
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', 'jobs', '--namespace', namespace, '--output=wide']),
      ...migrationJobNames.map((migrationJobName) => kubectl(['describe', `job/${migrationJobName}`, '--namespace', namespace])),
      ...migrationJobNames.map((migrationJobName) => kubectl(['logs', '--namespace', namespace, `job/${migrationJobName}`, '--all-containers=true', '--tail=300'])),
      ...migrationJobNames.map((migrationJobName) => kubectl(['get', 'pods', '--namespace', namespace, '--selector', `job-name=${migrationJobName}`, '--output=wide'])),
      ...migrationJobNames.map((migrationJobName) => kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `job-name=${migrationJobName}`])),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Migration jobs did not complete.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForGeneratedMigrationStatusComplete(): Promise<void> {
  const appInstance = await discoverAppInstanceRef();
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < 180_000) {
    try {
      const output = (await kubectl(['get', `${appPlural}.${apiGroup}/${appInstance.name}`, '--namespace', appInstance.namespace, '--output=json'])).stdout;
      const resource = JSON.parse(output);
      const jobs = resource?.status?.applik8s?.jobs;
      lastStatus = JSON.stringify(jobs ?? resource?.status ?? {});
      if (migrationJobNames.every((migrationJobName) => jobs?.[migrationJobName]?.phase === 'Complete')) {
        return;
      }
      const fallbackPhase = await readGeneratedStatusConfigMapPhase();
      if (fallbackPhase.status) {
        lastStatus = `app=${lastStatus}; durableStore=${fallbackPhase.status}`;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `${appPlural}.${apiGroup}/${appInstance.name}`, '--namespace', appInstance.namespace, '--output=yaml']),
    kubectl(['get', `configmap/${statusConfigMapName}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['describe', `deployment/${statusReconcilerName}`, '--namespace', namespace]),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${statusReconcilerName}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Timed out waiting for generated migration durable status to become Complete. Last status: ${lastStatus}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function readGeneratedStatusConfigMapPhase(): Promise<{ complete?: boolean; status?: string }> {
  try {
    const output = (await kubectl(['get', `configmap/${statusConfigMapName}`, '--namespace', namespace, '--output=json'])).stdout;
    const configMap = JSON.parse(output);
    const status = String(configMap?.data?.['applik8s-jobs.json'] ?? '');
    if (!status) {
      return {};
    }
    const jobs = JSON.parse(status);
    return { complete: migrationJobNames.every((migrationJobName) => jobs?.[migrationJobName]?.phase === 'Complete'), status };
  } catch {
    return {};
  }
}

async function waitForGeneratedMigrationStatusHistory(): Promise<void> {
  const started = Date.now();
  let lastHistory = '';
  while (Date.now() - started < 120_000) {
    try {
      const output = (await kubectl(['get', `configmap/${statusConfigMapName}`, '--namespace', namespace, '--output=json'])).stdout;
      const configMap = JSON.parse(output);
      lastHistory = String(configMap?.data?.['history.json'] ?? '');
      if (lastHistory) {
        const history = JSON.parse(lastHistory);
        const complete = migrationJobNames.every((migrationJobName) => {
          const entries = history?.[migrationJobName];
          return Array.isArray(entries) && entries.some((entry) => entry?.phase === 'Complete' && entry?.idempotencyKey);
        });
        if (complete) {
          return;
        }
      }
    } catch (error) {
      lastHistory = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for generated migration status history. Last history: ${lastHistory}`);
}

async function discoverAppInstanceRef(): Promise<AppInstanceRef> {
  await waitForDeploymentExists(statusReconcilerName);
  const output = (await kubectl(['get', `deployment/${statusReconcilerName}`, '--namespace', namespace, '--output=json'])).stdout;
  const deployment = JSON.parse(output);
  const labels = deployment?.metadata?.labels ?? {};
  return {
    name: String(labels['kro.run/instance-name'] ?? stackName),
    namespace: String(labels['kro.run/instance-namespace'] ?? namespace),
  };
}

async function rolloutStatusWithDiagnostics(deployment: string): Promise<void> {
  try {
    await waitForDeploymentExists(deployment);
    await kubectl(['rollout', 'status', `deployment/${deployment}`, '--namespace', namespace, '--timeout=180s']);
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

async function waitForJobExists(job: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', `job/${job}`, '--namespace', namespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for job/${job} to be created in namespace ${namespace}.`);
}

async function waitForDeploymentExists(deployment: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', `deployment/${deployment}`, '--namespace', namespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for deployment/${deployment} to be created in namespace ${namespace}.`);
}

async function postTenantAccount(endpoint: string, tenant: string, email: string, displayName: string): Promise<ModelObjectPayload> {
  const response = await fetch(`${endpoint}/tenants/${tenant}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, displayName, role: 'owner' }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  // typecast: generated server returns the typed JSON payload produced by the Tenant Platform route under test.
  return JSON.parse(text) as ModelObjectPayload;
}

async function waitForTenantAccount(endpoint: string, tenant: string, email: string): Promise<ModelQueryPayload> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    try {
        const response = await fetch(`${endpoint}/tenants/${tenant}/accounts`, { headers: { 'cache-control': 'no-store' } });
      lastOutput = await response.text();
      if (response.ok) {
        // typecast: generated server returns the typed JSON payload produced by the Tenant Platform route under test.
        const payload = JSON.parse(lastOutput) as ModelQueryPayload;
        if (payload.items.some((item) => item.spec.email === email)) {
          return payload;
        }
      }
    } catch (error) {
      lastOutput = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${adminServerName}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', `clusters.postgresql.cnpg.io/${databaseClusterName}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected tenant account ${email}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function startPortForward(args: readonly string[]): Promise<PortForward> {
  const child = spawn('kubectl', ['port-forward', ...args], { cwd: process.cwd(), env: process.env });
  let output = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out starting kubectl port-forward.\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) -> (?:80|8080)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl port-forward exited with code ${code}.\n${output}`));
    });
  });
  return { endpoint, close: () => closePortForward(child) };
}

async function closePortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
  });
}

function requiredOutDir(): string {
  if (!outDir) {
    throw new Error('Output directory was not initialized.');
  }
  return outDir;
}

function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function pluralizeKubernetesKind(kind: string): string {
  const segment = kubernetesNameSegment(kind).replaceAll('-', '');
  if (segment.endsWith('y')) {
    return `${segment.slice(0, -1)}ies`;
  }
  if (segment.endsWith('s')) {
    return `${segment}es`;
  }
  return `${segment}s`;
}

function tenantPlatformEntrypointSource(): string {
  return `
import { createTenantPlatformExample } from ${JSON.stringify(join(process.cwd(), 'examples/tenant-platform.ts'))};

export const tenantPlatform = createTenantPlatformExample({
  apiGroup: ${JSON.stringify(apiGroup)},
  namespace: ${JSON.stringify(namespace)},
  stackName: ${JSON.stringify(stackName)},
  stackKind: ${JSON.stringify(stackKind)},
  databaseName: 'tenant_platform',
  databaseClusterName: ${JSON.stringify(databaseClusterName)},
  adminServerName: ${JSON.stringify(adminServerName)},
}).composition;
`.trimStart();
}
