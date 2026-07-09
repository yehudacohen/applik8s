import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { typeKroRuntimeBootstrap } from 'typekro';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { assertExpectedKubectlContext, describeLive, exec, formatSettledOutput, kubectl, sleep } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-modelstore-${process.pid}`;
const runtimeNamespace = process.env.APPLIK8S_E2E_TYPEKRO_RUNTIME_NAMESPACE ?? 'applik8s-typekro-runtime';
const stackName = `accounts-modelstore-${process.pid}`;
const stackKind = `AccountsModelStore${process.pid}`;
const serverName = 'accounts-web';
const serviceName = `${serverName}-svc`;
const databaseName = 'accounts-db';
const migrationJobName = 'accounts-model-migration';
const appPlural = pluralizeKubernetesKind(stackKind);
const statusReconcilerName = `${kubernetesNameSegment(stackKind)}-status-reconciler`;
const statusConfigMapName = `${statusReconcilerName}-status`;
const cnpgInstallUrl = process.env.APPLIK8S_E2E_CNPG_INSTALL_URL ?? 'https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.26/releases/cnpg-1.26.0.yaml';
const driftNamespace = process.env.APPLIK8S_E2E_DRIFT_NAMESPACE ?? `applik8s-modelstore-drift-${process.pid}`;
const driftStackName = `accounts-modelstore-drift-${process.pid}`;
const driftStackKind = `AccountsModelStoreDrift${process.pid}`;
const driftDatabaseName = 'accounts-drift-db';
const driftMigrationJobName = 'accounts-drift-model-migration';
const accountModelTableName = 'applik8s_account';

let tempDir: string | undefined;
let outDir: string | undefined;

describeLive('live TypeKro Postgres ModelStore runtime', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await ensureKroRuntime();
    await ensureCnpgOperator();
    await ensureNamespace(namespace);

    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-modelstore-'));
    outDir = join(tempDir, 'dist');
    const entrypoint = join(tempDir, 'modelstore-live.ts');
    await writeFile(entrypoint, liveEntrypointSource());
    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'accountsStack', '--out-dir', outDir], process.cwd());
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

  it('creates and queries schema-first model data through a generated server and CNPG Postgres', async () => {
    await runGeneratedTypeKroApplyScript();
    await waitForCnpgClusterReady();
    await waitForCnpgAppSecret();
    await waitForMigrationJobComplete();
    await rolloutStatusWithDiagnostics(statusReconcilerName);
    await waitForGeneratedMigrationStatusComplete();
    await rolloutStatusWithDiagnostics(serverName);

    const portForward = await startPortForward(['--namespace', namespace, `service/${serviceName}`, '0:80']);
    try {
      const created = await postAccount(portForward.endpoint, 'ada@example.com', 'Ada');
      expect(created).toMatchObject({ spec: { email: 'ada@example.com', displayName: 'Ada' } });

      const queried = await waitForAccount(portForward.endpoint, 'ada@example.com');
      expect(queried.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, spec: expect.objectContaining({ email: 'ada@example.com' }) })]));
    } finally {
      await portForward.close();
    }
  }, 420_000);

  it('gets, patches, deletes, queries declared indexes, and rejects duplicate unique model data', async () => {
    const portForward = await startPortForward(['--namespace', namespace, `service/${serviceName}`, '0:80']);
    try {
      const created = await postAccount(portForward.endpoint, 'grace@example.com', 'Grace');
      await expect(getAccount(portForward.endpoint, created.id)).resolves.toMatchObject({ id: created.id, spec: { email: 'grace@example.com' } });
      await expect(patchAccountPhase(portForward.endpoint, created.id, 'Active')).resolves.toMatchObject({ id: created.id, status: { phase: 'Active' } });
      await expect(queryAccountIndex(portForward.endpoint, 'grace@example.com')).resolves.toMatchObject({ items: [expect.objectContaining({ id: created.id })] });

      const duplicate = await fetch(`${portForward.endpoint}/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'grace@example.com', displayName: 'Duplicate Grace' }),
      });
      expect(await duplicate.text()).toContain('account-email-unique');
      expect(duplicate.status).toBe(409);

      await deleteAccount(portForward.endpoint, created.id);
      await expect(getAccount(portForward.endpoint, created.id)).resolves.toBeUndefined();
    } finally {
      await portForward.close();
    }
  }, 420_000);
});

