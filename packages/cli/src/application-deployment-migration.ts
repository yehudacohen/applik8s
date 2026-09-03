// typecast-file-boundary: Released deployment graphs and plans are decoded by their owning codecs before migration mapping.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type ApplicationCapabilityImplementationIdentity,
  type ApplicationDeploymentMigrationBaseline,
  type ApplicationDeploymentMigrationProvider,
  type ApplicationDeploymentMigrationReceipt,
  type ApplicationDeploymentMigrationRun,
  type ApplicationDeploymentMigrationRunStore,
  type ApplicationLegacyDeploymentNode,
  type ApplicationPhysicalIdentity,
  type ApplicationPlan,
  type ApplicationSourceProvenance,
  type ApplicationTargetDeploymentNode,
  advanceApplicationDeploymentMigration,
  applicationProviderIdentity,
  canonicalJsonV1String,
  createApplicationDeploymentMigrationRun,
  proposeApplicationDeploymentMigration,
  serializeApplicationDeploymentMigrationProposal,
  sourceProvenance,
  startApplicationDeploymentMigration,
} from '@applik8s/core';
import {
  type ApplicationAlchemyApplyResult,
  type ApplicationAlchemyDeployment,
  type ApplicationAlchemyLease,
  type ApplicationAlchemyStackIdentity,
  applicationAlchemyStackIdentity,
  inspectApplicationAlchemyStackIdentityClaim,
  inspectApplicationAlchemyState,
} from '@applik8s/deployment-alchemy';
import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentNode,
  applicationRuntimeAccessPlanDigest,
  decodeApplicationDeploymentGraph,
  digestApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
} from '@applik8s/deployment-contract';

export const releasedV071ApplicationDeploymentBaseline: ApplicationDeploymentMigrationBaseline = Object.freeze({
  release: '0.7.1',
  gitTag: 'v0.7.1',
  commit: '3d482707d70e868c9e20267650c9ebfda573bc98',
  applicationArtifactSchema: 'applik8s.appGraph/v1alpha1',
  applicationPlanSchema: 'applik8s.applicationPlan/absent-v0.7.1',
  providerCatalogDigest: 'sha256:a76d01d9a16e8a0d4259c625c003384638f31d459539554392c44aeda826bbc8',
  runtimeProtocolVersions: ['applik8s.runtime/v1alpha1'],
  evidenceManifestDigest: 'sha256:78c2f708283fb7367ebe32c7f0d82fffebd1a36bb4dd12d0dc23fc2903b18498',
});

export interface ReleasedV071ApplicationDeploymentSource {
  readonly graphPath: string;
  readonly graph: ApplicationDeploymentGraph;
  readonly graphDigest: string;
  readonly baseline: ApplicationDeploymentMigrationBaseline;
  readonly sourceSnapshotPath: string;
  /** Exact released deployment-graph artifact retained for audit/recovery. */
  readonly serializedSource: string;
}

/**
 * Captures the prior graph before compilation replaces it. Compiler version
 * 0.6.0 was shared by the released v0.7 line, so an explicit exact release
 * acknowledgement is required rather than guessing provenance.
 */
