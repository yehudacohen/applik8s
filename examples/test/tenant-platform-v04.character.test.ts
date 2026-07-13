import { applicationGraphFor } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { createTenantPlatformExample, createTenantPlatformV04Example } from '../tenant-platform.js';

describe('Tenant Platform v0.4 longitudinal benchmark', () => {
  it('adds one typed account behavior declaration and infers the durable graph plus workloads', () => {
    const example = createTenantPlatformV04Example({ namespace: 'tenant-v04' });
    const graph = applicationGraphFor(example.composition);

    expect(example.commands?.renameAccount).toMatchObject({
      kind: 'applicationModelCommand',
      command: 'tenant-account.rename.v1',
      model: 'Account',
      processor: 'Account-commands',
      send: expect.any(Function),
      execute: expect.any(Function),
    });
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'tenant-account.rename.v1' }),
      expect.objectContaining({ kind: 'event', name: 'tenant-account.changed.v1' }),
      expect.objectContaining({
        kind: 'commandHandler',
        ordering: 'serial',
        missing: 'reject',
        effectBoundary: 'transactionSafeOnly',
        effectEnforcement: {
          sourceAnalysis: 'closedStructuralAllowlist',
          runtimeMembrane: 'asyncContextAmbientIo',
          externalEffects: 'outboxOrTaskOnly',
        },
        projectionReadiness: {
          submissionAcknowledgement: 'transportOnly',
          durableResultAuthority: 'postgresCommandResults',
          duplicateRecovery: 'idempotentRedelivery',
          correlation: 'commandCorrelationCausation',
          resultRevisionAuthority: 'postgresCommandResults',
          stateRevisionAuthority: 'modelRevision',
          reconciliationLink: 'modelRevisionWhenPresent',
        },
        transaction: expect.objectContaining({ history: [{ nodeId: 'model.account' }], outbox: [{ nodeId: 'event.tenant-account.changed.v1' }] }),
      }),
      expect.objectContaining({
        kind: 'processor',
        name: 'Account-commands',
        runtime: 'node',
        generatedResources: expect.arrayContaining([
          expect.objectContaining({ resource: expect.objectContaining({ kind: 'Deployment', namespace: 'tenant-v04' }) }),
          expect.objectContaining({ resource: expect.objectContaining({ kind: 'Consumer', namespace: 'tenant-v04' }) }),
        ]),
      }),
      expect.objectContaining({
        kind: 'permission',
        name: 'tenant-controller-permissions',
        mode: 'explicit',
        rules: [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get', 'list'] }],
      }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ interface: 'EventLog', purpose: 'eventLog', consumer: { nodeId: 'processor.account-commands' } }),
    ]));
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'processor', name: 'Account-commands', deployment: expect.objectContaining({ replicas: 2, concurrency: 4, maxAckPending: 8, disruption: { maxUnavailable: 1 } }) }),
    ]));
    expect(graph ? validateApplicationGraphStructure(graph) : []).toEqual([]);
  });

  it('keeps the v0.3 baseline free of v0.4 transport resources', () => {
    const baseline = createTenantPlatformExample();
    const graph = applicationGraphFor(baseline.composition);
    expect(baseline.commands).toBeUndefined();
    expect(graph?.nodes.some((node) => node.kind === 'processor')).toBe(false);
  });
});
