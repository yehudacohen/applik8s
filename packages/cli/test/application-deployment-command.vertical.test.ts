// typecast-file-boundary: deployment-admission fixtures intentionally pass an invalid canonical plan to prove pre-effect fail-closed behavior.
import { describe, expect, it } from 'vitest';
import { assertDeployableApplicationPlan } from '../src/application-deployment-command.js';

describe('generated Application deployment admission', () => {
  it('fails closed on an invalid canonical plan for ordinary deploys as well as plan-only runs', () => {
    const diagnostics: string[] = [];

    expect(() =>
      assertDeployableApplicationPlan(
        {
          schemaVersion: 'invalid',
          sourceGraphVersion: 'applik8s.appGraph/v1alpha1',
          application: {
            apiVersion: 'applik8s.foundation/v1alpha1',
            kind: 'application',
            id: 'applik8s://applications/example',
            application: 'example',
            semanticKey: 'example',
          },
          target: {
            apiVersion: 'applik8s.target/v1alpha1',
            identity: {
              apiVersion: 'applik8s.foundation/v1alpha1',
              kind: 'target',
              id: 'applik8s://applications/example/targets/kubernetes',
              application: 'example',
              semanticKey: 'kubernetes',
              parentId: 'applik8s://applications/example',
            },
            target: 'kubernetes',
            profile: 'starter',
            lifecycleAuthority: 'alchemy',
            attributes: {},
          },
          generatedAt: '2026-08-31T00:00:00.000Z',
          sourceDigest: `sha256:${'0'.repeat(64)}`,
          identities: [
            {
              apiVersion: 'applik8s.foundation/v1alpha1',
              kind: 'application',
              id: 'applik8s://applications/example',
              application: 'example',
              semanticKey: 'example',
            },
            {
              apiVersion: 'applik8s.foundation/v1alpha1',
              kind: 'target',
              id: 'applik8s://applications/example/targets/kubernetes',
              application: 'example',
              semanticKey: 'kubernetes',
              parentId: 'applik8s://applications/example',
            },
          ],
          semantic: {
            nodes: [], edges: [], executions: [], authority: [], dataFlows: [],
            state: [], exposures: [], observability: [], runtimeAccess: [],
          },
          resolution: { capabilities: [] },
          physical: { nodes: [], edges: [], nativePlans: [] },
          diagnostics: [],
          estimates: [],
          evidence: [],
        // typecast: deliberately pass an invalid envelope through deployment
        // admission to prove ordinary effectful deploys fail closed.
        } as never,
        { stderr: (message) => diagnostics.push(message) },
      )
    ).toThrow(/Canonical ApplicationPlan is not deployable/u);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('PLAN_ENVELOPE_INVALID'),
    ]));
  });
});
