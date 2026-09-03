// typecast-file-boundary: exact-release fixtures deliberately project legacy and current graph shapes across the validated migration decoder boundary.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationPlan,
  applicationCanonicalIdentity,
  applicationTargetIdentity,
  createMemoryApplicationDeploymentMigrationRunStore,
  sourceProvenance,
} from '@applik8s/core';
import {
  type ApplicationAlchemyDeployment,
  type ApplicationAlchemyLease,
  applicationAlchemyStackIdentity,
  claimApplicationAlchemyStackIdentity,
} from '@applik8s/deployment-alchemy';
import {
  type ApplicationDeploymentGraph,
  applicationRuntimeAccessPlanDigest,
  digestApplicationDeploymentValue,
  serializeApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import {
  captureReleasedV071ApplicationDeployment,
  decodeReleasedV071ApplicationDeploymentGraph,
  planReleasedV071ApplicationDeploymentMigration,
  prepareReleasedV071ApplicationDeploymentMigration,
} from '../src/application-deployment-migration.js';

const digest = (value: string) => digestApplicationDeploymentValue({ value });

function graph(compilerVersion: string): ApplicationDeploymentGraph {
  const connectionDigest = digest('connection');
  const sourceGraphDigest = digest('source') as `sha256:${string}`;
  const runtimeAccess = {
    apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
    application: 'migration-fixture',
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
        connection: { provider: 'kubernetes', cluster: 'orbstack', digest: connectionDigest },
        application: 'migration-fixture',
        controlPlaneNamespace: 'migration-system',
        instance: 'migration',
        profile: 'starter',
      },
      mode: 'fresh',
      strategy: 'kro',
      sourceGraphDigest,
      compilerVersion,
    },
    runtimeAccess: { ...runtimeAccess, digest: applicationRuntimeAccessPlanDigest(runtimeAccess) },
    nodes: [{
      id: 'kubernetes.application',
      kind: 'kubernetesComposition',
      contractVersion: 1,
      source: { semanticNodeId: 'application' },
      provider: { interface: 'KubernetesApplication', implementation: 'typekro', version: '1' },
      scope: { connectionDigest, namespace: 'migration-system' },
      capabilities: { strategies: ['direct', 'kro'], alchemy: true },
      configurationDigest: digest('configuration'),
      inputs: {},
      outputs: [{ name: 'status', type: 'json', sensitivity: 'public', persistence: 'state' }],
      lifecycle: { ownership: 'application', deletion: 'delete', adoption: 'createOrAdoptExact' },
      spec: { compositionId: 'migration-fixture', fragmentIds: [] },
    }],
    edges: [],
  };
}

function plan(targetGraph: ApplicationDeploymentGraph): ApplicationPlan {
  const provenance = sourceProvenance({ origin: 'provider-plan', symbol: 'application' });
  return {
    schemaVersion: 'applik8s.applicationPlan/v1alpha1',
    sourceGraphVersion: 'applik8s.appGraph/v1alpha1',
    application: applicationCanonicalIdentity({
      application: 'migration-fixture',
      kind: 'application',
      semanticKey: 'migration-fixture',
    }),
    target: {
      apiVersion: 'applik8s.target/v1alpha1',
      identity: applicationTargetIdentity({
        application: 'migration-fixture',
        target: 'kubernetes',
        connectionDigest: targetGraph.metadata.identity.connection.digest,
        instance: 'migration',
      }),
      target: 'kubernetes',
      profile: 'starter',
      lifecycleAuthority: 'alchemy',
      attributes: {},
    },
    generatedAt: new Date(0).toISOString(),
    sourceDigest: targetGraph.metadata.sourceGraphDigest,
    identities: [],
    semantic: {
      nodes: [], edges: [], executions: [], authority: [], dataFlows: [], state: [],
      exposures: [], observability: [], runtimeAccess: [],
    },
    resolution: { capabilities: [] },
    physical: {
      nodes: [{
        id: applicationCanonicalIdentity({
          application: 'migration-fixture',
          kind: 'graph-node',
          semanticKey: 'kubernetes.application',
        }).id,
        deploymentNodeId: 'kubernetes.application',
        kind: 'kubernetesComposition',
        provider: { interface: 'KubernetesApplication', implementation: 'typekro', version: '1' },
        scope: { connectionDigest: targetGraph.metadata.identity.connection.digest, namespace: 'migration-system' },
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

async function activeLegacyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'applik8s-v071-migration-'));
  const stateRoot = join(root, 'state');
  const sourceGraph = graph('0.6.0');
  const graphPath = join(root, 'application-deployment-graph.json');
  const { runtimeAccess: _runtimeAccess, ...releasedGraph } = sourceGraph;
  await writeFile(graphPath, `${JSON.stringify(releasedGraph, null, 2)}\n`);
  const stack = applicationAlchemyStackIdentity(sourceGraph.metadata.identity, sourceGraph.metadata.strategy);
  await claimApplicationAlchemyStackIdentity(stateRoot, stack);
  const stage = join(stateRoot, 'alchemy-state', stack.key, 'installation');
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'cmVzb3VyY2U.json'), '{}');
  await writeFile(join(stage, '__stack_output__.json'), '{}');
  return { root, stateRoot, sourceGraph, graphPath, stack };
}

