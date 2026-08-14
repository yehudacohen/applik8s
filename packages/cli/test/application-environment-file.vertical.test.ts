import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('application environment files', () => {
  test('loads the application-root .env without overriding exported operation-host values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'applik8s-environment-file-'));
    temporaryDirectories.push(cwd);
    await writeFile(
      join(cwd, '.env'),
      'FROM_APPLICATION_FILE=file-value\nEXPLICIT_OPERATION_HOST=file-value\n',
    );
    await writeFile(
      join(cwd, '.env.local'),
      'FROM_APPLICATION_FILE=local-value\nLOCAL_ONLY=local-value\nEXPLICIT_OPERATION_HOST=local-value\n',
    );
    const helper = pathToFileURL(
      resolve('packages/cli/src/application-environment-file.mjs'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const { loadApplicationEnvironmentFile } = await import(${JSON.stringify(helper)});\n`
          + `const loaded = await loadApplicationEnvironmentFile(${JSON.stringify(cwd)});\n`
          + 'console.log(JSON.stringify({ loaded, fromFile: process.env.FROM_APPLICATION_FILE, localOnly: process.env.LOCAL_ONLY, explicit: process.env.EXPLICIT_OPERATION_HOST }));',
      ],
      {
        cwd,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          EXPLICIT_OPERATION_HOST: 'exported-value',
        },
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      loaded: true,
      fromFile: 'local-value',
      localOnly: 'local-value',
      explicit: 'exported-value',
    });
  });
});
