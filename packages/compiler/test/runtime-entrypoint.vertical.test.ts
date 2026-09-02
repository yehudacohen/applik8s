import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleApplicationCompositionRuntimeEntrypoint } from '../src/pipeline/runtime-entrypoint.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const quietKnownDependencyWarnings = {
  env: {
    ...process.env,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=DEP0040',
    ].filter(Boolean).join(' '),
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('application composition runtime entrypoint', () => {
  it('does not load the optional Hatchet SDK for an application with no workflows', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'applik8s-runtime-entrypoint-'),
    );
    temporaryDirectories.push(directory);
    const entrypoint = resolve(
      process.cwd(),
      'packages/e2e/test/fixtures/v06-generated-app/app.ts',
    );
    const output = join(directory, 'dist', 'application.mjs');

    await bundleApplicationCompositionRuntimeEntrypoint(entrypoint, output);
    const source = await readFile(output, 'utf8');

    expect(source).not.toContain('@hatchet-dev/typescript-sdk');
    expect(source).not.toContain('runtime-hatchet/src');
    expect(source).not.toContain('from "@nats-io/jetstream"');
    expect(source).not.toContain('from "drizzle-orm');
    expect(source).toContain("importProvider(\"@applik8s/runtime-hatchet\")");
    const loaded = await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      'const loaded = await import(process.argv[1]); if (!loaded.v06GeneratedApp) process.exitCode = 2;',
      `${pathToFileURL(output).href}?proof=${Date.now()}`,
    ], quietKnownDependencyWarnings);
    expect(loaded.stderr).toBe('');
  }, 30_000);

  it('loads a maintained-module Start as one physical model graph', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'applik8s-runtime-entrypoint-maintained-'),
    );
    temporaryDirectories.push(directory);
    const entrypoint = resolve(
      process.cwd(),
      'examples/identity-start/src/application.ts',
    );
    const output = join(directory, 'dist', 'application.mjs');

    await bundleApplicationCompositionRuntimeEntrypoint(entrypoint, output);
    const source = await readFile(output, 'utf8');

    expect(source).toContain('packages/conversations/src/schema.ts');
    expect(source).not.toContain('packages/conversations/dist/schema.js');
    expect(source).toContain('packages/operations-ui/src/schema.ts');
    expect(source).not.toContain('packages/operations-ui/dist/schema.js');
    const loaded = await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      'const loaded = await import(process.argv[1]); if (!loaded.application) process.exitCode = 2;',
      `${pathToFileURL(output).href}?proof=${Date.now()}`,
    ], quietKnownDependencyWarnings);
    expect(loaded.stderr).toBe('');
  }, 60_000);
});
