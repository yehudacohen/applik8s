import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runApplicationTargetPlan } from '../src/application-target-plan-command.js';

describe('target-native planning', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('emits a canonical AWS plan without consulting Kubernetes or applying effects', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'applik8s-aws-plan-'));
    roots.push(cwd);
    const stdout: string[] = [];
    const stderr: string[] = [];
    let childCalls = 0;
    let buildExecutionTarget: string | undefined;
    const instancePath = join(cwd, 'application.yaml');
    await writeFile(instancePath, [
      'apiVersion: applications.applik8s.dev/v1alpha1',
      'kind: PlanProofInstallation',
      'metadata:',
      '  name: plan-proof',
      '  namespace: plan-proof-system',
      'spec: {}',
      '',
    ].join('\n'));
    const result = await runApplicationTargetPlan('src/app.ts', {
      target: 'aws', environment: 'production', region: 'us-east-1', accountId: '123456789012',
      availabilityZones: ['us-east-1a', 'us-east-1b'], outDir: '.plans', skipAppBuild: true, format: 'text',
      instance: instancePath,
    }, { cwd, stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message) }, {
      runChild: async () => { childCalls += 1; return 0; },
      runBuild: async (_entrypoint, options) => {
        buildExecutionTarget = options.executionTarget;
        const directory = resolve(cwd, options.outDir ?? '', 'typekro');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'application-graph.json'), JSON.stringify(graph()), 'utf8');
        await writeFile(join(directory, 'typekro-composition.json'), JSON.stringify({
          apiVersion: 'applik8s.dev/v1alpha1',
          kind: 'TypeKroCompositionBundle',
          spec: {
            applicationGraph: {
              path: join(directory, 'application-graph.json'),
            },
          },
        }), 'utf8');
        await writeFile(join(directory, 'resources.json'), JSON.stringify([{
          apiVersion: 'kro.run/v1alpha1',
          kind: 'ResourceGraphDefinition',
          metadata: { name: 'plan-proof' },
          spec: {
            schema: {
              group: 'applications.applik8s.dev',
              apiVersion: 'v1alpha1',
              kind: 'PlanProofInstallation',
            },
          },
        }]), 'utf8');
        return 0;
      },
    });

    expect(result).toBe(0);
    expect(childCalls).toBe(0);
    expect(buildExecutionTarget).toBe('aws');
    expect(stderr).toEqual([]);
    expect(stdout.join('\n')).toContain('Target: aws (production)');
    expect(stdout.join('\n')).toContain('Alchemy AWS native plan:');
    const artifact = JSON.parse(await readFile(join(cwd, '.plans', 'production.aws.json'), 'utf8'));
    expect(artifact).toMatchObject({ apiVersion: 'applik8s.awsPlan/v1alpha1', region: 'us-east-1', accountId: '123456789012' });
    expect(artifact.runtimeArtifacts).toEqual([]);
    const applicationPlan = JSON.parse(await readFile(join(cwd, '.plans', 'production.application-plan.json'), 'utf8'));
    expect(applicationPlan).toMatchObject({
      schemaVersion: 'applik8s.applicationPlan/v1alpha1',
      sourceGraphVersion: 'applik8s.appGraph/v1alpha1',
      target: {
        target: 'aws',
        profile: 'production',
        lifecycleAuthority: 'alchemy',
        attributes: {
          cluster: '123456789012/us-east-1',
          connectionProvider: 'aws',
        },
      },
      physical: {
        nativePlans: [expect.objectContaining({ authority: 'alchemy', contentDigest: artifact.digest })],
      },
    });
    expect(applicationPlan.physical.nodes).toHaveLength(artifact.resources.length);
  });
});

function graph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'plan-proof' },
    nodes: [{ id: 'provider.ObjectStorage', kind: 'provider', name: 'ObjectStorage', stability: 'stable', interface: 'ObjectStorage', implementation: 's3' }],
    edges: [], providerRequirements: [], providerBindings: [],
    compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
  };
}
