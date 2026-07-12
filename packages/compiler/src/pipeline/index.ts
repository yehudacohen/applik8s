import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import type {
  AnyResourceDefinition,
  ApplicationGraph,
  ApplicationGraphArtifactReference,
  BundleArtifact,
  Diagnostic,
  JsonObject,
  OperatorDefinition,
  OperatorManifest,
  Result,
} from '@applik8s/core';
import { applicationGraphArtifactFileName, applicationGraphMetadataProperty, serializeApplicationGraph, validateApplicationGraph } from '@applik8s/core';
import { imageRefString } from '@applik8s/typetainer';
import { build } from 'esbuild';
import ts from 'typescript';
import { parseAllDocuments, stringify } from 'yaml';
import { compilerArtifactLayout } from '../artifacts/index.js';
import { emitGeneratedApplicationProcessors } from '../application-processors/index.js';
import type { GeneratedApplicationProcessorArtifact } from '../application-processors/index.js';
import { applik8sWorkspaceSourcePlugin, bundleHandlerEntrypoint } from '../bundling/index.js';
import type {
  ClosureGraph,
  CompileOptions,
  CompileResult,
  Compiler,
  CompilerFactory,
  HandlerAbiArtifact,
  OperatorArtifacts,
} from '../interfaces.js';
import { emitOperatorKubernetesYaml } from '../kubernetes-yaml/index.js';
import { buildOperatorManifest } from '../manifest/index.js';
import { emitHandlerWitArtifact, emitRuntimeContractArtifact } from '../runtime-contract/index.js';
import { emitWasmComponentArtifact } from '../wasm-component/index.js';

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
  readonly dispatcherMode?: 'importEntrypoint' | 'staticSerializable';
}

