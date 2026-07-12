import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

it('compiles the Tenant Platform v0.4 reconciliation SDK closure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'applik8s-tenant-v04-proof-'));
  try {
    const entrypoint = join(dir, 'tenant-v04.ts');
    await writeFile(entrypoint, `import { createTenantPlatformV04Example } from ${JSON.stringify(resolve('examples/tenant-platform.ts'))};\nexport const tenantV04 = createTenantPlatformV04Example({ namespace: 'tenant-v04' }).composition;\n`);
    const result = await compileTypeKroComposition({
      entrypoint,
      compositionName: 'tenantV04',
      outDir: join(dir, 'dist'),
      runtimeVersionRange: '^0.4.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
    });
    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;

    const clusterRbac = result.value.composition.resources
      .filter((resource) => resource.kind === 'ClusterRole' || resource.kind === 'ClusterRoleBinding')
      .map((resource) => `${resource.kind}/${resource.metadata?.name}`);
    expect(clusterRbac, JSON.stringify(clusterRbac)).toContain('ClusterRole/tenant-v04-tenant-controller-controller');
    expect(clusterRbac, JSON.stringify(clusterRbac)).toContain('ClusterRoleBinding/tenant-v04-tenant-controller-controller');

    const tenantOperator = result.value.operatorCompiles.find((compiled) => compiled.manifest.metadata.name === 'tenant-controller');
    expect(tenantOperator).toBeDefined();
    expect(await stat(tenantOperator?.artifacts.handlerWasmPath ?? '')).toMatchObject({ size: expect.any(Number) });
    expect((await stat(tenantOperator?.artifacts.handlerWasmPath ?? '')).size).toBeGreaterThan(0);
    expect(basename(tenantOperator?.artifacts.generatedRbacYamlPath ?? '')).toMatch(/^clusterrole-/);
    expect(await readFile(tenantOperator?.artifacts.generatedRbacYamlPath ?? '', 'utf8')).toContain('- namespaces');

    const operatorArtifacts = result.value.artifacts.operatorArtifacts.find((artifact) => artifact.operatorName === 'tenant-controller');
    const bundleSource = await readFile(join(operatorArtifacts?.outDir ?? '', 'bundle', 'handler.js'), 'utf8');
    // typecast: esbuild owns this generated JSON artifact and the test consumes only its documented inputs map.
    const metafile = JSON.parse(await readFile(join(operatorArtifacts?.outDir ?? '', 'bundle', 'handler.esbuild-meta.json'), 'utf8')) as {
      readonly inputs: Readonly<Record<string, unknown>>;
    };
    expect(Object.keys(metafile.inputs).some((input) => input.endsWith('/gen/apis/CoreV1Api.js'))).toBe(true);
    expect(bundleSource).toContain('Kubernetes SDK observed');
    expect(bundleSource).not.toContain('fixture-token-that-must-not-enter-artifacts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 240_000);
