// typecast-file-boundary: Compiler artifacts are parsed from JSON and structurally inspected before the local runner consumes their typed subset.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { compileTypeKroComposition } from '@applik8s/compiler';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('v0.8 GuestBook local target', () => {
  it('executes the real compiler-owned CRD dispatcher without Kubernetes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-v08-guestbook-local-'));
    try {
      const compiled = await compileTypeKroComposition({
        entrypoint: resolve('examples/guestbook-start/src/application.ts'),
        compositionName: 'app',
        outDir: join(root, 'compiled'),
        executionTarget: 'local',
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
        },
      });
      expect(compiled.ok, compiled.ok ? undefined : compiled.error.message).toBe(true);
      if (!compiled.ok) return;

      const operator = compiled.value.artifacts.operatorArtifacts.find(({ operatorName }) => operatorName === 'guest-book-entry-controller');
      expect(operator).toBeDefined();
      if (!operator) return;
      const manifest = JSON.parse(await readFile(operator.manifestJsonPath, 'utf8')) as {
        readonly spec: { readonly bundle: { readonly artifacts: readonly { readonly kind: string; readonly path: string; readonly digest: string }[] } };
      };
      const javascript = manifest.spec.bundle.artifacts.find(({ kind }) => kind === 'javascript-bundle');
      expect(javascript).toBeDefined();
      if (!javascript) return;
      const actualDigest = `sha256:${createHash('sha256').update(await readFile(javascript.path)).digest('hex')}`;
      expect(actualDigest).toBe(javascript.digest);

      const artifactPath = join(root, 'operator-artifact.json');
      await writeFile(artifactPath, JSON.stringify({
        name: operator.operatorName,
        manifest: operator.manifestJsonPath,
        source: javascript.path,
        digest: javascript.digest,
      }));
      const runner = resolve('packages/e2e/test/fixtures/v08-local-operator-runner.mjs');
      const { stdout, stderr } = await execFileAsync(process.execPath, [runner, artifactPath, join(root, 'resources.json')], {
        cwd: process.cwd(),
        timeout: 20_000,
      });
      expect(stderr).toBe('');
      expect(JSON.parse(stdout.trim())).toMatchObject({
        phase: 'Published',
        fingerprint: 'demo:codex:hello from local target',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