interface CompileOperatorRequestWithDefinition extends CompileOperatorRequest {
  readonly operatorDefinition?: OperatorDefinition;
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

export interface CompileTypeKroCompositionRequest extends CompileOperatorRequest {
  readonly compositionName?: string;
}

export interface CompileTypeKroCompositionResult {
  readonly composition: CompiledTypeKroComposition;
  readonly operatorCompiles: readonly CompileResult[];
  readonly artifacts: TypeKroCompositionArtifacts;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompiledTypeKroComposition {
  readonly resources: readonly TypeKroCompositionResource[];
}

export interface TypeKroCompositionResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & {
    readonly name: string;
    readonly namespace?: string;
  };
}

export interface TypeKroCompositionBundleManifest extends JsonObject {
  readonly apiVersion: 'applik8s.dev/v1alpha1';
  readonly kind: 'TypeKroCompositionBundle';
  readonly metadata: JsonObject & { readonly name: string };
  readonly spec: JsonObject & {
    readonly entrypoint: string;
    readonly exportName?: string;
    readonly resourceCount: number;
    readonly operators: readonly TypeKroCompositionOperatorArtifactReference[];
    readonly applicationGraph?: ApplicationGraphArtifactReference;
    readonly processors?: readonly TypeKroCompositionProcessorArtifactReference[];
  };
}

export interface TypeKroCompositionOperatorArtifactReference extends JsonObject {
  readonly name: string;
  readonly manifest: string;
  readonly outDir: string;
}

export interface TypeKroCompositionProcessorArtifactReference extends JsonObject {
  readonly name: string;
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
  readonly sizeBytes: number;
}

export interface TypeKroCompositionArtifacts {
  readonly manifest: TypeKroCompositionBundleManifest;
  readonly resources: readonly TypeKroCompositionResource[];
  readonly manifestJsonPath: string;
  readonly resourcesJsonPath: string;
  readonly combinedYamlPath: string;
  readonly applyScriptPath: string;
  readonly resourceYamlPaths: readonly string[];
  readonly instanceYamlPaths: readonly string[];
  readonly applicationGraphJsonPath?: string;
  readonly processorArtifacts: readonly GeneratedApplicationProcessorArtifact[];
  readonly operatorArtifacts: readonly TypeKroCompositionOperatorArtifacts[];
}

export interface TypeKroCompositionOperatorArtifacts {
  readonly operatorName: string;
  readonly outDir: string;
  readonly manifestJsonPath: string;
}

interface EntrypointExports {
  readonly operators: readonly OperatorDefinition[];
  readonly typeKroCompositions: readonly TypeKroCompositionExport[];
}

interface TypeKroCompositionExport {
  readonly name?: string;
  readonly operatorInstalls: readonly { readonly operatorName: string; readonly operator?: unknown }[];
  resolveOperatorInstalls(options: { readonly manifests: readonly CompileResult[] }): Result<unknown>;
}

interface EmitTypeKroCompositionArtifactsRequest {
  readonly entrypoint: string;
  readonly outDir: string;
  readonly exportName?: string;
  readonly composition: CompiledTypeKroComposition;
  readonly operatorCompiles: readonly CompileResult[];
  readonly applicationGraph?: ApplicationGraph;
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

export async function compileTypeKroComposition(request: CompileTypeKroCompositionRequest): Promise<Result<CompileTypeKroCompositionResult>> {
  const discovered = await discoverEntrypointExports(request.entrypoint);
  if (!discovered.ok) {
    return discovered;
  }
  const composition = selectTypeKroComposition(discovered.value.typeKroCompositions, request.compositionName);
  if (!composition.ok) {
    return composition;
  }
  const installNames = unique(composition.value.operatorInstalls.map((install) => install.operatorName));
  const capturedOperators = new Map<string, OperatorDefinition>();
  for (const install of composition.value.operatorInstalls) {
    if (isOperatorDefinitionLike(install.operator)) {
      capturedOperators.set(install.operatorName, install.operator);
    }
  }
  const exportedOperators = new Map(discovered.value.operators.map((operator) => [operator.name, operator]));
  const missingOperator = installNames.find((operatorName) => !capturedOperators.has(operatorName) && !exportedOperators.has(operatorName));
  if (missingOperator) {
    return error('BUNDLE_INVALID', `TypeKro composition captures operator ${missingOperator}, but the captured install does not include an applik8s operator definition and the entrypoint does not export one with that name.`);
  }

  const { compositionName: _compositionName, outDir: _outDir, operatorName: _operatorName, ...operatorRequest } = request;
  const operatorCompiles: CompileResult[] = [];
  for (const operatorName of installNames) {
    const operatorDefinition = capturedOperators.get(operatorName) ?? exportedOperators.get(operatorName);
    if (!operatorDefinition) {
      return error('BUNDLE_INVALID', `TypeKro composition captures operator ${operatorName}, but no operator definition is available for compilation.`);
    }
    const compileRequest: CompileOperatorRequestWithDefinition = {
      ...operatorRequest,
      operatorName,
      operatorDefinition,
      dispatcherMode: 'staticSerializable',
      outDir: join(outputDirectory(request), 'operators', safePathSegment(operatorName)),
    };
    const compiled = await createCompilerPipeline().run(compileRequest);
    if (!compiled.ok) {
      return compiled;
    }
    operatorCompiles.push(compiled.value);
  }

  const resolved = composition.value.resolveOperatorInstalls({ manifests: operatorCompiles });
  if (!resolved.ok) {
    return resolved;
  }
  const resolvedComposition = compiledTypeKroComposition(resolved.value);
  if (!resolvedComposition.ok) {
    return resolvedComposition;
  }
  const applicationGraph = applicationGraphForComposition(composition.value);
  if (applicationGraph) {
    const graphDiagnostics = validateApplicationGraph(applicationGraph);
    if (graphDiagnostics.length > 0) {
      return error('COMPATIBILITY_FAILED', `Application graph is invalid: ${graphDiagnostics.map((diagnostic) => diagnostic.message).join('; ')}`);
    }
  }
  const artifacts = await emitTypeKroCompositionArtifacts({
    entrypoint: request.entrypoint,
    outDir: join(outputDirectory(request), 'typekro'),
    composition: resolvedComposition.value,
    operatorCompiles,
    ...(applicationGraph ? { applicationGraph } : {}),
    ...(composition.value.name ? { exportName: composition.value.name } : {}),
  });
  if (!artifacts.ok) {
    return artifacts;
  }
  return {
    ok: true,
    value: {
      composition: resolvedComposition.value,
      operatorCompiles,
      artifacts: artifacts.value,
      diagnostics: operatorCompiles.flatMap((compiled) => compiled.diagnostics),
    },
  };
}

async function emitTypeKroCompositionArtifacts(request: EmitTypeKroCompositionArtifactsRequest): Promise<Result<TypeKroCompositionArtifacts>> {
  try {
    const processorArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationProcessors({ graph: request.applicationGraph, outDir: join(request.outDir, 'processors'), entrypoint: request.entrypoint })
      : [];
    // typecast: generated processor resources are concrete Kubernetes JSON objects and are validated by the same serialization path as composition resources.
    const processorResources = processorArtifacts.flatMap((artifact) => artifact.resources) as unknown as readonly TypeKroCompositionResource[];
    const baseFactoryArtifacts = typeKroFactoryArtifacts(request.composition);
    const factoryArtifacts = request.applicationGraph
      ? injectGeneratedResourcesIntoApplicationRgd(baseFactoryArtifacts, processorResources, request.applicationGraph.metadata.name)
      : baseFactoryArtifacts;
    const resources = uniqueCompositionResources([
      ...factoryArtifacts.resources,
      ...compositionResources(request.composition),
      ...processorResources,
    ]);
    const resourcesDir = join(request.outDir, 'resources');
    const instancesDir = join(request.outDir, 'instances');
    await rm(resourcesDir, { recursive: true, force: true });
    await rm(instancesDir, { recursive: true, force: true });
    await mkdir(resourcesDir, { recursive: true });
    await mkdir(instancesDir, { recursive: true });

    const manifestJsonPath = join(request.outDir, 'typekro-composition.json');
    const resourcesJsonPath = join(request.outDir, 'resources.json');
    const combinedYamlPath = join(request.outDir, 'resources.yaml');
    const applyScriptPath = join(request.outDir, 'apply.sh');
    const templateManifestListPath = join(request.outDir, 'template-manifests.txt');
    const applicationGraphJsonPath = request.applicationGraph ? join(request.outDir, applicationGraphArtifactFileName) : undefined;
    const resourceYamlPaths: string[] = [];
    const instanceYamlPaths: string[] = [];
    const templateFingerprints = typeKroTemplateResourceFingerprints(resources);
    const templateManifestFileNames: string[] = [];
    if (request.applicationGraph && applicationGraphJsonPath) {
      await writeFile(applicationGraphJsonPath, serializeApplicationGraph(request.applicationGraph));
    }
    const applicationGraphDigest = applicationGraphJsonPath ? await digestFile(applicationGraphJsonPath) : undefined;

    const manifest: TypeKroCompositionBundleManifest = {
      apiVersion: 'applik8s.dev/v1alpha1',
      kind: 'TypeKroCompositionBundle',
      metadata: {
        name: request.exportName ?? 'typekro-composition',
      },
      spec: {
        entrypoint: request.entrypoint,
        ...(request.exportName ? { exportName: request.exportName } : {}),
        resourceCount: resources.length,
        ...(request.applicationGraph && applicationGraphJsonPath && applicationGraphDigest ? {
          applicationGraph: {
            apiVersion: request.applicationGraph.apiVersion,
            path: applicationGraphJsonPath,
            digest: applicationGraphDigest,
          },
        } : {}),
        operators: request.operatorCompiles.map((compiled) => ({
          name: compiled.manifest.metadata.name,
          manifest: compiled.artifacts.manifestJsonPath,
          outDir: dirname(compiled.artifacts.manifestJsonPath),
        })),
        ...(processorArtifacts.length > 0 ? { processors: processorArtifacts.map((artifact) => ({ name: artifact.name, manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes })) } : {}),
      },
    };

    await writeFile(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(resourcesJsonPath, `${JSON.stringify(resources, null, 2)}\n`);
    await writeFile(combinedYamlPath, resources.map((resource) => stringify(resource)).join('---\n'));
    await writeFile(applyScriptPath, emitTypeKroApplyScript(resources));
    await chmod(applyScriptPath, 0o755);

    for (const [index, resource] of resources.entries()) {
      const fileName = `${compositionResourceFileName(resource, index)}.yaml`;
      const path = join(resourcesDir, fileName);
      await writeFile(path, stringify(resource));
      resourceYamlPaths.push(path);
      if (isTypeKroTemplateResource(resource, templateFingerprints) || isTypeKroExternalReferenceResource(resource)) {
        templateManifestFileNames.push(fileName);
      }
    }

    const instanceResources = factoryArtifacts.instances.length > 0 ? factoryArtifacts.instances : typeKroInstanceResources(resources);
    for (const [index, instance] of instanceResources.entries()) {
      const path = join(instancesDir, `${compositionResourceFileName(instance, index)}.yaml`);
      await writeFile(path, stringify(instance));
      instanceYamlPaths.push(path);
    }
    await writeFile(templateManifestListPath, templateManifestFileNames.map((fileName) => `${fileName}\n`).join(''));

    return {
      ok: true,
      value: {
        manifest,
        resources,
        manifestJsonPath,
        resourcesJsonPath,
        combinedYamlPath,
        applyScriptPath,
        resourceYamlPaths,
        instanceYamlPaths,
        ...(applicationGraphJsonPath ? { applicationGraphJsonPath } : {}),
        processorArtifacts,
        operatorArtifacts: request.operatorCompiles.map((compiled) => ({
          operatorName: compiled.manifest.metadata.name,
          outDir: dirname(compiled.artifacts.manifestJsonPath),
          manifestJsonPath: compiled.artifacts.manifestJsonPath,
        })),
      },
    };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to emit TypeKro composition artifacts.');
  }
}

function injectGeneratedResourcesIntoApplicationRgd(
  artifacts: TypeKroFactoryArtifactsProjection,
  generatedResources: readonly TypeKroCompositionResource[],
  applicationName: string,
): TypeKroFactoryArtifactsProjection {
  const target = artifacts.resources.find((resource) => resource.apiVersion === 'kro.run/v1alpha1' && resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === applicationName);
  if (!target) {
    if (generatedResources.length === 0) return artifacts;
    throw new Error(`Application ${applicationName} generated processor resources but its TypeKro ResourceGraphDefinition was not found.`);
  }
  const spec = target.spec;
  if (!isJsonObject(spec) || !Array.isArray(spec.resources)) throw new Error(`Application ResourceGraphDefinition ${applicationName} does not expose spec.resources.`);
  // CRDs are cluster-scoped installation prerequisites shared by every instance.
  // Keeping them outside the per-instance graph prevents one instance deletion
  // from removing the API and avoids CRD cleanup finalizers blocking KRO teardown.
  const existingResources = spec.resources.filter((resource) => !isResourceGraphTemplateKind(resource, 'CustomResourceDefinition'));
  const injected = generatedResources.map((resource, index) => ({
    id: `applik8sGenerated${safeResourceIdentifier(resource.kind)}${safeResourceIdentifier(String(resource.metadata.name))}${index + 1}`,
    template: resource,
  }));
  return {
    ...artifacts,
    resources: artifacts.resources.map((resource) => resource === target ? {
      ...resource,
      spec: { ...spec, resources: [...existingResources, ...injected] },
    } : resource),
  };
}

function isResourceGraphTemplateKind(resource: unknown, kind: string): boolean {
  if (!isJsonObject(resource) || !isJsonObject(resource.template)) return false;
  return resource.template.kind === kind;
}

function safeResourceIdentifier(value: string): string {
  const identifier = value.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next: string | undefined) => next?.toUpperCase() ?? '');
  return identifier.length > 0 ? `${identifier[0]?.toUpperCase()}${identifier.slice(1)}` : 'Resource';
}

function applicationGraphForComposition(composition: object): ApplicationGraph | undefined {
  const graph = Reflect.get(composition, applicationGraphMetadataProperty);
  return graph && typeof graph === 'object' && Reflect.get(graph, 'apiVersion') === 'applik8s.appGraph/v1alpha1' && Reflect.get(graph, 'kind') === 'ApplicationGraph'
    // typecast: composition graph metadata is attached by @applik8s/applik8s using the shared core property key and is structurally checked before narrowing here.
    ? graph as ApplicationGraph
    : undefined;
}

function compiledTypeKroComposition(value: unknown): Result<CompiledTypeKroComposition> {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return error('BUNDLE_INVALID', 'Resolved TypeKro composition is not an object and cannot emit composition artifacts.');
  }
  const resources = compositionResources(value);
  return { ok: true, value: Object.assign(value, { resources }) };
}

