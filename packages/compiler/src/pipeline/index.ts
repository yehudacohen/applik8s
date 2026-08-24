// typecast-file-boundary: the compiler validates graph discriminators and generated artifact shapes before projecting erased node unions into emitters.
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationInstallationArtifactContract,
  BundleArtifact,
  Diagnostic,
  JsonObject,
  OperatorDefinition,
  Result,
} from '@applik8s/core';
import { applicationGraphArtifactFileName, applicationOperationCatalogArtifactFileName, applicationWorkloadAuthorityArtifactFileName, serializeApplicationGraph, validateApplicationGraph } from '@applik8s/core';
import type { ApplicationFrameworkCredentialDependency } from '@applik8s/deployment-contract';
import { parseAllDocuments, stringify } from 'yaml';
import { emitGeneratedApplicationAgents } from '../application-agents/index.js';
import { applicationGraphWithEntrypointPublicSurface } from '../application-facade/public-surface.js';
import { applicationGraphWithInferredApplicationHost, applicationHostFrameworkCredentialDependencies } from '../application-host/index.js';
import { emitGeneratedApplicationHttpServers } from '../application-http/index.js';
import { emitGeneratedApplicationLakehousePublishers } from '../application-lakehouse-publishers/index.js';
import { emitGeneratedApplicationMcpServers } from '../application-mcp/index.js';
import { emitGeneratedApplicationMigrations } from '../application-migrations/index.js';
import { compileApplicationOperationCatalog, compileApplicationWorkloadAuthority } from '../application-operations/index.js';
import { emitGeneratedApplicationProcessors } from '../application-processors/index.js';
import {
  consolidateGeneratedApplicationReactiveResources,
  emitGeneratedApplicationReactive,
} from '../application-reactive/index.js';
import { emitGeneratedApplicationWorkflows } from '../application-workflows/index.js';
import { compilerArtifactLayout } from '../artifacts/index.js';
import { bundleHandlerEntrypoint } from '../bundling/index.js';
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
import {
  applicationGraphForComposition,
  applicationInstallationForComposition,
  filterReplacedFunctionNativeServerResources,
  injectGeneratedResourcesIntoApplicationRgd,
  type TypeKroFactoryArtifactsProjection,
  typeKroContainerArtifactReference,
} from './application-artifacts.js';
import { generatedApplicationHostResources } from './application-support.js';
import { emitRuntimeImageDockerfile, emitStandaloneApplyScript, emitTypeKroApplyScript } from './artifact-scripts.js';
import { discoverEntrypointExports, discoverExportedOperators } from './entrypoint-discovery.js';
import {
  artifactsFromPaths,
  discoverAndSelectOperator,
  isOperatorDefinitionLike,
  outputDirectory,
  selectProvidedOperator,
  selectTypeKroComposition,
} from './pipeline-selection.js';
import {
  compiledTypeKroComposition,
  compositionResources,
  portableOperatorDefinition,
} from './pipeline-shapes.js';
import { generatedDispatcherEntrypoint } from './static-dispatcher.js';
import type {
  TypeKroCompositionArtifacts,
  TypeKroCompositionBundleManifest,
  TypeKroCompositionFrameworkCredentialReference,
  TypeKroCompositionResource,
  TypeKroCompositionRuntimeEndpointReference,
} from './typekro-artifact-contracts.js';
import { planTypeKroEmission, typeKroResourceFingerprint } from './typekro-emission-plan.js';
import { typeKroSingletonOwnerInstances } from './typekro-singleton-instances.js';
import { digestFile, safePathSegment, unique } from './utilities.js';

export { bundleApplicationCompositionRuntimeEntrypoint } from './runtime-entrypoint.js';
export type {
  TypeKroCompositionAgentArtifactReference,
  TypeKroCompositionArtifacts,
  TypeKroCompositionBundleManifest,
  TypeKroCompositionContainerArtifactReference,
  TypeKroCompositionHttpArtifactReference,
  TypeKroCompositionLakehousePublisherArtifactReference,
  TypeKroCompositionMcpArtifactReference,
  TypeKroCompositionMigrationArtifactReference,
  TypeKroCompositionOperatorArtifactReference,
  TypeKroCompositionOperatorArtifacts,
  TypeKroCompositionProcessorArtifactReference,
  TypeKroCompositionReactiveArtifactReference,
  TypeKroCompositionResource,
  TypeKroCompositionWorkflowArtifactReference,
} from './typekro-artifact-contracts.js';

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
  readonly operationCatalogPolicy?: 'development' | 'production';
  /** Local execution emits runnable boundaries without Kubernetes host artifacts. */
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
  readonly operatorKubernetesConnectionBindings?: Readonly<Record<string, NonNullable<CompileOptions['kubernetesConnectionBindings']>>>;
}

