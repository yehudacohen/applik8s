// typecast-file-boundary: Migration tests construct deliberately incomplete persisted-state fixtures to verify fail-closed decoding.
import { describe, expect, it } from 'vitest';
import {
  type ApplicationCapabilityImplementationIdentity,
  type ApplicationDeploymentMigrationBaseline,
  type ApplicationDeploymentMigrationInput,
  ApplicationDeploymentMigrationProposalError,
  type ApplicationLegacyDeploymentNode,
  type ApplicationTargetDeploymentNode,
  applicationPhysicalIdentityKey,
  applicationProviderIdentity,
  proposeApplicationDeploymentMigration,
  serializeApplicationDeploymentMigrationProposal,
  sourceProvenance,
} from '../src/index.js';

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const provenance = sourceProvenance({
  origin: 'authored',
  module: 'src/application.ts',
  symbol: 'Application',
});
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

function implementation(id: string): ApplicationCapabilityImplementationIdentity {
  return {
    apiVersion: 'applik8s.implementationIdentity/v1alpha1',
    identityVersion: 1,
    canonical: applicationProviderIdentity({
      application: 'migration-test',
      capabilityInterface: 'TransactionalDatabase',
      nodeId: id,
    }),
    capability: { interface: 'TransactionalDatabase' },
    provider: { package: '@applik8s/runtime-postgres', export: 'postgres', version: '0.9.0' },
    source: 'named',
    explicitName: id,
    provenance,
    configurationDigest: sha('d'),
  };
}

function sourceNode(overrides: Partial<ApplicationLegacyDeploymentNode> = {}): ApplicationLegacyDeploymentNode {
  return {
    id: 'legacy-database',
    semanticRequirement: 'application.database',
    capability: { interface: 'TransactionalDatabase' },
    implementation: 'postgres-v071',
    providerContract: 'postgres.lifecycle/v1',
    physicalIdentity: {
      domain: 'kubernetes',
      cluster: 'cluster-a',
      group: 'postgresql.cnpg.io',
      kind: 'Cluster',
      namespace: 'application',
      name: 'database',
    },
    lifecycle: 'application',
    stateSchema: 'alchemy.kubernetes/v1',
    guarantees: ['durable', 'ready'],
    provenance: [provenance],
    ...overrides,
  };
}

function sourceNodeWithoutSemantic(
  overrides: Partial<Omit<ApplicationLegacyDeploymentNode, 'semanticRequirement'>> = {},
): ApplicationLegacyDeploymentNode {
  const { semanticRequirement: _semanticRequirement, ...source } = sourceNode();
  return { ...source, ...overrides };
}

function targetNode(overrides: Partial<ApplicationTargetDeploymentNode> = {}): ApplicationTargetDeploymentNode {
  return {
    id: 'database',
    semanticRequirement: 'application.database',
    implementation: implementation('database'),
    providerContract: 'postgres.lifecycle/v1',
    physicalIdentity: {
      domain: 'kubernetes',
      cluster: 'cluster-a',
      group: 'postgresql.cnpg.io',
      kind: 'Cluster',
      namespace: 'application',
      name: 'database',
    },
    lifecycle: 'application',
    stateSchema: 'alchemy.kubernetes/v1',
    guarantees: ['durable', 'ready'],
    provenance: [provenance],
    ...overrides,
  };
}

function input(overrides: Partial<ApplicationDeploymentMigrationInput> = {}): ApplicationDeploymentMigrationInput {
  return {
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
    sourceNodes: [sourceNode()],
    targetNodes: [targetNode()],
    ...overrides,
  };
}