function compositionResources(composition: object | ((...args: never[]) => unknown)): readonly TypeKroCompositionResource[] {
  if (!composition || (typeof composition !== 'object' && typeof composition !== 'function')) {
    throw new Error('Resolved TypeKro composition is not an object and cannot emit composition artifacts.');
  }
  const resources = Reflect.get(composition, 'resources');
  if (!Array.isArray(resources)) {
    throw new Error('Resolved TypeKro composition does not expose a resources array for artifact emission.');
  }
  return resources.map((resource, index) => serializeCompositionResource(resource, index));
}

interface TypeKroFactoryArtifactsProjection {
  readonly resources: readonly TypeKroCompositionResource[];
  readonly instances: readonly TypeKroCompositionResource[];
}

function typeKroFactoryArtifacts(composition: object | ((...args: never[]) => unknown)): TypeKroFactoryArtifactsProjection {
  const factory = Reflect.get(composition, 'factory');
  if (typeof factory !== 'function') {
    return { resources: [], instances: [] };
  }

  const kroFactory = factory.call(composition, 'kro');
  if (!kroFactory || (typeof kroFactory !== 'object' && typeof kroFactory !== 'function')) {
    return { resources: [], instances: [] };
  }
  const toYaml = Reflect.get(kroFactory, 'toYaml');
  if (typeof toYaml !== 'function') {
    return { resources: [], instances: [] };
  }

  const resources = parseTypeKroYamlResources(toYaml.call(kroFactory));
  try {
    return { resources, instances: parseTypeKroYamlResources(toYaml.call(kroFactory, {})) };
  } catch {
    return { resources, instances: [] };
  }
}

function parseTypeKroYamlResources(source: unknown): readonly TypeKroCompositionResource[] {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return [];
  }
  return parseAllDocuments(source)
    .map((document) => document.toJSON())
    .filter((value): value is object => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    .map((resource, index) => serializeCompositionResource(resource, index));
}

