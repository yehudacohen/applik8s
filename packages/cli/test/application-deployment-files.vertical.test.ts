import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readExplicitApplicationInstallationSpec,
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from '../src/application-deployment-files.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated Application deletion identity', () => {
  it('recovers the owned root from persisted Alchemy state after instance YAML is regenerated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-delete-identity-'));
    temporaryDirectories.push(root);
    const directory = join(root, 'typekro');
    await mkdir(join(directory, 'instances'), { recursive: true });
    const bundlePath = join(directory, 'typekro-composition.json');
    await writeFile(bundlePath, '{}\n');
    await writeFile(
      join(directory, 'application-graph.json'),
      JSON.stringify({ metadata: { name: 'documents' } }),
    );
    await writeFile(
      join(directory, 'resources.json'),
      JSON.stringify([
        {
          apiVersion: 'kro.run/v1alpha1',
          kind: 'ResourceGraphDefinition',
          metadata: { name: 'documents' },
          spec: {
            schema: {
              group: 'documents.applik8s.dev',
              apiVersion: 'v1alpha1',
              kind: 'Documents',
            },
          },
        },
      ]),
    );
    await writeFile(
      join(directory, 'application-deployment-graph.json'),
      JSON.stringify({
        metadata: {
          identity: {
            instance: 'documents-starter',
            controlPlaneNamespace: 'documents-control',
          },
        },
      }),
    );
    await writeFile(
      join(directory, 'instances', 'singleton.yaml'),
      [
        'apiVersion: platform.applik8s.dev/v1alpha1',
        'kind: SharedRuntime',
        'metadata:',
        '  name: shared-runtime',
        '  namespace: platform-system',
        '',
      ].join('\n'),
    );

    await expect(
      resolveGeneratedApplicationDeleteTarget(bundlePath, {}),
    ).resolves.toEqual({
      apiVersion: 'documents.applik8s.dev/v1alpha1',
      kind: 'Documents',
      instanceName: 'documents-starter',
      controlPlaneNamespace: 'documents-control',
      applicationInstance: true,
      resourceGraphDefinitionName: 'documents',
    });
  });
});

describe('generated Application instance staging', () => {
  it('reads the authored precompile view and removes provider-owned artifact bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-precompile-instance-'));
    temporaryDirectories.push(root);
    const instancePath = join(root, 'application.yaml');
    await writeFile(instancePath, [
      'apiVersion: applications.applik8s.dev/v1alpha1',
      'kind: PrecompileFixture',
      'metadata:',
      '  name: fixture',
      '  namespace: control-plane',
      'spec:',
      '  name: workload-system',
      '  profile: starter',
      '  typekroArtifactBindings: {}',
      '',
    ].join('\n'));

    await expect(readExplicitApplicationInstallationSpec(instancePath)).resolves.toEqual({
      name: 'workload-system',
      profile: 'starter',
    });
  });

  it('keeps the assembly profile independent from the installation capacity profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-instance-profile-'));
    temporaryDirectories.push(root);
    const sourceDirectory = join(root, 'src');
    const outputDirectory = join(root, '.applik8s', 'typekro');
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"name":"profile-fixture"}\n');
    const entrypoint = join(sourceDirectory, 'application.ts');
    await writeFile(entrypoint, 'export {};\n');
    const graphPath = join(outputDirectory, 'application-graph.json');
    await writeFile(graphPath, JSON.stringify({ metadata: { name: 'profile-fixture' } }));
    const bundlePath = join(outputDirectory, 'typekro-composition.json');
    await writeFile(bundlePath, JSON.stringify({
      spec: { applicationGraph: { path: graphPath } },
    }));
    await writeFile(join(outputDirectory, 'resources.json'), JSON.stringify([{
      apiVersion: 'kro.run/v1alpha1',
      kind: 'ResourceGraphDefinition',
      metadata: { name: 'profile-fixture' },
      spec: {
        schema: {
          group: 'profile-fixture.applik8s.dev',
          apiVersion: 'v1alpha1',
          kind: 'ProfileFixture',
        },
      },
    }]));
    const instancePath = join(root, 'application.yaml');
    await writeFile(instancePath, [
      'apiVersion: profile-fixture.applik8s.dev/v1alpha1',
      'kind: ProfileFixture',
      'metadata:',
      '  name: profile-fixture',
      '  namespace: default',
      'spec:',
      '  name: profile-fixture',
      '  profile: starter',
      '',
    ].join('\n'));

    const staged = await stageExplicitApplicationInstance(
      entrypoint,
      bundlePath,
      instancePath,
    );

    expect(staged.spec).toMatchObject({ name: 'profile-fixture', profile: 'starter' });
    expect(await readFile(staged.path, 'utf8')).toContain('profile: starter');
  });
});