export interface CompileTypeKroCompositionResult {
  readonly composition: CompiledTypeKroComposition;
  readonly operatorCompiles: readonly CompileResult[];
  readonly artifacts: TypeKroCompositionArtifacts;
  readonly diagnostics: readonly Diagnostic[];
}

export async function discoverApplicationGraph(entrypoint: string, compositionName?: string): Promise<Result<ApplicationGraph>> {
  const discovered = await discoverApplicationGraphWithExports(entrypoint, compositionName);
  return discovered.ok ? { ok: true, value: discovered.value.graph } : discovered;
}

export interface DiscoveredApplicationGraph {
  readonly graph: ApplicationGraph;
  readonly operationExports: readonly { readonly name: string; readonly operationId: string }[];
  readonly modelExports: readonly { readonly name: string; readonly modelName: string }[];
  readonly signalExports: readonly { readonly name: string; readonly signalId: string }[];
  readonly agentExports: readonly { readonly name: string; readonly agentName: string }[];
  readonly objectStoreExports: readonly { readonly name: string; readonly objectStoreName: string }[];
  readonly durableExports: readonly { readonly name: string; readonly kind: 'workflow' | 'task'; readonly id: string }[];
  readonly scheduleExports: readonly { readonly name: string; readonly id: string }[];
  readonly lakehousePublicationExports: readonly { readonly name: string; readonly id: string }[];
  readonly actorExports: readonly { readonly name: string; readonly actorId: string }[];
}

export async function discoverApplicationGraphWithExports(
  entrypoint: string,
  compositionName?: string,
  options: { readonly hosted?: boolean } = {},
): Promise<Result<DiscoveredApplicationGraph>> {
  const discovered = await discoverEntrypointExports(entrypoint);
  if (!discovered.ok) return discovered;
  const selected = selectTypeKroComposition(discovered.value.typeKroCompositions, compositionName);
  if (!selected.ok) return selected;
  const graph = applicationGraphForComposition(selected.value);
  if (graph) {
    const publicGraph = applicationGraphWithEntrypointPublicSurface(graph, {
      operationIds: discovered.value.applicationOperations.map(
        (operation) => operation.operationId,
      ),
      modelNames: discovered.value.applicationModels.map(
        (model) => model.modelName,
      ),
      signalIds: discovered.value.applicationSignals.map(
        (signal) => signal.signalId,
      ),
      durables: discovered.value.applicationDurables,
      ...(options.hosted === undefined ? {} : { hosted: options.hosted }),
      schedules: discovered.value.applicationSchedules.map((schedule) => schedule.graphNode),
      lakehousePublications: discovered.value.applicationLakehousePublications.map((publication) => publication.graphNode),
      actorIds: discovered.value.applicationActors.map((actor) => actor.actorId),
    });
    return {
      ok: true,
      value: {
        graph: publicGraph,
        operationExports: discovered.value.applicationOperations,
        modelExports: discovered.value.applicationModels,
        signalExports: discovered.value.applicationSignals,
        agentExports: discovered.value.applicationAgents,
        objectStoreExports: discovered.value.applicationObjectStores,
        durableExports: discovered.value.applicationDurables,
        scheduleExports: discovered.value.applicationSchedules.map(({ name, id }) => ({ name, id })),
        lakehousePublicationExports: discovered.value.applicationLakehousePublications.map(({ name, graphNode }) => ({ name, id: graphNode.id })),
        actorExports: discovered.value.applicationActors,
      },
    };
  }
  return error('BUNDLE_INVALID', `TypeKro composition ${compositionName ?? selected.value.name ?? '<selected>'} does not expose an Applik8s ApplicationGraph.`);
}
export interface CompiledTypeKroComposition {
  readonly resources: readonly TypeKroCompositionResource[];
}


interface EmitTypeKroCompositionArtifactsRequest {
  readonly entrypoint: string;
  readonly outDir: string;
  readonly exportName?: string;
  readonly composition: CompiledTypeKroComposition;
  readonly operatorCompiles: readonly CompileResult[];
  readonly applicationGraph?: ApplicationGraph;
  readonly applicationInstallation?: ApplicationInstallationArtifactContract;
  readonly operationCatalogPolicy?: 'development' | 'production';
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
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