export async function captureReleasedV071ApplicationDeployment(input: {
  readonly graphPath: string;
  readonly stateRoot: string;
  readonly migrationRoot: string;
  readonly migrateFrom?: string;
}): Promise<ReleasedV071ApplicationDeploymentSource | undefined> {
  const graphPath = resolve(input.graphPath);
  if (!await exists(graphPath)) {
    if (input.migrateFrom) {
      throw new Error(`V09_MIGRATION_SOURCE_STATE_MISSING: --migrate-from ${input.migrateFrom} was supplied but no prior deployment graph exists at ${graphPath}.`);
    }
    return undefined;
  }
  const serializedSource = await readFile(graphPath, 'utf8');
  const graph = decodeReleasedOrCurrentApplicationDeploymentGraph(serializedSource);
  const stack = applicationAlchemyStackIdentity(graph.metadata.identity, graph.metadata.strategy);
  const sourceSnapshotPath = join(input.migrationRoot, 'sources', `${stack.key}.v071.json`);
  const [claim, state] = await Promise.all([
    inspectApplicationAlchemyStackIdentityClaim(input.stateRoot, stack),
    inspectApplicationAlchemyState({ root: input.stateRoot, stack: stack.key, stage: 'installation' }),
  ]);
  if (!claim && !state.exists) {
    if (input.migrateFrom) {
      throw new Error(`V09_MIGRATION_SOURCE_STATE_MISSING: --migrate-from ${input.migrateFrom} was supplied but no active Alchemy state exists for ${stack.key}.`);
    }
    return undefined;
  }
  if (!claim || !state.exists) {
    throw new Error(
      `V09_MIGRATION_SOURCE_STATE_MISSING: deployment ${stack.key} has only part of its Alchemy identity/state pair; repair or explicitly destroy it with the originating release.`,
    );
  }
  if (graph.metadata.compilerVersion === '0.9.0') {
    if (await exists(sourceSnapshotPath)) {
      if (input.migrateFrom !== '0.7.1') {
        throw new Error('V09_MIGRATION_SOURCE_RELEASE_UNQUALIFIED: a preserved v0.7.1 source snapshot is awaiting migration. Re-run with --migrate-from 0.7.1.');
      }
      const preservedSource = await readFile(sourceSnapshotPath, 'utf8');
      const source = decodeReleasedV071ApplicationDeploymentGraph(preservedSource);
      if (source.metadata.compilerVersion !== '0.6.0') {
        throw new Error(`V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: preserved source ${sourceSnapshotPath} is not compiler 0.6.0.`);
      }
      assertSameInstallation(source, graph);
      return {
        graphPath,
        graph: source,
        graphDigest: digestApplicationDeploymentGraph(source),
        baseline: releasedV071ApplicationDeploymentBaseline,
        sourceSnapshotPath,
        serializedSource: preservedSource,
      };
    }
    if (input.migrateFrom) {
      throw new Error(`V09_MIGRATION_SOURCE_RELEASE_UNQUALIFIED: deployment ${stack.key} is already a v0.9 graph and has no pending v0.7.1 source snapshot.`);
    }
    return undefined;
  }
  if (graph.metadata.compilerVersion !== '0.6.0') {
    throw new Error(
      `V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: persisted deployment graph compiler ${graph.metadata.compilerVersion} is not the exact released v0.7.1 migration codec. Destroy the unpublished development deployment with its originating checkout before redeploying.`,
    );
  }
  if (input.migrateFrom !== '0.7.1') {
    throw new Error(
      'V09_MIGRATION_SOURCE_RELEASE_UNQUALIFIED: compiler 0.6.0 cannot distinguish v0.7.0 from v0.7.1. Re-run with --migrate-from 0.7.1 only after verifying the active deployment was created by the coordinated v0.7.1 release.',
    );
  }
  await atomicWrite(sourceSnapshotPath, serializedSource);
  return {
    graphPath,
    graph,
    graphDigest: digestApplicationDeploymentGraph(graph),
    baseline: releasedV071ApplicationDeploymentBaseline,
    sourceSnapshotPath,
    serializedSource,
  };
}

export async function retireReleasedV071ApplicationDeploymentSource(
  source: ReleasedV071ApplicationDeploymentSource,
): Promise<string> {
  const retired = `${source.sourceSnapshotPath}.completed`;
  await rename(source.sourceSnapshotPath, retired).catch((cause: unknown) => {
    if (!isNotFound(cause)) throw cause;
  });
  return retired;
}

export interface PreparedApplicationDeploymentMigration {
  readonly run: ApplicationDeploymentMigrationRun;
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly provider: ApplicationDeploymentMigrationProvider;
  readonly artifactPath: string;
  advance(): Promise<ApplicationDeploymentMigrationRun>;
}