function uniqueCompositionResources(resources: readonly TypeKroCompositionResource[]): readonly TypeKroCompositionResource[] {
  const seen = new Set<string>();
  const uniqueResources: TypeKroCompositionResource[] = [];
  for (const [index, resource] of resources.entries()) {
    const key = kubernetesResourceFingerprint(resource) ?? `${index}\u0000${resource.apiVersion}\u0000${resource.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueResources.push(resource);
  }
  return uniqueResources;
}

function serializeCompositionResource(resource: unknown, index: number): TypeKroCompositionResource {
  if (!resource || typeof resource !== 'object') {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not an object.`);
  }
  // typecast: JSON.parse returns any; immediately re-narrow to JsonObject before using the serialized resource.
  const serialized = JSON.parse(JSON.stringify(resource)) as unknown;
  if (!isJsonObject(serialized)) {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not JSON-serializable as an object.`);
  }
  const normalized = normalizeKubernetesTopLevelLists(serialized);
  if (!isTypeKroCompositionResource(normalized)) {
    const resourceNumber = index + 1;
    if (!isJsonObject(normalized)) {
      throw new Error(`Resolved TypeKro resource ${resourceNumber} is not JSON-serializable as an object.`);
    }
    if (typeof normalized.apiVersion !== 'string') {
      throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing apiVersion.`);
    }
    if (typeof normalized.kind !== 'string') {
      throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing kind.`);
    }
    throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing metadata.name.`);
  }
  return normalized;
}

const kubernetesTopLevelListFields: Readonly<Record<string, readonly string[]>> = {
  'rbac.authorization.k8s.io/v1|ClusterRole': ['rules'],
  'rbac.authorization.k8s.io/v1|ClusterRoleBinding': ['subjects'],
  'rbac.authorization.k8s.io/v1|Role': ['rules'],
  'rbac.authorization.k8s.io/v1|RoleBinding': ['subjects'],
};

function normalizeKubernetesTopLevelLists(resource: JsonObject): JsonObject {
  const apiVersion = typeof resource.apiVersion === 'string' ? resource.apiVersion : undefined;
  const kind = typeof resource.kind === 'string' ? resource.kind : undefined;
  const listFields = apiVersion && kind ? kubernetesTopLevelListFields[`${apiVersion}|${kind}`] : undefined;
  if (!listFields) {
    return resource;
  }

  let normalized: Record<string, unknown> | undefined;
  for (const field of listFields) {
    const list = numericKeyedObjectToArray(resource[field]);
    if (list) {
      normalized ??= { ...resource };
      normalized[field] = list;
    }
  }
  // typecast: values originated from JSON serialization; this function only restores known Kubernetes list fields from TypeKro's numeric object encoding.
  return (normalized ?? resource) as JsonObject;
}

function numericKeyedObjectToArray(value: unknown): unknown[] | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  const indexed: { readonly index: number; readonly entry: unknown }[] = [];
  for (const [key, entry] of entries) {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      return undefined;
    }
    indexed.push({ index: Number(key), entry });
  }
  indexed.sort((left, right) => left.index - right.index);
  for (const [expectedIndex, entry] of indexed.entries()) {
    if (entry.index !== expectedIndex) {
      return undefined;
    }
  }
  return indexed.map((entry) => entry.entry);
}

function isTypeKroCompositionResource(value: unknown): value is TypeKroCompositionResource {
  return Boolean(
    isJsonObject(value) &&
      typeof value.apiVersion === 'string' &&
      typeof value.kind === 'string' &&
      isJsonObject(value.metadata) &&
      typeof value.metadata.name === 'string'
  );
}

function isTypeKroExternalReferenceResource(resource: TypeKroCompositionResource): boolean {
  return Reflect.get(resource, '__externalRef') === true;
}

function compositionResourceFileName(resource: TypeKroCompositionResource, index: number): string {
  const metadata = resource.metadata;
  const namespace = typeof metadata.namespace === 'string' ? `${metadata.namespace}-` : '';
  const name = typeof metadata.name === 'string' ? metadata.name : `resource-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${safePathSegment(String(resource.kind ?? 'resource').toLowerCase())}-${safePathSegment(`${namespace}${name}`.toLowerCase())}`;
}

function typeKroTemplateResourceFingerprints(resources: readonly TypeKroCompositionResource[]): ReadonlySet<string> {
  const fingerprints = new Set<string>();
  for (const rgd of typeKroResourceGraphDefinitions(resources)) {
    for (const template of typeKroResourceGraphTemplates(rgd)) {
      const fingerprint = kubernetesResourceFingerprint(template);
      if (fingerprint) {
        fingerprints.add(fingerprint);
      }
    }
  }
  return fingerprints;
}

function typeKroInstanceResources(resources: readonly TypeKroCompositionResource[]): readonly TypeKroCompositionResource[] {
  return typeKroResourceGraphDefinitions(resources).map((rgd) => {
    const schema = typeKroResourceGraphSchema(rgd);
    const kind = typeof schema?.kind === 'string' ? schema.kind : undefined;
    const schemaApiVersion = typeof schema?.apiVersion === 'string' ? schema.apiVersion : undefined;
    if (!kind || !schemaApiVersion) {
      throw new Error(`ResourceGraphDefinition ${rgd.metadata.name} is missing spec.schema.kind or spec.schema.apiVersion.`);
    }
    const version = schemaApiVersion.includes('/') ? schemaApiVersion.split('/').at(-1) : schemaApiVersion;
    const group = typeof schema?.group === 'string' && schema.group.length > 0 ? schema.group : 'kro.run';
    const namespace = unique(typeKroResourceGraphTemplates(rgd).map((template) => template.metadata.namespace).filter((value): value is string => typeof value === 'string'));
    return {
      apiVersion: `${group}/${version}`,
      kind,
      metadata: {
        name: rgd.metadata.name,
        ...(namespace.length === 1 ? { namespace: namespace[0] } : {}),
      },
      spec: {},
    };
  });
}

