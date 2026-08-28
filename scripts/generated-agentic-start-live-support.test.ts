import { mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { materializeGeneratedWorkspaceDependencies } from './generated-agentic-start-live-support.js';

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
});