export function planReleasedV071ApplicationDeploymentMigration(input: {
  readonly source: ReleasedV071ApplicationDeploymentSource;
  readonly targetGraph: ApplicationDeploymentGraph;
  readonly targetPlan: ApplicationPlan;
  readonly targetStack: ApplicationAlchemyStackIdentity;
}): {
  readonly proposal: ReturnType<typeof proposeApplicationDeploymentMigration>;
  readonly proposalSource: string;
  readonly proposalDigest: string;
  readonly runId: string;
} {
  assertSameInstallation(input.source.graph, input.targetGraph);
  const proposal = proposeApplicationDeploymentMigration({
    source: {
      baseline: input.source.baseline,
      application: input.source.graph.metadata.identity.application,
      deploymentStateIdentity: `alchemy://${input.targetStack.key}/installation`,
      applicationArtifactDigest: input.source.graph.metadata.sourceGraphDigest,
      planDigest: input.source.graphDigest,
    },
    target: {
      release: '0.9.0',
      application: input.targetGraph.metadata.identity.application,
      profile: input.targetGraph.metadata.identity.profile,
      applicationArtifactDigest: input.targetGraph.metadata.sourceGraphDigest,
      applicationPlanSchema: input.targetPlan.schemaVersion,
      providerCatalogDigest: digestApplicationDeploymentValue(input.targetPlan.resolution as never),
      planDigest: sha256(canonicalJsonV1String(input.targetPlan)),
    },
    acceptedBaseline: releasedV071ApplicationDeploymentBaseline,
    sourceNodes: input.source.graph.nodes.map((node) => legacyNode(input.source.graph, node)),
    targetNodes: input.targetPlan.physical.nodes.map((node) => targetNode(input.targetGraph, input.targetPlan, node.deploymentNodeId)),
  });
  if (proposal.status !== 'ready') {
    throw new Error(
      `V09_MIGRATION_MAPPING_BLOCKED:\n${proposal.diagnostics.map(({ code, message }) => `- ${code}: ${message}`).join('\n')}`,
    );
  }
  const proposalSource = serializeApplicationDeploymentMigrationProposal(proposal);
  const proposalDigest = sha256(proposalSource);
  return {
    proposal,
    proposalSource,
    proposalDigest,
    runId: `v071-${input.targetStack.key}-${proposalDigest.slice(7, 19)}`,
  };
}

export async function writeApplicationDeploymentMigrationProposal(
  migrationRoot: string,
  planned: ReturnType<typeof planReleasedV071ApplicationDeploymentMigration>,
): Promise<string> {
  const path = join(migrationRoot, `${planned.runId}.proposal.json`);
  await atomicWrite(path, planned.proposalSource);
  return path;
}

export async function prepareReleasedV071ApplicationDeploymentMigration(input: {
  readonly source: ReleasedV071ApplicationDeploymentSource;
  readonly targetGraph: ApplicationDeploymentGraph;
  readonly targetPlan: ApplicationPlan;
  readonly targetDeployment: ApplicationAlchemyDeployment;
  readonly lease: ApplicationAlchemyLease;
  readonly stateRoot: string;
  readonly migrationRoot: string;
  readonly store: ApplicationDeploymentMigrationRunStore;
  readonly owner: string;
  readonly observeTargetReady: () => Promise<void>;
}): Promise<PreparedApplicationDeploymentMigration> {
  const sourceStack = input.targetDeployment.stack;
  const planned = planReleasedV071ApplicationDeploymentMigration({
    source: input.source,
    targetGraph: input.targetGraph,
    targetPlan: input.targetPlan,
    targetStack: sourceStack,
  });
  const { proposal, proposalDigest, runId } = planned;
  const run = await startApplicationDeploymentMigration({
    store: input.store,
    run: createApplicationDeploymentMigrationRun({
      id: runId,
      deployment: `${sourceStack.key}/installation`,
      proposalDigest,
      proposal,
    }),
  });
  const artifactPath = await writeApplicationDeploymentMigrationProposal(input.migrationRoot, planned);
  const provider = createV071AlchemyMigrationProvider({
    sourceGraph: input.source.graph,
    sourceStack,
    targetDeployment: input.targetDeployment,
    lease: input.lease,
    stateRoot: input.stateRoot,
    observeTargetReady: input.observeTargetReady,
  });
  return {
    run,
    store: input.store,
    provider,
    artifactPath,
    advance: () => advanceApplicationDeploymentMigration({
      store: input.store,
      provider,
      runId,
      owner: input.owner,
      // Provider deployment/readiness is bounded by the outer Alchemy lease;
      // the durable coordinator lease must not expire during that operation.
      leaseDurationMs: 30 * 60_000,
    }),
  };
}