function typeKroSchemaApiResources(resources: readonly TypeKroCompositionResource[]): readonly { readonly group: string; readonly kind: string }[] {
  const apiResources = typeKroResourceGraphDefinitions(resources).flatMap((rgd) => {
    const schema = typeKroResourceGraphSchema(rgd);
    const kind = typeof schema?.kind === 'string' ? schema.kind : undefined;
    const apiVersion = typeof schema?.apiVersion === 'string' ? schema.apiVersion : undefined;
    const group = typeof schema?.group === 'string' && schema.group.length > 0 ? schema.group : apiVersion?.split('/')[0];
    return kind && group ? [{ group, kind }] : [];
  });
  const seen = new Set<string>();
  return apiResources.filter((resource) => {
    const key = `${resource.group}/${resource.kind}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isTypeKroTemplateResource(resource: TypeKroCompositionResource, templateFingerprints: ReadonlySet<string>): boolean {
  const fingerprint = kubernetesResourceFingerprint(resource);
  return Boolean(fingerprint && templateFingerprints.has(fingerprint));
}

function typeKroResourceGraphDefinitions(resources: readonly TypeKroCompositionResource[]): TypeKroCompositionResource[] {
  return resources.filter((resource) => resource.apiVersion === 'kro.run/v1alpha1' && resource.kind === 'ResourceGraphDefinition');
}

function typeKroResourceGraphSchema(rgd: TypeKroCompositionResource): JsonObject | undefined {
  const spec = rgd.spec;
  if (!isJsonObject(spec)) {
    return undefined;
  }
  const schema = spec.schema;
  return isJsonObject(schema) ? schema : undefined;
}

function typeKroResourceGraphTemplates(rgd: TypeKroCompositionResource): TypeKroCompositionResource[] {
  const spec = rgd.spec;
  if (!isJsonObject(spec) || !Array.isArray(spec.resources)) {
    return [];
  }
  return spec.resources.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }
    const template = entry.template;
    return isTypeKroCompositionResource(template) ? [template] : [];
  });
}

function kubernetesResourceFingerprint(resource: Pick<TypeKroCompositionResource, 'apiVersion' | 'kind' | 'metadata'>): string | undefined {
  if (typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string' || !isJsonObject(resource.metadata) || typeof resource.metadata.name !== 'string') {
    return undefined;
  }
  const namespace = typeof resource.metadata.namespace === 'string' ? resource.metadata.namespace : '';
  return `${resource.apiVersion}\u0000${resource.kind}\u0000${namespace}\u0000${resource.metadata.name}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

    // typecast: CompileOperatorRequest may carry an in-memory operator definition on the generated TypeKro path.
    const providedOperator = (request as CompileOperatorRequestWithDefinition).operatorDefinition;
    const selected = providedOperator
      ? selectProvidedOperator(providedOperator, request.operatorName)
      : await discoverAndSelectOperator(request.entrypoint, request.operatorName);
    if (!selected.ok) {
      return selected;
    }
    const layout = compilerArtifactLayout({ outDir: outputDirectory(request) });
    await mkdir(layout.bundleDir, { recursive: true });
    const hasCapabilities = Boolean(selected.value.capabilities && Object.keys(selected.value.capabilities).length > 0);
    const dispatcher = generatedDispatcherEntrypoint(request.entrypoint, selected.value, hasCapabilities, true, request.dispatcherMode ?? 'importEntrypoint');
    if (!dispatcher.ok) {
      return dispatcher;
    }
    await writeFile(layout.generatedDispatcherEntrypointPath, dispatcher.value);
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
  const discovered = await discoverEntrypointExports(entrypoint);
  return discovered.ok ? { ok: true, value: { operators: discovered.value.operators } } : discovered;
}

async function discoverEntrypointExports(entrypoint: string): Promise<Result<EntrypointExports>> {
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
      nodePaths: [join(process.cwd(), 'node_modules')],
      tsconfigRaw: { compilerOptions: {} },
      outfile: discoveryBundle,
      banner: {
        js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
      },
      external: ['applik8s:handler/capabilities', 'applik8s:handler/kubernetes', '@applik8s/compiler', '@applik8s/compiler/*', 'esbuild', 'typekro', 'typekro/*', '@napi-rs/lzma-*', '@oxc-parser/binding-*'],
      plugins: [applik8sWorkspaceSourcePlugin()],
    });
    const discoverySpecifier = `${pathToFileURL(discoveryBundle).href}?applik8s=${Date.now()}`;
    // static-import-exception: compiler discovery must load generated user entrypoint bundles at runtime; typecast: discovery bundles are namespace objects and exports are structurally narrowed before use.
    const imported = (await import(/* @vite-ignore */ discoverySpecifier)) as Record<string, unknown>;
    const operators = Object.values(imported).filter(isExportedOperator).map((value) => value.definition);
    const duplicate = firstDuplicate(operators.map((operator) => operator.name));
    if (duplicate) {
      return error('BUNDLE_INVALID', `Entrypoint exports multiple operators named ${duplicate}.`);
    }
    const typeKroCompositions: TypeKroCompositionExport[] = [];
    for (const [name, value] of Object.entries(imported)) {
      if (isExportedTypeKroComposition(value)) {
        typeKroCompositions.push(Object.assign(value, { name }));
      }
    }
    return { ok: true, value: { operators, typeKroCompositions } };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : `Failed to discover exported entrypoint exports: ${inspect(cause)}`);
  } finally {
    deferTemporaryDirectoryCleanup(bundleRoot);
  }
}

const deferredTemporaryDirectoryCleanups = new Set<string>();
let temporaryDirectoryCleanupRegistered = false;

function deferTemporaryDirectoryCleanup(directory: string): void {
  if (process.env.APPLIK8S_KEEP_TMP === '1') {
    return;
  }
  deferredTemporaryDirectoryCleanups.add(directory);
  if (temporaryDirectoryCleanupRegistered) {
    return;
  }
  temporaryDirectoryCleanupRegistered = true;
  process.once('exit', () => {
    for (const cleanupDirectory of deferredTemporaryDirectoryCleanups) {
      rmSync(cleanupDirectory, { recursive: true, force: true });
    }
    deferredTemporaryDirectoryCleanups.clear();
  });
}