describeLive('live TypeKro Postgres ModelStore migration drift preflight', () => {
  let driftTempDir: string | undefined;
  let driftOutDir: string | undefined;

  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await ensureCnpgOperator();
    await ensureNamespace(driftNamespace);

    driftTempDir = await mkdtemp(join(tmpdir(), 'applik8s-modelstore-drift-'));
    driftOutDir = join(driftTempDir, 'dist');
    const entrypoint = join(driftTempDir, 'modelstore-drift-live.ts');
    await writeFile(entrypoint, liveEntrypointSource({ namespace: driftNamespace, stackName: driftStackName, stackKind: driftStackKind, databaseName: driftDatabaseName, migrationJobName: driftMigrationJobName }));
    await exec('bun', ['run', 'applik8s', 'build', entrypoint, '--typekro', '--composition-name', 'accountsStack', '--out-dir', driftOutDir], process.cwd());
    await applyCnpgCluster(driftNamespace, driftDatabaseName);
    await waitForCnpgClusterReady(driftNamespace, driftDatabaseName);
    await waitForCnpgAppSecret(driftNamespace, driftDatabaseName);
  }, 720_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E_LIVE === '1') {
      await kubectl(['delete', 'namespace', driftNamespace, '--ignore-not-found=true', '--wait=false']);
    }
    if (driftTempDir && process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(driftTempDir, { recursive: true, force: true });
    }
  });

  it('fails closed before schema effects for existing schema drift in real Postgres', async () => {
    const preflightSql = await generatedPreflightSql(requiredDriftOutDir(driftOutDir));
    const migrationSql = await generatedMigrationSql(requiredDriftOutDir(driftOutDir));

    const cases: readonly MigrationDriftCase[] = [
      {
        name: 'missing-history-table',
        expectedReason: 'missingHistoryTable',
        seedSql: `
DROP TABLE IF EXISTS "applik8s_model_migrations" CASCADE;
DROP TABLE IF EXISTS "${accountModelTableName}" CASCADE;
CREATE TABLE "${accountModelTableName}" (
  id text PRIMARY KEY,
  spec jsonb NOT NULL,
  status jsonb,
  revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
      },
      {
        name: 'incompatible-index',
        expectedReason: 'incompatibleIndex',
        seedSql: `${resetDriftSchemaSql()}
CREATE TABLE "applik8s_drift_index_holder" (email text);
CREATE INDEX "accounts-by-email" ON "applik8s_drift_index_holder" (email);
`,
      },
      {
        name: 'incompatible-column',
        expectedReason: 'incompatibleColumn',
        seedSql: `
DROP TABLE IF EXISTS "applik8s_model_migrations" CASCADE;
DROP TABLE IF EXISTS "${accountModelTableName}" CASCADE;
CREATE TABLE "applik8s_model_migrations" (
  id text PRIMARY KEY,
  model text NOT NULL,
  revision text NOT NULL,
  plan jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "${accountModelTableName}" (
  id text PRIMARY KEY,
  spec jsonb NOT NULL,
  revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
      },
      {
        name: 'unknown-existing-object',
        expectedReason: 'unknownExistingObject',
        seedSql: `${resetDriftSchemaSql()}
ALTER TABLE "${accountModelTableName}" ADD COLUMN unmanaged text;
`,
      },
      {
        name: 'destructive-change',
        expectedReason: 'destructiveChange',
        seedSql: `${resetDriftSchemaSql()}
INSERT INTO "applik8s_model_migrations" (id, model, revision, plan) VALUES ('drift', 'Account', 'sha256:previous', '{}'::jsonb);
`,
      },
    ];

    for (const testCase of cases) {
      await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: `seed-${testCase.name}`, sql: testCase.seedSql, expectFailure: false });
      const logs = await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: `preflight-${testCase.name}`, sql: preflightSql, expectFailure: true });
      expect(logs).toContain('applik8s-model-migration-drift-detected');
      expect(logs).toContain(testCase.expectedReason);
    }

    await runSqlJob({
      namespace: driftNamespace,
      databaseName: driftDatabaseName,
      name: 'seed-preflight-before-migration-effects',
      sql: `
DROP TABLE IF EXISTS "applik8s_model_migrations" CASCADE;
DROP TABLE IF EXISTS "${accountModelTableName}" CASCADE;
CREATE TABLE "${accountModelTableName}" (
  id text PRIMARY KEY,
  spec jsonb NOT NULL,
  status jsonb,
  revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
      expectFailure: false,
    });
    const combinedLogs = await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: 'preflight-before-migration-effects', sql: `${preflightSql}\n${migrationSql}`, expectFailure: true });
    expect(combinedLogs).toContain('applik8s-model-migration-drift-detected');
    expect(combinedLogs).toContain('missingHistoryTable');
    const effectLogs = await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: 'assert-no-migration-effects', sql: `SELECT CASE WHEN to_regclass('public.applik8s_model_migrations') IS NULL AND to_regclass('public."accounts-by-email"') IS NULL AND to_regclass('public."account-email-unique"') IS NULL THEN 'migration-effects-absent' ELSE 'migration-effects-present' END AS migration_effects;`, expectFailure: false });
    expect(effectLogs).toContain('migration-effects-absent');

    await runSqlJob({
      namespace: driftNamespace,
      databaseName: driftDatabaseName,
      name: 'seed-destructive-before-migration-effects',
      sql: `${resetDriftSchemaSql()}
INSERT INTO "applik8s_model_migrations" (id, model, revision, plan) VALUES ('drift', 'Account', 'sha256:previous', '{}'::jsonb);
`,
      expectFailure: false,
    });
    const destructiveLogs = await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: 'destructive-before-migration-effects', sql: `${preflightSql}\n${migrationSql}`, expectFailure: true });
    expect(destructiveLogs).toContain('applik8s-model-migration-drift-detected');
    expect(destructiveLogs).toContain('destructiveChange');
    const destructiveEffectLogs = await runSqlJob({ namespace: driftNamespace, databaseName: driftDatabaseName, name: 'assert-destructive-migration-effects', sql: `SELECT CASE WHEN count(*) = 1 AND max(revision) = 'sha256:previous' AND to_regclass('public."accounts-by-email"') IS NULL AND to_regclass('public."account-email-unique"') IS NULL THEN 'destructive-migration-effects-absent' ELSE 'destructive-migration-effects-present' END AS migration_effects FROM "applik8s_model_migrations";`, expectFailure: false });
    expect(destructiveEffectLogs).toContain('destructive-migration-effects-absent');
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

interface MigrationDriftCase {
  readonly name: string;
  readonly expectedReason: string;
  readonly seedSql: string;
}

interface SqlJobOptions {
  readonly namespace: string;
  readonly databaseName: string;
  readonly name: string;
  readonly sql: string;
  readonly expectFailure: boolean;
}

interface EntrypointSourceOptions {
  readonly namespace: string;
  readonly stackName: string;
  readonly stackKind: string;
  readonly databaseName: string;
  readonly migrationJobName: string;
  readonly serverName?: string;
  readonly serviceName?: string;
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
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-modelstore-e2e', '--filename', cnpgInstallUrl]);
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

async function applyCnpgCluster(targetNamespace: string, targetDatabaseName: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'applik8s-cnpg-cluster-'));
  try {
    const manifestPath = join(dir, 'cluster.yaml');
    await writeFile(manifestPath, `
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: ${targetDatabaseName}
  namespace: ${targetNamespace}
spec:
  instances: 1
  bootstrap:
    initdb:
      database: accounts
      owner: app
  storage:
    size: 1Gi
`.trimStart());
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-modelstore-drift-e2e', '--filename', manifestPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function generatedPreflightSql(targetOutDir: string): Promise<string> {
  return generatedMigrationConfigMapData(targetOutDir, 'preflight.sql');
}

async function generatedMigrationSql(targetOutDir: string): Promise<string> {
  return generatedMigrationConfigMapData(targetOutDir, 'migration.sql');
}

async function generatedMigrationConfigMapData(targetOutDir: string, key: 'preflight.sql' | 'migration.sql'): Promise<string> {
  const resourcesPath = join(targetOutDir, 'typekro', 'resources.json');
  const parsed: unknown = JSON.parse(await readFile(resourcesPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected TypeKro resources array at ${resourcesPath}.`);
  }
  for (const resource of parsed) {
    const object = objectRecord(resource);
    const metadata = objectRecord(object?.metadata);
    const data = objectRecord(object?.data);
    if (object?.kind === 'ConfigMap' && metadata?.name === `${driftMigrationJobName}-migration` && typeof data?.[key] === 'string') {
      return data[key];
    }
  }
  throw new Error(`Generated migration ConfigMap ${driftMigrationJobName}-migration with ${key} was not found in ${resourcesPath}.`);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  // typecast: runtime guard above narrows to a non-array object for JSON object field access.
  return value as Record<string, unknown>;
}