function createV071AlchemyMigrationProvider(input: {
  readonly sourceGraph: ApplicationDeploymentGraph;
  readonly sourceStack: ApplicationAlchemyStackIdentity;
  readonly targetDeployment: ApplicationAlchemyDeployment;
  readonly lease: ApplicationAlchemyLease;
  readonly stateRoot: string;
  readonly observeTargetReady: () => Promise<void>;
}): ApplicationDeploymentMigrationProvider {
  let applied: ApplicationAlchemyApplyResult | undefined;
  let ready = false;
  const receipt = (
    context: Parameters<ApplicationDeploymentMigrationProvider['verifySource']>[0],
    operation: ApplicationDeploymentMigrationReceipt['operation'],
    outcome: ApplicationDeploymentMigrationReceipt['outcome'],
    details?: Readonly<Record<string, string | number | boolean | null>>,
  ): ApplicationDeploymentMigrationReceipt => ({
    id: sha256(canonicalJsonV1String({ operationId: context.operationId, outcome, details })).slice(7),
    operation,
    mapping: context.mapping.id,
    operationId: context.operationId,
    recordedAt: new Date().toISOString(),
    outcome,
    ...(context.expectedPhysicalIdentity && outcome === 'succeeded'
      ? { observedPhysicalIdentity: context.expectedPhysicalIdentity }
      : {}),
    ...(details ? { details } : {}),
  });
  return {
    async verifySource(context) {
      const [claim, state] = await Promise.all([
        inspectApplicationAlchemyStackIdentityClaim(input.stateRoot, input.sourceStack),
        inspectApplicationAlchemyState({ root: input.stateRoot, stack: input.sourceStack.key, stage: 'installation' }),
      ]);
      if (!claim || claim.key !== input.sourceStack.key || claim.digest !== input.sourceStack.digest || claim.canonical !== input.sourceStack.canonical) {
        throw new Error(`Legacy Alchemy identity ${input.sourceStack.key} is absent or does not match the released deployment graph.`);
      }
      if (claim.strategy && claim.strategy !== input.sourceGraph.metadata.strategy) {
        throw new Error(`Legacy Alchemy identity strategy ${claim.strategy} does not match ${input.sourceGraph.metadata.strategy}.`);
      }
      if (!state.exists || state.resourceCount === 0 || !state.hasStackOutput) {
        throw new Error(`Legacy Alchemy state ${input.sourceStack.key}/installation is incomplete and cannot be adopted safely.`);
      }
      return receipt(context, 'verifySource', 'succeeded', {
        identityClaimVersion: claim.version,
        stateResourceCount: state.resourceCount,
        stackOutputObserved: state.hasStackOutput,
      });
    },
    async prepareTarget(context) {
      return receipt(context, 'prepareTarget', 'succeeded', { targetPlanValidated: true });
    },
    async fenceSource(context) {
      if (
        input.lease.identity.key !== input.sourceStack.key
        || input.lease.identity.digest !== input.sourceStack.digest
      ) {
        throw new Error('Migration source fence does not hold the exact Alchemy stack lease.');
      }
      await input.lease.heartbeat();
      return receipt(context, 'fenceSource', 'succeeded', {
        authority: 'exclusive-alchemy-stack-lease',
        leaseOwner: input.lease.owner,
      });
    },
    async activateTarget(context) {
      applied ??= await input.targetDeployment.apply();
      return receipt(context, 'activateTarget', 'succeeded', {
        transaction: applied.transaction,
        declarations: applied.declarationCount,
      });
    },
    async observeTargetReady(context) {
      if (!ready) {
        await input.observeTargetReady();
        ready = true;
      }
      return receipt(context, 'observeTargetReady', 'succeeded', { authoritativeReadinessObserved: true });
    },
    async retireLegacy(context) {
      const state = await inspectApplicationAlchemyState({
        root: input.stateRoot,
        stack: input.sourceStack.key,
        stage: 'installation',
      });
      if (!state.exists || !state.hasStackOutput) {
        throw new Error('Target Alchemy state disappeared before legacy authority retirement completed.');
      }
      return receipt(context, 'retireLegacy', 'succeeded', { stateReconciledInPlace: true });
    },
    async rollbackTarget(context) {
      if (applied) {
        throw new Error('The preserved-resource migration crossed target authorization and must recover forward.');
      }
      return receipt(context, 'rollbackTarget', 'absent', { targetMutationObserved: false });
    },
    async reactivateSource(context) {
      return receipt(context, 'reactivateSource', 'succeeded', { sourceStateUnchanged: true });
    },
  };
}

