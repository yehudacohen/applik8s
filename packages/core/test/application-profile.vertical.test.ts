import {
  type ApplicationGraph,
  type ApplicationProfileDescriptor,
  type ApplicationProfileProviderSelectionContract,
  planApplicationProfileTransitions,
  profileTransitionAcknowledgement,
  validateApplicationProfileDescriptor,
  validateApplicationProfileProviderSelection,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';

const descriptor: ApplicationProfileDescriptor = {
  apiVersion: 'applik8s.profile/v1alpha1',
  id: 'profile:example:profile',
  application: 'example',
  discriminator: 'profile',
  schemaRevision: 'v1alpha1',
  variants: ['starter', 'dedicated'],
  installationIdentity: 'installation:example',
};

function selection(
  transitions: ApplicationProfileProviderSelectionContract['transitions'],
): ApplicationProfileProviderSelectionContract {
  return {
    apiVersion: 'applik8s.profileProvider/v1alpha1',
    profileId: descriptor.id,
    descriptor,
    qualification: {
      apiVersion: 'applik8s.providerQualification/v1alpha1',
      capability: 'TransactionalDatabase',
      name: 'primary',
      compatibilityRevision: 'v1alpha1',
      key: 'TransactionalDatabase@v1alpha1:primary',
    },
    branches: descriptor.variants.map((variant) => ({
      variant,
      implementation: 'postgres',
      credentialReferences: [],
      resources: [],
      provenance: 'application',
    })),
    transitions,
    selectedBy: 'schema.spec.profile',
    inactiveBranches: 'plan-only',
  };
}

function graph(
  profile: ApplicationProfileProviderSelectionContract,
): ApplicationGraph {
  // typecast-test-fixture: transition planning reads only the normalized
  // provider node; graph-wide validation is covered by application-graph tests.
  return {
    apiVersion: 'applik8s.applicationGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'example' },
    nodes: [
      {
        id: 'provider.transactional-database-primary',
        kind: 'provider',
        name: 'primary',
        stability: 'stable',
        interface: 'TransactionalDatabase',
        implementation: 'profile-selection',
        config: { profile },
      },
    ],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {},
  } as unknown as ApplicationGraph;
}

describe('application profile contracts', () => {
  it('accepts a complete fail-closed transition matrix', () => {
    expect(validateApplicationProfileDescriptor(descriptor)).toEqual([]);
    expect(
      validateApplicationProfileProviderSelection(
        selection([
          {
            from: 'starter',
            to: 'dedicated',
            kind: 'unsupported',
            destructive: false,
            authority: 'external',
            drainDependents: true,
            rollback: 'unsupported',
          },
          {
            from: 'dedicated',
            to: 'starter',
            kind: 'unsupported',
            destructive: false,
            authority: 'external',
            drainDependents: true,
            rollback: 'unsupported',
          },
        ]),
        descriptor,
      ),
    ).toEqual([]);
  });

  it('reports missing and unsafe destructive transitions', () => {
    expect(
      validateApplicationProfileProviderSelection(
        selection([
          {
            from: 'starter',
            to: 'dedicated',
            kind: 'replace',
            destructive: true,
            authority: 'source-until-cutover',
            drainDependents: true,
            rollback: 'manual',
          },
        ]),
        descriptor,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('requires acknowledgement'),
        expect.stringContaining('no transition policy for dedicated -> starter'),
      ]),
    );
  });

  it('plans fresh, unchanged, and non-destructive profile transitions', () => {
    const profile = selection([
      {
        from: 'starter',
        to: 'dedicated',
        kind: 'replicate-cutover',
        destructive: false,
        authority: 'source-until-cutover',
        drainDependents: true,
        rollback: 'automatic',
      },
      {
        from: 'dedicated',
        to: 'starter',
        kind: 'unsupported',
        destructive: false,
        authority: 'external',
        drainDependents: true,
        rollback: 'unsupported',
      },
    ]);
    const installation = { namespace: 'control', name: 'example' };
    const fresh = planApplicationProfileTransitions({
      graph: graph(profile),
      installation,
      desiredInstallationSpec: { profile: 'starter' },
    });
    expect(fresh.mode).toBe('fresh');
    expect(fresh.entries).toEqual([]);

    const unchanged = planApplicationProfileTransitions({
      graph: graph(profile),
      installation,
      previousInstallationSpec: { profile: 'starter' },
      desiredInstallationSpec: { profile: 'starter' },
    });
    expect(unchanged.mode).toBe('unchanged');

    const transition = planApplicationProfileTransitions({
      graph: graph(profile),
      installation,
      previousInstallationSpec: { profile: 'starter' },
      desiredInstallationSpec: { profile: 'dedicated' },
    });
    expect(transition.mode).toBe('transition');
    expect(transition.entries).toMatchObject([
      {
        qualification: 'TransactionalDatabase@v1alpha1:primary',
        from: 'starter',
        to: 'dedicated',
        transition: { kind: 'replicate-cutover' },
      },
    ]);
    expect(transition.identityInput).toMatchObject({
      installation,
      mode: 'transition',
    });
  });

  it('requires an exact installation-scoped acknowledgement before a destructive transition', () => {
    const profile = selection([
      {
        from: 'starter',
        to: 'dedicated',
        kind: 'replace',
        destructive: true,
        acknowledgement: 'delete-local-data',
        authority: 'source-until-cutover',
        drainDependents: true,
        rollback: 'manual',
      },
      {
        from: 'dedicated',
        to: 'starter',
        kind: 'unsupported',
        destructive: false,
        authority: 'external',
        drainDependents: true,
        rollback: 'unsupported',
      },
    ]);
    const installation = { namespace: 'control', name: 'example' };
    const acknowledgement = profileTransitionAcknowledgement(
      installation,
      profile,
      profile.transitions[0]!,
    );
    const request = {
      graph: graph(profile),
      installation,
      previousInstallationSpec: { profile: 'starter' },
      desiredInstallationSpec: { profile: 'dedicated' },
    } as const;
    expect(() => planApplicationProfileTransitions(request)).toThrow(
      acknowledgement,
    );
    const plan = planApplicationProfileTransitions({
      ...request,
      acknowledgements: [acknowledgement],
    });
    expect(plan.acknowledgements).toEqual([acknowledgement]);
    expect(plan.identityInput).toMatchObject({
      acknowledgements: [acknowledgement],
    });
    expect(() =>
      planApplicationProfileTransitions({
        ...request,
        acknowledgements: [`${acknowledgement}-stale`],
      }),
    ).toThrow('requires --acknowledge');
  });

  it('rejects unsupported transitions and acknowledgements on fresh plans', () => {
    const profile = selection([
      {
        from: 'starter',
        to: 'dedicated',
        kind: 'unsupported',
        destructive: false,
        authority: 'external',
        drainDependents: true,
        rollback: 'unsupported',
      },
      {
        from: 'dedicated',
        to: 'starter',
        kind: 'unsupported',
        destructive: false,
        authority: 'external',
        drainDependents: true,
        rollback: 'unsupported',
      },
    ]);
    const installation = { namespace: 'control', name: 'example' };
    expect(() =>
      planApplicationProfileTransitions({
        graph: graph(profile),
        installation,
        previousInstallationSpec: { profile: 'starter' },
        desiredInstallationSpec: { profile: 'dedicated' },
      }),
    ).toThrow('does not support');
    expect(() =>
      planApplicationProfileTransitions({
        graph: graph(profile),
        installation,
        desiredInstallationSpec: { profile: 'starter' },
        acknowledgements: ['stale'],
      }),
    ).toThrow('fresh installation');
  });
});