function generatedDispatcherEntrypoint(userEntrypoint: string, operator: OperatorDefinition, hasCapabilities: boolean, hasKubernetesRead: boolean, mode: CompileOperatorRequest['dispatcherMode']): Result<string> {
  const staticOperator = staticSerializableOperatorSource(operator);
  if (staticOperator.ok) {
    return { ok: true, value: dispatcherProgram(staticOperator.value.source, hasCapabilities, hasKubernetesRead, staticOperator.value.imports) };
  }
  if (mode === 'staticSerializable' || operator.handlers.length === 0) {
    return staticOperator;
  }

  const operatorName = operator.name;
  return { ok: true, value: `${hasCapabilities ? "import { capabilityRequest } from 'applik8s:handler/capabilities';\n" : ''}${hasKubernetesRead ? "import { kubernetesRead } from 'applik8s:handler/kubernetes';\n" : ''}
import { dispatchOperatorHandler } from '@applik8s/sdk';
import * as userModule from ${JSON.stringify(userEntrypoint)};

const selectedExport = Object.values(userModule).find((value) => Boolean(value && typeof value === 'function' && value.definition?.name === ${JSON.stringify(operatorName)}));
if (!selectedExport) {
  throw new Error(${JSON.stringify(`Entrypoint does not export an applik8s operator named ${operatorName}.`)});
}

export async function handle(inputJson: string): Promise<string> {
  try {
    return await dispatchOperatorHandler(selectedExport.definition, inputJson${hasCapabilities || hasKubernetesRead ? `, {${hasCapabilities ? ' capabilityRequest,' : ''}${hasKubernetesRead ? ' kubernetesRead' : ''} }` : ''});
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Handler threw an unknown error.';
    const stack = cause instanceof Error ? cause.stack : undefined;
    throw (stack && !stack.includes(message) ? message + '\\n' + stack : (stack ?? message));
  }
}
` };
}

function dispatcherProgram(operatorSource: string, hasCapabilities: boolean, hasKubernetesRead: boolean, capturedImports: readonly string[] = []): string {
  return `${capturedImports.join('\n')}${capturedImports.length > 0 ? '\n' : ''}${hasCapabilities ? "import { capabilityRequest } from 'applik8s:handler/capabilities';\n" : ''}${hasKubernetesRead ? "import { kubernetesRead } from 'applik8s:handler/kubernetes';\n" : ''}
import { dispatchOperatorHandler } from '@applik8s/sdk';

const selectedExport = { definition: ${operatorSource} };

export async function handle(inputJson: string): Promise<string> {
  try {
    return await dispatchOperatorHandler(selectedExport.definition, inputJson${hasCapabilities || hasKubernetesRead ? `, {${hasCapabilities ? ' capabilityRequest,' : ''}${hasKubernetesRead ? ' kubernetesRead' : ''} }` : ''});
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Handler threw an unknown error.';
    const stack = cause instanceof Error ? cause.stack : undefined;
    throw (stack && !stack.includes(message) ? message + '\\n' + stack : (stack ?? message));
  }
}
`;
}

function staticSerializableOperatorSource(operator: OperatorDefinition): Result<{ readonly source: string; readonly imports: readonly string[] }> {
  const handlerRegistrations: string[] = [];
  const capturedImports = new Set<string>();
  const resourceIdentifiers = staticResourceIdentifiers(operator.resources);
  const allowedFreeIdentifiers = new Set(resourceIdentifiers.map((resource) => resource.identifier));
  for (const registration of operator.handlers) {
    const handler = Reflect.get(registration, 'handler');
    if (typeof handler !== 'function') {
      return error('BUNDLE_INVALID', `Handler ${registration.id} cannot be statically bundled because it does not carry a runnable handler function.`);
    }
    const handlerSource = staticHandlerSource(handler, registration.id, allowedFreeIdentifiers);
    if (!handlerSource.ok) {
      return handlerSource;
    }
    const serializableRegistration = toSerializableJson(registrationWithoutHandler(registration), `handler ${registration.id}`);
    if (!serializableRegistration.ok) {
      return serializableRegistration;
    }
    for (const capturedImport of handlerSource.value.imports) capturedImports.add(capturedImport);
    handlerRegistrations.push(`Object.assign(${JSON.stringify(serializableRegistration.value)}, { handler: (${handlerSource.value.source}) })`);
  }

  const operatorWithoutHandlers = toSerializableJson({ ...operator, handlers: [] }, `operator ${operator.name}`);
  if (!operatorWithoutHandlers.ok) {
    return operatorWithoutHandlers;
  }
  const operatorSource = JSON.stringify(operatorWithoutHandlers.value);
  if (resourceIdentifiers.length === 0) {
    return { ok: true, value: { source: `Object.assign(${operatorSource}, { handlers: [${handlerRegistrations.join(', ')}] })`, imports: [...capturedImports].sort() } };
  }
  const resourceBindings = resourceIdentifiers.map((resource) => `const ${resource.identifier} = __operator.resources[${JSON.stringify(resource.key)}];`).join('\n');
  return {
    ok: true,
    value: { source: `(() => {
const __operator = ${operatorSource};
${resourceBindings}
return Object.assign(__operator, { handlers: [${handlerRegistrations.join(', ')}] });
})()`, imports: [...capturedImports].sort() },
  };
}

function staticHandlerSource(handler: (...args: never[]) => unknown, handlerId: string, allowedFreeIdentifiers: ReadonlySet<string>): Result<{ readonly source: string; readonly imports: readonly string[] }> {
  const source = handler.toString();
  if (source.includes('[native code]')) {
    return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled because it is native code.`);
  }
  const capturedImports = likelyFreeIdentifiers(source)
    .filter((identifier) => !allowedFreeIdentifiers.has(identifier))
    .flatMap((identifier) => staticHandlerCapturedImports.get(identifier) ?? []);
  const freeIdentifiers = likelyFreeIdentifiers(source).filter((identifier) => !allowedFreeIdentifiers.has(identifier) && !staticHandlerCapturedImports.has(identifier));
  if (freeIdentifiers.length > 0) {
    return error(
      'BUNDLE_INVALID',
      `Handler ${handlerId} cannot be statically bundled. The app-level reconcile callback references module-scope identifier(s) that are not available inside the generated runtime: ${freeIdentifiers.join(', ')}. Keep plain constants and helper functions inside the reconcile handler, or pass literal data through the reconciled resource spec/status so the generated handler is self-contained. Substrate detail: static handler serialization cannot capture JavaScript module scope into the WASM dispatcher.`
    );
  }
  try {
    new Function(`return (${source});`);
  } catch (cause) {
    return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled from its function source: ${cause instanceof Error ? cause.message : 'invalid function source'}.`);
  }
  return { ok: true, value: { source, imports: [...new Set(capturedImports)].sort() } };
}

