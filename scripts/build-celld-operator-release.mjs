import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCompilerPipeline } from '../packages/compiler/dist/index.js';

const outDirArgument = process.argv.indexOf('--out-dir');
const outDir = resolve(
  process.cwd(),
  outDirArgument >= 0 ? process.argv[outDirArgument + 1] ?? '' : 'dist/celld-operator-image',
);
if (outDirArgument >= 0 && !process.argv[outDirArgument + 1]) {
  throw new Error('--out-dir requires a path.');
}

await mkdir(outDir, { recursive: true });
const result = await createCompilerPipeline().run({
  entrypoint: resolve(process.cwd(), 'packages/celld-operator/src/operator.ts'),
  operatorName: 'applik8s-celld-operator',
  outDir,
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
    sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
  },
});
if (!result.ok) throw new Error(result.error.message);

console.log(JSON.stringify({
  outDir,
  dockerfile: result.value.artifacts.generatedImageDockerfilePath,
  manifest: result.value.artifacts.manifestJsonPath,
  wasm: result.value.artifacts.handlerWasmPath,
}, null, 2));
