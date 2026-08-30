import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  applicationAgenticStartDefinition,
  renderApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartTemplates,
} from '@applik8s/start-agentic';
import { describe, expect, it } from 'vitest';
import {
  applyApplicationStartUpdate,
  checkApplicationStartUpdate,
} from '../src/application-start-update-command.js';

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
      .toMatchObject({ state: 'application-edited' });
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
      state: 'application-edited',
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
      state: 'cleanly-applicable',
      securityRelevant: true,
    }));
    expect(after).toBe(before);
  });

  it('uses the tracked v0.8 lineage to report a deterministic conservative three-way plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-tracked-'));
    const templates = await renderApplicationAgenticStartTemplates(
      'notes-product',
      'product',
    );
    const changedPath = 'src/routes/index.tsx';
    const addedPath = 'src/brand.ts';
    const baseline: Record<string, string> = {
      ...templates,
      [changedPath]: `${templates[changedPath]}\n// installed baseline\n`,
    };
    delete baseline[addedPath];
    const files = Object.fromEntries(
      Object.entries(baseline).map(([path, source]) => [path, digest(source)]),
    );
    for (const [path, source] of Object.entries(baseline)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    await writeFile(join(root, '.applik8s-start.json'), JSON.stringify({
      apiVersion: 'applik8s.startLineage/v1alpha2',
      start: 'agentic',
      startVersion: '0.7.1',
      generatorVersion: '0.7.1',
      projectName: 'notes-product',
      example: 'product',
      templateRevision: digest(JSON.stringify(
        Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
      )),
      files,
    }));

    const first = await checkApplicationStartUpdate(root);
    const second = await checkApplicationStartUpdate(root);
    expect(second).toEqual(first);
    expect(first.paths).toContainEqual(expect.objectContaining({
      path: changedPath,
      state: 'cleanly-applicable',
      baselineDigest: files[changedPath],
      applicationDigest: files[changedPath],
      availableDigest: expect.stringMatching(/^sha256:/u),
    }));
    expect(first.paths).toContainEqual(expect.objectContaining({
      path: addedPath,
      state: 'upstream-added',
    }));

    await writeFile(join(root, changedPath), `${baseline[changedPath]}\n// application edit\n`);
    const conflict = await checkApplicationStartUpdate(root);
    expect(conflict.conflicts).toBe(true);
    expect(conflict.paths).toContainEqual(expect.objectContaining({
      path: changedPath,
      state: 'conflict',
    }));

    await writeFile(join(root, changedPath), templates[changedPath] ?? '');
    const applied = await checkApplicationStartUpdate(root);
    expect(applied.paths).toContainEqual(expect.objectContaining({
      path: changedPath,
      state: 'unchanged',
    }));
  });

  it('applies clean updates, preserves application package fields, and is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-apply-'));
    const templates = await renderApplicationAgenticStartTemplates('notes-product', 'product');
    const changedPath = 'src/routes/index.tsx';
    const removedPath = 'src/removed-upstream.ts';
    const addedPath = 'src/brand.ts';
    const managedPackage = renderApplicationAgenticStartManagedPackage(
      'notes-product',
      'product',
      'workspace:*',
      'orbstack',
    );
    // typecast: the generator owns and validates the managed package fixture.
    const applicationPackage = JSON.parse(managedPackage) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    applicationPackage.scripts['application-owned'] = 'echo retained';
    applicationPackage.dependencies['application-owned-package'] = '1.0.0';
    const baseline: Record<string, string> = {
      ...templates,
      [changedPath]: `${templates[changedPath]}\n// installed baseline\n`,
      [removedPath]: 'export const removed = true;\n',
      'package.json': managedPackage,
    };
    delete baseline[addedPath];
    for (const [path, source] of Object.entries(baseline)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(
        join(root, path),
        path === 'package.json'
          ? `${JSON.stringify(applicationPackage, null, 2)}\n`
          : source,
      );
    }
    const files = Object.fromEntries(
      Object.entries(baseline).map(([path, source]) => [path, digest(source)]),
    );
    await writeFile(join(root, '.applik8s-start.json'), JSON.stringify({
      apiVersion: 'applik8s.startLineage/v1alpha2',
      start: 'agentic',
      startVersion: '0.7.1',
      projectName: 'notes-product',
      example: 'product',
      packageVersion: 'workspace:*',
      context: 'orbstack',
      templateRevision: digest(JSON.stringify(files)),
      files,
    }));

    const result = await applyApplicationStartUpdate(root);
    expect(result.applied).toEqual(expect.arrayContaining([changedPath, addedPath]));
    expect(result.removed).toContain(removedPath);
    expect(await readFile(join(root, changedPath), 'utf8')).toBe(templates[changedPath]);
    await expect(access(join(root, removedPath))).rejects.toThrow();
    // typecast: the updater emits this package fixture from its validated object merger.
    const updatedPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(updatedPackage.scripts['application-owned']).toBe('echo retained');
    expect(updatedPackage.dependencies['application-owned-package']).toBe('1.0.0');
    expect(result.report).toMatchObject({ updateAvailable: false, conflicts: false });

    const rerun = await applyApplicationStartUpdate(root);
    expect(rerun.applied).toEqual([]);
    expect(rerun.removed).toEqual([]);
    expect(rerun.report).toEqual(result.report);
  });

  it('fails closed and preserves every path when any update conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-start-update-conflict-'));
    const templates = await renderApplicationAgenticStartTemplates('notes-product', 'product');
    const conflictPath = 'src/routes/index.tsx';
    const cleanPath = 'src/routes/__root.tsx';
    const baseline = {
      ...templates,
      [conflictPath]: `${templates[conflictPath]}\n// prior conflict baseline\n`,
      [cleanPath]: `${templates[cleanPath]}\n// prior clean baseline\n`,
    };
    const files = Object.fromEntries(
      Object.entries(baseline).map(([path, source]) => [path, digest(source)]),
    );
    for (const [path, source] of Object.entries(baseline)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(
        join(root, path),
        path === conflictPath ? `${source}// application edit\n` : source,
      );
    }
    await writeFile(join(root, '.applik8s-start.json'), JSON.stringify({
      apiVersion: 'applik8s.startLineage/v1alpha2',
      start: 'agentic',
      startVersion: '0.7.1',
      projectName: 'notes-product',
      example: 'product',
      templateRevision: digest(JSON.stringify(files)),
      files,
    }));
    const beforeConflict = await readFile(join(root, conflictPath), 'utf8');
    const beforeClean = await readFile(join(root, cleanPath), 'utf8');

    await expect(applyApplicationStartUpdate(root)).rejects.toThrow(
      'has conflicts and made no changes',
    );
    expect(await readFile(join(root, conflictPath), 'utf8')).toBe(beforeConflict);
    expect(await readFile(join(root, cleanPath), 'utf8')).toBe(beforeClean);
  });
});

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
