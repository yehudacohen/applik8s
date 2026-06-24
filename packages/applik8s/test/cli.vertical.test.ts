import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';

describe('applik8s CLI', () => {
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
});
