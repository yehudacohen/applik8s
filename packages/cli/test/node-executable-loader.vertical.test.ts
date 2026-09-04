import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

describe('installed Node executable TypeScript loading', () => {
  afterAll(async () => {
    await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })));
  });

  test('registers the extensionless authored-TypeScript resolver before loading CLI commands', async () => {
    const bin = await readFile(resolve('packages/cli/dist/bin.js'), 'utf8');
    expect(bin).toContain('node-register-typescript.mjs');
    expect(bin).toMatch(/nodeOnlyCommands = new Set\(\[[\s\S]*["']build["']/u);

    const directory = await mkdtemp(join(tmpdir(), 'applik8s-node-loader-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'dependency.ts'), 'export const value = "resolved";\n');
    await writeFile(join(directory, 'entrypoint.ts'), 'import { value } from "./dependency"; console.log(value);\n');

    const result = await execFileAsync(process.execPath, [
      '--import',
      resolve('packages/cli/dist/node-register-typescript.mjs'),
      join(directory, 'entrypoint.ts'),
    ]);
    expect(result.stdout.trim()).toBe('resolved');
  });
});
