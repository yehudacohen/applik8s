// typecast-file-boundary: The compiler fixture inspects validated generated artifacts through intentionally erased test-only shapes.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileTypeKroComposition, createCompilerPipeline } from '../src/pipeline/index.js';

describe('Celld operator compiler integration', () => {
  it('componentizes the independently consumable operator through the ordinary pipeline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-celld-operator-compile-'));
    try {
      const result = await createCompilerPipeline().run({
        entrypoint: resolve('packages/celld-operator/src/operator.ts'),
        operatorName: 'applik8s-celld-operator',
        outDir: directory,
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        dispatcherMode: 'staticSerializable',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: {
            emit: true,
            includeSourceContent: false,
            redactPaths: false,
          },
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.ok).toBe(true);
      expect(result.value.manifest.metadata.name).toBe('applik8s-celld-operator');
      expect(result.value.manifest.metadata.annotations?.['applik8s.dev/watch-scope']).toBe('Cluster');
      expect(result.value.manifest.spec.readResources).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'StatefulSet', scope: 'Namespaced', namespaces: 'all' }),
        expect.objectContaining({ kind: 'Secret', scope: 'Namespaced', namespaces: 'all' }),
      ]));
      expect(result.value.manifest.spec.container?.build?.context).toBe(directory);
      expect(result.value.artifacts.handlerWasmPath).toMatch(/handler\.wasm$/u);
      expect(result.value.closureGraph.handlers.length).toBeGreaterThanOrEqual(2);
      expect(result.value.artifacts.generatedCrdYamlPaths).toHaveLength(1);
      const emittedManifest = JSON.parse(await readFile(result.value.artifacts.manifestJsonPath, 'utf8')) as {
        readonly spec?: { readonly secondaryWatches?: readonly { readonly source?: unknown; readonly target?: unknown }[] };
      };
      expect(emittedManifest.spec?.secondaryWatches).toHaveLength(7);
      for (const watch of emittedManifest.spec?.secondaryWatches ?? []) {
        expect(watch.source).toBeDefined();
        expect(watch.target).toMatchObject({ apiVersion: 'celld.applik8s.io/v1alpha1', kind: 'CelldFleet' });
      }
      const crd = await readFile(result.value.artifacts.generatedCrdYamlPaths[0] ?? '', 'utf8');
      expect(crd).toContain('x-kubernetes-validations');
      expect(crd).toContain('credentials must select exactly one Secret or workload identity source');
      expect(crd).toContain('observedArtifactManifestDigest');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('combines the immutable operator artifact and schedule control in one Kubernetes actor application', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-celld-operator-application-'));
    try {
      const result = await compileTypeKroComposition({
        entrypoint: resolve('packages/compiler/test/fixtures/v08-celld-operator-app.ts'),
        compositionName: 'celldOperatorArtifactProof',
        executionTarget: 'kubernetes',
        outDir: directory,
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
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.operatorCompiles.map(compiled => compiled.manifest.metadata.name))
        .toContain('applik8s-celld-operator');
      expect(result.value.artifacts.manifest.spec.operators).toContainEqual(expect.objectContaining({
        name: 'applik8s-celld-operator',
        manifest: expect.stringContaining('operators/applik8s-celld-operator/operator-manifest.json'),
      }));
      expect(result.value.artifacts.manifest.spec.reactive).toContainEqual(expect.objectContaining({
        kind: 'scheduleControlWorker',
      }));
      expect(result.value.artifacts.applicationGraphJsonPath).toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
