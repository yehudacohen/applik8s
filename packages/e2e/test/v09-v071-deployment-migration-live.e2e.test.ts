// typecast-file-boundary: this exact-release fixture constructs one minimal
// released deployment graph and its corresponding canonical v0.9 plan.
import { readFile, writeFile } from 'node:fs/promises';
import {
  type ApplicationPlan,
  applicationCanonicalIdentity,
  applicationTargetIdentity,
  sourceProvenance,
} from '@applik8s/core';
import {
  type ApplicationAlchemyDeployment,
  applicationAlchemyStackIdentity,
  createApplicationAlchemyGraphDeployment,
  withApplicationAlchemyDeploymentLease,
} from '@applik8s/deployment-alchemy';
import {
  type ApplicationDeploymentGraph,
  applicationRuntimeAccessPlanDigest,
  digestApplicationDeploymentValue,
  serializeApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { ConfigMap } from 'typekro/simple';
import { expect, it } from 'vitest';
import {
  captureReleasedV071ApplicationDeployment,
  prepareReleasedV071ApplicationDeploymentMigration,
  retireReleasedV071ApplicationDeploymentSource,
} from '../../cli/src/application-deployment-migration.js';
import { createFileApplicationDeploymentMigrationRunStore } from '../../cli/src/application-deployment-migration-store.js';
import { assertExpectedKubectlContext, describeLive, kubectl } from './live-e2e-helpers.js';

const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const namespace = process.env.APPLIK8S_V09_MIGRATION_NAMESPACE ?? 'applik8s-v09-migration-live';
const application = process.env.APPLIK8S_V09_MIGRATION_APPLICATION ?? 'v09-migration-fixture';
const instance = 'migration';
const strategy = deploymentStrategy();
const connectionDigest = digestApplicationDeploymentValue({ provider: 'kubernetes', context });

describeLive('v0.7.1 to v0.9 deployment-state migration', () => {
it('adopts the exact released v0.7.1 Alchemy state in place', async () => {
  const stateRoot = required('APPLIK8S_V09_MIGRATION_STATE_ROOT');
  const graphPath = required('APPLIK8S_V09_MIGRATION_GRAPH_PATH');
  const migrationRoot = required('APPLIK8S_V09_MIGRATION_ROOT');
  await assertExpectedKubectlContext();
  const before = await liveConfig();
  expect(before.data?.version).toBe('v1');
  const source = await captureReleasedV071ApplicationDeployment({
    graphPath,
    stateRoot,
    migrationRoot,
    migrateFrom: '0.7.1',
  });
  if (!source) throw new Error('The released v0.7.1 source deployment is absent.');

  const targetGraph = deploymentGraph('v2');
  const targetPlan = applicationPlan(targetGraph);
  await writeFile(graphPath, serializeApplicationDeploymentGraph(targetGraph));
  const composition = applicationComposition();
  let deployment: ApplicationAlchemyDeployment | undefined;
  try {
    const stack = applicationAlchemyStackIdentity(
      targetGraph.metadata.identity,
      targetGraph.metadata.strategy,
    );
    await withApplicationAlchemyDeploymentLease(
      {
        stateRoot,
        owner: 'v09-exact-release-migration',
        leaseTtlMs: 120_000,
      },
      stack,
      async (lease) => {
        deployment = await createApplicationAlchemyGraphDeployment({
          graph: targetGraph,
          source: composition,
          spec: { name: instance, version: 'v2' },
          stateRoot,
          stage: 'installation',
          owner: 'v09-exact-release-migration',
          lease,
          factory: {
            namespace: 'typekro-system',
            waitForReady: true,
            timeout: 120_000,
          },
        });
        const plan = await deployment.plan();
        expect(plan.changes.some(({ action }) => action === 'update')).toBe(true);
        const prepared = await prepareReleasedV071ApplicationDeploymentMigration({
          source,
          targetGraph,
          targetPlan,
          targetDeployment: deployment,
          lease,
          stateRoot,
          migrationRoot,
          store: createFileApplicationDeploymentMigrationRunStore({ root: migrationRoot }),
          owner: 'v09-exact-release-migration',
          observeTargetReady: async () => {
            const current = await liveConfig();
            expect(current.metadata?.uid).toBe(before.metadata?.uid);
            expect(current.data?.version).toBe('v2');
          },
        });
        const completed = await prepared.advance();
        expect(completed.phase).toBe('completed');
        await retireReleasedV071ApplicationDeploymentSource(source);
      },
    );

    const after = await liveConfig();
    expect(after.metadata?.uid).toBe(before.metadata?.uid);
    expect(after.data?.version).toBe('v2');
    expect(JSON.parse(
      await readFile(`${source.sourceSnapshotPath}.completed`, 'utf8'),
    )).toMatchObject({ metadata: { compilerVersion: '0.6.0' } });
  } finally {
    await deployment?.destroy();
  }
  const absent = await kubectl([
    '--context', context,
    'get', 'configmap', `${application}-config`,
    '--namespace', namespace,
    '--ignore-not-found=true',
    '--output', 'name',
  ]);
  expect(absent.stdout.trim()).toBe('');
}, 300_000);
});

function applicationComposition() {
  const definition = {
    name: application,
    apiVersion: `${application}.qualification.applik8s.dev/v1alpha1`,
    kind: 'V09MigrationFixture',
    spec: type({ name: 'string', version: 'string' }),
    status: type({ ready: 'boolean' }),
  };
  const composition = kubernetesComposition(definition, spec => {
    const config = ConfigMap({
      id: 'migrationConfig',
      name: `${application}-config`,
      namespace,
      data: { version: spec.version },
    });
    return { ready: config.metadata.name === `${application}-config` };
  });
  Object.defineProperty(composition, '__applik8sTypeKroDefinition', {
    value: definition,
    enumerable: false,
  });
  return composition;
}

function deploymentGraph(version: string): ApplicationDeploymentGraph {
  const sourceGraphDigest = digestApplicationDeploymentValue({
    name: instance,
    version,
  }) as `sha256:${string}`;
  const runtimeAccess = {
    apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
    application,
    target: 'kubernetes' as const,
    sourceGraphDigest,
    executions: [],
    workloads: [],
    diagnostics: [],
  };
  return {
    apiVersion: 'applik8s.deploymentGraph/v1alpha1',
    kind: 'ApplicationDeploymentGraph',
    metadata: {
      identity: {
        connection: { provider: 'kubernetes', cluster: context, digest: connectionDigest },
        application,
        controlPlaneNamespace: 'typekro-system',
        instance,
        profile: 'starter',
      },
      mode: 'fresh',
      strategy,
      sourceGraphDigest,
      compilerVersion: '0.9.0',
    },
    runtimeAccess: { ...runtimeAccess, digest: applicationRuntimeAccessPlanDigest(runtimeAccess) },
    nodes: [{
      id: 'kubernetes.application',
      kind: 'kubernetesComposition',
      contractVersion: 1,
      source: { semanticNodeId: 'application' },
      provider: { interface: 'KubernetesApplication', implementation: 'typekro', version: '1' },
      scope: { connectionDigest, namespace },
      capabilities: { strategies: ['direct', 'kro'], alchemy: true },
      configurationDigest: digestApplicationDeploymentValue({ name: instance, version }),
      inputs: {},
      outputs: [{ name: 'status', type: 'json', sensitivity: 'public', persistence: 'state' }],
      lifecycle: { ownership: 'application', deletion: 'delete', adoption: 'createOrAdoptExact' },
      spec: {
        compositionId: application,
        fragmentIds: [],
        installationSpec: { name: instance, version },
        materialized: {
          resources: [{
            id: 'migrationConfig',
            template: {
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: { name: `${application}-config`, namespace },
              data: { version },
            },
          }],
          status: { ready: true },
        },
      },
    }],
    edges: [],
  };
}

function applicationPlan(graph: ApplicationDeploymentGraph): ApplicationPlan {
  const provenance = sourceProvenance({ origin: 'provider-plan', symbol: 'application' });
  return {
    schemaVersion: 'applik8s.applicationPlan/v1alpha1',
    sourceGraphVersion: 'applik8s.appGraph/v1alpha1',
    application: applicationCanonicalIdentity({ application, kind: 'application', semanticKey: application }),
    target: {
      apiVersion: 'applik8s.target/v1alpha1',
      identity: applicationTargetIdentity({
        application,
        target: 'kubernetes',
        connectionDigest,
        instance,
      }),
      target: 'kubernetes',
      profile: 'starter',
      lifecycleAuthority: 'alchemy',
      attributes: {},
    },
    generatedAt: new Date(0).toISOString(),
    sourceDigest: graph.metadata.sourceGraphDigest,
    identities: [],
    semantic: {
      nodes: [], edges: [], executions: [], authority: [], dataFlows: [], state: [],
      exposures: [], observability: [], runtimeAccess: [],
    },
    resolution: { capabilities: [] },
    physical: {
      nodes: [{
        id: applicationCanonicalIdentity({
          application,
          kind: 'graph-node',
          semanticKey: 'kubernetes.application',
        }).id,
        deploymentNodeId: 'kubernetes.application',
        kind: 'kubernetesComposition',
        provider: { interface: 'KubernetesApplication', implementation: 'typekro', version: '1' },
        scope: { connectionDigest, namespace },
        lifecycle: { ownership: 'application', intent: 'update' },
        outputs: [{ name: 'status', sensitivity: 'public', persistence: 'state' }],
        fact: 'planned',
        provenance: [provenance],
      }],
      edges: [],
      nativePlans: [],
    },
    diagnostics: [],
    estimates: [],
    evidence: [],
  };
}

async function liveConfig(): Promise<{
  readonly data?: { readonly version?: string };
  readonly metadata?: { readonly uid?: string };
}> {
  const result = await kubectl([
    '--context', context,
    'get', 'configmap', `${application}-config`,
    '--namespace', namespace,
    '--output', 'json',
  ]);
  return JSON.parse(result.stdout) as {
    readonly data?: { readonly version?: string };
    readonly metadata?: { readonly uid?: string };
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function deploymentStrategy(): 'direct' | 'kro' {
  const value = process.env.APPLIK8S_V09_MIGRATION_STRATEGY ?? 'direct';
  if (value !== 'direct' && value !== 'kro') {
    throw new Error(`Unsupported migration strategy ${value}.`);
  }
  return value;
}
