import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bundleHandlerEntrypoint, emitHandlerWitArtifact, emitWasmComponentArtifact } from '@applik8s/compiler';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const live = process.env.APPLIK8S_E2E_LIVE === '1';

describe.runIf(live)('Kubernetes SDK inside WASM live boundary', () => {
  it('executes Core, Apps, and Custom Objects list calls against the selected cluster with host-owned transport', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-kubernetes-wasm-live-'));
    const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
    const proxy = spawn('kubectl', ['--context', context, 'proxy', '--port=0', '--accept-hosts=^.*$'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const endpoint = await kubectlProxyEndpoint(proxy);
      const entrypoint = join(dir, 'handler.ts');
      await writeFile(entrypoint, kubernetesSdkHandlerSource());
      const bundle = await bundleHandlerEntrypoint({ entrypoint, outDir: join(dir, 'bundle'), portability: { allowNetworkAccess: true } });
      const wit = await emitHandlerWitArtifact({ outDir: join(dir, 'contract') });
      expect(bundle.ok).toBe(true);
      expect(wit.ok).toBe(true);
      if (!bundle.ok || !wit.ok) return;
      const component = await emitWasmComponentArtifact({ javascriptBundlePath: bundle.value.javascriptBundlePath, witPath: wit.value.path, outDir: join(dir, 'component') });
      expect(component.ok).toBe(true);
      if (!component.ok) return;

      const forbiddenCredential = 'credential-that-must-not-enter-the-component';
      expect(await readFile(bundle.value.javascriptBundlePath, 'utf8')).not.toContain(forbiddenCredential);
      expect((await readFile(component.value.path)).includes(Buffer.from(forbiddenCredential))).toBe(false);
      const invocation = await execFileAsync('cargo', [
        'run', '-p', 'applik8s-runtime-bridge', '--bin', 'applik8s-wasm-kubernetes-proof', '--', component.value.path, endpoint,
      ], {
        cwd: process.cwd(),
        timeout: 240_000,
        env: { ...process.env, K8S_OPENAPI_ENABLED_VERSION: '1.32' },
      });
      expect(invocation.stderr).not.toContain(forbiddenCredential);
      expect(JSON.parse(invocation.stdout)).toMatchObject({
        operations: [{ kind: 'status', status: { phase: 'Ready', observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), namespaceCount: expect.any(Number), deploymentCount: expect.any(Number), resourceGraphDefinitionCount: expect.any(Number) } }],
      });
    } finally {
      proxy.kill('SIGTERM');
      await rm(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

function kubectlProxyEndpoint(proxy: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`kubectl proxy did not become ready: ${output}`)), 30_000);
    const observe = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Starting to serve on 127\.0\.0\.1:(\d+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    proxy.stdout?.on('data', observe);
    proxy.stderr?.on('data', observe);
    proxy.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proxy.once('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`kubectl proxy exited with ${code}: ${output}`));
      }
    });
  });
}

function kubernetesSdkHandlerSource(): string {
  return `import * as k8s from '@kubernetes/client-node';
export async function handle(_inputJson) {
  const observedAt = new Date().toISOString();
  const config = new k8s.KubeConfig();
  config.loadFromOptions({
    clusters: [{ name: 'cluster', server: 'http://kubernetes.default.svc' }],
    users: [{ name: 'runtime' }],
    contexts: [{ name: 'runtime', cluster: 'cluster', user: 'runtime' }],
    currentContext: 'runtime',
  });
  const namespaces = await config.makeApiClient(k8s.CoreV1Api).listNamespace({ limit: 2 });
  const deployments = await config.makeApiClient(k8s.AppsV1Api).listDeploymentForAllNamespaces({ limit: 2 });
  const custom = await config.makeApiClient(k8s.CustomObjectsApi).listClusterCustomObject({ group: 'kro.run', version: 'v1alpha1', plural: 'resourcegraphdefinitions', limit: 2 });
  return JSON.stringify({ operations: [{ kind: 'status', status: { phase: 'Ready', observedAt, namespaceCount: namespaces.items.length, deploymentCount: deployments.items.length, resourceGraphDefinitionCount: custom.items.length } }] });
}`;
}