function resetDriftSchemaSql(): string {
  return `
DROP TABLE IF EXISTS "applik8s_drift_index_holder" CASCADE;
DROP TABLE IF EXISTS "applik8s_model_migrations" CASCADE;
DROP TABLE IF EXISTS "${accountModelTableName}" CASCADE;
CREATE TABLE "applik8s_model_migrations" (
  id text PRIMARY KEY,
  model text NOT NULL,
  revision text NOT NULL,
  plan jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "${accountModelTableName}" (
  id text PRIMARY KEY,
  spec jsonb NOT NULL,
  status jsonb,
  revision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
}

async function runSqlJob(options: SqlJobOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'applik8s-sql-job-'));
  const configMapName = `${options.name}-sql`;
  try {
    const manifestPath = join(dir, `${options.name}.yaml`);
    await writeFile(manifestPath, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${configMapName}
  namespace: ${options.namespace}
data:
  script.sql: |
${indentYamlBlock(options.sql.trimEnd(), 4)}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: psql
          image: postgres:16
          command:
            - sh
            - -c
            - 'for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null 2>&1 && exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/script.sql; sleep 2; done; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1" >/dev/null && exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/script.sql'
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${options.databaseName}-app
                  key: uri
          volumeMounts:
            - name: sql
              mountPath: /sql
      volumes:
        - name: sql
          configMap:
            name: ${configMapName}
`.trimStart());
    await kubectl(['delete', 'job', options.name, '--namespace', options.namespace, '--ignore-not-found=true', '--wait=false']);
    await kubectl(['delete', 'configmap', configMapName, '--namespace', options.namespace, '--ignore-not-found=true', '--wait=false']);
    await kubectl(['apply', '--server-side', '--field-manager=applik8s-modelstore-drift-e2e', '--filename', manifestPath]);
    await waitForSqlJobCondition(options.namespace, options.name, options.expectFailure ? 'Failed' : 'Complete');
    return await sqlJobLogs(options.namespace, options.name);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `job/${options.name}`, '--namespace', options.namespace]),
      kubectl(['logs', '--namespace', options.namespace, `job/${options.name}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'pods', '--namespace', options.namespace, '--selector', `job-name=${options.name}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', options.namespace, '--selector', `job-name=${options.name}`]),
      kubectl(['get', 'events', '--namespace', options.namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : `SQL job ${options.name} failed unexpectedly.`}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function waitForSqlJobCondition(targetNamespace: string, jobName: string, expectedType: 'Complete' | 'Failed'): Promise<void> {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < 180_000) {
    try {
      const output = (await kubectl(['get', `job/${jobName}`, '--namespace', targetNamespace, '--output=json'])).stdout;
      const status = sqlJobConditionStatus(output, expectedType);
      lastStatus = status.summary;
      if (status.matched) {
        return;
      }
      if (status.terminalMismatch) {
        throw new Error(`SQL job ${jobName} reached ${status.oppositeType}; expected ${expectedType}.`);
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for SQL job ${jobName} condition ${expectedType}. Last status: ${lastStatus}`);
}

function sqlJobConditionStatus(output: string, expectedType: 'Complete' | 'Failed'): { readonly matched: boolean; readonly terminalMismatch: boolean; readonly oppositeType: 'Complete' | 'Failed'; readonly summary: string } {
  const parsed: unknown = JSON.parse(output);
  const job = objectRecord(parsed);
  const status = objectRecord(job?.status);
  const conditions = status?.conditions;
  const oppositeType = expectedType === 'Complete' ? 'Failed' : 'Complete';
  if (!Array.isArray(conditions)) {
    return { matched: false, terminalMismatch: false, oppositeType, summary: JSON.stringify(status ?? {}) };
  }
  const matched = conditions.some((condition) => {
    const object = objectRecord(condition);
    return object?.type === expectedType && object.status === 'True';
  });
  const terminalMismatch = conditions.some((condition) => {
    const object = objectRecord(condition);
    return object?.type === oppositeType && object.status === 'True';
  });
  return { matched, terminalMismatch, oppositeType, summary: JSON.stringify(conditions) };
}

async function sqlJobLogs(targetNamespace: string, jobName: string): Promise<string> {
  return (await kubectl(['logs', '--namespace', targetNamespace, `job/${jobName}`, '--all-containers=true', '--tail=300'])).stdout;
}

function indentYamlBlock(value: string, spaces: number): string {
  const indentation = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${indentation}${line}`).join('\n');
}

async function runGeneratedTypeKroApplyScript(): Promise<void> {
  await exec('sh', [join(requiredOutDir(), 'typekro', 'apply.sh')], process.cwd());
}

async function waitForCnpgClusterReady(targetNamespace = namespace, targetDatabaseName = databaseName): Promise<void> {
  try {
    await waitForCnpgClusterExists(targetNamespace, targetDatabaseName);
    await kubectl(['wait', `clusters.postgresql.cnpg.io/${targetDatabaseName}`, '--namespace', targetNamespace, '--for=condition=Ready', '--timeout=300s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['get', `clusters.postgresql.cnpg.io/${targetDatabaseName}`, '--namespace', targetNamespace, '--ignore-not-found=true', '--output=yaml']),
      kubectl(['get', 'pods', '--namespace', targetNamespace, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', targetNamespace]),
      kubectl(['logs', '--namespace', 'cnpg-system', '--selector', 'app.kubernetes.io/name=cloudnative-pg', '--all-containers=true', '--tail=500']),
      kubectl(['get', 'events', '--namespace', targetNamespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'CNPG cluster did not become Ready.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForCnpgClusterExists(targetNamespace = namespace, targetDatabaseName = databaseName): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      await kubectl(['get', `clusters.postgresql.cnpg.io/${targetDatabaseName}`, '--namespace', targetNamespace]);
      return;
    } catch {
      await sleep(2_000);
    }
  }
  throw new Error(`Timed out waiting for CNPG Cluster ${targetDatabaseName} to be created in namespace ${targetNamespace}.`);
}

async function waitForCnpgAppSecret(targetNamespace = namespace, targetDatabaseName = databaseName): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const key = (await kubectl(['get', `secret/${targetDatabaseName}-app`, '--namespace', targetNamespace, '--output=jsonpath={.data.uri}'])).stdout.trim();
      if (key) {
        return;
      }
    } catch {
      // keep waiting
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', 'secrets', '--namespace', targetNamespace, '--output=yaml']),
    kubectl(['get', `clusters.postgresql.cnpg.io/${targetDatabaseName}`, '--namespace', targetNamespace, '--output=yaml']),
  ]);
  throw new Error(`Timed out waiting for CNPG app Secret ${targetDatabaseName}-app with key uri.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
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

async function waitForMigrationJobComplete(): Promise<void> {
  try {
    await waitForJobExists(migrationJobName);
    await kubectl(['wait', `job/${migrationJobName}`, '--namespace', namespace, '--for=condition=Complete', '--timeout=240s']);
  } catch (cause) {
    const diagnostics = await Promise.allSettled([
      kubectl(['describe', `job/${migrationJobName}`, '--namespace', namespace]),
      kubectl(['logs', '--namespace', namespace, `job/${migrationJobName}`, '--all-containers=true', '--tail=300']),
      kubectl(['get', 'pods', '--namespace', namespace, '--selector', `job-name=${migrationJobName}`, '--output=wide']),
      kubectl(['describe', 'pods', '--namespace', namespace, '--selector', `job-name=${migrationJobName}`]),
      kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
    ]);
    throw new Error(`${cause instanceof Error ? cause.message : 'Migration job did not complete.'}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
  }
}

async function waitForGeneratedMigrationStatusComplete(): Promise<void> {
  const appInstance = await discoverAppInstanceRef();
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < 180_000) {
    try {
      const output = (await kubectl(['get', `${appPlural}.modelstore.applik8s.dev/${appInstance.name}`, '--namespace', appInstance.namespace, '--output=json'])).stdout;
      const resource = JSON.parse(output);
      const phase = resource?.status?.applik8s?.jobs?.[migrationJobName]?.phase;
      lastStatus = JSON.stringify(resource?.status?.applik8s?.jobs?.[migrationJobName] ?? resource?.status ?? {});
      if (phase === 'Complete') {
        return;
      }
      const fallbackPhase = await readGeneratedStatusConfigMapPhase();
      if (fallbackPhase.phase === 'Complete') {
        return;
      }
      if (fallbackPhase.status) {
        lastStatus = fallbackPhase.status;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  const diagnostics = await Promise.allSettled([
    kubectl(['get', `${appPlural}.modelstore.applik8s.dev/${appInstance.name}`, '--namespace', appInstance.namespace, '--output=yaml']),
    kubectl(['get', `configmap/${statusConfigMapName}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['describe', `deployment/${statusReconcilerName}`, '--namespace', namespace]),
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${statusReconcilerName}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Timed out waiting for generated migration durable status to become Complete. Last status: ${lastStatus}\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function readGeneratedStatusConfigMapPhase(): Promise<{ phase?: string; status?: string }> {
  try {
    const output = (await kubectl(['get', `configmap/${statusConfigMapName}`, '--namespace', namespace, '--output=json'])).stdout;
    const configMap = JSON.parse(output);
    const status = String(configMap?.data?.['applik8s-jobs.json'] ?? '');
    if (!status) {
      return {};
    }
    const jobs = JSON.parse(status);
    return { phase: jobs?.[migrationJobName]?.phase, status };
  } catch {
    return {};
  }
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

async function postAccount(endpoint: string, email: string, displayName: string): Promise<ModelObjectPayload> {
  const response = await fetch(`${endpoint}/accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, displayName }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  // typecast: generated server returns the typed JSON payload produced by the route under test.
  return JSON.parse(text) as ModelObjectPayload;
}

async function waitForAccount(endpoint: string, email: string): Promise<ModelQueryPayload> {
  const started = Date.now();
  let lastOutput = '<missing>';
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(`${endpoint}/accounts?email=${encodeURIComponent(email)}`, { headers: { 'cache-control': 'no-store' } });
      lastOutput = await response.text();
      if (response.ok) {
        // typecast: generated server returns the typed JSON payload produced by the route under test.
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
    kubectl(['logs', '--namespace', namespace, '--selector', `app.kubernetes.io/name=${serverName}`, '--all-containers=true', '--tail=300']),
    kubectl(['get', `clusters.postgresql.cnpg.io/${databaseName}`, '--namespace', namespace, '--output=yaml']),
    kubectl(['get', 'events', '--namespace', namespace, '--sort-by=.lastTimestamp']),
  ]);
  throw new Error(`Expected account ${email}, got ${lastOutput}.\n${diagnostics.map(formatSettledOutput).join('\n')}`);
}

async function getAccount(endpoint: string, id: string): Promise<ModelObjectPayload | undefined> {
  const response = await fetch(`${endpoint}/account?id=${encodeURIComponent(id)}`, { headers: { 'cache-control': 'no-store' } });
  const text = await response.text();
  if (response.status === 404) {
    return undefined;
  }
  expect(response.status, text).toBe(200);
  // typecast: generated server returns the typed JSON payload produced by the route under test.
  return JSON.parse(text) as ModelObjectPayload;
}

async function patchAccountPhase(endpoint: string, id: string, phase: string): Promise<ModelObjectPayload> {
  const response = await fetch(`${endpoint}/account/phase`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id, phase }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  // typecast: generated server returns the typed JSON payload produced by the route under test.
  return JSON.parse(text) as ModelObjectPayload;
}

async function queryAccountIndex(endpoint: string, email: string): Promise<ModelQueryPayload> {
  const response = await fetch(`${endpoint}/accounts/by-email?email=${encodeURIComponent(email)}`, { headers: { 'cache-control': 'no-store' } });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  // typecast: generated server returns the typed JSON payload produced by the route under test.
  return JSON.parse(text) as ModelQueryPayload;
}

async function deleteAccount(endpoint: string, id: string): Promise<void> {
  const response = await fetch(`${endpoint}/account/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
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

function requiredDriftOutDir(value: string | undefined): string {
  if (!value) {
    throw new Error('Drift output directory was not initialized.');
  }
  return value;
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

function liveEntrypointSource(options: EntrypointSourceOptions = { namespace, stackName, stackKind, databaseName, migrationJobName, serverName, serviceName }): string {
  const generatedServerName = options.serverName ?? serverName;
  const generatedServiceName = options.serviceName ?? serviceName;
  return `
import { ModelStore, sdk } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';

const AccountEntity = entity('Account', {
  spec: type({ email: 'string', displayName: 'string' }),
  status: type({ phase: 'string?' }),
});

export const accountsStack = sdk.kubernetesComposition({
  name: ${JSON.stringify(options.stackName)},
  apiVersion: 'modelstore.applik8s.dev/v1alpha1',
  kind: ${JSON.stringify(options.stackKind)},
  spec: type({}),
  status: type({ ready: 'boolean', applik8s: 'object?' }),
}, (_spec, app) => {
  const store = app.provide(ModelStore, {
    kind: 'postgres',
    name: ${JSON.stringify(options.databaseName)},
    namespace: ${JSON.stringify(options.namespace)},
    database: 'accounts',
    migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: ${JSON.stringify(options.migrationJobName)} },
  });
  const Account = app.model(AccountEntity, {
    store,
    schema: {
      identity: ['id'],
      constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
      indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
      transactions: 'supported',
    },
  });
  app.server(${JSON.stringify(generatedServerName)}, {
    namespace: ${JSON.stringify(options.namespace)},
    serviceName: ${JSON.stringify(generatedServiceName)},
    service: { port: 80 },
  }, (server) => {
    server.post('/accounts', async (request) => {
      const form = await request.formData();
      return Account.create({ spec: { email: form.string('email'), displayName: form.string('displayName') } });
    });
    server.get('/accounts', async (request) => Account.query({ where: { email: request.query.email ?? '' }, limit: 10 }));
    server.get('/account', async (request) => {
      const account = await Account.get({ id: request.query.id ?? '' });
      return account ?? new Response('not found', { status: 404 });
    });
    server.post('/account/phase', async (request) => {
      const form = await request.formData();
      return Account.patch({ id: form.string('id') }, { status: { phase: form.string('phase') } });
    });
    server.post('/account/delete', async (request) => {
      const form = await request.formData();
      await Account.delete({ id: form.string('id') });
      return { deleted: true };
    });
    server.get('/accounts/by-email', async (request) => Account.index('accounts-by-email', { partitionBy: 'email', unique: true }).query(request.query.email ?? '', { limit: 10 }));
  });
  return { ready: true };
});
`.trimStart();
}
