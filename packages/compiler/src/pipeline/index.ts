import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import type {
  BundleArtifact,
  Diagnostic,
  OperatorDefinition,
  OperatorManifest,
  Result,
} from '@applik8s/core';
import { imageRefString } from '@applik8s/typetainer';
import { compilerArtifactLayout } from '../artifacts/index.js';
import { applik8sWorkspaceSourcePlugin, bundleHandlerEntrypoint } from '../bundling/index.js';
import { emitOperatorKubernetesYaml } from '../kubernetes-yaml/index.js';
import { buildOperatorManifest } from '../manifest/index.js';
import { emitHandlerWitArtifact, emitRuntimeContractArtifact } from '../runtime-contract/index.js';
import { emitWasmComponentArtifact } from '../wasm-component/index.js';
import type {
  ClosureGraph,
  CompileOptions,
  CompileResult,
  HandlerAbiArtifact,
  OperatorArtifacts,
  Compiler,
  CompilerFactory,
} from '../interfaces.js';

const DEFAULT_OUT_DIR = 'dist/applik8s';

export type CompilerPipelineStageName =
  | 'discoverOperators'
  | 'validateSchemas'
  | 'analyzeHandlers'
  | 'bundleJavaScript'
  | 'emitRuntimeContract'
  | 'emitWasmComponent'
  | 'buildManifest'
  | 'emitKubernetesArtifacts'
  | 'validateBundle';

export interface CompileOperatorRequest extends CompileOptions {
  readonly operatorName?: string;
}

