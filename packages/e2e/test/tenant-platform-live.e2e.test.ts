import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalApplicationCommandKey, eventLogSubject } from '@applik8s/applik8s/processor-runtime';
import { buildImplicitRuntimeImage } from '@applik8s/compiler';
import type { OperatorManifest } from '@applik8s/core';
import { connect, StringCodec } from 'nats';
import postgres from 'postgres';
import { typeKroRuntimeBootstrap } from 'typekro';
import { natsBootstrap } from 'typekro/nats';
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
const v04 = process.env.APPLIK8S_E2E_V04 === '1';
const eventLogServiceName = 'applik8s-events';
const processorName = 'account-commands';

let tempDir: string | undefined;
let outDir: string | undefined;
let deleteKroApplicationInstance: ((instance: AppInstanceRef) => Promise<void>) | undefined;
let deleteJetStreamInfrastructure: (() => Promise<void>) | undefined;

describeLive('live Tenant Platform pressure test', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await docker(['build', '--file', 'Dockerfile.operator-host', '--tag', 'ghcr.io/applik8s/applik8s-operator-host:dev', '.'], process.cwd());
    await ensureKroRuntime();
    await ensureCnpgOperator();
    await ensureNamespace(namespace);
    if (v04) await ensureJetStreamInfrastructureInstalled();

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-tenant-platform-live-'));
    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'tenant-platform-live.ts');
    await writeFile(entrypoint, tenantPlatformEntrypointSource());
    // static-import-exception: the generated entrypoint exists only after this test writes it; typecast: identify its known composition export.
    const entrypointExports = await import(entrypoint) as { readonly tenantPlatform?: KroDeletableComposition };
    if (!entrypointExports.tenantPlatform) throw new Error(`Tenant Platform entrypoint did not export tenantPlatform: ${entrypoint}`);
    deleteKroApplicationInstance = async (instance) => {
      const factory = entrypointExports.tenantPlatform?.factory('kro', { namespace: instance.namespace, waitForReady: true, timeout: 600_000 });
      if (!factory) throw new Error('Tenant Platform TypeKro composition was unavailable during teardown.');
      try {
        await factory.deleteInstance(instance.name);
      } finally {
        await factory.dispose();
      }
    };
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
      await deleteApplicationInstancesWithTypeKro();
      await kubectl(['delete', 'resourcegraphdefinition', stackName, '--ignore-not-found=true', '--timeout=180s']);
      await deleteApplicationCrds();
      if (v04) await deleteJetStreamInfrastructureWithTypeKro();
      await deleteDisposableNamespace();
    }
    if (tempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 720_000);

  it('installs the control-plane substrate and serves Account data through the generated admin API', async () => {
    await runGeneratedTypeKroApplyScript();
    if (v04) await waitForJetStreamResourcesReady();
    await waitForCnpgClusterReady();
    await waitForCnpgAppSecret();
    await waitForMigrationJobComplete();
    await rolloutStatusWithDiagnostics(statusReconcilerName);
    await waitForGeneratedMigrationStatusComplete();
    await waitForGeneratedMigrationStatusHistory();
    await rolloutStatusWithDiagnostics(adminServerName);

    const portForward = await startPortForward(['--namespace', namespace, `service/${adminServerName}`, '0:80']);
    try {
      const email = `ada-${process.pid}@example.com`;
      const created = await postTenantAccount(portForward.endpoint, 'tenant-a', email, 'Ada Lovelace');
      expect(created).toMatchObject({ spec: { tenant: 'tenant-a', email, displayName: 'Ada Lovelace', role: 'owner' } });

      const queried = await waitForTenantAccount(portForward.endpoint, 'tenant-a', email);
      expect(queried.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, spec: expect.objectContaining({ tenant: 'tenant-a', email }) })]));
    } finally {
      await portForward.close();
    }
  }, 420_000);

  it.runIf(v04)('runs the unified durable command, Postgres, JetStream, and Kubernetes-WASM story', async () => {
    await rolloutStatusWithDiagnostics(processorName);
    await rolloutStatusWithDiagnostics('tenant-controller');
    const adminForward = await startPortForward(['--namespace', namespace, `service/${adminServerName}`, '0:80']);
    const natsForward = await startPortForward(['--namespace', namespace, `service/${eventLogServiceName}`, '0:4222']);
    const postgresForward = await startPortForward(['--namespace', namespace, `service/${databaseClusterName}-rw`, '0:5432']);
    const nats = await connect({ servers: `nats://127.0.0.1:${natsForward.port}` });
    const sql = postgres(await forwardedDatabaseUrl(postgresForward.port), { max: 2 });
    try {
      const account = await postTenantAccount(adminForward.endpoint, 'tenant-a', `v04-${process.pid}@example.com`, 'Before');
      const targetKey = canonicalApplicationCommandKey(account.id);
      const subscription = nats.subscribe('applik8s.events.tenant-account-changed.v1.>');
      const publish = async (id: string, requestId: string, displayName: string) => {
        const envelope = {
          id,
          contract: { name: 'tenant-account.rename', version: 'v1' },
          payload: { tenant: 'tenant-a', accountId: account.id, displayName, requestId },
          recordedAt: new Date().toISOString(),
          partitionKey: targetKey,
          routing: { binding: 'Account-tenant-account.rename.v1', targetKey, idempotencyKey: requestId },
        };
        await nats.jetstream().publish(eventLogSubject('applik8s', envelope, 'commands'), StringCodec().encode(JSON.stringify(envelope)), { msgID: id });
      };

      await publish('tenant-v04-command-1', 'tenant-v04-request-1', 'First');
      const fact = await nextNatsJson(subscription, 120_000);
      expect(fact).toMatchObject({ contract: { name: 'tenant-account.changed', version: 'v1' }, payload: { accountId: account.id, displayName: 'First' } });
      await publish('tenant-v04-command-duplicate', 'tenant-v04-request-1', 'First');
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 1);

      await Promise.all([
        publish('tenant-v04-command-2', 'tenant-v04-request-2', 'Second'),
        publish('tenant-v04-command-3', 'tenant-v04-request-3', 'Third'),
      ]);
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 3);
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_model_history history JOIN applik8s_command_inbox inbox ON inbox.scope = history.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 3);
      const modelRows = await sql.unsafe('SELECT spec FROM applik8s_account WHERE id = $1', [account.id]);
      expect(modelRows[0]).toMatchObject({ spec: expect.objectContaining({ displayName: expect.stringMatching(/Second|Third/) }) });
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_event_outbox outbox JOIN applik8s_command_inbox inbox ON inbox.scope = outbox.scope WHERE inbox.binding_id = $1 AND outbox.published_at IS NOT NULL', ['Account-tenant-account.rename.v1'], 3);

      const gracefulPod = await processorPodState();
      await Promise.all(Array.from({ length: 8 }, (_, index) => publish(
        `tenant-v04-graceful-${index}`,
        `tenant-v04-graceful-request-${index}`,
        `Graceful ${index}`,
      )));
      const gracefulDrainLog = waitForProcessorLog(gracefulPod.name, 'applik8s-command-processor-draining', 60_000);
      await restartProcessorPod(gracefulPod.name, false);
      await waitForProcessorRestart(gracefulPod);
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 11);
      await expect(gracefulDrainLog).resolves.toContain('applik8s-command-processor-draining');

      const crashPod = await processorPodState();
      await Promise.all(Array.from({ length: 16 }, (_, index) => publish(
        `tenant-v04-crash-${index}`,
        `tenant-v04-crash-request-${index}`,
        `Crash ${index}`,
      )));
      await restartProcessorPod(crashPod.name, true);
      await waitForProcessorRestart(crashPod);
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 27);
      await waitForSqlCount(sql, 'SELECT count(*)::int AS count FROM applik8s_model_history history JOIN applik8s_command_inbox inbox ON inbox.scope = history.scope WHERE inbox.binding_id = $1', ['Account-tenant-account.rename.v1'], 27);

      await createTenantAndWaitForKubernetesSdkStatus();
      const logs = (await kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${processorName}`, '--tail=300'])).stdout;
      expect(logs).toContain('applik8s-command-processor-observation');
      expect(logs).toContain('databaseLag');
      expect(logs).toContain('consumerLag');
      subscription.unsubscribe();
    } finally {
      await sql.end({ timeout: 1 });
      await nats.drain();
      await Promise.all([adminForward.close(), natsForward.close(), postgresForward.close()]);
    }
  }, 600_000);
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
  readonly port: number;
  close(): Promise<void>;
}

interface AppInstanceRef {
  readonly name: string;
  readonly namespace: string;
}

interface KroDeletableComposition {
  factory(mode: 'kro', options: { readonly namespace: string; readonly waitForReady: boolean; readonly timeout: number }): {
    deleteInstance(name: string): Promise<void>;
    dispose(): Promise<void>;
  };
}

interface ProcessorPodState {
  readonly name: string;
  readonly restartCount: number;
}

async function processorPodState(): Promise<ProcessorPodState> {
  const output = (await kubectl(['get', 'pods', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${processorName}`, '--output=json'])).stdout;
  const pods = JSON.parse(output)?.items ?? [];
  const pod = pods.find((candidate: { readonly status?: { readonly phase?: unknown } }) => candidate.status?.phase === 'Running') ?? pods[0];
  const name = pod?.metadata?.name;
  if (typeof name !== 'string') throw new Error(`No processor pod found in ${namespace}.`);
  return { name, restartCount: Number(pod?.status?.containerStatuses?.[0]?.restartCount ?? 0) };
}

