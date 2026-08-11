import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  applicationAgenticStartDefinition,
  renderApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartTemplates,
} from '@applik8s/start-agentic';
import { describe, expect, it } from 'vitest';
import { checkApplicationStartUpdate } from '../src/application-start-update-command.js';

describe('applik8s start update --check', () => {
  it('classifies application changes without mutating generated source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-'));
    const templates = await renderApplicationAgenticStartTemplates(
      'notes-product',
      'product',
    );
    const digests = Object.fromEntries(
      Object.entries(templates).map(([path, source]) => [path, digest(source)]),
    );
    for (const [path, source] of Object.entries(templates)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    await mkdir(join(root, '.applik8s'), { recursive: true });
    await writeFile(
      join(root, '.applik8s/start-lineage.json'),
      JSON.stringify({
        apiVersion: 'applik8s.startLineage/v1alpha1',
        start: 'agentic',
        startVersion: applicationAgenticStartDefinition.version,
        generatorVersion: applicationAgenticStartDefinition.version,
        projectName: 'notes-product',
        example: 'product',
        templateRevision: digest(JSON.stringify(digests)),
        files: digests,
      }),
    );
    await writeFile(
      join(root, 'src/routes/index.tsx'),
      `${templates['src/routes/index.tsx']}\n// application-owned change\n`,
    );

    const report = await checkApplicationStartUpdate(root);

    expect(report.updateAvailable).toBe(false);
    expect(report.conflicts).toBe(false);
    expect(report.paths.find(({ path }) => path === 'src/routes/index.tsx'))
      .toMatchObject({ state: 'application-modified' });
  });

  it('rejects symbolic links instead of reading outside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-link-'));
    const outside = join(root, '..', 'applik8s-start-update-secret');
    await writeFile(outside, 'secret-value');
    await mkdir(join(root, '.applik8s'), { recursive: true });
    await symlink(outside, join(root, '.applik8s/start-lineage.json'));

    await expect(checkApplicationStartUpdate(root)).rejects.toThrow(
      'refuses symbolic link',
    );
  });

  it('tracks managed package metadata without claiming application-owned entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-package-'));
    const managed = renderApplicationAgenticStartManagedPackage(
      'notes-product',
      'product',
      'workspace:*',
      'orbstack',
    );
    // typecast: the generator owns this JSON fixture and the test narrows it to mutate the two asserted maps.
    const manifest = JSON.parse(managed) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    manifest.scripts['application-owned'] = 'echo retained';
    manifest.dependencies['application-owned-package'] = '1.0.0';
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(join(root, '.applik8s'), { recursive: true });
    const files = { 'package.json': digest(managed) };
    await writeFile(
      join(root, '.applik8s/start-lineage.json'),
      JSON.stringify({
        apiVersion: 'applik8s.startLineage/v1alpha1',
        start: 'agentic',
        startVersion: applicationAgenticStartDefinition.version,
        generatorVersion: applicationAgenticStartDefinition.version,
        projectName: 'notes-product',
        example: 'product',
        packageVersion: 'workspace:*',
        context: 'orbstack',
        templateRevision: digest(JSON.stringify(files)),
        files,
      }),
    );

    const unchanged = await checkApplicationStartUpdate(root);
    expect(unchanged.paths).toContainEqual(expect.objectContaining({
      path: 'package.json',
      state: 'unchanged',
      securityRelevant: true,
      compatibilityChanging: true,
    }));

    manifest.scripts.deploy = 'unsafe-custom-deploy';
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const modified = await checkApplicationStartUpdate(root);
    expect(modified.paths).toContainEqual(expect.objectContaining({
      path: 'package.json',
      state: 'application-modified',
    }));
  });

  it('classifies cross-version security drift without rewriting application source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-version-'));
    const templates = await renderApplicationAgenticStartTemplates(
      'notes-product',
      'product',
    );
    const securityPath = 'src/features/account/session-loader.ts';
    const installedSecuritySource = `${templates[securityPath]}\n// prior maintained security boundary\n`;
    const installedFiles = {
      ...templates,
      [securityPath]: installedSecuritySource,
    };
    const installedDigests = Object.fromEntries(
      Object.entries(installedFiles).map(([path, source]) => [path, digest(source)]),
    );
    for (const [path, source] of Object.entries(installedFiles)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    await mkdir(join(root, '.applik8s'), { recursive: true });
    await writeFile(
      join(root, '.applik8s/start-lineage.json'),
      JSON.stringify({
        apiVersion: 'applik8s.startLineage/v1alpha1',
        start: 'agentic',
        startVersion: '0.6.9',
        generatorVersion: '0.6.9',
        projectName: 'notes-product',
        example: 'product',
        templateRevision: digest(JSON.stringify(installedDigests)),
        files: installedDigests,
      }),
    );

    const before = await readFile(join(root, securityPath), 'utf8');
    const report = await checkApplicationStartUpdate(root);
    const after = await readFile(join(root, securityPath), 'utf8');

    expect(report).toMatchObject({
      installedVersion: '0.6.9',
      availableVersion: applicationAgenticStartDefinition.version,
      updateAvailable: true,
      conflicts: false,
    });
    expect(report.paths).toContainEqual(expect.objectContaining({
      path: securityPath,
      state: 'template-changed',
      securityRelevant: true,
    }));
    expect(after).toBe(before);
  });
});

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
