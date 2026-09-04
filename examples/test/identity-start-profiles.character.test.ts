import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { application as externalProviders } from '../../packages/e2e/test/fixtures/v07-external-providers/src/application';

describe('maintained Identity Start deployment profiles', () => {
  it('uses the maintained complete Agentic assembly module instead of reconstructing partial profiles', async () => {
    const source = await readFile(
      'examples/identity-start/src/providers.ts',
      'utf8',
    );
    expect(source).toContain('application.include(agenticProfilesWith({');
    expect(source).not.toContain('configureAgenticProfiles(application');
  });

  it('routes the provider-only External fixture without inventing an application host', () => {
    const plan = externalProviders.implementationPlan('external-providers');
    expect(plan.bindings).toEqual([
      expect.objectContaining({
        capability: expect.objectContaining({
          interface: 'WorkflowEngine@v1alpha1',
        }),
      }),
    ]);
    expect(plan.implementations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deploymentFamily: 'kubernetes' }),
      ]),
    );
    expect(
      plan.bindings.some(({ capability }) =>
        capability.interface === 'ApplicationHost@v1alpha1'),
    ).toBe(false);
  });

  it('keeps every maintained Kubernetes lifecycle command profile-explicit', async () => {
    const scripts = [
      'scripts/run-identity-start-starter-live.ts',
      'scripts/run-identity-start-dedicated-live.ts',
      'scripts/run-identity-start-external-live.ts',
      'scripts/run-agentic-start-starter-live.ts',
      'scripts/run-agentic-product-starter-live.ts',
      'scripts/run-v09-chirp-kubernetes-live.ts',
    ];

    for (const path of scripts) {
      const source = await readFile(path, 'utf8');
      const lifecycleCommands = source.matchAll(
        /['"](?:deploy|destroy)['"]([\s\S]{0,220}?)['"]--context['"]/gu,
      );
      for (const command of lifecycleCommands) {
        expect(command[0], `${path} contains a profile-implicit lifecycle command`)
          .toMatch(/['"]--profile['"]/u);
      }
    }
  });
});
