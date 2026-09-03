// typecast-file-boundary: phase-interruption fixtures intentionally derive typed protocol records and provider outcomes for exhaustive state-machine testing.
import { describe, expect, it } from 'vitest';
import {
  type ApplicationCapabilityImplementationIdentity,
  type ApplicationDeploymentMigrationBaseline,
  type ApplicationDeploymentMigrationOperation,
  type ApplicationDeploymentMigrationPhase,
  type ApplicationDeploymentMigrationProvider,
  type ApplicationDeploymentMigrationProviderContext,
  type ApplicationDeploymentMigrationReceipt,
  ApplicationDeploymentMigrationRunError,
  ApplicationDeploymentMigrationUnknownOutcomeError,
  advanceApplicationDeploymentMigration,
  applicationProviderIdentity,
  createApplicationDeploymentMigrationRun,
  createMemoryApplicationDeploymentMigrationRunStore,
  proposeApplicationDeploymentMigration,
  requestApplicationDeploymentMigrationRollback,
  resolveApplicationDeploymentMigrationUnknownOutcome,
  sourceProvenance,
  startApplicationDeploymentMigration,
} from '../src/index.js';

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const provenance = sourceProvenance({ origin: 'authored', module: 'src/application.ts', symbol: 'Application' });
const identity = {
  domain: 'kubernetes' as const,
  cluster: 'cluster-a',
  group: 'postgresql.cnpg.io',
  kind: 'Cluster',
  namespace: 'application',
  name: 'database',
};
const baseline: ApplicationDeploymentMigrationBaseline = {
  release: '0.7.1',
  gitTag: 'v0.7.1',
  commit: '3d482707d70e868c9e20267650c9ebfda573bc98',
  applicationArtifactSchema: 'applik8s.appGraph/v1alpha1',
  applicationPlanSchema: 'applik8s.applicationPlan/absent-v0.7.1',
  providerCatalogDigest: sha('b'),
  runtimeProtocolVersions: ['applik8s.runtime/v1alpha1'],
  evidenceManifestDigest: sha('c'),
};

function implementation(): ApplicationCapabilityImplementationIdentity {
  return {
    apiVersion: 'applik8s.implementationIdentity/v1alpha1',
    identityVersion: 1,
    canonical: applicationProviderIdentity({
      application: 'migration-test',
      capabilityInterface: 'TransactionalDatabase',
      nodeId: 'database',
    }),
    capability: { interface: 'TransactionalDatabase' },
    provider: { package: '@applik8s/runtime-postgres', export: 'postgres', version: '0.9.0' },
    source: 'named',
    explicitName: 'database',
    provenance,
    configurationDigest: sha('d'),
  };
}

function proposal() {
  return proposeApplicationDeploymentMigration({
    source: {
      baseline,
      application: 'migration-test',
      deploymentStateIdentity: 'alchemy://migration-test',
      applicationArtifactDigest: sha('e'),
      planDigest: sha('f'),
    },
    target: {
      release: '0.9.0',
      application: 'migration-test',
      profile: 'production',
      applicationArtifactDigest: sha('1'),
      applicationPlanSchema: 'applik8s.applicationPlan/v1alpha1',
      providerCatalogDigest: sha('2'),
      planDigest: sha('3'),
    },
    acceptedBaseline: baseline,
    sourceNodes: [{
      id: 'legacy-database',
      semanticRequirement: 'application.database',
      capability: { interface: 'TransactionalDatabase' },
      implementation: 'postgres-v071',
      providerContract: 'postgres.lifecycle/v1',
      physicalIdentity: identity,
      lifecycle: 'application',
      stateSchema: 'alchemy.kubernetes/v1',
      guarantees: ['durable', 'ready'],
      provenance: [provenance],
    }],
    targetNodes: [{
      id: 'database',
      semanticRequirement: 'application.database',
      implementation: implementation(),
      providerContract: 'postgres.lifecycle/v1',
      physicalIdentity: identity,
      lifecycle: 'application',
      stateSchema: 'alchemy.kubernetes/v1',
      guarantees: ['durable', 'ready'],
      provenance: [provenance],
    }],
  });
}

