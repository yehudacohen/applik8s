// typecast-file-boundary: release-baseline and evidence records are decoded at this qualification boundary and verified by exact hashes and downstream validators.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  collectV06ClusterIdentity,
  collectV06GitIdentity,
  createV06AssertionEvidence,
  discardV06Evidence,
  writeV06EvidenceReceipt,
} from './v06-evidence';
import { v09EvidencePath } from './v09-release-evidence-contract';

const execFileAsync = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const context = requiredEnvironment('APPLIK8S_E2E_CONTEXT');

const baseline = JSON.parse(
  await readFile(join(root, 'docs/v071-deployment-migration-baseline.json'), 'utf8'),
) as { readonly gitTag: string; readonly commit: string };
const actualCommit = (await run('git', ['rev-parse', `${baseline.gitTag}^{commit}`], root)).stdout.trim();
if (actualCommit !== baseline.commit) {
  throw new Error(`Released migration baseline ${baseline.gitTag} resolved to ${actualCommit}, expected ${baseline.commit}.`);
}

const runId = randomUUID();
const startedAt = new Date().toISOString();
const suite = 'v071-deployment-migration';
const evidencePath = v09EvidencePath(suite);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'applik8s-v09-v071-migration-'));
const releasedRoot = join(temporaryRoot, 'released-v071');
const archive = join(temporaryRoot, 'released-v071.tar');
const fixtureTarget = join(releasedRoot, 'packages/e2e/test/v09-migration-source.e2e.test.ts');

await discardV06Evidence(evidencePath);
try {
  await mkdir(releasedRoot, { recursive: true });
  await run('git', ['archive', '--format=tar', `--output=${archive}`, baseline.gitTag], root);
  await run('tar', ['-xf', archive, '-C', releasedRoot], root);
  await copyFile(
    join(root, 'packages/e2e/test/fixtures/v071-deployment-migration/source.e2e.test.ts.txt'),
    fixtureTarget,
  );
  await run('bun', ['install', '--frozen-lockfile'], releasedRoot);
  for (const strategy of ['direct', 'kro'] as const) {
    await qualifyStrategy(strategy);
  }

  const completedAt = new Date().toISOString();
  const [git, cluster] = await Promise.all([
    collectV06GitIdentity(root, { exclude: ['.applik8s-tmp/evidence/'] }),
    collectV06ClusterIdentity(context),
  ]);
  const assertions = [
    'released-v071-state-created',
    'v071-graph-decoded',
    'stack-lease-fenced',
    'physical-uid-preserved',
    'target-ready',
    'typekro-cleanup',
  ] as const;
  await writeV06EvidenceReceipt(evidencePath, {
    suite,
    run: { id: runId, startedAt, completedAt },
    candidate: { git, cluster },
    environment: {
      context,
      clusterUid: cluster.uid,
      sourceRelease: '0.7.1',
      sourceCommit: baseline.commit,
      targetRelease: '0.9.0',
      strategies: ['direct', 'kro'],
    },
    assertionEvidence: createV06AssertionEvidence(
      assertions.map(assertion => ({
        assertion,
        test: 'exact released v0.7.1 state to v0.9 in-place migration',
        observedAt: completedAt,
      })),
      runId,
    ),
  });
  console.log(JSON.stringify({ suite, evidencePath, source: baseline, candidate: git, cluster }, null, 2));
} catch (cause) {
  await discardV06Evidence(evidencePath);
  throw cause;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function qualifyStrategy(strategy: 'direct' | 'kro'): Promise<void> {
  const suffix = `${strategy}-${runId.replaceAll('-', '').slice(0, 8)}`;
  const namespace = `applik8s-v09-migration-${suffix}`;
  const strategyRoot = join(temporaryRoot, strategy);
  const environment = {
    ...process.env,
    APPLIK8S_E2E: '1',
    APPLIK8S_E2E_LIVE: '1',
    APPLIK8S_E2E_CONTEXT: context,
    APPLIK8S_V09_MIGRATION_STRATEGY: strategy,
    APPLIK8S_V09_MIGRATION_APPLICATION: `v09-migration-${suffix}`,
    APPLIK8S_V09_MIGRATION_NAMESPACE: namespace,
    APPLIK8S_V09_MIGRATION_STATE_ROOT: join(strategyRoot, 'state'),
    APPLIK8S_V09_MIGRATION_GRAPH_PATH: join(strategyRoot, 'out', 'application-deployment-graph.json'),
    APPLIK8S_V09_MIGRATION_ROOT: join(strategyRoot, 'migration'),
    TYPEKRO_LOG_LEVEL: 'fatal',
  };
  await run('kubectl', ['--context', context, 'delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=true', '--timeout=120s'], root);
  await run('kubectl', ['--context', context, 'create', 'namespace', namespace], root);
  let migrationCompleted = false;
  try {
    await run(
      'bunx',
      ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/v09-migration-source.e2e.test.ts', '--maxWorkers=1'],
      releasedRoot,
      environment,
    );
    await run(
      'bunx',
      ['vitest', 'run', '--config', 'vitest.e2e.config.ts', 'packages/e2e/test/v09-v071-deployment-migration-live.e2e.test.ts', '--maxWorkers=1'],
      root,
      environment,
    );
    migrationCompleted = true;
    if (strategy === 'kro') {
      await removeRetainedGeneratedCrd(environment.APPLIK8S_V09_MIGRATION_APPLICATION);
    }
  } finally {
    // The v0.9 phase uses TypeKro/Alchemy destroy for owned resources. This
    // externally-created test Namespace is only a harness boundary. In KRO
    // mode, retain it on failure rather than risking deletion of an instance
    // whose finalizer still depends on its RGD.
    if (strategy === 'direct' || migrationCompleted) {
      await run('kubectl', ['--context', context, 'delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=true', '--timeout=120s'], root);
    }
  }
}

async function removeRetainedGeneratedCrd(application: string): Promise<void> {
  const rgd = await run(
    'kubectl',
    ['--context', context, 'get', 'resourcegraphdefinition.kro.run', application, '--ignore-not-found=true', '--output=name'],
    root,
  );
  if (rgd.stdout.trim()) {
    throw new Error(`Refusing generated-CRD cleanup while ${rgd.stdout.trim()} still exists.`);
  }
  const customResource = `v09migrationfixtures.${application}.qualification.applik8s.dev`;
  const instances = await run(
    'kubectl',
    ['--context', context, 'get', customResource, '--all-namespaces', '--ignore-not-found=true', '--output=name'],
    root,
  );
  if (instances.stdout.trim()) {
    throw new Error(`Refusing generated-CRD cleanup while instances remain: ${instances.stdout.trim()}.`);
  }
  await run(
    'kubectl',
    ['--context', context, 'delete', 'customresourcedefinition.apiextensions.k8s.io', customResource, '--ignore-not-found=true', '--wait=true', '--timeout=120s'],
    root,
  );
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    env,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  return result;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; migration qualification never uses an ambient cluster implicitly.`);
  }
  return value;
}