export interface CompileOperatorPlan {
  readonly entrypoint: string;
  readonly outDir: string;
  readonly stages: readonly CompilerPipelineStageName[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompilerPipelineStage<TInput, TOutput> {
  readonly name: CompilerPipelineStageName;
  run(input: TInput): Promise<Result<TOutput>> | Result<TOutput>;
}

export interface CompilerPipelineContext {
  readonly request: CompileOperatorRequest;
  readonly discoveredOperators?: readonly OperatorDefinition[];
  readonly selectedOperator?: OperatorDefinition;
  readonly closureGraph?: ClosureGraph;
  readonly handlerAbi?: HandlerAbiArtifact;
  readonly artifacts?: OperatorArtifacts;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompileOperatorPipeline {
  plan(request: CompileOperatorRequest): Result<CompileOperatorPlan>;
  run(request: CompileOperatorRequest): Promise<Result<CompileResult>>;
  stages(): readonly CompilerPipelineStageName[];
}

const defaultStages: readonly CompilerPipelineStageName[] = [
  'discoverOperators',
  'validateSchemas',
  'analyzeHandlers',
  'bundleJavaScript',
  'emitRuntimeContract',
  'emitWasmComponent',
  'buildManifest',
  'emitKubernetesArtifacts',
  'validateBundle',
];

export function createCompilerPipeline(): CompileOperatorPipeline {
  return new MinimalCompileOperatorPipeline();
}

export function createCompiler(): Compiler {
  const pipeline = createCompilerPipeline();
  return {
    async discover(entrypoint) {
      const result = await discoverExportedOperators(entrypoint);
      return result.ok ? { ok: true, value: result.value.operators } : result;
    },
    compile(options) {
      return pipeline.run(options);
    },
    validate(result) {
      return result.manifest ? { ok: true, value: result.diagnostics } : error('BUNDLE_INVALID', 'Compile result is missing an operator manifest.');
    },
  };
}

export function createCompilerFactory(): CompilerFactory {
  return {
    create: () => ({ ok: true, value: createCompiler() }),
    createPipeline: () => ({ ok: true, value: createCompilerPipeline() }),
  };
}

class MinimalCompileOperatorPipeline implements CompileOperatorPipeline {
  plan(request: CompileOperatorRequest): Result<CompileOperatorPlan> {
    if (request.packageName !== undefined) {
      return error('BUNDLE_INVALID', 'compile option packageName is not implemented yet; remove it so package naming is not silently ignored.');
    }
    if (request.adapter !== 'wasmComponent') {
      return error('BUNDLE_INVALID', 'applik8s currently supports only the wasmComponent runtime adapter.');
    }
    if (request.handlerAbiVersion !== 'applik8s.handler/v1alpha1') {
      return error('BUNDLE_INVALID', `applik8s currently supports only handlerAbiVersion applik8s.handler/v1alpha1, got ${request.handlerAbiVersion}.`);
    }
    if (request.adapterRequirements !== undefined) {
      return error('BUNDLE_INVALID', 'compile option adapterRequirements is not implemented as caller override yet; the compiler emits the canonical wasmComponent requirements and rejects overrides to avoid silently ignoring them.');
    }
    if (request.portability.allowedHostImports.length > 0) {
      return error('BUNDLE_INVALID', 'compile option portability.allowedHostImports is not implemented as caller override yet; host imports are derived from the canonical runtime contract and declared capabilities.');
    }
    return { ok: true, value: { entrypoint: request.entrypoint, outDir: outputDirectory(request), stages: defaultStages, diagnostics: [] } };
  }

  async run(request: CompileOperatorRequest): Promise<Result<CompileResult>> {
    const planned = this.plan(request);
    if (!planned.ok) {
      return planned;
    }

    const discovered = await discoverExportedOperators(request.entrypoint);
    if (!discovered.ok) {
      return discovered;
    }

    const selected = selectOperator(discovered.value.operators, request.operatorName);
    if (!selected.ok) {
      return selected;
    }
    const layout = compilerArtifactLayout({ outDir: outputDirectory(request) });
    await mkdir(layout.bundleDir, { recursive: true });
    await writeFile(layout.generatedDispatcherEntrypointPath, generatedDispatcherEntrypoint(request.entrypoint, selected.value.name, Boolean(selected.value.capabilities && Object.keys(selected.value.capabilities).length > 0)));
    const bundle = await bundleHandlerEntrypoint({
      entrypoint: layout.generatedDispatcherEntrypointPath,
      outDir: layout.bundleDir,
      portabilitySourceRoot: dirname(request.entrypoint),
      portability: {
        allowDynamicImport: false,
        allowEnvironmentAccess: request.portability.allowEnvironmentAccess,
        allowFilesystemAccess: request.portability.allowFilesystemAccess,
        allowNetworkAccess: request.portability.allowNetworkAccess,
      },
    });
    if (!bundle.ok) {
      return bundle;
    }

    const runtimeContract = await emitRuntimeContractArtifact({ outDir: layout.contractDir });
    if (!runtimeContract.ok) {
      return runtimeContract;
    }
    const wit = await emitHandlerWitArtifact({ outDir: layout.contractDir });
    if (!wit.ok) {
      return wit;
    }
    const wasm = await emitWasmComponentArtifact({ javascriptBundlePath: bundle.value.javascriptBundlePath, witPath: wit.value.path, outDir: layout.wasmDir });
    if (!wasm.ok) {
      return wasm;
    }

    const additionalArtifacts: BundleArtifact[] = [
      { kind: 'handler-wit', path: wit.value.path, digest: wit.value.digest },
      { kind: 'javascript-bundle', path: bundle.value.javascriptBundlePath, digest: await digestFile(bundle.value.javascriptBundlePath) },
      { kind: 'javascript-source-map', path: bundle.value.sourceMapPath, digest: await digestFile(bundle.value.sourceMapPath) },
      { kind: 'esbuild-metafile', path: bundle.value.metafilePath, digest: await digestFile(bundle.value.metafilePath) },
    ];

    const manifest = buildOperatorManifest({
      operator: selected.value,
      handlerArtifactPath: wasm.value.path,
      handlerArtifactDigest: wasm.value.digest,
      runtimeContractPath: runtimeContract.value.path,
      runtimeContractDigest: runtimeContract.value.digest,
      additionalArtifacts,
      runtimeVersionRange: request.runtimeVersionRange,
      containerBuildContext: layout.rootDir,
      portability: request.portability,
    });
    if (!manifest.ok) {
      return manifest;
    }

    await mkdir(layout.rootDir, { recursive: true });
    const manifestJsonPath = `${layout.rootDir}/operator-manifest.json`;
    await writeFile(manifestJsonPath, `${JSON.stringify(manifest.value, null, 2)}\n`);
    await writeFile(layout.imageDockerfilePath, emitRuntimeImageDockerfile(manifest.value));
    await writeFile(layout.applyScriptPath, emitStandaloneApplyScript(manifest.value));
    await chmod(layout.applyScriptPath, 0o755);

    const yaml = await emitOperatorKubernetesYaml({ manifest: manifest.value, operator: selected.value, outDir: layout.kubernetesDir });
    if (!yaml.ok) {
      return yaml;
    }

    const artifacts = artifactsFromPaths(manifestJsonPath, wasm.value.path, wit.value.path, yaml.value.paths, layout.imageDockerfilePath, layout.applyScriptPath, bundle.value.sourceMapPath);
    // typecast: esbuild metafiles are JSON objects whose inputs map is the only field this minimal closure graph needs.
    const metafile = JSON.parse(await readFile(bundle.value.metafilePath, 'utf8')) as { readonly inputs?: Record<string, unknown> };
    const reachableModules = Object.keys(metafile.inputs ?? {});
    const closureGraph: ClosureGraph = {
      entrypoint: request.entrypoint,
      handlers: selected.value.handlers.map((handler) => ({
        handlerId: handler.id,
        exportName: 'handle',
        sourceFile: request.entrypoint,
        reachableModules,
        capturedConstants: {},
      })),
      modules: [],
      unsupportedDependencies: [],
      hostImports: manifest.value.spec.adapterRequirements?.hostImports ?? [],
    };

    return {
      ok: true,
      value: {
        manifest: manifest.value,
        artifacts,
        schemas: [],
        // typecast: the canonical runtime contract is the authoritative ABI source for this minimal pipeline; the richer HandlerAbiDefinition facade is not emitted yet.
        handlerAbi: { definition: runtimeContract.value.contract as unknown as HandlerAbiArtifact['definition'], witSource: wit.value.witSource, path: wit.value.path, digest: wit.value.digest },
        closureGraph,
        diagnostics: bundle.value.diagnostics,
      },
    };
  }

  stages(): readonly CompilerPipelineStageName[] {
    return defaultStages;
  }
}

async function discoverExportedOperators(entrypoint: string): Promise<Result<{ readonly operators: readonly OperatorDefinition[] }>> {
  const bundleRoot = join(process.cwd(), '.applik8s-tmp', `discovery-${process.pid}-${Date.now()}`);
  const discoveryBundle = join(bundleRoot, 'entrypoint.mjs');
  try {
    await mkdir(bundleRoot, { recursive: true });
    await build({
      entryPoints: [entrypoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: discoveryBundle,
      packages: 'external',
      external: ['applik8s:handler/capabilities'],
      plugins: [applik8sWorkspaceSourcePlugin()],
    });
    // static-import-exception: compiler discovery must load the user-provided entrypoint path at runtime.
    const imported = await import(`${pathToFileURL(discoveryBundle).href}?applik8s=${Date.now()}`);
    const operators = Object.values(imported).filter(isExportedOperator).map((value) => value.definition);
    const duplicate = firstDuplicate(operators.map((operator) => operator.name));
    if (duplicate) {
      return error('BUNDLE_INVALID', `Entrypoint exports multiple operators named ${duplicate}.`);
    }
    return { ok: true, value: { operators } };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to discover exported operators.');
  } finally {
    if (process.env.APPLIK8S_KEEP_TMP !== '1') {
      await rm(bundleRoot, { recursive: true, force: true });
    }
  }
}

function generatedDispatcherEntrypoint(userEntrypoint: string, operatorName: string, hasCapabilities: boolean): string {
  return `${hasCapabilities ? "import { capabilityRequest } from 'applik8s:handler/capabilities';\n" : ''}import { dispatchOperatorHandler } from '@applik8s/sdk';
import * as userModule from ${JSON.stringify(userEntrypoint)};

const selectedExport = Object.values(userModule).find((value) => Boolean(value && typeof value === 'function' && value.definition?.name === ${JSON.stringify(operatorName)}));
if (!selectedExport) {
  throw new Error(${JSON.stringify(`Entrypoint does not export an applik8s operator named ${operatorName}.`)});
}

export async function handle(inputJson: string): Promise<string> {
  try {
    return await dispatchOperatorHandler(selectedExport.definition, inputJson${hasCapabilities ? ', { capabilityRequest }' : ''});
  } catch (cause) {
    throw new Error(cause instanceof Error ? (cause.stack ?? cause.message) : 'Handler threw an unknown error.');
  }
}
`;
}

function outputDirectory(request: CompileOperatorRequest): string {
  return request.outDir ?? join(process.cwd(), DEFAULT_OUT_DIR);
}

function isExportedOperator(value: unknown): value is { readonly definition: OperatorDefinition } {
  return Boolean(value && typeof value === 'function' && typeof Reflect.get(value, 'definition') === 'object');
}

function selectOperator(operators: readonly OperatorDefinition[], name: string | undefined): Result<OperatorDefinition> {
  if (operators.length === 0) {
    return error('BUNDLE_INVALID', 'Entrypoint does not export an applik8s operator.');
  }
  if (name) {
    const operator = operators.find((candidate) => candidate.name === name);
    return operator ? { ok: true, value: operator } : error('BUNDLE_INVALID', `Entrypoint does not export an operator named ${name}.`);
  }
  if (operators.length > 1) {
    return error('BUNDLE_INVALID', 'Entrypoint exports multiple operators; set operatorName to choose one.');
  }
  const [operator] = operators;
  return operator ? { ok: true, value: operator } : error('BUNDLE_INVALID', 'Entrypoint does not export an applik8s operator.');
}

function artifactsFromPaths(manifestJsonPath: string, handlerWasmPath: string, handlerWitPath: string, yamlPaths: readonly string[], imageDockerfilePath?: string, applyScriptPath?: string, sourceMapPath?: string): OperatorArtifacts {
  return {
    manifestJsonPath,
    handlerWasmPath,
    handlerWitPath,
    generatedCrdYamlPaths: yamlPaths.filter((path) => basename(path).startsWith('customresourcedefinition-')),
    generatedRbacYamlPath: yamlPaths.find((path) => basename(path).startsWith('role-') || basename(path).startsWith('clusterrole-')) ?? '',
    generatedServiceAccountYamlPath: yamlPaths.find((path) => basename(path).startsWith('serviceaccount-')) ?? '',
    generatedDeploymentYamlPath: yamlPaths.find((path) => basename(path).startsWith('deployment-')) ?? '',
    generatedConfigMapYamlPath: yamlPaths.find((path) => basename(path).startsWith('configmap-')) ?? '',
    ...(imageDockerfilePath ? { generatedImageDockerfilePath: imageDockerfilePath } : {}),
    ...(applyScriptPath ? { generatedApplyScriptPath: applyScriptPath } : {}),
    ...(sourceMapPath ? { sourceMapPath } : {}),
  };
}

function emitRuntimeImageDockerfile(manifest: OperatorManifest): string {
  const container = manifest.spec.container;
  if (!container?.baseImage || !container.files) {
    throw new Error('Operator manifest is missing the implicit runtime image recipe.');
  }
  const labels = container.build?.labels ?? {};
  const labelLines = Object.entries(labels).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`);
  return [
    `FROM ${imageRefString(container.baseImage)}`,
    '',
    ...(labelLines.length > 0 ? [`LABEL ${labelLines.join(' ')}`, ''] : []),
    'RUN mkdir -p /etc/applik8s /handler',
    ...container.files.flatMap((file) => [`COPY ${file.source} ${file.destination}`, ...(file.mode ? [`RUN chmod ${file.mode} ${file.destination}`] : [])]),
    '',
    'ENV APPLIK8S_MANIFEST_PATH=/etc/applik8s/operator-manifest.json',
    'ENV APPLIK8S_HANDLER_PATH=/handler/handler.wasm',
    '',
  ].join('\n');
}

function emitStandaloneApplyScript(manifest: OperatorManifest): string {
  const container = manifest.spec.container;
  if (!container?.build?.dockerfile) {
    throw new Error('Operator manifest is missing the implicit runtime image build recipe.');
  }
  const image = imageRefString(container.image);
  const baseImage = container.baseImage ? imageRefString(container.baseImage) : 'ghcr.io/applik8s/applik8s-operator-host:dev';
  const namespace = manifest.metadata.annotations?.['applik8s.dev/namespace'] ?? '';
  const shDefault = (name: string, fallback: string) => ['$', `{${name}:-${fallback}}`].join('');
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    '',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `DOCKER="${shDefault('DOCKER', 'docker')}"`,
    `KUBECTL="${shDefault('KUBECTL', 'kubectl')}"`,
    `DEFAULT_IMAGE=${JSON.stringify(image)}`,
    `IMAGE="${shDefault('APPLIK8S_IMAGE', image)}"`,
    `BASE_IMAGE="${shDefault('APPLIK8S_BASE_IMAGE', baseImage)}"`,
    `FIELD_MANAGER="${shDefault('APPLIK8S_FIELD_MANAGER', 'applik8s-standalone')}"`,
    `DEPLOYMENT=${JSON.stringify(manifest.metadata.name)}`,
    `NAMESPACE=${JSON.stringify(namespace)}`,
    '',
    `if [ "${shDefault('APPLIK8S_BUILD_BASE', '0')}" = "1" ]; then`,
    `  BASE_DOCKERFILE="${shDefault('APPLIK8S_BASE_DOCKERFILE', 'Dockerfile.operator-host')}"`,
    `  BASE_CONTEXT="${shDefault('APPLIK8S_BASE_CONTEXT', '.')}"`,
    '  "$DOCKER" build --file "$BASE_DOCKERFILE" --tag "$BASE_IMAGE" "$BASE_CONTEXT"',
    'fi',
    '',
    `"$DOCKER" build --file "$SCRIPT_DIR/${container.build.dockerfile}" --tag "$IMAGE" "$SCRIPT_DIR"`,
    `if [ "${shDefault('APPLIK8S_PUSH_IMAGE', '0')}" = "1" ]; then`,
    '  "$DOCKER" push "$IMAGE"',
    'fi',
    '',
    'for manifest in "$SCRIPT_DIR"/kubernetes/*.yaml; do',
    '  "$KUBECTL" apply --server-side --field-manager="$FIELD_MANAGER" --filename "$manifest"',
    'done',
    '',
    'if [ "$IMAGE" != "$DEFAULT_IMAGE" ]; then',
    '  if [ -n "$NAMESPACE" ]; then',
    '    "$KUBECTL" set image "deployment/$DEPLOYMENT" "operator-host=$IMAGE" --namespace "$NAMESPACE"',
    '  else',
    '    "$KUBECTL" set image "deployment/$DEPLOYMENT" "operator-host=$IMAGE"',
    '  fi',
    'fi',
    '',
  ].join('\n');
}

async function digestFile(path: string): Promise<string> {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
}

function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