describe('released v0.7.1 deployment migration', () => {
  it('decodes only the exact pre-runtime-access v0.7.1 graph root', () => {
    const sourceGraph = graph('0.6.0');
    const { runtimeAccess: _runtimeAccess, ...releasedGraph } = sourceGraph;
    expect(
      decodeReleasedV071ApplicationDeploymentGraph(JSON.stringify(releasedGraph)),
    ).toMatchObject({
      metadata: { compilerVersion: '0.6.0' },
      runtimeAccess: { target: 'kubernetes', executions: [], workloads: [] },
    });
    expect(() => decodeReleasedV071ApplicationDeploymentGraph(JSON.stringify({
      ...releasedGraph,
      unexpected: true,
    }))).toThrow(/unexpected root fields/u);
  });

  it('ignores a stale generated graph when no active Alchemy state exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-v071-stale-'));
    const graphPath = join(root, 'application-deployment-graph.json');
    await writeFile(graphPath, serializeApplicationDeploymentGraph(graph('0.6.0')));
    await expect(captureReleasedV071ApplicationDeployment({
      graphPath,
      stateRoot: join(root, 'state'),
      migrationRoot: join(root, 'migration'),
    })).resolves.toBeUndefined();
  });

  it('requires the exact source release before accepting active state', async () => {
    const fixture = await activeLegacyFixture();
    await expect(captureReleasedV071ApplicationDeployment({
      graphPath: fixture.graphPath,
      stateRoot: fixture.stateRoot,
      migrationRoot: join(fixture.root, 'migration'),
    })).rejects.toThrow(/--migrate-from 0\.7\.1/u);
    await expect(captureReleasedV071ApplicationDeployment({
      graphPath: fixture.graphPath,
      stateRoot: fixture.stateRoot,
      migrationRoot: join(fixture.root, 'migration'),
      migrateFrom: '0.7.1',
    })).resolves.toMatchObject({
      baseline: { release: '0.7.1' },
      serializedSource: expect.not.stringContaining('runtimeAccess'),
    });

    // A plan command may overwrite the generated candidate graph without
    // applying it. The preserved active source must remain resumable.
    await writeFile(fixture.graphPath, serializeApplicationDeploymentGraph(graph('0.9.0')));
    await expect(captureReleasedV071ApplicationDeployment({
      graphPath: fixture.graphPath,
      stateRoot: fixture.stateRoot,
      migrationRoot: join(fixture.root, 'migration'),
      migrateFrom: '0.7.1',
    })).resolves.toMatchObject({ graph: { metadata: { compilerVersion: '0.6.0' } } });
  });

  it('plans and completes the same-stack fenced handoff exactly once', async () => {
    const fixture = await activeLegacyFixture();
    const source = await captureReleasedV071ApplicationDeployment({
      graphPath: fixture.graphPath,
      stateRoot: fixture.stateRoot,
      migrationRoot: join(fixture.root, 'migration'),
      migrateFrom: '0.7.1',
    });
    if (!source) throw new Error('Expected active v0.7.1 source.');
    const targetGraph = graph('0.9.0');
    const targetPlan = plan(targetGraph);
    const planned = planReleasedV071ApplicationDeploymentMigration({
      source,
      targetGraph,
      targetPlan,
      targetStack: fixture.stack,
    });
    expect(planned.proposal).toMatchObject({
      status: 'ready',
      mappings: [{ disposition: 'preserve', lifecycleTransfer: { mode: 'fenced-handoff' } }],
    });

    let applyCount = 0;
    let readyCount = 0;
    let heartbeatCount = 0;
    const deployment: ApplicationAlchemyDeployment = {
      stack: fixture.stack,
      stage: 'installation',
      async plan() { throw new Error('not used'); },
      async apply() {
        applyCount += 1;
        return {
          stack: fixture.stack,
          stage: 'installation',
          declarationCount: 1,
          deploymentEvidenceDigest: digest('evidence'),
          planIdentityDigest: digest('plan'),
          artifacts: [],
          transaction: 'applied',
        };
      },
      async destroy() { throw new Error('not used'); },
    };
    const lease: ApplicationAlchemyLease = {
      identity: fixture.stack,
      owner: 'migration-test',
      token: 'token',
      acquiredAt: new Date().toISOString(),
      async heartbeat() { heartbeatCount += 1; },
      async release() {},
    };
    const prepared = await prepareReleasedV071ApplicationDeploymentMigration({
      source,
      targetGraph,
      targetPlan,
      targetDeployment: deployment,
      lease,
      stateRoot: fixture.stateRoot,
      migrationRoot: join(fixture.root, 'migration-artifacts'),
      store: createMemoryApplicationDeploymentMigrationRunStore(),
      owner: 'migration-test',
      observeTargetReady: async () => { readyCount += 1; },
    });
    const completed = await prepared.advance();
    expect(completed.phase).toBe('completed');
    expect(applyCount).toBe(1);
    expect(readyCount).toBe(1);
    expect(heartbeatCount).toBe(1);
    expect(JSON.parse(await readFile(prepared.artifactPath, 'utf8'))).toMatchObject({ status: 'ready' });
  });
});