  const { compositionName: _compositionName, outDir: _outDir, operatorName: _operatorName, operatorKubernetesConnectionBindings, ...operatorRequest } = request;
  const operatorCompiles: CompileResult[] = [];
  for (const operatorName of installNames) {
    const operatorDefinition = capturedOperators.get(operatorName) ?? exportedOperators.get(operatorName);
    if (!operatorDefinition) {
      return error('BUNDLE_INVALID', `TypeKro composition captures operator ${operatorName}, but no operator definition is available for compilation.`);
    }
    const compileRequest: CompileOperatorRequestWithDefinition = {
      ...operatorRequest,
      operatorName,
      operatorDefinition: portableOperatorDefinition(operatorDefinition),
      ...(operatorKubernetesConnectionBindings?.[operatorName]
        ? { kubernetesConnectionBindings: operatorKubernetesConnectionBindings[operatorName] }
        : {}),
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
  const resolvedComposition = compiledTypeKroComposition(resolved.value, serializeCompositionResource);
  if (!resolvedComposition.ok) {
    return resolvedComposition;
  }
  const authoredApplicationGraph =
    applicationGraphForComposition(composition.value);
  const publicApplicationGraph = authoredApplicationGraph
    ? applicationGraphWithEntrypointPublicSurface(
        await applicationGraphWithInferredApplicationHost(
          authoredApplicationGraph,
          request.entrypoint,
        ),
        {
          operationIds: discovered.value.applicationOperations.map(
            (operation) => operation.operationId,
          ),
          modelNames: discovered.value.applicationModels.map(
            (model) => model.modelName,
          ),
          signalIds: discovered.value.applicationSignals.map(
            (signal) => signal.signalId,
          ),
          durables: discovered.value.applicationDurables,
          hosted: true,
          schedules: discovered.value.applicationSchedules.map(
            (schedule) => schedule.graphNode,
          ),
          lakehousePublications: discovered.value.applicationLakehousePublications.map(
            (publication) => publication.graphNode,
          ),
          actorIds: discovered.value.applicationActors.map(
            (actor) => actor.actorId,
          ),
        },
      )
    : undefined;
  const applicationGraph = publicApplicationGraph
    ? applicationGraphWithCompiledOperatorPermissions(publicApplicationGraph, operatorCompiles)
    : undefined;
  const applicationInstallation = applicationInstallationForComposition(composition.value);
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
    ...(applicationInstallation ? { applicationInstallation } : {}),
    ...(request.operationCatalogPolicy ? { operationCatalogPolicy: request.operationCatalogPolicy } : {}),
    ...(request.executionTarget ? { executionTarget: request.executionTarget } : {}),
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

function applicationGraphWithCompiledOperatorPermissions(
  graph: ApplicationGraph,
  compiles: readonly CompileResult[],
): ApplicationGraph {
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  for (const compiled of compiles) {
    const operator = graph.nodes.find((node) =>
      node.kind === 'operator'
      && (node.name === compiled.manifest.metadata.name || node.id.endsWith(`.${compiled.manifest.metadata.name}`)));
    if (!operator) continue;
    const existingRules = graph.nodes.flatMap((node) =>
      node.kind === 'permission' && node.owner.nodeId === operator.id
        ? node.rules
        : []);
    const inferredRules = compiled.manifest.spec.permissions.flatMap((rule) => {
      const coveredVerbs = new Set(existingRules
        .filter((candidate) => permissionRuleIdentity(candidate) === permissionRuleIdentity(rule))
        .flatMap(({ verbs }) => verbs));
      const verbs = rule.verbs.filter((verb) => !coveredVerbs.has(verb)).sort();
      return verbs.length > 0 ? [{
        apiGroups: [...rule.apiGroups].sort(),
        resources: [...rule.resources].sort(),
        verbs,
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames].sort() } : {}),
        ...(rule.scope ? { scope: rule.scope } : {}),
        ...(rule.namespaces ? { namespaces: rule.namespaces === 'all' ? 'all' as const : [...rule.namespaces].sort() } : {}),
      }] : [];
    });
    if (inferredRules.length === 0) continue;
    const permissionId = `permission.${compiled.manifest.metadata.name}-compiler-inferred`;
    nodes.push({
      id: permissionId,
      kind: 'permission',
      name: `${compiled.manifest.metadata.name}-compiler-inferred`,
      stability: 'experimental',
      owner: { nodeId: operator.id },
      mode: 'inferred',
      rules: inferredRules,
    });
    edges.push({ from: { nodeId: permissionId }, to: { nodeId: operator.id }, relationship: 'writes' });
  }
  return { ...graph, nodes, edges };
}

function permissionRuleIdentity(rule: {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly resourceNames?: readonly string[];
  readonly scope?: string;
  readonly namespaces?: readonly string[] | 'all';
}): string {
  return JSON.stringify({
    apiGroups: [...rule.apiGroups].sort(),
    resources: [...rule.resources].sort(),
    ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames].sort() } : {}),
    ...(rule.scope ? { scope: rule.scope } : {}),
    ...(rule.namespaces ? { namespaces: rule.namespaces === 'all' ? 'all' : [...rule.namespaces].sort() } : {}),
  });
}