describe('read-only application deployment migration proposals', () => {
  it('preserves a compatible physical identity through a fenced authority handoff', () => {
    const proposal = proposeApplicationDeploymentMigration(input());

    expect(proposal).toMatchObject({
      schemaVersion: 'applik8s.deploymentMigrationProposal/v1alpha1',
      mode: 'read-only',
      mutationAuthorized: false,
      status: 'ready',
      mappings: [{
        sourceNode: 'legacy-database',
        targetNode: 'database',
        disposition: 'preserve',
        lifecycleTransfer: {
          mode: 'fenced-handoff',
          requiresSourceFence: true,
          requiresPhysicalIdentityReread: true,
          commitFrontier: 'target-authorized',
        },
      }],
    });
    expect(serializeApplicationDeploymentMigrationProposal(proposal)).toBe(
      serializeApplicationDeploymentMigrationProposal(proposeApplicationDeploymentMigration(input())),
    );
  });

  it('uses Kubernetes group identity independently of served API version', () => {
    const alphaRepresentation = {
      domain: 'kubernetes' as const,
      cluster: 'cluster-a',
      group: 'example.com',
      kind: 'Widget',
      namespace: 'application',
      name: 'shared',
    };
    const betaRepresentation = { ...alphaRepresentation };

    expect(applicationPhysicalIdentityKey(alphaRepresentation)).toBe(applicationPhysicalIdentityKey(betaRepresentation));
    expect(() => applicationPhysicalIdentityKey({
      ...alphaRepresentation,
      group: '',
      kind: 'ConfigMap',
    })).not.toThrow();
  });

  it('blocks ambiguous semantic targets before any mutation can be authorized', () => {
    const proposal = proposeApplicationDeploymentMigration(input({
      targetNodes: [targetNode(), targetNode({ id: 'database-replica', implementation: implementation('database-replica') })],
    }));

    expect(proposal.status).toBe('blocked');
    expect(proposal.mutationAuthorized).toBe(false);
    expect(proposal.mappings).toEqual([]);
    expect(proposal.diagnostics).toContainEqual(expect.objectContaining({ code: 'MIGRATION_MAPPING_AMBIGUOUS' }));
  });

  it('requires an explicit qualified provider migration when physical identity changes', () => {
    const replacement = targetNode({
      physicalIdentity: {
        domain: 'aws',
        account: '123456789012',
        region: 'us-east-1',
        resourceType: 'rds.cluster',
        resourceId: 'application-database',
      },
    });
    const blocked = proposeApplicationDeploymentMigration(input({ targetNodes: [replacement] }));
    expect(blocked.status).toBe('blocked');
    expect(blocked.diagnostics).toContainEqual(expect.objectContaining({ code: 'MIGRATION_PHYSICAL_IDENTITY_CONFLICT' }));

    const ready = proposeApplicationDeploymentMigration(input({
      targetNodes: [replacement],
      directives: [{
        sourceNode: 'legacy-database',
        targetNode: 'database',
        disposition: 'replace',
        reason: 'move to the selected production provider',
        providerMigration: 'postgres.kubernetes-to-rds/v1',
        compatibilityReceipts: ['postgres.export-import/v1'],
      }],
    }));
    expect(ready.status).toBe('ready');
    expect(ready.mappings[0]).toMatchObject({
      disposition: 'replace',
      lifecycleTransfer: { mode: 'migration-exclusive', commitFrontier: 'target-ready' },
      consequences: ['physical identity changes', 'provider readiness is the commit frontier'],
    });
  });

  it('never converts external or retained resources into application ownership by inference', () => {
    const externalSource = sourceNodeWithoutSemantic({ id: 'legacy-external', lifecycle: 'external' });
    const retainedSource = sourceNodeWithoutSemantic({ id: 'legacy-data', lifecycle: 'retained', retention: 'retain' });
    const proposal = proposeApplicationDeploymentMigration(input({
      sourceNodes: [externalSource, retainedSource],
      targetNodes: [],
      directives: [
        { sourceNode: 'legacy-external', disposition: 'external', reason: 'binding remains externally owned' },
        { sourceNode: 'legacy-data', disposition: 'retain', reason: 'data survives deployment migration' },
      ],
    }));

    expect(proposal.status).toBe('ready');
    expect(proposal.mappings.map(({ disposition }) => disposition)).toEqual(['retain', 'external']);
    expect(proposal.mappings.every(({ lifecycleTransfer }) => lifecycleTransfer.mode === 'none')).toBe(true);

    const preservedExternal = proposeApplicationDeploymentMigration(input({
      sourceNodes: [sourceNode({ lifecycle: 'external' })],
      targetNodes: [targetNode({ lifecycle: 'external' })],
    }));
    expect(preservedExternal.status).toBe('ready');
    expect(preservedExternal.mappings[0]).toMatchObject({
      disposition: 'preserve',
      lifecycleTransfer: { mode: 'none', sourceAuthority: 'external', targetAuthority: 'external' },
    });
  });

  it('rejects partial, floating, or codec-mismatched release baselines', () => {
    expect(() => proposeApplicationDeploymentMigration(input({
      acceptedBaseline: { ...baseline, providerCatalogDigest: sha('9') },
    }))).toThrowError(ApplicationDeploymentMigrationProposalError);
    expect(() => proposeApplicationDeploymentMigration(input({
      source: {
        ...input().source,
        baseline: { ...baseline, release: '0.7.x', gitTag: 'v0.7.x' },
      },
    }))).toThrow(/exact semantic-version release/u);
  });
});