function provider(options: {
  readonly unknownAt?: ApplicationDeploymentMigrationOperation;
  readonly failAt?: ApplicationDeploymentMigrationOperation;
} = {}) {
  const invocations: string[] = [];
  const receipts = new Map<string, ApplicationDeploymentMigrationReceipt>();
  const operation = async (
    context: ApplicationDeploymentMigrationProviderContext,
    kind: ApplicationDeploymentMigrationOperation,
  ) => {
    invocations.push(context.operationId);
    if (options.failAt === kind) throw new Error(`provider failed during ${kind}`);
    const receipt = receipts.get(context.operationId) ?? {
      id: `receipt-${context.operationId}`,
      operation: kind,
      mapping: context.mapping.id,
      operationId: context.operationId,
      recordedAt: '2026-09-02T00:00:00.000Z',
      outcome: options.unknownAt === kind ? 'unknown' as const : 'succeeded' as const,
      ...(context.expectedPhysicalIdentity
        ? { observedPhysicalIdentity: context.expectedPhysicalIdentity }
        : {}),
    };
    receipts.set(context.operationId, receipt);
    return receipt;
  };
  const adapter: ApplicationDeploymentMigrationProvider = {
    verifySource: context => operation(context, 'verifySource'),
    prepareTarget: context => operation(context, 'prepareTarget'),
    fenceSource: context => operation(context, 'fenceSource'),
    activateTarget: context => operation(context, 'activateTarget'),
    observeTargetReady: context => operation(context, 'observeTargetReady'),
    retireLegacy: context => operation(context, 'retireLegacy'),
    rollbackTarget: context => operation(context, 'rollbackTarget'),
    reactivateSource: context => operation(context, 'reactivateSource'),
  };
  return { adapter, invocations };
}

async function initialized() {
  const run = createApplicationDeploymentMigrationRun({
    id: 'upgrade-v071-v09',
    deployment: 'migration-test/production',
    proposalDigest: sha('9'),
    proposal: proposal(),
    now: '2026-09-02T00:00:00.000Z',
  });
  const store = createMemoryApplicationDeploymentMigrationRunStore();
  await startApplicationDeploymentMigration({ store, run });
  return { run, store };
}

const resumablePhases: readonly ApplicationDeploymentMigrationPhase[] = [
  'proposed',
  'sourceVerified',
  'mapped',
  'targetPrepared',
  'authorityPending',
  'sourceFenced',
  'targetAuthorized',
  'targetReady',
  'committed',
  'legacyRetired',
];

