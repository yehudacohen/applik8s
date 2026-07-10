import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

describe('applik8s CLI', () => {
  it('keeps TypeKro package subpaths external to the Node build runner', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const runner = await readFile(join(testDir, '..', 'src', 'node-build-runner.mjs'), 'utf8');

    expect(runner).toContain("'typekro/*'");
  });

  it('prints help for the thin command surface', async () => {
    const output: string[] = [];

    const code = await runCli(['--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('build [options] <entrypoint>');
    expect(output.join('\n')).toContain('replay');
  });

  it('prints nested replay help through Commander', async () => {
    const output: string[] = [];

    const code = await runCli(['replay', 'inspect', '--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Usage: applik8s replay inspect [options] <artifact>');
    expect(output.join('\n')).toContain('--bundle-dir <dir>');
  });

  it('explains diagnostic reasons through the shared taxonomy', async () => {
    const output: string[] = [];

    const code = await runCli(['explain', 'UndeclaredPermission'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('UndeclaredPermission (rbac)');
    expect(output.join('\n')).toContain('Effects: none');
  });

  it('fails closed for unknown diagnostic reasons', async () => {
    const output: string[] = [];

    const code = await runCli(['explain', 'NotAReason'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('No diagnostic advice is registered');
  });

  it('builds the documented ImageJob example through the CLI', async () => {
    const output: string[] = [];
    const outDir = join(process.cwd(), 'dist', 'test-cli-build');
    await rm(outDir, { recursive: true, force: true });

    const code = await runCli(['build', 'examples/imagejob.ts', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Built image-pipeline');
    const manifest = JSON.parse(await readFile(join(outDir, 'operator-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ metadata: { name: 'image-pipeline' } });

    await rm(outDir, { recursive: true, force: true });
  }, 120_000);

  it('builds the documented ImageJob through the isolated Node runner', async () => {
    const outDir = join(process.cwd(), 'dist', 'test-node-runner-build');
    await rm(outDir, { recursive: true, force: true });
    const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'node-build-runner.mjs');
    const request = JSON.stringify({
      cwd: process.cwd(),
      entrypoint: 'examples/imagejob.ts',
      options: { outDir },
    });

    try {
      const { stdout } = await execFileAsync(process.execPath, [runner, request], { cwd: process.cwd() });
      expect(stdout).toContain('Built image-pipeline');
      await expect(readFile(join(outDir, 'operator-manifest.json'), 'utf8')).resolves.toContain('image-pipeline');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('builds an exported TypeKro composition through the CLI', async () => {
    const output: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-typekro-'));
    try {
      const entrypoint = join(dir, 'media-stack.mjs');
      const outDir = join(dir, 'dist');
      await writeFile(entrypoint, `
        import { type } from 'arktype';
        import { sdk, typeKro } from '@applik8s/applik8s';

        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: {
            type: 'object',
            required: ['sourceUrl', 'formats'],
            additionalProperties: false,
            properties: {
              sourceUrl: { type: 'string' },
              formats: { type: 'array', items: { type: 'string' } }
            }
          }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: { type: 'object', properties: { phase: { type: 'string' } } }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'cli-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });

        export const mediaStack = typeKro.kubernetesComposition({
          name: 'cli-media-stack',
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'CliMediaStack',
          spec: type({ namespace: 'string' }),
          status: type({ ready: 'boolean' }),
        }, (spec) => {
          const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
          const image = pipeline.imageJob({
            name: 'hero',
            namespace: spec.namespace,
            spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
          });
          return { ready: image.status.phase === 'Complete' };
        });
      `);

      const code = await runCli(['build', entrypoint, '--typekro', '--composition-name', 'mediaStack', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

      expect(code).toBe(0);
      expect(output.join('\n')).toContain('Built TypeKro composition mediaStack');
      expect(output.join('\n')).toContain('Apply:');
      expect(output.join('\n')).toContain('Operators: 1');

      const compositionManifest = JSON.parse(await readFile(join(outDir, 'typekro', 'typekro-composition.json'), 'utf8'));
      expect(compositionManifest).toMatchObject({ kind: 'TypeKroCompositionBundle', metadata: { name: 'mediaStack' } });
      expect(compositionManifest.spec.operators[0]).toMatchObject({ name: 'cli-image-pipeline' });

      const resourcesYaml = await readFile(join(outDir, 'typekro', 'resources.yaml'), 'utf8');
      expect(resourcesYaml).toContain('kind: Deployment');
      expect(resourcesYaml).toContain('kind: ImageJob');
      const staleResourcePath = join(outDir, 'typekro', 'resources', '99-stale-resource.yaml');
      await writeFile(staleResourcePath, 'kind: Stale\n');
      const rebuildCode = await runCli(['build', entrypoint, '--typekro', '--composition-name', 'mediaStack', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });
      expect(rebuildCode).toBe(0);
      await expect(readdir(join(outDir, 'typekro', 'resources'))).resolves.not.toContain('99-stale-resource.yaml');
      const applyScript = await readFile(join(outDir, 'typekro', 'apply.sh'), 'utf8');
      expect(applyScript).toContain('Applying TypeKro prerequisite CustomResourceDefinitions');
      expect(applyScript).toContain('Applying TypeKro ResourceGraphDefinitions');
      expect(applyScript).toContain('apply_with_retry');
      const operatorManifest = JSON.parse(await readFile(join(outDir, 'operators', 'cli-image-pipeline', 'operator-manifest.json'), 'utf8'));
      expect(operatorManifest.metadata.name).toBe('cli-image-pipeline');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