const staticHandlerCapturedImports = new Map<string, readonly string[]>([
  ['KubeConfig', ["import { KubeConfig } from '@kubernetes/client-node';"]],
  ['ObjectCoreV1Api', ["import { CoreV1Api as ObjectCoreV1Api } from '@kubernetes/client-node';"]],
  ['ObjectAppsV1Api', ["import { AppsV1Api as ObjectAppsV1Api } from '@kubernetes/client-node';"]],
  ['ObjectCustomObjectsApi', ["import { CustomObjectsApi as ObjectCustomObjectsApi } from '@kubernetes/client-node';"]],
]);

function staticResourceIdentifiers(resources: Readonly<Record<string, AnyResourceDefinition>>): readonly { readonly identifier: string; readonly key: string }[] {
  const identifiers = new Map<string, string>();
  for (const [key, resource] of Object.entries(resources)) {
    for (const candidate of [key, resource.kind, uncapitalize(resource.kind)]) {
      if (isJavaScriptIdentifier(candidate) && !staticHandlerKnownGlobals.has(candidate) && !staticHandlerKeywords.has(candidate) && !identifiers.has(candidate)) {
        identifiers.set(candidate, key);
      }
    }
  }
  return [...identifiers.entries()].map(([identifier, key]) => ({ identifier, key }));
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}

function uncapitalize(value: string): string {
  return value ? value[0]?.toLowerCase() + value.slice(1) : value;
}

const staticHandlerKnownGlobals = new Set([
  'Array',
  'Boolean',
  'Date',
  'Error',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'URL',
  'console',
  'decodeURIComponent',
  'encodeURIComponent',
  'globalThis',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'process',
  'undefined',
]);

const staticHandlerKeywords = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

