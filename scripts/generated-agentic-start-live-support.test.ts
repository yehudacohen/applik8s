import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  materializeDeclaredPackageBins,
  materializeGeneratedWorkspaceDependencies,
} from './generated-agentic-start-live-support.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('generated workspace consumer boundary', () => {
  test('links every declared publishable workspace package explicitly', async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), 'applik8s-generated-consumer-'));
    temporaryDirectories.push(targetDirectory);
    await writeFile(join(targetDirectory, 'package.json'), `${JSON.stringify({
      dependencies: {
        '@applik8s/runtime': 'workspace:*',
        react: '^19.1.0',
      },
      devDependencies: {
        '@applik8s/cli': 'workspace:*',
      },
    })}\n`);

    const linked = await materializeGeneratedWorkspaceDependencies({
      workspaceRoot: resolve(import.meta.dirname, '..'),
      targetDirectory,
    });

    expect(linked).toEqual(['@applik8s/cli', '@applik8s/runtime']);
    expect(await readlink(join(targetDirectory, 'node_modules/@applik8s/runtime')))
      .toContain('packages/runtime');
  });

  test('fails closed for a workspace dependency outside the release package set', async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), 'applik8s-generated-consumer-'));
    temporaryDirectories.push(targetDirectory);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(join(targetDirectory, 'package.json'), `${JSON.stringify({
      dependencies: { '@applik8s/not-a-package': 'workspace:*' },
    })}\n`);

    await expect(materializeGeneratedWorkspaceDependencies({
      workspaceRoot: resolve(import.meta.dirname, '..'),
      targetDirectory,
    })).rejects.toThrow('unresolved workspace dependency @applik8s/not-a-package');
  });

  test('materializes only declared package executables inside the generated consumer', async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), 'applik8s-generated-consumer-'));
    temporaryDirectories.push(targetDirectory);
    const modules = join(targetDirectory, 'node_modules');
    const cli = join(modules, '@applik8s/cli');
    const typescript = join(modules, 'typescript');
    await mkdir(join(cli, 'dist'), { recursive: true });
    await mkdir(join(typescript, 'bin'), { recursive: true });
    await writeFile(join(targetDirectory, 'package.json'), `${JSON.stringify({
      devDependencies: {
        '@applik8s/cli': 'workspace:*',
        typescript: '^5.3.0',
      },
    })}\n`);
    await writeFile(join(cli, 'package.json'), `${JSON.stringify({
      name: '@applik8s/cli',
      bin: { applik8s: 'dist/bin.js' },
    })}\n`);
    await writeFile(join(cli, 'dist/bin.js'), '#!/usr/bin/env node\n');
    await writeFile(join(typescript, 'package.json'), `${JSON.stringify({
      name: 'typescript',
      bin: { tsc: 'bin/tsc' },
    })}\n`);
    await writeFile(join(typescript, 'bin/tsc'), '#!/usr/bin/env node\n');
    const ambientBins = join(targetDirectory, 'ambient-bin');
    await mkdir(ambientBins);
    await writeFile(join(ambientBins, 'applik8s'), 'stale ambient executable\n');
    await symlink(ambientBins, join(modules, '.bin'), 'junction');

    await expect(materializeDeclaredPackageBins(targetDirectory)).resolves.toEqual({
      applik8s: '@applik8s/cli',
      tsc: 'typescript',
    });

    expect(await readlink(join(modules, '.bin/applik8s'))).toBe(
      '../@applik8s/cli/dist/bin.js',
    );
    expect(await readFile(join(modules, '.bin/applik8s'), 'utf8')).toContain(
      '#!/usr/bin/env node',
    );
    expect(await readlink(join(modules, '.bin/tsc'))).toBe('../typescript/bin/tsc');
  });
});
