import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { expect, it } from 'vitest';
import { compileTypeKroComposition } from '../src/pipeline/index.js';

it('compiles the Tenant Platform v0.5 durable onboarding and decommissioning proof', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'applik8s-tenant-v05-proof-'));
  try {
    const entrypoint = join(dir, 'tenant-v05.ts');
    await writeFile(entrypoint, `import { createTenantPlatformV05Example } from ${JSON.stringify(resolve('examples/tenant-platform.ts'))};\nexport const tenantV05 = createTenantPlatformV05Example({ namespace: 'tenant-v05', stackName: 'tenant-v05' }).composition;\n`);
    const result = await compileTypeKroComposition({
      entrypoint,
      compositionName: 'tenantV05',
      outDir: join(dir, 'dist'),
      runtimeVersionRange: '^0.5.0',
      handlerAbiVersion: 'applik8s.handler/v1alpha1',
      adapter: 'wasmComponent',
      portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
    });
    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) return;
    const graph = result.value.artifacts.manifest.spec.applicationGraph;
    expect(graph).toBeDefined();
    expect(result.value.artifacts.workflowArtifacts.map((artifact) => artifact.name).sort()).toEqual(['tenant-v05-decommissioning', 'tenant-v05-onboarding', 'tenant-v05-workflows']);
    // typecast: the compiler emitted and validated this file as its serialized ApplicationGraph artifact.
    const applicationGraph = JSON.parse(await readFile(result.value.artifacts.applicationGraphJsonPath ?? '', 'utf8')) as ApplicationGraph;
    expect(applicationGraph?.nodes.filter((node) => node.kind === 'task')).toHaveLength(3);
    expect(applicationGraph?.nodes.filter((node) => node.kind === 'workflow')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tenant.onboard.v1' }),
      expect.objectContaining({ name: 'tenant.decommission.v1' }),
    ]));
    expect(applicationGraph?.nodes.filter((node) => node.kind === 'workflowWorker')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tenant-v05-workflows', handlers: expect.arrayContaining([expect.objectContaining({ nodeId: expect.stringContaining('task-handler') })]) }),
      expect.objectContaining({ name: 'tenant-v05-onboarding', handlers: [expect.objectContaining({ nodeId: 'workflow-handler.tenant.onboard.v1' })] }),
      expect.objectContaining({ name: 'tenant-v05-decommissioning', handlers: [expect.objectContaining({ nodeId: 'workflow-handler.tenant.decommission.v1' })] }),
    ]));
    expect(applicationGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider', interface: 'DnsPublication' }),
      expect.objectContaining({ kind: 'operator', name: 'tenant-controller' }),
    ]));
    const tenantDnsOperator = result.value.artifacts.operatorArtifacts.find((artifact) => artifact.operatorName === 'tenant-controller');
    // typecast: the compiler emitted this JSON through its validated operator-manifest serialization path.
    const tenantDnsManifest = JSON.parse(await readFile(tenantDnsOperator?.manifestJsonPath ?? '', 'utf8')) as { readonly spec?: { readonly secondaryWatches?: readonly unknown[] } };
    expect(tenantDnsManifest.spec?.secondaryWatches).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ kind: 'DNSEndpoint' }),
      mapper: { mode: 'targetNameFromSourceField', source: { kind: 'annotation', key: 'dns.applik8s.dev/source-name' }, namespace: 'source' },
    }));
    expect(applicationGraph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'WorkflowEngine',
        implementation: 'hatchet',
        config: expect.objectContaining({
          name: 'tenant-v05-workflows',
          namespace: 'tenant-v05',
          provision: true,
        }),
      }),
    ]));
    // Provider infrastructure is now one deployment-graph side effect lowered
    // through TypeKro's Hatchet integration. The legacy compiler artifact must
    // retain only application workloads and never emit a competing Helm owner.
    expect(result.value.artifacts.resources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'HelmRelease', metadata: expect.objectContaining({ name: 'tenant-v05-workflows' }) }),
    ]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 300_000);