function legacyNode(
  graph: ApplicationDeploymentGraph,
  node: ApplicationDeploymentNode,
): ApplicationLegacyDeploymentNode {
  return {
    id: node.id,
    semanticRequirement: node.id,
    capability: { interface: node.provider.interface },
    implementation: `${node.provider.implementation}@${node.provider.version}`,
    providerContract: providerContract(node),
    physicalIdentity: graphNodePhysicalIdentity(graph, node),
    lifecycle: migrationLifecycle(node),
    stateSchema: 'alchemy.local-state/v1',
    guarantees: nodeGuarantees(node),
    ...(node.lifecycle.deletion === 'retain' ? { retention: 'retain' } : {}),
    provenance: [deploymentNodeProvenance(node)],
  };
}

function targetNode(
  graph: ApplicationDeploymentGraph,
  plan: ApplicationPlan,
  deploymentNodeId: string,
): ApplicationTargetDeploymentNode {
  const node = graph.nodes.find(({ id }) => id === deploymentNodeId);
  if (!node) throw new Error(`ApplicationPlan physical node ${deploymentNodeId} has no deployment-graph node.`);
  return {
    id: deploymentNodeId,
    semanticRequirement: deploymentNodeId,
    implementation: implementationForNode(plan, node),
    providerContract: providerContract(node),
    physicalIdentity: graphNodePhysicalIdentity(graph, node),
    lifecycle: migrationLifecycle(node),
    stateSchema: 'alchemy.local-state/v1',
    guarantees: nodeGuarantees(node),
    ...(node.lifecycle.deletion === 'retain' ? { retention: 'retain' } : {}),
    provenance: [deploymentNodeProvenance(node)],
  };
}

function implementationForNode(
  plan: ApplicationPlan,
  node: ApplicationDeploymentNode,
): ApplicationCapabilityImplementationIdentity {
  const physical = plan.physical.nodes.find(({ deploymentNodeId }) => deploymentNodeId === node.id);
  const identity = physical?.implementations?.[0]?.identity;
  const implementation = plan.resolution.implementationPlan?.implementations.find(({ id }) => id === identity)?.identity;
  if (implementation) return implementation;
  const provenance = deploymentNodeProvenance(node);
  return {
    apiVersion: 'applik8s.implementationIdentity/v1alpha1',
    identityVersion: 1,
    canonical: applicationProviderIdentity({
      application: plan.application.application,
      capabilityInterface: node.provider.interface,
      nodeId: node.id,
    }),
    capability: { interface: node.provider.interface },
    provider: {
      package: '@applik8s/deployment-alchemy',
      export: node.provider.implementation,
      version: node.provider.version,
    },
    source: 'declaration',
    provenance,
    configurationDigest: node.configurationDigest,
  };
}

function graphNodePhysicalIdentity(
  graph: ApplicationDeploymentGraph,
  node: ApplicationDeploymentNode,
): ApplicationPhysicalIdentity {
  return {
    domain: 'provider',
    provider: 'alchemy',
    scope: [
      graph.metadata.identity.connection.digest,
      node.scope.namespace ?? '',
    ].map((value) => `${new TextEncoder().encode(value).length}:${value}`).join('|'),
    resourceType: `${node.provider.interface}/${node.kind}`,
    resourceId: node.id,
  };
}

function migrationLifecycle(node: ApplicationDeploymentNode): 'application' | 'shared' | 'external' | 'retained' {
  if (node.lifecycle.ownership === 'external') return 'external';
  if (node.lifecycle.deletion === 'retain') return 'retained';
  return node.lifecycle.ownership;
}