function likelyFreeIdentifiers(source: string): readonly string[] {
  const declared = new Set<string>();
  const file = ts.createSourceFile('applik8s-static-handler.ts', `const __applik8sHandler = (${source});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const collectBindingName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      declared.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) collectBindingName(element.name);
    }
  };
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) collectBindingName(node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) collectBindingName(node.variableDeclaration.name);
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(file);
  const free = new Set<string>();
  const collectReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const identifier = node.text;
      if (!declared.has(identifier) && !staticHandlerKnownGlobals.has(identifier) && isStaticHandlerIdentifierReference(node)) {
        free.add(identifier);
        if (process.env.APPLIK8S_DEBUG_STATIC_CAPTURES === '1') {
          console.error(JSON.stringify({ component: 'static-handler-capture-analysis', identifier, node: node.getText(file), parent: ts.SyntaxKind[node.parent.kind], context: node.parent.getText(file).slice(0, 240) }));
        }
      }
    }
    ts.forEachChild(node, collectReferences);
  };
  collectReferences(file);
  return [...free].sort();
}

function isStaticHandlerIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.propertyName === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)
    || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
    || (ts.isQualifiedName(parent) && parent.right === node)
    || ts.isImportSpecifier(parent)
    || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent)) {
    return false;
  }
  return !isTypeOnlyStaticHandlerIdentifier(node);
}

function isTypeOnlyStaticHandlerIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    current = current.parent;
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

function registrationWithoutHandler(registration: object): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(registration)) {
    if (key !== 'handler') {
      output[key] = value;
    }
  }
  return output;
}

function toSerializableJson(value: unknown, path: string): Result<unknown> {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (isRuntimeSchemaForStaticSerialization(value)) {
    const schema = value.emitJsonSchema();
    if (!schema.ok) {
      return schema;
    }
    return {
      ok: true,
      value: {
        source: schema.value,
        contract: value.contract,
      },
    };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const [index, item] of value.entries()) {
      const serialized = toSerializableJson(item, `${path}[${index}]`);
      if (!serialized.ok) {
        return serialized;
      }
      items.push(serialized.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value === 'function') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return { ok: true, value: undefined };
    }
    return toSerializableJson(Object.fromEntries(entries), path);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        continue;
      }
      const serialized = toSerializableJson(child, `${path}.${key}`);
      if (!serialized.ok) {
        return serialized;
      }
      if (serialized.value === undefined) {
        continue;
      }
      output[key] = serialized.value;
    }
    return { ok: true, value: output };
  }

  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return error('BUNDLE_INVALID', `${path} contains a value that cannot be statically serialized.`);
}

function isRuntimeSchemaForStaticSerialization(value: unknown): value is { readonly contract: unknown; emitJsonSchema(): Result<unknown> } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'contract' in value &&
      typeof Reflect.get(value, 'emitJsonSchema') === 'function'
  );
}

function outputDirectory(request: CompileOperatorRequest): string {
  return request.outDir ?? join(process.cwd(), DEFAULT_OUT_DIR);
}

function isExportedOperator(value: unknown): value is { readonly definition: OperatorDefinition } {
  return Boolean(value && typeof value === 'function' && typeof Reflect.get(value, 'definition') === 'object');
}

function isExportedTypeKroComposition(value: unknown): value is TypeKroCompositionExport {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      Array.isArray(Reflect.get(value, 'operatorInstalls')) &&
      typeof Reflect.get(value, 'resolveOperatorInstalls') === 'function'
  );
}

function selectTypeKroComposition(compositions: readonly TypeKroCompositionExport[], name: string | undefined): Result<TypeKroCompositionExport> {
  if (compositions.length === 0) {
    return error('BUNDLE_INVALID', 'Entrypoint does not export an applik8s-wrapped TypeKro composition.');
  }
  if (name) {
    const composition = compositions.find((candidate) => candidate.name === name);
    return composition ? { ok: true, value: composition } : error('BUNDLE_INVALID', `Entrypoint does not export a TypeKro composition named ${name}.`);
  }
  if (compositions.length > 1) {
    return error('BUNDLE_INVALID', 'Entrypoint exports multiple TypeKro compositions; set compositionName to choose one.');
  }
  const [composition] = compositions;
  return composition ? { ok: true, value: composition } : error('BUNDLE_INVALID', 'Entrypoint does not export an applik8s-wrapped TypeKro composition.');
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

async function discoverAndSelectOperator(entrypoint: string, name: string | undefined): Promise<Result<OperatorDefinition>> {
  const discovered = await discoverExportedOperators(entrypoint);
  return discovered.ok ? selectOperator(discovered.value.operators, name) : discovered;
}

function selectProvidedOperator(operator: OperatorDefinition, name: string | undefined): Result<OperatorDefinition> {
  if (name && operator.name !== name) {
    return error('BUNDLE_INVALID', `Provided operator definition is named ${operator.name}, but compile requested operator ${name}.`);
  }
  return { ok: true, value: operator };
}

function isOperatorDefinitionLike(value: unknown): value is OperatorDefinition {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof Reflect.get(value, 'name') === 'string' &&
      isJsonObject(Reflect.get(value, 'resources')) &&
      Array.isArray(Reflect.get(value, 'handlers'))
  );
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
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

function emitTypeKroApplyScript(resources: readonly TypeKroCompositionResource[]): string {
  const shDefault = (name: string, fallback: string) => ['$', `{${name}:-${fallback}}`].join('');
  const schemaApiResourceWaits = typeKroSchemaApiResources(resources).map((resource) => `wait_for_api_resource ${shellQuote(resource.group)} ${shellQuote(resource.kind)}`);
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    '',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `KUBECTL="${shDefault('KUBECTL', 'kubectl')}"`,
    `FIELD_MANAGER="${shDefault('APPLIK8S_FIELD_MANAGER', 'applik8s-typekro')}"`,
    `WAIT_TIMEOUT="${shDefault('APPLIK8S_WAIT_TIMEOUT', '180s')}"`,
    `APPLY_RETRY_SECONDS="${shDefault('APPLIK8S_APPLY_RETRY_SECONDS', '180')}"`,
    'RESOURCES_DIR="$SCRIPT_DIR/resources"',
    'INSTANCES_DIR="$SCRIPT_DIR/instances"',
    'TEMPLATE_MANIFESTS="$SCRIPT_DIR/template-manifests.txt"',
    '',
    'if [ ! -d "$RESOURCES_DIR" ]; then',
    '  echo "TypeKro resources directory not found: $RESOURCES_DIR" >&2',
    '  exit 1',
    'fi',
    '',
    'is_kind() {',
    '  grep -Eq "^kind:[[:space:]]*$2[[:space:]]*$" "$1"',
    '}',
    '',
    'has_typekro_expression() {',
    '  grep -Eq "^[[:space:]]*_type:[[:space:]]*" "$1" && grep -Eq "^[[:space:]]*expression:[[:space:]]*" "$1"',
    '}',
    '',
    'is_typekro_template_manifest() {',
    '  [ -f "$TEMPLATE_MANIFESTS" ] && grep -Fxq "$(basename "$1")" "$TEMPLATE_MANIFESTS"',
    '}',
    '',
    'apply_manifest() {',
    '  "$KUBECTL" apply --server-side --field-manager="$FIELD_MANAGER" --filename "$1"',
    '}',
    '',
    'apply_with_retry() {',
    '  deadline=$(( $(date +%s) + APPLY_RETRY_SECONDS ))',
    '  until apply_manifest "$1"; do',
    '    if [ "$(date +%s)" -ge "$deadline" ]; then',
    '      echo "Timed out applying $1 after $APPLY_RETRY_SECONDS seconds" >&2',
    '      return 1',
    '    fi',
    '    sleep 2',
    '  done',
    '}',
    '',
    'wait_for_api_resource() {',
    '  group="$1"',
    '  kind="$2"',
    '  deadline=$(( $(date +%s) + APPLY_RETRY_SECONDS ))',
    '  until "$KUBECTL" api-resources --api-group="$group" --no-headers 2>/dev/null | grep -Eq "[[:space:]]$kind$"; do',
    '    if [ "$(date +%s)" -ge "$deadline" ]; then',
    '      echo "Timed out waiting for TypeKro API resource $kind in group $group after $APPLY_RETRY_SECONDS seconds" >&2',
    '      return 1',
    '    fi',
    '    sleep 2',
    '  done',
    '}',
    '',
    'has_resources=0',
    'for manifest in "$RESOURCES_DIR"/*.yaml; do',
    '  [ -e "$manifest" ] || continue',
    '  has_resources=1',
    'done',
    'if [ "$has_resources" = "0" ]; then',
    '  echo "No TypeKro resource YAML files found under $RESOURCES_DIR" >&2',
    '  exit 1',
    'fi',
    '',
    'echo "Applying TypeKro prerequisite CustomResourceDefinitions..."',
    'for manifest in "$RESOURCES_DIR"/*.yaml; do',
    '  [ -e "$manifest" ] || continue',
    '  if is_kind "$manifest" CustomResourceDefinition; then',
    '    apply_manifest "$manifest"',
    '    "$KUBECTL" wait --for=condition=Established --timeout="$WAIT_TIMEOUT" --filename "$manifest"',
    '  fi',
    'done',
    '',
    'echo "Applying TypeKro ResourceGraphDefinitions..."',
    'for manifest in "$RESOURCES_DIR"/*.yaml; do',
    '  [ -e "$manifest" ] || continue',
    '  if is_kind "$manifest" ResourceGraphDefinition; then',
    '    apply_manifest "$manifest"',
    '  fi',
    'done',
    ...(schemaApiResourceWaits.length > 0 ? [
      '',
      'echo "Waiting for TypeKro stack APIs..."',
      ...schemaApiResourceWaits,
    ] : []),
    '',
    'echo "Applying remaining TypeKro resources..."',
    'for manifest in "$RESOURCES_DIR"/*.yaml; do',
    '  [ -e "$manifest" ] || continue',
    '  if is_kind "$manifest" CustomResourceDefinition || is_kind "$manifest" ResourceGraphDefinition; then',
    '    continue',
    '  fi',
    '  if is_typekro_template_manifest "$manifest"; then',
    '    echo "Skipping TypeKro template resource owned by a ResourceGraphDefinition: $manifest"',
    '    continue',
    '  fi',
    '  if has_typekro_expression "$manifest"; then',
    '    echo "Skipping TypeKro template resource with expression placeholders: $manifest"',
    '    continue',
    '  fi',
    '  apply_with_retry "$manifest"',
    'done',
    '',
    'echo "Applying TypeKro stack instances..."',
    'for manifest in "$INSTANCES_DIR"/*.yaml; do',
    '  [ -e "$manifest" ] || continue',
    '  apply_with_retry "$manifest"',
    'done',
    '',
    'echo "Applied TypeKro composition resources from $RESOURCES_DIR"',
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
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