async function emitTypeKroCompositionArtifacts(request: EmitTypeKroCompositionArtifactsRequest): Promise<Result<TypeKroCompositionArtifacts>> {
  try {
    const operationCatalog = request.applicationGraph
      ? compileApplicationOperationCatalog(request.applicationGraph, {
          requireClassified: request.operationCatalogPolicy === 'production',
        })
      : undefined;
    const workloadAuthority = request.applicationGraph && operationCatalog
      ? compileApplicationWorkloadAuthority(request.applicationGraph, operationCatalog)
      : [];
    const agentArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationAgents({
          graph: request.applicationGraph,
          ...(operationCatalog ? { operationCatalog } : {}),
          workloadAuthority,
          outDir: join(request.outDir, 'agents'),
          entrypoint: request.entrypoint,
        })
      : [];
    const httpArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationHttpServers({
          graph: request.applicationGraph,
          ...(operationCatalog ? { operationCatalog } : {}),
          outDir: join(request.outDir, 'http'),
          executionTarget: request.executionTarget ?? 'kubernetes',
        })
      : [];
    const migrationArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationMigrations({ graph: request.applicationGraph, outDir: join(request.outDir, 'migrations'), entrypoint: request.entrypoint })
      : [];
    const mcpArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationMcpServers({
          graph: request.applicationGraph,
          ...(operationCatalog ? { operationCatalog } : {}),
          outDir: join(request.outDir, 'mcp'),
        })
      : [];
    const processorArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationProcessors({ graph: request.applicationGraph, ...(operationCatalog ? { operationCatalog } : {}), outDir: join(request.outDir, 'processors'), entrypoint: request.entrypoint, executionTarget: request.executionTarget ?? 'kubernetes' })
      : [];
    const lakehousePublisherArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationLakehousePublishers({ graph: request.applicationGraph, outDir: join(request.outDir, 'lakehouse-publishers'), executionTarget: request.executionTarget ?? 'kubernetes' })
      : [];
    const workflowArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationWorkflows({
          graph: request.applicationGraph,
          ...(operationCatalog ? { operationCatalog } : {}),
          workloadAuthority,
          operatorManifests: request.operatorCompiles.map((compiled) => compiled.manifest),
          outDir: join(request.outDir, 'workflows'),
          entrypoint: request.entrypoint,
          executionTarget: request.executionTarget ?? 'kubernetes',
        })
      : [];
    const reactiveArtifacts = request.applicationGraph
      ? await emitGeneratedApplicationReactive({ graph: request.applicationGraph, ...(operationCatalog ? { operationCatalog } : {}), outDir: join(request.outDir, 'reactive'), entrypoint: request.entrypoint, executionTarget: request.executionTarget ?? 'kubernetes' })
      : [];
    const hostResources = request.applicationGraph && (request.executionTarget === undefined || request.executionTarget === 'kubernetes')
      ? await generatedApplicationHostResources({ graph: request.applicationGraph, entrypoint: request.entrypoint, outDir: join(request.outDir, 'application-host') })
      : [];
    const applicationHost = request.applicationGraph?.nodes.find(
      (node) => node.kind === 'provider' && node.interface === 'ApplicationHost',
    );
    const applicationHostFrameworkCredentials = request.applicationGraph && applicationHost
      ? applicationHostFrameworkCredentialDependencies(request.applicationGraph)
      : [];
    // typecast: generated processor resources are concrete Kubernetes JSON objects and are validated by the same serialization path as composition resources.
    const processorResources = processorArtifacts.flatMap((artifact) => artifact.resources) as unknown as readonly TypeKroCompositionResource[];
    const lakehousePublisherResources = lakehousePublisherArtifacts.flatMap((artifact) => artifact.resources) as unknown as readonly TypeKroCompositionResource[];
    // typecast: generated migration resources are concrete Kubernetes JSON objects and use the shared TypeKro serialization path.
    const migrationResources = migrationArtifacts.flatMap((artifact) => artifact.resources) as unknown as readonly TypeKroCompositionResource[];
    // typecast: generated workflow resources are concrete Kubernetes JSON objects and pass through the shared TypeKro serialization path.
    const workflowResources = workflowArtifacts.flatMap((artifact) => artifact.resources) as unknown as readonly TypeKroCompositionResource[];
    // typecast: generated reactive resources are concrete Kubernetes JSON objects and use the shared TypeKro serialization path.
    const reactiveResources = request.applicationGraph
      ? consolidateGeneratedApplicationReactiveResources({
          graphName: request.applicationGraph.metadata.name,
          artifacts: reactiveArtifacts,
        }) as unknown as readonly TypeKroCompositionResource[]
      : [];
    // typecast: generated agent resources are concrete Kubernetes JSON objects
    // and pass through the shared TypeKro serialization path.
    const agentResources = agentArtifacts.flatMap(
      (artifact) => artifact.resources,
    ) as unknown as readonly TypeKroCompositionResource[];
    const httpResources = httpArtifacts.flatMap(
      (artifact) => artifact.resources,
    ) as unknown as readonly TypeKroCompositionResource[];
    // typecast: generated MCP resources are concrete Kubernetes JSON objects
    // and pass through the shared TypeKro serialization path.
    const mcpResources = mcpArtifacts.flatMap(
      (artifact) => artifact.resources,
    ) as unknown as readonly TypeKroCompositionResource[];
    // typecast: generated host resources are concrete Kubernetes JSON objects and share the TypeKro emission contract.
    const generatedResources = [...migrationResources, ...processorResources, ...lakehousePublisherResources, ...workflowResources, ...reactiveResources, ...mcpResources, ...agentResources, ...httpResources, ...hostResources as unknown as readonly TypeKroCompositionResource[]];
    const baseFactoryArtifacts = typeKroFactoryArtifacts(request.composition, request.applicationGraph?.metadata, request.applicationInstallation);
    const factoryArtifacts = request.applicationGraph
      ? injectGeneratedResourcesIntoApplicationRgd(baseFactoryArtifacts, generatedResources, request.applicationGraph.metadata.name, request.applicationInstallation, request.applicationGraph)
      : baseFactoryArtifacts;
    const compositionEmissionResources = compositionResources(
      request.composition,
      serializeCompositionResource,
    );
    const emissionPlan = planTypeKroEmission({
      factory: factoryArtifacts.resources,
      composition: request.applicationGraph
        ? filterReplacedFunctionNativeServerResources(
            compositionEmissionResources,
            request.applicationGraph,
          )
        : compositionEmissionResources,
      migrations: migrationResources,
      processors: processorResources,
      workflows: workflowResources,
      reactive: reactiveResources,
      mcp: mcpResources,
      agents: agentResources,
      http: httpResources,
    });
    const resources = emissionPlan.resources;
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
    const operationCatalogJsonPath = request.applicationGraph ? join(request.outDir, applicationOperationCatalogArtifactFileName) : undefined;
    const workloadAuthorityJsonPath = request.applicationGraph ? join(request.outDir, applicationWorkloadAuthorityArtifactFileName) : undefined;
    const resourceYamlPaths: string[] = [];
    const instanceYamlPaths: string[] = [];
    const templateFingerprints = typeKroTemplateResourceFingerprints(resources);
    const templateManifestFileNames: string[] = [];
    if (request.applicationGraph && applicationGraphJsonPath) {
      await writeFile(applicationGraphJsonPath, serializeApplicationGraph(request.applicationGraph));
    }
    const applicationGraphDigest = applicationGraphJsonPath ? await digestFile(applicationGraphJsonPath) : undefined;
    if (operationCatalog && operationCatalogJsonPath) {
      await writeFile(operationCatalogJsonPath, `${JSON.stringify(operationCatalog, null, 2)}\n`);
    }
    const operationCatalogDigest = operationCatalogJsonPath ? await digestFile(operationCatalogJsonPath) : undefined;
    if (workloadAuthorityJsonPath) {
      await writeFile(workloadAuthorityJsonPath, `${JSON.stringify({
        apiVersion: 'applik8s.workloadAuthoritySet/v1alpha1',
        application: request.applicationGraph?.metadata.name,
        catalogRevision: operationCatalog?.revision,
        envelopes: workloadAuthority,
      }, null, 2)}\n`);
    }
    const workloadAuthorityDigest = workloadAuthorityJsonPath ? await digestFile(workloadAuthorityJsonPath) : undefined;

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
        ...(operationCatalog && operationCatalogJsonPath && operationCatalogDigest ? {
          operationCatalog: {
            apiVersion: operationCatalog.apiVersion,
            revision: operationCatalog.revision,
            path: operationCatalogJsonPath,
            digest: operationCatalogDigest,
          },
        } : {}),
        ...(workloadAuthorityJsonPath && workloadAuthorityDigest ? {
          workloadAuthority: {
            apiVersion: 'applik8s.workloadAuthoritySet/v1alpha1',
            path: workloadAuthorityJsonPath,
            digest: workloadAuthorityDigest,
            count: workloadAuthority.length,
          },
        } : {}),
        ...(migrationArtifacts.length > 0 ? { migrations: migrationArtifacts.map((artifact) => ({ name: artifact.name, manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, container: typeKroContainerArtifactReference(artifact.container) })) } : {}),
        operators: request.operatorCompiles.map((compiled) => ({
          name: compiled.manifest.metadata.name,
          manifest: compiled.artifacts.manifestJsonPath,
          outDir: dirname(compiled.artifacts.manifestJsonPath),
        })),
        ...(processorArtifacts.length > 0 ? { processors: processorArtifacts.map((artifact) => ({ name: artifact.name, nodeId: artifact.processorId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.processorId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(lakehousePublisherArtifacts.length > 0 ? { lakehousePublishers: lakehousePublisherArtifacts.map((artifact) => ({ name: artifact.name, nodeId: artifact.publicationId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.publicationId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, localSource: artifact.localSourcePath, localDigest: artifact.localDigest, localSizeBytes: artifact.localSizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(workflowArtifacts.length > 0 ? { workflows: workflowArtifacts.map((artifact) => ({ name: artifact.name, nodeId: artifact.workerId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.workerId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...(artifact.runtimeEndpoints.length ? { runtimeEndpoints: typeKroRuntimeEndpointReferences(artifact.runtimeEndpoints) } : {}), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(reactiveArtifacts.length > 0 ? { reactive: reactiveArtifacts.map((artifact) => ({ name: artifact.name, nodeId: artifact.nodeId, kind: artifact.kind, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.nodeId, artifact.kind), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(mcpArtifacts.length > 0 ? { mcp: mcpArtifacts.map((artifact) => ({ name: artifact.name, serverId: artifact.serverId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.serverId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...(artifact.runtimeEndpoints.length ? { runtimeEndpoints: typeKroRuntimeEndpointReferences(artifact.runtimeEndpoints) } : {}), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(agentArtifacts.length > 0 ? { agents: agentArtifacts.map((artifact) => ({ name: artifact.name, nodeId: artifact.agentId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.agentId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...(artifact.runtimeEndpoints.length ? { runtimeEndpoints: typeKroRuntimeEndpointReferences(artifact.runtimeEndpoints) } : {}), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(httpArtifacts.length > 0 ? { http: httpArtifacts.map((artifact) => ({ name: artifact.name, serverId: artifact.serverId, ...typeKroExecutionNodeReferences(request.applicationGraph, artifact.serverId), manifest: artifact.manifestPath, source: artifact.sourcePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes, container: typeKroContainerArtifactReference(artifact.container), ...typeKroFrameworkCredentialReferences(artifact.frameworkCredentials) })) } : {}),
        ...(applicationHost ? {
          applicationHost: {
            nodeId: applicationHost.id,
            frameworkCredentials: applicationHostFrameworkCredentials.map(({ kind, environmentName }) => ({ kind, environmentName })),
          },
        } : {}),
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

    const instanceResources = factoryArtifacts.instancesAreAuthoritative
      ? factoryArtifacts.instances
      : factoryArtifacts.instances.length > 0
        ? factoryArtifacts.instances
        : typeKroInstanceResources(resources);
    const conditionalInstanceResources = instanceResources.map((instance) =>
      typeKroConditionalPrerequisiteInstance(instance, resources));
    for (const [index, instance] of conditionalInstanceResources.entries()) {
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
        ...(operationCatalogJsonPath ? { operationCatalogJsonPath } : {}),
        ...(workloadAuthorityJsonPath ? { workloadAuthorityJsonPath } : {}),
        workloadAuthority,
        agentArtifacts,
        httpArtifacts,
        mcpArtifacts,
        migrationArtifacts,
        processorArtifacts,
        lakehousePublisherArtifacts,
        workflowArtifacts,
        reactiveArtifacts,
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

function typeKroFactoryArtifacts(
  composition: object | ((...args: never[]) => unknown),
  applicationMetadata?: { readonly name: string; readonly namespace?: string },
  installation?: ApplicationInstallationArtifactContract,
): TypeKroFactoryArtifactsProjection {
  const factory = Reflect.get(composition, 'factory');
  if (typeof factory !== 'function') {
    return { resources: [], instances: [], instancesAreAuthoritative: false };
  }

  const factoryNamespace = installation?.controlPlaneNamespace ?? applicationMetadata?.namespace;
  const kroFactory = factory.call(composition, 'kro', factoryNamespace ? { namespace: factoryNamespace } : undefined);
  if (!kroFactory || (typeof kroFactory !== 'object' && typeof kroFactory !== 'function')) {
    return { resources: [], instances: [], instancesAreAuthoritative: false };
  }
  const toYaml = Reflect.get(kroFactory, 'toYaml');
  if (typeof toYaml !== 'function') {
    return { resources: [], instances: [], instancesAreAuthoritative: false };
  }

  const resources = parseTypeKroYamlResources(toYaml.call(kroFactory));
  if (process.env.APPLIK8S_DEBUG_TYPEKRO_FACTORY === '1') {
    console.error(JSON.stringify({
      component: 'typekro-factory-artifacts',
      compositionType: typeof composition,
      factoryType: typeof kroFactory,
      resourceCount: resources.length,
      resourceIdentities: resources.map((resource) => ({
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        name: resource.metadata.name,
      })),
    }));
  }
  const singletonInstances = typeKroSingletonOwnerInstances(kroFactory, serializeCompositionResource);
  try {
    const generatedInstances = parseTypeKroYamlResources(toYaml.call(kroFactory, {}));
    const requestedInstances = installation?.emitDefaultInstance === false
      ? generatedInstances.filter((instance) => instance.apiVersion !== installation.apiVersion || instance.kind !== installation.kind)
      : generatedInstances;
    const instances = uniqueTypeKroResources([...singletonInstances, ...requestedInstances]);
    if (!applicationMetadata || instances.length === 0) return { resources, instances, instancesAreAuthoritative: true };
    return {
      resources,
      instances: instances.map((instance) => installation && instance.apiVersion === installation.apiVersion && instance.kind === installation.kind ? {
        ...instance,
        metadata: {
          ...instance.metadata,
          name: applicationMetadata.name,
          ...(applicationMetadata.namespace ? { namespace: applicationMetadata.namespace } : {}),
        },
      } : instance),
      instancesAreAuthoritative: true,
    };
  } catch {
    // An installable Application usually has required spec fields, so asking
    // TypeKro to serialize a fabricated `{}` root instance correctly fails.
    // Singleton definitions are already concrete and remain valid deployment
    // prerequisites; preserve them without inventing root desired state.
    return { resources, instances: singletonInstances, instancesAreAuthoritative: true };
  }
}

function uniqueTypeKroResources(resources: readonly TypeKroCompositionResource[]): readonly TypeKroCompositionResource[] {
  const uniqueResources = new Map<string, TypeKroCompositionResource>();
  for (const [index, resource] of resources.entries()) {
    uniqueResources.set(typeKroResourceFingerprint(resource) ?? `${index}:${resource.apiVersion}:${resource.kind}`, resource);
  }
  return [...uniqueResources.values()];
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

function serializeCompositionResource(resource: unknown, index: number): TypeKroCompositionResource {
  if (!resource || typeof resource !== 'object') {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not an object.`);
  }
  const sourceMetadata = Reflect.get(resource, 'metadata');
  const sourceName = sourceMetadata && (typeof sourceMetadata === 'object' || typeof sourceMetadata === 'function')
    ? serializeTypeKroReference('name', Reflect.get(sourceMetadata, 'name'))
    : undefined;
  const sourceNamespace = sourceMetadata && (typeof sourceMetadata === 'object' || typeof sourceMetadata === 'function')
    ? serializeTypeKroReference('namespace', Reflect.get(sourceMetadata, 'namespace'))
    : undefined;
  // JSON.stringify invokes an object's toJSON() before its replacer. TypeKro
  // reference proxies therefore become `{}` when nested inside plain
  // Kubernetes objects such as RoleBinding subjects or selector labels.
  // Capture their locations first and restore the portable expression strings
  // after the rest of the resource has been safely JSON-normalized.
  const nestedReferences = collectTypeKroReferencePaths(resource);
  // typecast: JSON.parse returns any; immediately re-narrow to JsonObject before using the serialized resource.
  const serialized = JSON.parse(JSON.stringify(resource, serializeTypeKroReference)) as unknown;
  if (!isJsonObject(serialized)) {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not JSON-serializable as an object.`);
  }
  for (const reference of nestedReferences) setSerializedPath(serialized, reference.path, reference.value);
  const serializedMetadata = isJsonObject(serialized.metadata) ? serialized.metadata : {};
  const normalized = normalizeKubernetesTopLevelLists({
    ...serialized,
    metadata: {
      ...serializedMetadata,
      ...(typeof serializedMetadata.name === 'string' ? {} : typeof sourceName === 'string' ? { name: sourceName } : {}),
      ...(typeof serializedMetadata.namespace === 'string' ? {} : typeof sourceNamespace === 'string' ? { namespace: sourceNamespace } : {}),
    },
  });
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

function serializeTypeKroReference(_key: string, value: unknown): unknown {
  if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
    if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
      const resourceId = Reflect.get(value, 'resourceId');
      const fieldPath = Reflect.get(value, 'fieldPath');
      if (resourceId === '__schema__' && typeof fieldPath === 'string' && fieldPath.trim()) return `\${schema.${fieldPath}}`;
      if (typeof resourceId === 'string' && resourceId.trim() && typeof fieldPath === 'string' && fieldPath.trim()) return `\${${resourceId}.${fieldPath}}`;
    }
    if (Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true) {
      const expression = Reflect.get(value, 'expression');
      if (typeof expression === 'string' && expression.trim()) return `\${${expression}}`;
    }
  }
  return value;
}

interface TypeKroReferencePath {
  readonly path: readonly string[];
  readonly value: string;
}

function collectTypeKroReferencePaths(value: unknown): readonly TypeKroReferencePath[] {
  const references: TypeKroReferencePath[] = [];
  const ancestors = new WeakSet<object>();
  const visit = (entry: unknown, path: readonly string[]): void => {
    if (!entry || (typeof entry !== 'object' && typeof entry !== 'function')) return;
    const serialized = serializeTypeKroReference('', entry);
    if (typeof serialized === 'string') {
      references.push({ path, value: serialized });
      return;
    }
    if (ancestors.has(entry)) return;
    ancestors.add(entry);
    try {
      for (const key of Object.keys(entry)) visit(Reflect.get(entry, key), [...path, key]);
    } finally {
      ancestors.delete(entry);
    }
  };
  visit(value, []);
  return references;
}

function setSerializedPath(root: JsonObject, path: readonly string[], value: string): void {
  if (path.length === 0) return;
  let parent: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') return;
    parent = Reflect.get(parent, segment);
  }
  const leaf = path.at(-1);
  if (!leaf || !parent || typeof parent !== 'object') return;
  Reflect.set(parent, leaf, value);
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
    for (const graphResource of typeKroResourceGraphObservedResources(rgd)) {
      const fingerprint = typeKroResourceFingerprint(graphResource);
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

function typeKroConditionalPrerequisiteInstance(
  instance: TypeKroCompositionResource,
  resources: readonly TypeKroCompositionResource[],
): TypeKroCompositionResource {
  const conditions = new Set<string>();
  for (const rgd of typeKroResourceGraphDefinitions(resources)) {
    const spec = isJsonObject(rgd.spec) ? rgd.spec : undefined;
    if (!spec || !Array.isArray(spec.resources)) continue;
    for (const entry of spec.resources) {
      if (!isJsonObject(entry) || !isJsonObject(entry.externalRef) || !isJsonObject(entry.externalRef.metadata)
        || !Array.isArray(entry.includeWhen)) continue;
      if (entry.externalRef.apiVersion !== instance.apiVersion || entry.externalRef.kind !== instance.kind
        || entry.externalRef.metadata.name !== instance.metadata.name
        || (entry.externalRef.metadata.namespace ?? '') !== (instance.metadata.namespace ?? '')) continue;
      for (const condition of entry.includeWhen) {
        if (typeof condition === 'string' && condition.trim().length > 0) conditions.add(condition);
      }
    }
  }
  if (conditions.size === 0) return instance;
  const annotations = isJsonObject(instance.metadata.annotations) ? instance.metadata.annotations : {};
  return {
    ...instance,
    metadata: {
      ...instance.metadata,
      annotations: {
        ...annotations,
        'applik8s.dev/include-when': JSON.stringify([...conditions]),
      },
    },
  };
}

function isTypeKroTemplateResource(resource: TypeKroCompositionResource, templateFingerprints: ReadonlySet<string>): boolean {
  const fingerprint = typeKroResourceFingerprint(resource);
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

function typeKroResourceGraphObservedResources(rgd: TypeKroCompositionResource): TypeKroCompositionResource[] {
  const spec = rgd.spec;
  if (!isJsonObject(spec) || !Array.isArray(spec.resources)) return [];
  return spec.resources.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const resource = isTypeKroCompositionResource(entry.template)
      ? entry.template
      : isTypeKroCompositionResource(entry.externalRef)
        ? entry.externalRef
        : undefined;
    return resource ? [resource] : [];
  });
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
    // Runtime dispatch is metadata-first: authored ArkType graphs and the user
    // entrypoint must never be reconstructed inside each WASM invocation.
    const dispatcher = generatedDispatcherEntrypoint(request.entrypoint, selected.value, hasCapabilities, true, request.dispatcherMode ?? 'staticSerializable');
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
      ...(request.kubernetesConnectionBindings ? { kubernetesConnectionBindings: request.kubernetesConnectionBindings } : {}),
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
function typeKroRuntimeEndpointReferences(
  endpoints: readonly { readonly nodeId: string; readonly environmentName: string }[],
): readonly TypeKroCompositionRuntimeEndpointReference[] {
  return endpoints.map(({ nodeId, environmentName }) => ({ nodeId, environmentName }));
}
function typeKroFrameworkCredentialReferences(
  credentials: readonly ApplicationFrameworkCredentialDependency[],
): { readonly frameworkCredentials?: readonly TypeKroCompositionFrameworkCredentialReference[] } {
  return credentials.length > 0
    ? { frameworkCredentials: credentials.map(({ kind, environmentName }) => ({ kind, environmentName })) }
    : {};
}
function typeKroExecutionNodeReferences(
  graph: ApplicationGraph | undefined,
  nodeId: string,
  artifactKind?: string,
): { readonly executionNodeIds?: readonly string[] } {
  if (!graph) return {};
  if (artifactKind === 'scheduleControlWorker') {
    const executionNodeIds = graph.nodes.filter(({ kind }) => kind === 'schedule').map(({ id }) => id).sort();
    return executionNodeIds.length > 0 ? { executionNodeIds } : {};
  }
  const node = graph.nodes.find(({ id }) => id === nodeId);
  if (!node) return {};
  const executionNodeIds = new Set<string>([nodeId]);
  if (node.kind === 'processor' || node.kind === 'workflowWorker') {
    for (const handler of node.handlers) executionNodeIds.add(handler.nodeId);
  } else if (node.kind === 'gateway') {
    for (const query of node.queries) executionNodeIds.add(query.nodeId);
    for (const subscription of node.subscriptions) executionNodeIds.add(subscription.nodeId);
  }
  return { executionNodeIds: [...executionNodeIds].sort() };
}
function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
