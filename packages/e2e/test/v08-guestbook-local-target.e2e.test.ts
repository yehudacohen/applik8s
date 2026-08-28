// typecast-file-boundary: Compiler artifacts are parsed from JSON and structurally inspected before the local runner consumes their typed subset.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { compileTypeKroComposition } from '@applik8s/compiler';
import type { LocalSupervisorPlan } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import { startLocalSupervisor } from '../../cli/src/local-supervisor.js';

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

  it.runIf(process.env.APPLIK8S_E2E_DOCKER === '1')('retains declared container data across supervisor restarts and removes it on reset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-v08-local-volume-'));
    const stateRoot = join(root, 'state');
    const plan: LocalSupervisorPlan = {
      apiVersion: 'applik8s.localSupervisor/v1alpha1', application: 'volume-lifecycle', target: 'local', profile: 'developer', projectDigest: 'sha256:volume-lifecycle', diagnostics: [], bindings: [],
      resources: [{
        id: 'retained-store', kind: 'container', image: 'busybox:1.37', ports: [], environment: [],
        command: ['sh', '-c', 'count=$(cat /data/count 2>/dev/null || echo 0); echo $((count + 1)) > /data/count; sleep 3600'],
        volumes: [{ name: 'data', mountPath: '/data', retained: true }], dependsOn: [],
        lifecycle: { ownership: 'application', retention: 'retained' }, health: { kind: 'process', timeoutMs: 5_000 },
        provenance: { graphNodeId: 'provider.retained-store' },
      }],
    };
    const io = { cwd: root, stdout() {}, stderr() {} };
    let first: Awaited<ReturnType<typeof startLocalSupervisor>> | undefined;
    let second: Awaited<ReturnType<typeof startLocalSupervisor>> | undefined;
    let volumeId: string | undefined;
    try {
      first = await startLocalSupervisor(plan, io, { stateRoot });
      const firstRuntime = first.state.resources[0];
      if (!firstRuntime) throw new Error('Retained store did not produce a local runtime record.');
      volumeId = firstRuntime?.volumes?.[0]?.id;
      expect(volumeId).toBeDefined();
      expect((await execFileAsync('docker', ['exec', firstRuntime.runtimeId, 'cat', '/data/count'])).stdout.trim()).toBe('1');
      await first.stop();

      second = await startLocalSupervisor(plan, io, { stateRoot });
      const secondRuntime = second.state.resources[0];
      if (!secondRuntime) throw new Error('Restarted retained store did not produce a local runtime record.');
      expect(secondRuntime?.volumes?.[0]?.id).toBe(volumeId);
      expect((await execFileAsync('docker', ['exec', secondRuntime.runtimeId, 'cat', '/data/count'])).stdout.trim()).toBe('2');
      await second.reset();
      if (!volumeId) throw new Error('Retained store did not expose its volume identity.');
      await expect(execFileAsync('docker', ['volume', 'inspect', volumeId])).rejects.toThrow();
    } finally {
      await second?.stop();
      await first?.stop();
      if (volumeId) await execFileAsync('docker', ['volume', 'rm', '-f', volumeId]).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