describe('active application deployment migration', () => {
  it.each(resumablePhases)('persists and resumes safely after %s', async (phase) => {
    const { store } = await initialized();
    const firstProvider = provider();
    const stopped = await advanceApplicationDeploymentMigration({
      store,
      provider: firstProvider.adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      stopAfterPhase: phase,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    });
    expect(stopped.phase).toBe(phase);

    const resumedProvider = provider();
    const completed = await advanceApplicationDeploymentMigration({
      store,
      provider: resumedProvider.adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-two',
      now: () => new Date('2026-09-02T00:01:00.000Z'),
    });
    expect(completed.phase).toBe('completed');
    expect(completed.handoffs).toEqual([
      expect.objectContaining({ active: 'target' }),
    ]);
    expect(new Set(completed.receipts.map(({ operationId }) => operationId)).size).toBe(completed.receipts.length);
  });

  it('rejects concurrent owners until the durable lease expires', async () => {
    const { store } = await initialized();
    await advanceApplicationDeploymentMigration({
      store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      stopAfterPhase: 'proposed',
      leaseDurationMs: 60_000,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    });
    await expect(advanceApplicationDeploymentMigration({
      store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-two',
      now: () => new Date('2026-09-02T00:00:30.000Z'),
    })).rejects.toMatchObject({ code: 'MIGRATION_CONCURRENT_OPERATION' });
  });

  it('fails closed on unknown provider outcomes and preserves the provider receipt', async () => {
    const { store } = await initialized();
    await expect(advanceApplicationDeploymentMigration({
      store,
      provider: provider({ unknownAt: 'activateTarget' }).adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    })).rejects.toBeInstanceOf(ApplicationDeploymentMigrationRunError);
    const failed = await store.read('upgrade-v071-v09');
    expect(failed).toMatchObject({
      phase: 'failedUnknown',
      rollbackFrom: 'sourceFenced',
      failure: { code: 'MIGRATION_FORWARD_RECOVERY_REQUIRED', operation: 'activateTarget' },
    });
    expect(failed?.receipts).toContainEqual(expect.objectContaining({ outcome: 'unknown' }));
    const unknown = failed?.receipts.find(({ outcome }) => outcome === 'unknown');
    if (!unknown) throw new Error('Expected an unknown migration receipt.');
    const recovered = await resolveApplicationDeploymentMigrationUnknownOutcome({
      store,
      runId: 'upgrade-v071-v09',
      owner: 'operator-resolution',
      now: new Date('2026-09-02T00:01:00.000Z'),
      resolution: {
        ...unknown,
        id: `${unknown.id}-resolved`,
        recordedAt: '2026-09-02T00:01:00.000Z',
        outcome: 'succeeded',
        observedPhysicalIdentity: identity,
      },
    });
    expect(recovered.phase).toBe('sourceFenced');
    expect((await advanceApplicationDeploymentMigration({
      store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-two',
      now: () => new Date('2026-09-02T00:02:00.000Z'),
    })).phase).toBe('completed');
  });

  it('honors the mapping commit frontier when deciding rollback authority', async () => {
    const beforeCommit = await initialized();
    await advanceApplicationDeploymentMigration({
      store: beforeCommit.store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      stopAfterPhase: 'sourceFenced',
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    });
    const rolledBack = await requestApplicationDeploymentMigrationRollback({
      store: beforeCommit.store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-two',
      now: () => new Date('2026-09-02T00:01:00.000Z'),
    });
    expect(rolledBack).toMatchObject({ phase: 'rolledBack' });
    expect(rolledBack.handoffs).toEqual([expect.objectContaining({ active: 'source' })]);

    const afterCommit = await initialized();
    await advanceApplicationDeploymentMigration({
      store: afterCommit.store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      stopAfterPhase: 'targetAuthorized',
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    });
    await expect(requestApplicationDeploymentMigrationRollback({
      store: afterCommit.store,
      provider: provider().adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-two',
      now: () => new Date('2026-09-02T00:01:00.000Z'),
    })).rejects.toMatchObject({ code: 'MIGRATION_FORWARD_RECOVERY_REQUIRED' });
  });

  it('requires physical identity evidence and rejects a mismatched provider observation', async () => {
    const { store } = await initialized();
    const wrong = provider();
    wrong.adapter.verifySource = async (context) => ({
      id: 'wrong-identity',
      operation: 'verifySource',
      mapping: context.mapping.id,
      operationId: context.operationId,
      recordedAt: '2026-09-02T00:00:00.000Z',
      outcome: 'succeeded',
      observedPhysicalIdentity: { ...identity, name: 'other-database' },
    });
    await expect(advanceApplicationDeploymentMigration({
      store,
      provider: wrong.adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'MIGRATION_PROVIDER_INCOMPATIBLE' });
    expect((await store.read('upgrade-v071-v09'))?.phase).toBe('blocked');
  });

  it('preserves an unknown receipt supplied by an adapter error', async () => {
    const { store } = await initialized();
    const uncertain = provider();
    uncertain.adapter.verifySource = async (context) => {
      throw new ApplicationDeploymentMigrationUnknownOutcomeError('transport ended after commit', {
        id: 'uncertain',
        operation: 'verifySource',
        mapping: context.mapping.id,
        operationId: context.operationId,
        recordedAt: '2026-09-02T00:00:00.000Z',
        outcome: 'unknown',
      });
    };
    await expect(advanceApplicationDeploymentMigration({
      store,
      provider: uncertain.adapter,
      runId: 'upgrade-v071-v09',
      owner: 'migrator-one',
      now: () => new Date('2026-09-02T00:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'MIGRATION_FORWARD_RECOVERY_REQUIRED' });
    expect((await store.read('upgrade-v071-v09'))?.receipts).toContainEqual(expect.objectContaining({ id: 'uncertain' }));
  });
});