async function restartProcessorPod(pod: string, force: boolean): Promise<void> {
  await kubectl([
    'delete',
    `pod/${pod}`,
    '--namespace',
    namespace,
    '--wait=false',
    ...(force ? ['--force', '--grace-period=0'] : ['--grace-period=60']),
  ]);
}

async function waitForProcessorLog(pod: string, pattern: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  let lastLogs = '';
  while (Date.now() - started < timeoutMs) {
    try {
      lastLogs = (await kubectl(['logs', `pod/${pod}`, '--namespace', namespace, '--tail=300'])).stdout;
      if (lastLogs.includes(pattern)) return lastLogs;
    } catch {
      // The terminating pod may briefly disappear between API-server observations.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${pattern} in terminating processor pod ${pod}. Last logs: ${lastLogs}`);
}

async function waitForProcessorRestart(previous: ProcessorPodState): Promise<void> {
  const started = Date.now();
  let lastState = '';
  while (Date.now() - started < 180_000) {
    try {
      const current = await processorPodState();
      const output = (await kubectl(['get', `pod/${current.name}`, '--namespace', namespace, '--output=json'])).stdout;
      const pod = JSON.parse(output);
      const ready = pod?.status?.containerStatuses?.[0]?.ready === true;
      lastState = JSON.stringify({ name: current.name, restartCount: current.restartCount, ready });
      if (current.name !== previous.name || current.restartCount > previous.restartCount) {
        if (ready) return;
      }
    } catch (cause) {
      lastState = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for processor restart after ${previous.name}/${previous.restartCount}. Last state: ${lastState}`);
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
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+) -> \d+/);
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
  return { endpoint, port: Number(new URL(endpoint).port), close: () => closePortForward(child) };
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

function requiredTempDir(): string {
  if (!tempDir) {
    throw new Error('Temporary directory was not initialized.');
  }
  return tempDir;
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
import { ${v04 ? 'createTenantPlatformV04Example' : 'createTenantPlatformExample'} } from ${JSON.stringify(join(process.cwd(), 'examples/tenant-platform.ts'))};

export const tenantPlatform = ${v04 ? 'createTenantPlatformV04Example' : 'createTenantPlatformExample'}({
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

async function ensureJetStreamInfrastructureInstalled(): Promise<void> {
  const factory = natsBootstrap.factory('direct', { namespace, waitForReady: true, timeout: 900_000 });
  try {
    await kubectl(['get', `service/${eventLogServiceName}`, '--namespace', namespace]);
    await kubectl(['get', 'crd/streams.jetstream.nats.io']);
  } catch {
    await factory.deploy({
      name: eventLogServiceName,
      namespace,
      namespaceOwnership: 'owned',
      replicas: 1,
      storageSize: '1Gi',
      pvcRetentionPolicy: 'delete',
    });
  }
  deleteJetStreamInfrastructure = async () => {
    try {
      try {
        await factory.deleteInstance(eventLogServiceName);
      } catch (cause) {
        await assertJetStreamInfrastructureAbsent(cause);
      }
    } finally {
      await factory.dispose();
    }
  };
}

async function waitForJetStreamResourcesReady(): Promise<void> {
  await kubectl(['get', `service/${eventLogServiceName}`, '--namespace', namespace]);
  await waitForNamespacedResourceReady('stream.jetstream.nats.io', eventLogServiceName, 180_000);
  await waitForNamespacedResourceReady('consumer.jetstream.nats.io', processorName, 180_000);
}

async function waitForNamespacedResourceReady(resource: string, name: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastObservation = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const output = (await kubectl(['get', `${resource}/${name}`, '--namespace', namespace, '--output=json'])).stdout;
      const value = JSON.parse(output);
      lastObservation = JSON.stringify(value.status ?? {});
      if (value.status?.conditions?.some((condition: { readonly type?: unknown; readonly status?: unknown }) => condition.type === 'Ready' && condition.status === 'True')) return;
    } catch (cause) {
      lastObservation = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${resource}/${name} to become Ready in ${namespace}: ${lastObservation}`);
}

async function deleteApplicationInstancesWithTypeKro(): Promise<void> {
  try {
    await kubectl(['get', `crd/${appPlural}.${apiGroup}`]);
  } catch {
    return;
  }
  const instances = JSON.parse((await kubectl(['get', `${appPlural}.${apiGroup}`, '--all-namespaces', '--output=json'])).stdout)?.items
    ?.map((item: { readonly metadata?: { readonly name?: unknown; readonly namespace?: unknown } }) => ({
      name: item.metadata?.name,
      namespace: item.metadata?.namespace,
    }))
    .filter((item: { readonly name?: unknown; readonly namespace?: unknown }): item is AppInstanceRef => typeof item.name === 'string' && typeof item.namespace === 'string') ?? [];
  if (!deleteKroApplicationInstance && instances.length > 0) throw new Error('TypeKro application deletion was not initialized.');
  for (const instance of instances) {
    await deleteKroApplicationInstance?.(instance);
  }
}

async function deleteJetStreamInfrastructureWithTypeKro(): Promise<void> {
  if (!deleteJetStreamInfrastructure) throw new Error('TypeKro JetStream infrastructure deletion was not initialized.');
  await deleteJetStreamInfrastructure();
}

async function deleteDisposableNamespace(): Promise<void> {
  if (!namespace.startsWith('applik8s-tenant-platform-')) {
    throw new Error(`Refusing bounded namespace cleanup for non-disposable namespace ${namespace}.`);
  }
  await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
  const started = Date.now();
  while (Date.now() - started < 360_000) {
    try {
      await kubectl(['get', 'namespace', namespace]);
    } catch {
      return;
    }
    await sleep(1_000);
  }

  // OrbStack's K3s namespace controller can retain its built-in finalizer after
  // every namespaced object has disappeared. Prove the disposable namespace is
  // empty across every discoverable resource type before using the finalize
  // subresource; TypeKro instance/infrastructure deletion always runs first.
  const resourceTypes = (await kubectl(['api-resources', '--verbs=list', '--namespaced', '--output=name'])).stdout
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const remaining = resourceTypes.length > 0
    ? (await kubectl(['get', resourceTypes.join(','), '--namespace', namespace, '--ignore-not-found=true', '--output=name'])).stdout.trim()
    : '';
  if (remaining) {
    throw new Error(`Refusing to finalize namespace/${namespace}; resources remain:\n${remaining}`);
  }

  const namespaceState = JSON.parse((await kubectl(['get', 'namespace', namespace, '--output=json'])).stdout);
  namespaceState.spec = { ...(namespaceState.spec ?? {}), finalizers: [] };
  const finalizePath = join(requiredTempDir(), 'namespace-finalize.json');
  await writeFile(finalizePath, JSON.stringify(namespaceState));
  await kubectl(['replace', '--raw', `/api/v1/namespaces/${namespace}/finalize`, '--filename', finalizePath]);
  await kubectl(['wait', '--for=delete', `namespace/${namespace}`, '--timeout=60s']);
}

async function assertJetStreamInfrastructureAbsent(originalError: unknown): Promise<void> {
  const diagnostic = originalError instanceof Error ? originalError.message : String(originalError);
  if (!/(?:\b404\b|not found)/i.test(diagnostic)) {
    throw originalError;
  }
  const resources = [
    `service/${eventLogServiceName}`,
    `statefulset/${eventLogServiceName}`,
    'deployment/nack',
    `helmrelease/${eventLogServiceName}`,
    'helmrelease/nack',
  ];
  const remaining: string[] = [];
  for (const resource of resources) {
    try {
      await kubectl(['get', resource, '--namespace', namespace]);
      remaining.push(resource);
    } catch {
      // The desired postcondition is absence.
    }
  }
  if (remaining.length > 0) {
    throw new Error(`TypeKro JetStream cleanup failed and left resources behind (${remaining.join(', ')}): ${diagnostic}`);
  }
}

async function deleteApplicationCrds(): Promise<void> {
  const crds = JSON.parse((await kubectl(['get', 'customresourcedefinitions', '--output=json'])).stdout)?.items
    ?.filter((item: { readonly spec?: { readonly group?: unknown } }) => item.spec?.group === apiGroup)
    .map((item: { readonly metadata?: { readonly name?: unknown }; readonly spec?: { readonly group?: unknown; readonly scope?: unknown; readonly names?: { readonly plural?: unknown } } }) => ({
      name: item.metadata?.name,
      group: item.spec?.group,
      scope: item.spec?.scope,
      plural: item.spec?.names?.plural,
    }))
    .filter((crd: { readonly name?: unknown; readonly group?: unknown; readonly scope?: unknown; readonly plural?: unknown }): crd is { readonly name: string; readonly group: string; readonly scope: string; readonly plural: string } =>
      typeof crd.name === 'string' && typeof crd.group === 'string' && typeof crd.scope === 'string' && typeof crd.plural === 'string') ?? [];
  for (const crd of crds) {
    const resource = `${crd.plural}.${crd.group}`;
    const scopeArgs = crd.scope === 'Namespaced' ? ['--all-namespaces'] : [];
    await kubectl(['delete', resource, '--all', ...scopeArgs, '--ignore-not-found=true', '--timeout=180s']);
    await kubectl(['delete', `customresourcedefinition/${crd.name}`, '--ignore-not-found=true', '--wait=false']);
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      try {
        await kubectl(['get', `customresourcedefinition/${crd.name}`]);
      } catch {
        break;
      }
      await sleep(1_000);
    }
    try {
      await kubectl(['get', `customresourcedefinition/${crd.name}`]);
    } catch {
      continue;
    }
    const remaining = JSON.parse((await kubectl(['get', resource, ...scopeArgs, '--output=json'])).stdout)?.items ?? [];
    if (remaining.length > 0) throw new Error(`Refusing to finalize CRD ${crd.name}; ${remaining.length} custom resources remain.`);
    // OrbStack's K3s CRD cleanup controller can retain its finalizer after an
    // authoritative empty list. Limit this escape hatch to disposable E2E API
    // groups and only after proving there are no instances.
    await kubectl(['patch', `customresourcedefinition/${crd.name}`, '--type=json', '-p=[{"op":"remove","path":"/metadata/finalizers"}]']);
    await kubectl(['wait', '--for=delete', `customresourcedefinition/${crd.name}`, '--timeout=60s']);
  }
}

async function forwardedDatabaseUrl(port: number): Promise<string> {
  const secret = JSON.parse((await kubectl(['get', `secret/${databaseClusterName}-app`, '--namespace', namespace, '--output=json'])).stdout);
  const encoded = secret?.data?.uri;
  if (typeof encoded !== 'string') throw new Error(`Secret ${databaseClusterName}-app does not contain data.uri.`);
  const url = new URL(Buffer.from(encoded, 'base64').toString('utf8'));
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return url.toString();
}

async function nextNatsJson(subscription: AsyncIterable<{ readonly data: Uint8Array }>, timeoutMs: number): Promise<unknown> {
  const iterator = subscription[Symbol.asyncIterator]();
  const next = iterator.next();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for committed Tenant account fact after ${timeoutMs}ms.`)), timeoutMs));
  const message = await Promise.race([next, timeout]);
  if (message.done) throw new Error('NATS subscription closed before the committed fact arrived.');
  return JSON.parse(StringCodec().decode(message.value.data));
}

async function waitForSqlCount(sql: postgres.Sql, query: string, parameters: readonly unknown[], expected: number): Promise<void> {
  const started = Date.now();
  let actual = -1;
  while (Date.now() - started < 120_000) {
    // typecast: each caller binds only primitive SQL parameters to a fixed test-owned query.
    const rows = await sql.unsafe(query, [...parameters] as never[]);
    actual = Number(Reflect.get(rows[0] ?? {}, 'count') ?? 0);
    if (actual === expected) return;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for SQL count ${expected}; observed ${actual}.`);
}

async function createTenantAndWaitForKubernetesSdkStatus(): Promise<void> {
  const manifestPath = join(requiredOutDir(), 'tenant-v04-instance.yaml');
  await writeFile(manifestPath, `apiVersion: ${apiGroup}/v1alpha1\nkind: Tenant\nmetadata:\n  name: tenant-v04-sdk\n  namespace: ${namespace}\nspec:\n  plan: team\n  namespace: tenant-a\n  ownerEmail: owner@example.com\n`);
  await kubectl(['apply', '--server-side', '--field-manager=applik8s-v04-e2e', '--filename', manifestPath]);
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < 180_000) {
    const output = (await kubectl(['get', `tenants.${apiGroup}/tenant-v04-sdk`, '--namespace', namespace, '--output=json'])).stdout;
    const tenant = JSON.parse(output);
    lastStatus = JSON.stringify(tenant.status ?? {});
    if (tenant.status?.phase === 'Ready' && String(tenant.status?.message ?? '').includes('Kubernetes SDK observed')) return;
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for Tenant Kubernetes SDK status: ${lastStatus}`);
}
