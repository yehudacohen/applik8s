export interface CompilerArtifactLayoutOptions {
  readonly outDir: string;
}

export interface CompilerArtifactLayout {
  readonly rootDir: string;
  readonly bundleDir: string;
  readonly generatedDispatcherEntrypointPath: string;
  readonly contractDir: string;
  readonly wasmDir: string;
  readonly kubernetesDir: string;
  readonly imageDockerfilePath: string;
  readonly applyScriptPath: string;
}

export interface CompilerArtifactPaths {
  readonly javascriptBundlePath: string;
  readonly javascriptMetafilePath: string;
  readonly runtimeContractPath: string;
  readonly witPath: string;
  readonly wasmPath: string;
  readonly manifestPath: string;
  readonly kubernetesDir: string;
  readonly imageDockerfilePath: string;
  readonly applyScriptPath: string;
}

export function compilerArtifactLayout(options: CompilerArtifactLayoutOptions): CompilerArtifactLayout {
  return {
    rootDir: options.outDir,
    bundleDir: `${options.outDir}/bundle`,
    generatedDispatcherEntrypointPath: `${options.outDir}/bundle/handler-dispatcher.generated.ts`,
    contractDir: `${options.outDir}/contract`,
    wasmDir: `${options.outDir}/wasm`,
    kubernetesDir: `${options.outDir}/kubernetes`,
    imageDockerfilePath: `${options.outDir}/Dockerfile.applik8s-runtime`,
    applyScriptPath: `${options.outDir}/apply.sh`,
  };
}

export function compilerArtifactPaths(options: CompilerArtifactLayoutOptions): CompilerArtifactPaths {
  const layout = compilerArtifactLayout(options);

  return {
    javascriptBundlePath: `${layout.bundleDir}/handler.js`,
    javascriptMetafilePath: `${layout.bundleDir}/handler.esbuild-meta.json`,
    runtimeContractPath: `${layout.contractDir}/runtime-contract.json`,
    witPath: `${layout.contractDir}/applik8s-handler.wit`,
    wasmPath: `${layout.wasmDir}/handler.wasm`,
    manifestPath: `${layout.rootDir}/operator-manifest.json`,
    kubernetesDir: layout.kubernetesDir,
    imageDockerfilePath: layout.imageDockerfilePath,
    applyScriptPath: layout.applyScriptPath,
  };
}