function providerContract(node: ApplicationDeploymentNode): string {
  return `${node.provider.interface}/${node.provider.implementation}@${node.provider.version}`;
}

function nodeGuarantees(node: ApplicationDeploymentNode): readonly string[] {
  return [
    `strategy:${node.capabilities.strategies.join(',')}`,
    `ownership:${node.lifecycle.ownership}`,
    `deletion:${node.lifecycle.deletion}`,
    ...node.outputs.map(({ name, type, persistence }) => `output:${name}:${type}:${persistence}`),
  ].sort();
}

function deploymentNodeProvenance(node: ApplicationDeploymentNode): ApplicationSourceProvenance {
  return sourceProvenance({
    origin: 'provider-plan',
    ...(node.source.file ? { module: node.source.file } : {}),
    symbol: node.source.semanticNodeId ?? node.id,
    generatedBy: `deployment-node:${node.id}`,
  });
}

function assertSameInstallation(source: ApplicationDeploymentGraph, target: ApplicationDeploymentGraph): void {
  const before = source.metadata.identity;
  const after = target.metadata.identity;
  if (
    before.connection.digest !== after.connection.digest
    || before.application !== after.application
    || before.controlPlaneNamespace !== after.controlPlaneNamespace
    || before.instance !== after.instance
    || source.metadata.strategy !== target.metadata.strategy
  ) {
    throw new Error('V09_MIGRATION_PHYSICAL_IDENTITY_CONFLICT: the automatic v0.7.1 upgrade requires the same application, cluster, namespace, instance, and deployment strategy.');
  }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function atomicWrite(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${source.trimEnd()}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

function isNotFound(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT');
}

/**
 * v0.7.1 predates the required runtime-access envelope. Migration decodes
 * that one exact historical shape and adds an empty planning-only envelope;
 * ordinary v0.9 graph decoding remains strict.
 */
export function decodeReleasedV071ApplicationDeploymentGraph(
  source: string,
): ApplicationDeploymentGraph {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) {
    throw new Error('V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: released deployment graph must be a JSON object.');
  }
  const keys = Object.keys(value).sort();
  const expected = ['apiVersion', 'edges', 'kind', 'metadata', 'nodes'];
  if (canonicalJsonV1String(keys) !== canonicalJsonV1String(expected)) {
    throw new Error(
      `V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: released v0.7.1 deployment graph has unexpected root fields ${keys.join(', ')}.`,
    );
  }
  const metadata = Reflect.get(value, 'metadata');
  if (!isRecord(metadata) || Reflect.get(metadata, 'compilerVersion') !== '0.6.0') {
    throw new Error('V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: released deployment graph is not compiler 0.6.0.');
  }
  const identity = Reflect.get(metadata, 'identity');
  const sourceGraphDigest = Reflect.get(metadata, 'sourceGraphDigest');
  if (
    !isRecord(identity)
    || typeof Reflect.get(identity, 'application') !== 'string'
    || typeof sourceGraphDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(sourceGraphDigest)
  ) {
    throw new Error('V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: released deployment metadata is malformed.');
  }
  const connection = Reflect.get(identity, 'connection');
  if (!isRecord(connection) || Reflect.get(connection, 'provider') !== 'kubernetes') {
    throw new Error('V09_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED: v0.7.1 automatic migration supports Kubernetes deployment state only.');
  }
  const runtimeAccess = {
    apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
    application: String(Reflect.get(identity, 'application')),
    target: 'kubernetes' as const,
    sourceGraphDigest: sourceGraphDigest as `sha256:${string}`,
    executions: [],
    workloads: [],
    diagnostics: [],
  };
  return decodeApplicationDeploymentGraph({
    ...value,
    runtimeAccess: {
      ...runtimeAccess,
      digest: applicationRuntimeAccessPlanDigest(runtimeAccess),
    },
  });
}

function decodeReleasedOrCurrentApplicationDeploymentGraph(
  source: string,
): ApplicationDeploymentGraph {
  const value: unknown = JSON.parse(source);
  if (isRecord(value) && !Object.hasOwn(value, 'runtimeAccess')) {
    return decodeReleasedV071ApplicationDeploymentGraph(source);
  }
  return decodeApplicationDeploymentGraph(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
