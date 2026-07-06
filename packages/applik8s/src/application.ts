import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationGraphMetadataProperty } from '@applik8s/core';
import type { AnyResourceDefinition, ApplicationGraph, ApplicationProviderInterfaceKind, JsonValue, OperatorDeploymentOptions, ResourceDefinition, ResourceIndex } from '@applik8s/core';
import type { CrdOptions } from '@applik8s/sdk';
import { sdk as baseSdk, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import type { TypeKroListenerComposition, TypeKroListenerCompositionDefinition } from '@applik8s/typekro-adapter';
import { typeKro } from '@applik8s/typekro-adapter';
import { buildSync, transformSync } from 'esbuild';
import type { Enhanced, KroCompatibleType, MagicAssignableShape, SerializationOptions } from 'typekro';
import { cluster as typeKroCnpgCluster } from 'typekro/cnpg';
import { configMap as typeKroConfigMap, cronJob as typeKroCronJob, deployment as typeKroDeployment, job as typeKroJob, role as typeKroRole, roleBinding as typeKroRoleBinding, service as typeKroService, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import { valkey as typeKroValkey } from 'typekro/valkey';
import { addApplicationGraphEdge, addApplicationGraphNode, applicationGraphFromState, isApplicationGraph, type ApplicationGraphState } from './application-graph-state.js';
import { applicationModelBinding, applicationModelMigrationPlan, applicationModelMigrationSql, applicationRuntimeModelContract, recordApplicationModelGraph, resolveApplicationModelStore } from './application-models.js';
import type { ApplicationModelBinding, ApplicationModelOptions, ApplicationModelRuntimeBinding, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationGeneratedJobDurableStatus, applicationGeneratedJobPhase, applicationGeneratedJobPhaseStatusContract, applicationGeneratedJobRetry, applicationGeneratedJobRuntime, applicationGeneratedJobStatusUpdater } from './application-jobs.js';
import { applicationModelStoreImplementation, applyApplicationProvider, applicationProviderImplementationName, applicationProviderInterface, applicationProviderTokenName, defaultApplicationIndexBackend, defaultApplicationIndexProvider, isValkeyIndexDefault, ModelStore } from './application-providers.js';
import type { ApplicationDefaults, ApplicationDefaultsBinding, ApplicationIndexBackend, ApplicationModelStoreProvider, ApplicationProviderBinding, ApplicationProviderState, ApplicationProviderToken, ApplicationValkeyIndexBackend } from './application-providers.js';
import { generatedApplicationServerRuntimeSource, runtimeIndexTable } from './application-server-runtime.js';
import type { EntityDefinition } from './dsl.js';
import { generatedApplicationRuntimeModuleBundle, generatedJobStatusRuntimeBundle } from './application-runtime-modules.js';
import { applicationStatusReconcilerName, emitApplicationGeneratedJobStatusReconcilers } from './application-status-reconciler.js';
import type { ApplicationGeneratedJobStatusTarget, ApplicationStatusReconcilerAppResourceTarget } from './application-status-reconciler.js';

export { CounterStore, CredentialStore, EventSource, HttpExposure, IndexStore, ModelStore, ObjectStorage, providers, Queue, Secret } from './application-providers.js';
export type { ApplicationModelBackendContract, ApplicationModelBinding, ApplicationModelConstraintOptions, ApplicationModelCreateInput, ApplicationModelEventBinding, ApplicationModelEventHandler, ApplicationModelEventRegistrar, ApplicationModelIndexBinding, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelOptions, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationModelSchemaOptions, ApplicationRuntimeModelContract } from './application-models.js';
export type { ApplicationDefaults, ApplicationDefaultsBinding, ApplicationIndexBackend, ApplicationModelStoreMigrationPolicy, ApplicationModelStoreProvider, ApplicationPostgresModelStoreProvider, ApplicationPostgresReadinessPolicy, ApplicationProviderBinding, ApplicationProviderToken, ApplicationValkeyIndexBackend } from './application-providers.js';

export interface KubernetesApplicationScope {
  readonly api: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly server: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  operator<TBinding>(operator: (options: OperatorDeploymentOptions) => TBinding, options: OperatorDeploymentOptions): TBinding;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options?: ApplicationModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  infra<TResource extends object>(resource: TResource): TResource;
  job(name: string, options?: ApplicationJobOptions): ApplicationJobBinding;
  schedule(name: string, options?: ApplicationScheduleOptions): ApplicationJobBinding;
  defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding;
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation>;
  aggregate<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent>;
}

export type ApplicationServerRegistrar = (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void) => ApplicationServerBinding;

export type ApplicationCrdOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'kind' | 'spec' | 'status'> & {
  readonly kind?: string;
};

export interface ApplicationJobOptions {
  readonly taskKind?: 'preflight' | 'migration' | 'cleanup' | 'repair' | 'maintenance' | 'custom';
  readonly namespace?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface ApplicationScheduleOptions extends ApplicationJobOptions {
  readonly cron?: string;
  readonly timezone?: string;
  readonly concurrencyPolicy?: 'allow' | 'forbid' | 'replace';
  readonly missedRunPolicy?: 'skip' | 'startLate' | 'failClosed';
  readonly startingDeadlineSeconds?: number;
}

export interface ApplicationJobBinding {
  readonly kind: 'applicationJob';
  readonly name: string;
  readonly resourceName: string;
  readonly diagnosticsConfigMapName: string;
  readonly statusPath: string;
}

export interface ApplicationServerOptions {
  readonly namespace?: string;
  readonly resourceName?: string;
  readonly serviceName?: string;
  readonly serviceAccountName?: string;
  readonly sourceConfigMapName?: string;
  readonly source?: string;
  readonly sourceFileName?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly permissions?: readonly ApplicationPermissionRule[];
  readonly volumes?: readonly ApplicationServerVolume[];
  readonly volumeMounts?: readonly ApplicationServerVolumeMount[];
  readonly replicas?: number;
  readonly service?: { readonly port: number };
  readonly resources?: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes?: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly models?: Readonly<Record<string, ApplicationServerModelBinding>>;
  readonly captures?: Readonly<Record<string, ApplicationServerCaptureValue>>;
  readonly cache?: readonly ResourceIndex<object, object>[];
  readonly indexBackend?: ApplicationIndexBackend;
}

export type ApplicationServerModelBinding = ApplicationRuntimeModelContract | ApplicationModelRuntimeBinding;

export interface ApplicationPermissionRule {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
  readonly resourceNames?: readonly string[];
}

export interface ApplicationServerVolume {
  readonly name: string;
  readonly configMap?: { readonly name: string };
  readonly secret?: { readonly secretName: string };
  readonly emptyDir?: Record<string, never>;
}

export interface ApplicationServerVolumeMount {
  readonly name: string;
  readonly mountPath: string;
  readonly readOnly?: boolean;
}

export interface ApplicationServerBinding {
  readonly name: string;
  readonly url: string;
  readonly routes: readonly ApplicationServerRoute[];
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
}

export interface ApplicationServerRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handlerSource: string;
  readonly handlerSourceKind?: 'source' | 'functionToString';
  readonly handlerSourceLocation?: ApplicationRouteSourceLocation;
}

interface ApplicationRouteSourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

interface SerializedApplicationServerRoute extends ApplicationServerRoute {}

interface SerializedApplicationServerRouteWithDependencies extends SerializedApplicationServerRoute {
  readonly handlerDependencySource?: string;
  readonly handlerDependencyResolveDir?: string;
}

interface GeneratedApplicationServerRouteModule {
  readonly route: SerializedApplicationServerRouteWithDependencies;
  readonly fileName: string;
  readonly exportName: string;
}

export type ApplicationServerCaptureValue = JsonValue | ApplicationServerCaptureFunction;

export interface ApplicationServerCaptureFunction {
  readonly name: string;
  toString(): string;
}

type SerializedApplicationServerCaptures = Readonly<Record<string, SerializedApplicationServerCapture>>;

type SerializedApplicationServerCapture = SerializedApplicationServerJsonCapture | SerializedApplicationServerFunctionCapture;

interface SerializedApplicationServerJsonCapture {
  readonly kind: 'json';
  readonly value: JsonValue;
}

interface SerializedApplicationServerFunctionCapture {
  readonly kind: 'function';
  readonly source: string;
  readonly aliasName?: string;
}

interface ApplicationServerRuntimeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
  readonly scope: 'Namespaced' | 'Cluster';
}

interface ApplicationServerRuntimeIndex {
  readonly name: string;
  readonly resource: ApplicationServerRuntimeResource;
  readonly options: ResourceIndex<object, object>['options'];
  readonly backend?: ApplicationRuntimeIndexBackend;
}

interface ApplicationRuntimeIndexBackend {
  readonly kind: 'valkey';
  readonly host: string;
  readonly port: number;
}

interface ApplicationServerPermissionInferenceRequest {
  readonly routes: readonly ApplicationServerRoute[];
  readonly resources: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly indexBackend: ApplicationRuntimeIndexBackend | undefined;
  readonly cache: readonly ResourceIndex<object, object>[];
  readonly explicit: readonly ApplicationPermissionRule[];
}

interface ApplicationScopeState extends ApplicationGraphState, ApplicationProviderState {
  readonly resources: Record<string, AnyResourceDefinition>;
  readonly indexes: Record<string, ResourceIndex<object, object>>;
  readonly models: Record<string, ApplicationRuntimeModelContract>;
  readonly emittedModelStores: Set<string>;
  readonly appResource: ApplicationCompositionResourceTarget;
  readonly generatedJobStatusTargets: ApplicationGeneratedJobStatusTarget[];
}

interface ApplicationCompositionResourceTarget extends ApplicationStatusReconcilerAppResourceTarget {}

interface ApplicationContext {
  readonly scope: KubernetesApplicationScope;
  readonly state: ApplicationScopeState;
}

interface ApplicationGeneratedWorkloadBinding {
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
}

interface ApplicationDeploymentSpecProjection {
  readonly replicas: number;
  readonly selector: unknown;
  readonly template: unknown;
}

interface ApplicationDeploymentStatusProjection {
  readonly availableReplicas: number;
}


interface ApplicationServerRouteSourceAnalysis {
  readonly strippedSource: string;
  readonly declaredIdentifiers: ReadonlySet<string>;
  readonly memberCalls: readonly ApplicationServerMemberCall[];
  readonly methodAliases: readonly ApplicationServerMethodAlias[];
  readonly functionCalls: ReadonlySet<string>;
  readonly freeIdentifiers: readonly string[];
}

interface ApplicationServerMemberCall {
  readonly objectName: string;
  readonly methodName: string;
}

interface ApplicationServerMethodAlias {
  readonly aliasName: string;
  readonly objectName: string;
  readonly methodName: string;
}

interface ApplicationRouteSourceDependencies {
  readonly source: string;
  readonly resolveDir: string;
}

interface ApplicationRouteTopLevelBinding {
  readonly name: string;
  readonly source: string;
  readonly analysisSource: string;
  readonly kind: 'declaration' | 'import';
}

interface ApplicationRouteModuleBundle {
  readonly source: string;
  readonly inputs: readonly string[];
}

export interface ApplicationServer {
  get(path: string, handler: ApplicationRouteHandler): void;
  post(path: string, handler: ApplicationRouteHandler): void;
}

export type ApplicationRouteHandler = (request: ApplicationRequest) => unknown | Promise<unknown>;

export interface ApplicationRequest {
  readonly query: Readonly<Record<string, string | undefined>>;
  formData(): Promise<ApplicationFormData>;
}

export interface ApplicationFormData {
  string(name: string): string;
}

export interface ApplicationAggregateOptions<TStats extends object, TEvent extends object> {
  readonly source: ResourceIndex<object, object>;
  readonly target: ApplicationAggregateStatusTarget<TStats>;
  readonly initial: TStats;
  readonly flush?: { readonly every?: string; readonly maxEvents?: number };
  reduce(stats: TStats, event: TEvent): TStats;
}

export interface ApplicationAggregateStatusTarget<TStats extends object> {
  readonly resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>;
  readonly name: string;
  readonly namespace?: string;
  status(stats: TStats): object;
}

export interface ApplicationAggregateBinding<TStats extends object, TEvent extends object> {
  readonly name: string;
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
  readonly options: ApplicationAggregateOptions<TStats, TEvent>;
}

export type KubernetesApplicationCompositionFunction = <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
) => TypeKroListenerComposition<TSpec, TStatus>;

const applicationGraphByComposition = new WeakMap<object, ApplicationGraph>();
let lastApplicationGraph: ApplicationGraph | undefined;

export function applicationGraphFor(composition: object): ApplicationGraph | undefined {
  const attached = Reflect.get(composition, applicationGraphMetadataProperty);
  return isApplicationGraph(attached) ? attached : applicationGraphByComposition.get(composition);
}

function applicationCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  graphName: string
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  const wrapped = (spec: TSpec) => {
    const context = createApplicationContext(definition);
    const result = withApplicationOperatorResourceCollection(context.state, () => compositionFn(spec, context.scope));
    emitApplicationGeneratedJobStatusReconcilers(context.state, { graphResourceId, kubernetesNameSegment, apiGroupForApiVersion });
    lastApplicationGraph = applicationGraphFromState(kubernetesNameSegment(graphName), context.state);
    return result;
  };
  Object.defineProperty(wrapped, 'toString', { value: () => compositionFn.toString() });
  return wrapped;
}

export const kubernetesComposition: KubernetesApplicationCompositionFunction = (definition, compositionFn, options) => {
  lastApplicationGraph = undefined;
  const composition = typeKro.kubernetesComposition(
    definition,
    applicationCompositionWrapper(definition, compositionFn, definition.name),
    options
  );
  if (lastApplicationGraph) {
    applicationGraphByComposition.set(composition, lastApplicationGraph);
    Object.defineProperty(composition, applicationGraphMetadataProperty, { value: lastApplicationGraph, enumerable: false, configurable: false });
  }
  return composition;
};

export const app: KubernetesApplicationCompositionFunction = kubernetesComposition;

export const sdk = Object.assign({}, baseSdk, { app, kubernetesComposition });

function createApplicationContext<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>): ApplicationContext {
  const servers: Record<string, ApplicationServerBinding> = {};
  const state: ApplicationScopeState = { resources: {}, indexes: {}, models: {}, emittedModelStores: new Set(), appResource: applicationCompositionResourceTarget(definition), generatedJobStatusTargets: [], defaults: {}, providers: {}, graphNodes: [], graphEdges: [], providerRequirements: [], providerBindings: [] };
  const server = (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void) => {
    const routes: ApplicationServerRoute[] = [];
    configure(createRouteRecorder(routes));
    const resolvedOptions = applicationServerOptionsWithScope(state, options, routes);
    recordApplicationServerGraph(state, name, resolvedOptions, routes);
    const workload = emitApplicationServerResources(name, resolvedOptions, routes);
    const binding = applicationServerBinding(name, resolvedOptions, routes, workload);
    servers[name] = binding;
    Object.defineProperty(server, name, { value: binding, enumerable: true, configurable: true });
    collectApplicationIndexes(state, resolvedOptions.indexes ?? {});
    return binding;
  };
  const scope: KubernetesApplicationScope = {
    // typecast: app.api is the application-context name for the same generated HTTP workload registrar as app.server.
    api: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    // typecast: the callable server registrar also exposes named server bindings such as app.server.web after registration.
    server: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    operator(operator, options) {
      collectApplicationResources(state, applicationOperatorResources(operator));
      recordApplicationOperatorGraph(state, operator);
      return operator(options);
    },
    crd(entity, options) {
      const resource = baseSdk.crd({
        ...options,
        kind: options.kind ?? entity.name,
        spec: entity.spec,
        ...(entity.status ? { status: entity.status } : {}),
      });
      collectApplicationResources(state, { [entity.name]: resource });
      recordApplicationCrdGraph(state, entity.name, resource);
      return resource;
    },
    model(entity, options) {
      const modelStore = resolveApplicationModelStore(state, entity.name, options?.store);
      const runtimeModel = applicationRuntimeModelContract(entity, modelStore, options);
      emitApplicationModelStoreResources(state, runtimeModel, modelStore);
      recordApplicationModelGraph(state, entity, modelStore, options);
      state.models[runtimeModel.name] = runtimeModel;
      return applicationModelBinding(entity, modelStore, options, runtimeModel);
    },
    infra(resource) {
      recordApplicationTypeKroResourceGraph(state, resource);
      return resource;
    },
    job(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, undefined);
    },
    schedule(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, options?.cron ?? '* * * * *');
    },
    defaults(defaults) {
      if ('models' in defaults) {
        const modelStore = applicationModelStoreImplementation(defaults.models);
        if (!modelStore) {
          throw new Error('app.defaults({ models: ... }) currently supports only the typed Postgres ModelStore provider declaration. Use { kind: "postgres", ... } or app.provide(ModelStore, { kind: "postgres", ... }) until additional ModelStore providers are implemented.');
        }
        state.defaults.models = defaults.models;
        recordApplicationProviderGraph(state, 'ModelStore', 'default', modelStore);
      }
      if ('counters' in defaults) {
        throw new Error('app.defaults({ counters: ... }) requires a storage-backed CounterStore implementation, which is not enabled yet. This fails closed so counter durability semantics stay explicit.');
      }
      if ('events' in defaults) {
        throw new Error('app.defaults({ events: ... }) requires an EventSource implementation, which is not enabled yet. This fails closed so event delivery semantics stay explicit.');
      }
      if ('expose' in defaults) {
        throw new Error('app.defaults({ expose: ... }) requires an HttpExposure implementation, which is not enabled yet. This fails closed so exposure, TLS, and hostname semantics stay explicit.');
      }
      if ('indexes' in defaults) {
        state.defaults.indexes = defaults.indexes;
        recordApplicationProviderGraph(state, 'IndexStore', 'default', defaults.indexes);
      }
      return { kind: 'applicationDefaults', defaults };
    },
    provide(token, implementation) {
      applyApplicationProvider(state, token, implementation);
      recordApplicationProviderGraph(state, applicationProviderTokenName(token), 'provided', implementation);
      return { kind: 'applicationProvider', token, implementation };
    },
    aggregate(name, options) {
      collectApplicationIndexes(state, { [options.source.name]: options.source });
      recordApplicationAggregateGraph(state, name, options);
      const workload = emitApplicationAggregateResources(name, options);
      return applicationAggregateBinding(name, options, workload);
    },
  };
  return { scope, state };
}

function withApplicationOperatorResourceCollection<T>(state: ApplicationScopeState, fn: () => T): T {
  const restore = setOperatorDeploymentInterceptor((definition, _deployment, next) => {
    // typecast: app-scoped server inference only needs erased resource metadata, not capability-specific handler clients.
    collectApplicationResources(state, definition.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>);
    return next();
  });
  try {
    return fn();
  } finally {
    restore();
  }
}

function applicationServerOptionsWithScope(state: ApplicationScopeState, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationServerOptions {
  const routeAnalyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const inferredResources = inferredApplicationServerResources(state.resources, routeAnalyses);
  const cacheIndexes = options.cache ?? [];
  const inferredIndexes = {
    ...inferredApplicationServerIndexes(state.indexes, routeAnalyses),
    ...inferredApplicationServerIndexesFromCache(cacheIndexes, routeAnalyses, state.indexes, options.indexes ?? {}),
  };
  const inferredModels = inferredApplicationServerModels(state.models, routeAnalyses);
  const resources = { ...inferredResources, ...(options.resources ?? {}) };
  const indexes = { ...inferredIndexes, ...(options.indexes ?? {}) };
  const models = { ...inferredModels, ...applicationServerRuntimeModels(options.models ?? {}) };
  const indexBackend = options.indexBackend ?? defaultApplicationIndexBackend(state, options, indexes);
  const cache = options.cache ?? (indexBackend && isValkeyIndexDefault(defaultApplicationIndexProvider(state)) ? Object.values(indexes) : undefined);
  return {
    ...options,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(cache && cache.length > 0 ? { cache } : {}),
    ...(indexBackend ? { indexBackend } : {}),
  };
}

function applicationServerRuntimeModels(models: Readonly<Record<string, ApplicationServerModelBinding>>): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).map(([name, model]) => [name, applicationServerRuntimeModel(model)]));
}

function applicationServerRuntimeModel(model: ApplicationServerModelBinding): ApplicationRuntimeModelContract {
  if ('provider' in model) {
    return model;
  }
  return model.runtime;
}

function inferredApplicationServerResources(resources: Readonly<Record<string, AnyResourceDefinition>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, AnyResourceDefinition>> {
  return Object.fromEntries(Object.entries(resources).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || analysis.memberCalls.some((call) => call.objectName === name))));
}

function inferredApplicationServerIndexes(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ResourceIndex<object, object>>> {
  return Object.fromEntries(Object.entries(indexes).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || routeAnalysisCallsMethod(analysis, name, 'query'))));
}

function inferredApplicationServerModels(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || ['create', 'get', 'query', 'patch', 'delete', 'index'].some((method) => routeAnalysisCallsMethod(analysis, name, method)))));
}

function inferredApplicationServerIndexesFromCache(
  cache: readonly ResourceIndex<object, object>[],
  analyses: readonly ApplicationServerRouteSourceAnalysis[],
  scopedIndexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  explicitIndexes: Readonly<Record<string, ResourceIndex<object, object>>>
): Readonly<Record<string, ResourceIndex<object, object>>> {
  const existingNames = new Set([...Object.keys(scopedIndexes), ...Object.keys(explicitIndexes)]);
  const queryNames = unique(analyses.flatMap((analysis) => analysis.memberCalls.filter((call) => call.methodName === 'query').map((call) => call.objectName))).filter((name) => !existingNames.has(name));
  if (cache.length === 1 && queryNames.length === 1) {
    const [index] = cache;
    const [name] = queryNames;
    return index && name ? { [name]: index } : {};
  }
  const inferred: Record<string, ResourceIndex<object, object>> = {};
  for (const name of queryNames) {
    const match = cache.find((index) => index.name === name);
    if (match) {
      inferred[name] = match;
    }
  }
  return inferred;
}

function collectApplicationResources(state: ApplicationScopeState, resources: Readonly<Record<string, AnyResourceDefinition>>): void {
  for (const [name, resource] of Object.entries(resources)) {
    state.resources[name] = resource;
    recordApplicationCrdGraph(state, name, resource);
  }
}

function collectApplicationIndexes(state: ApplicationScopeState, indexes: Readonly<Record<string, ResourceIndex<object, object>>>): void {
  for (const [name, index] of Object.entries(indexes)) {
    state.indexes[name] = index;
    recordApplicationIndexGraph(state, name, index);
  }
}

function recordApplicationCrdGraph(state: ApplicationScopeState, name: string, resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>): void {
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('crd', name),
    kind: 'crd',
    name,
    stability: 'experimental',
    materialization: 'kubernetes-crd',
    resource: applicationResourceContract(resource),
  });
}

function recordApplicationOperatorGraph(state: ApplicationScopeState, operator: unknown): void {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const reflectedName = definition && typeof definition === 'object' ? Reflect.get(definition, 'name') : undefined;
  const name = typeof reflectedName === 'string' ? reflectedName : 'operator';
  const resources = applicationOperatorResources(operator);
  const nodeId = applicationGraphNodeId('operator', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'operator',
    name,
    stability: 'experimental',
    resources: Object.values(resources).map((resource) => applicationResourceRef(resource)),
    watches: [],
  });
  for (const [resourceName] of Object.entries(resources)) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'owns' });
  }
}

function recordApplicationProviderGraph(state: ApplicationScopeState, tokenName: string | undefined, bindingKind: string, implementation: unknown): void {
  const providerInterface = applicationProviderInterface(tokenName);
  if (!providerInterface) {
    return;
  }
  const nodeId = applicationProviderNodeId(providerInterface);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'provider',
    name: providerInterface,
    stability: 'experimental',
    interface: providerInterface,
    implementation: applicationProviderImplementationName(implementation),
    config: { bindingKind, provider: applicationProviderImplementationName(implementation) },
  });
}

function recordApplicationTypeKroResourceGraph(state: ApplicationScopeState, resource: unknown): void {
  const ref = applicationTypeKroResourceRef(resource);
  if (!ref) {
    throw new Error('app.infra(...) requires a TypeKro/Kubernetes resource with apiVersion, kind, and metadata.name. Create infrastructure with an existing @applik8s/applik8s/factories helper before passing it to app.infra(...).');
  }
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('typeKroResource', ref.name ?? ref.kind),
    kind: 'typeKroResource',
    name: ref.name ?? ref.kind,
    stability: 'experimental',
    resource: ref,
  });
}

function applicationTypeKroResourceRef(resource: unknown): { readonly apiVersion: string; readonly kind: string; readonly name?: string; readonly namespace?: string } | undefined {
  if (!resource || typeof resource !== 'object') {
    return undefined;
  }
  const apiVersion = Reflect.get(resource, 'apiVersion');
  const kind = Reflect.get(resource, 'kind');
  const metadata = Reflect.get(resource, 'metadata');
  const name = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : undefined;
  const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
  if (typeof apiVersion !== 'string' || typeof kind !== 'string' || typeof name !== 'string') {
    return undefined;
  }
  return { apiVersion, kind, name, ...(typeof namespace === 'string' ? { namespace } : {}) };
}

function recordApplicationServerGraph(state: ApplicationScopeState, name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): void {
  const nodeId = applicationGraphNodeId('server', name);
  const indexRefs = Object.keys(options.indexes ?? {}).map((indexName) => ({ nodeId: applicationGraphNodeId('index', indexName) }));
  for (const [resourceName, resource] of Object.entries(options.resources ?? {})) {
    recordApplicationCrdGraph(state, resourceName, resource);
  }
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'server',
    name,
    stability: 'experimental',
    routes: routes.map((route) => ({ id: route.id, method: route.method, path: route.path, ...(route.handlerSourceLocation ? { sourceLocation: route.handlerSourceLocation } : {}) })),
    resources: Object.values(options.resources ?? {}).map((resource) => applicationResourceRef(resource)),
    indexes: indexRefs,
  });
  for (const resourceName of Object.keys(options.resources ?? {})) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'dependsOn' });
  }
  for (const [indexName, index] of Object.entries(options.indexes ?? {})) {
    recordApplicationIndexGraph(state, indexName, index);
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('index', indexName) }, relationship: 'reads' });
  }
  recordApplicationCounterGraphs(state, name, options.resources ?? {}, routes);
  const permissions = inferApplicationServerPermissions({ routes, resources: options.resources ?? {}, indexes: options.indexes ?? {}, indexBackend: runtimeIndexBackendConfig(options.indexBackend, options.namespace, options.resourceName ?? name), cache: options.cache ?? [], explicit: options.permissions ?? [] });
  if (permissions.length > 0) {
    const permissionNodeId = applicationGraphNodeId('permission', `${name}-permissions`);
    addApplicationGraphNode(state, { id: permissionNodeId, kind: 'permission', name: `${name}-permissions`, stability: 'experimental', owner: { nodeId }, mode: options.permissions && options.permissions.length > 0 ? 'explicitAndInferred' : 'inferred', rules: permissions });
    addApplicationGraphEdge(state, { from: { nodeId: permissionNodeId }, to: { nodeId }, relationship: 'writes' });
  }
}

function recordApplicationCounterGraphs(state: ApplicationScopeState, serverName: string, resources: Readonly<Record<string, AnyResourceDefinition>>, routes: readonly ApplicationServerRoute[]): void {
  const analyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const serverNodeId = applicationGraphNodeId('server', serverName);
  for (const [resourceName, resource] of Object.entries(resources)) {
    if (!analyses.some((analysis) => routeAnalysisCallsMethod(analysis, resourceName, 'increment'))) {
      continue;
    }
    const nodeId = applicationGraphNodeId('counter', `${serverName}-${resourceName}`);
    addApplicationGraphNode(state, {
      id: nodeId,
      kind: 'counter',
      name: `${serverName}.${resourceName}`,
      stability: 'experimental',
      target: applicationResourceRef(resource),
      flush: { everyMs: 1000 },
    });
    addApplicationGraphEdge(state, { from: { nodeId: serverNodeId }, to: { nodeId }, relationship: 'emits' });
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'writes' });
  }
}

function recordApplicationIndexGraph(state: ApplicationScopeState, name: string, index: ResourceIndex<object, object>): void {
  const providerNodeId = applicationProviderNodeId('IndexStore');
  const nodeId = applicationGraphNodeId('index', name);
  recordApplicationCrdGraph(state, index.resource.kind, index.resource);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'index',
    name,
    stability: 'experimental',
    source: applicationResourceRef(index.resource),
    provider: { interface: 'IndexStore', nodeId: providerNodeId },
    ...(index.options.partitionBy ? { partitionBy: applicationExpressionContract(index.options.partitionBy) } : {}),
    ...(index.options.filter ? { filter: applicationExpressionContract(index.options.filter) } : {}),
    ...(index.options.orderBy ? { orderBy: applicationExpressionContract(index.options.orderBy) } : {}),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', index.resource.kind) }, relationship: 'reads' });
}

function recordApplicationAggregateGraph<TStats extends object, TEvent extends object>(state: ApplicationScopeState, name: string, options: ApplicationAggregateOptions<TStats, TEvent>): void {
  const sourceNodeId = applicationGraphNodeId('index', options.source.name);
  const nodeId = applicationGraphNodeId('aggregate', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'aggregate',
    name,
    stability: 'experimental',
    source: { nodeId: sourceNodeId },
    target: { resource: applicationResourceRef(options.target.resource), statusPath: 'status' },
    flush: { everyMs: parseDurationMs(options.flush?.every ?? '2s'), ...(options.flush?.maxEvents ? { maxEvents: options.flush.maxEvents } : {}) },
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: sourceNodeId }, relationship: 'reads' });
}

function applicationResourceContract(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>) {
  return { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope };
}

function applicationResourceRef(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>): { readonly apiVersion: string; readonly kind: string } {
  return { apiVersion: resource.apiVersion, kind: resource.kind };
}

function applicationExpressionContract(expression: unknown): { readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate'; readonly source: string } {
  const reflectedKind = expression && typeof expression === 'object' ? Reflect.get(expression, 'expressionKind') : undefined;
  const kind = typeof reflectedKind === 'string' ? reflectedKind : 'literal';
  return { kind: applicationExpressionKind(kind), source: JSON.stringify(expression) };
}

function applicationExpressionKind(kind: string): 'field' | 'label' | 'literal' | 'ordering' | 'predicate' {
  return kind === 'field' || kind === 'label' || kind === 'ordering' || kind === 'predicate' ? kind : 'literal';
}

function applicationProviderNodeId(providerInterface: ApplicationProviderInterfaceKind): string {
  return applicationGraphNodeId('provider', providerInterface);
}

function applicationCompositionResourceTarget<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>): ApplicationCompositionResourceTarget {
  const apiVersion = definition.apiVersion ?? (definition.group ? `${definition.group}/v1alpha1` : 'applik8s.dev/v1alpha1');
  return { apiVersion, kind: definition.kind, plural: pluralizeKubernetesKind(definition.kind) };
}

function pluralizeKubernetesKind(kind: string): string {
  const segment = kubernetesNameSegment(kind).replaceAll('-', '');
  if (segment.endsWith('y')) {
    return `${segment.slice(0, -1)}ies`;
  }
  if (segment.endsWith('s')) {
    return `${segment}es`;
  }
  return `${segment}s`;
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}

function applicationOperatorResources(operator: unknown): Readonly<Record<string, AnyResourceDefinition>> {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const resources = definition && typeof definition === 'object' ? Reflect.get(definition, 'resources') : undefined;
  // typecast: app-scoped operator inference reads the SDK operator definition shape without depending on its generic callable type.
  return resources && typeof resources === 'object' ? resources as Readonly<Record<string, AnyResourceDefinition>> : {};
}

function applicationServerBinding(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[], workload: ApplicationGeneratedWorkloadBinding): ApplicationServerBinding {
  const serviceName = options.serviceName ?? options.resourceName ?? name;
  const namespace = options.namespace ?? 'default';
  return {
    name,
    url: `http://${serviceName}.${namespace}.svc.cluster.local/`,
    routes,
    deployment: workload.deployment,
  };
}

function applicationAggregateBinding<TStats extends object, TEvent extends object>(
  name: string,
  options: ApplicationAggregateOptions<TStats, TEvent>,
  workload: ApplicationGeneratedWorkloadBinding
): ApplicationAggregateBinding<TStats, TEvent> {
  return {
    name,
    deployment: workload.deployment,
    options,
  };
}

function emitApplicationGeneratedJob(state: ApplicationScopeState, name: string, options: ApplicationJobOptions | ApplicationScheduleOptions, cron: string | undefined): ApplicationJobBinding {
  const resourceName = kubernetesNameSegment(name);
  const namespace = options.namespace;
  const nodeId = applicationGraphNodeId('job', resourceName);
  const statusPath = `status.applik8s.jobs.${resourceName}`;
  const diagnosticsConfigMapName = `${resourceName}-diagnostics`;
  const statusRuntimeConfigMapName = `${resourceName}-status-runtime`;
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': cron ? 'generated-scheduled-job' : 'generated-job',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/job': resourceName,
  };
  const missedRunPolicy = isApplicationScheduleOptions(options) ? options.missedRunPolicy : undefined;
  const annotations = missedRunPolicy ? { 'applik8s.dev/missed-run-policy': missedRunPolicy } : undefined;
  const container = applicationGeneratedJobContainer(resourceName, statusPath, options);
  const materialization = cron ? 'kubernetes-cronjob' : 'kubernetes-job';
  const resourceRef = { apiVersion: 'batch/v1', kind: cron ? 'CronJob' : 'Job', name: resourceName, ...(namespace ? { namespace } : {}) };
  const phaseStatusTarget = { resource: { nodeId }, statusPath };
  const permissions = [{ apiGroups: ['batch'], resources: [cron ? 'cronjobs' : 'jobs'], verbs: ['create', 'get', 'list', 'watch', 'patch'] }];
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: { nodeId },
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName: resourceName, idempotencyKey: 'metadata.generation' }),
  });
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName: resourceName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedJobFailed',
      message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`,
      failedStep: 'runJob',
      partialEffects: [{ operation: 'runJob', ref: resourceRef, status: 'visible' }],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} reached a terminal failure.`, observedGeneration: 0 }],
  });
  const durableStatusUpdater = applicationGeneratedJobStatusUpdater({
    jobName: resourceName,
    observes: [resourceRef],
    writes: phaseStatusTarget,
    statusShape: phaseStatusContract.statusShape,
  });
  const schedule = cron ? {
    cron,
    ...(isApplicationScheduleOptions(options) && options.timezone ? { timezone: options.timezone } : {}),
    ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: options.concurrencyPolicy } : {}),
    ...(missedRunPolicy ? { missedRunPolicy } : {}),
    ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
  } : undefined;

  if (cron) {
    typeKroCronJob({
      id: graphResourceId(resourceName, 'generatedCronJob'),
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels, ...(annotations ? { annotations } : {}) },
      spec: {
        schedule: cron,
        ...(isApplicationScheduleOptions(options) && options.timezone ? { timeZone: options.timezone } : {}),
        ...(isApplicationScheduleOptions(options) && options.concurrencyPolicy ? { concurrencyPolicy: kubernetesCronJobConcurrencyPolicy(options.concurrencyPolicy) } : {}),
        ...(isApplicationScheduleOptions(options) && options.startingDeadlineSeconds !== undefined ? { startingDeadlineSeconds: options.startingDeadlineSeconds } : {}),
        jobTemplate: { spec: applicationGeneratedJobSpec(labels, container) },
      },
    });
  } else {
    typeKroJob({
      id: graphResourceId(resourceName, 'generatedJob'),
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
      spec: applicationGeneratedJobSpec(labels, container),
    });
  }

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: {
      job: resourceName,
      materialization,
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      retryPolicy: JSON.stringify(applicationGeneratedJobRetry(), null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-job-terminal-failure', severity: 'error', reason: 'GeneratedJobFailed', message: `Generated job ${resourceName} failed. Inspect ${cron ? 'cronjob' : 'job'}/${resourceName} and its pod logs.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(resourceName, 'generatedJobStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName: resourceName, jobKind: cron ? 'CronJob' : 'Job', statusPath, materialization }], state.appResource),
  });

  const statusReconcilerName = applicationStatusReconcilerName(state.appResource, kubernetesNameSegment);
  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName,
    namespace,
    statusPath,
    jobKind: cron ? 'CronJob' : 'Job',
    materialization,
  });

  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'job',
    name: resourceName,
    stability: 'stable',
    task: {
      taskKind: options.taskKind ?? 'custom',
      ...(options.image ? { image: options.image } : {}),
      ...(options.command ? { command: options.command } : {}),
      ...(options.args ? { args: options.args } : {}),
    },
    ...(schedule ? { schedule } : {}),
    phase: applicationGeneratedJobPhase(),
    resources: [resourceRef],
    retry: applicationGeneratedJobRetry(),
    runtime: applicationGeneratedJobRuntime({
      materialization,
      statusResource: { nodeId },
      statusPath,
      permissions,
      durableStatusUpdater,
      metadataLinks: [{ graphNode: { nodeId }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName }, purpose: 'jobDiagnostics' }],
    }),
    generatedResources: [
      { role: 'workload', graphNode: { nodeId }, resource: resourceRef, artifact: { kind: 'kubernetesManifest', name: `${resourceName}.yaml` } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusRuntimeConfigMapName } },
      { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: statusReconcilerName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'runtimeModule', name: statusReconcilerName } },
      { role: 'jobDiagnostics', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: diagnosticsConfigMapName, ...(namespace ? { namespace } : {}) }, artifact: { kind: 'jobDiagnostics', name: diagnosticsConfigMapName } },
    ],
  });

  return { kind: 'applicationJob', name, resourceName, diagnosticsConfigMapName, statusPath };
}

function registerApplicationGeneratedJobStatusTarget(state: ApplicationScopeState, target: ApplicationGeneratedJobStatusTarget): void {
  state.generatedJobStatusTargets.push(target);
}

function applicationGeneratedJobSpec(labels: Readonly<Record<string, string>>, container: ReturnType<typeof applicationGeneratedJobContainer>) {
  return {
    backoffLimit: 3,
    template: {
      metadata: { labels },
      spec: {
        restartPolicy: 'OnFailure',
        containers: [container],
      },
    },
  };
}

function applicationGeneratedJobContainer(resourceName: string, statusPath: string, options: ApplicationJobOptions) {
  return {
    name: 'job',
    image: options.image ?? 'busybox:1.36',
    command: [...(options.command ?? ['sh', '-c'])],
    args: [...(options.args ?? [`echo "applik8s generated job ${resourceName}"`])],
    env: [
      { name: 'APPLIK8S_JOB_NAME', value: resourceName },
      { name: 'APPLIK8S_JOB_STATUS_PATH', value: statusPath },
      ...Object.entries(options.env ?? {}).map(([name, value]) => ({ name, value })),
    ],
  };
}

function isApplicationScheduleOptions(options: ApplicationJobOptions | ApplicationScheduleOptions): options is ApplicationScheduleOptions {
  return 'cron' in options || 'timezone' in options || 'concurrencyPolicy' in options || 'missedRunPolicy' in options || 'startingDeadlineSeconds' in options;
}

function kubernetesCronJobConcurrencyPolicy(policy: 'allow' | 'forbid' | 'replace'): 'Allow' | 'Forbid' | 'Replace' {
  if (policy === 'forbid') {
    return 'Forbid';
  }
  if (policy === 'replace') {
    return 'Replace';
  }
  return 'Allow';
}

function emitApplicationModelStoreResources(state: ApplicationScopeState, model: ApplicationRuntimeModelContract, provider: ApplicationModelStoreProvider): void {
  if (provider.kind !== 'postgres' || provider.provision === false || provider.cluster) {
    return;
  }
  const modelName = model.name;
  const resourceName = kubernetesNameSegment(modelName);
  const clusterName = provider.name ?? `${resourceName}-db`;
  const namespace = provider.namespace;
  const database = provider.database ?? resourceName;
  const secretName = provider.connectionSecret?.name ?? `${clusterName}-app`;
  const secretKey = provider.connectionSecretKey ?? 'uri';
  const modelStoreKey = `${namespace ?? ''}:${clusterName}:${database}:${secretName}:${secretKey}`;
  if (state.emittedModelStores.has(modelStoreKey)) {
    if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
      emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, {
        'app.kubernetes.io/name': clusterName,
        'app.kubernetes.io/component': 'model-store',
        'app.kubernetes.io/managed-by': 'applik8s',
        'applik8s.dev/model': resourceName,
      });
    }
    return;
  }
  state.emittedModelStores.add(modelStoreKey);
  const labels = {
    'app.kubernetes.io/name': clusterName,
    'app.kubernetes.io/component': 'model-store',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/model': resourceName,
  };

  typeKroCnpgCluster({
    id: graphResourceId(resourceName, 'modelStoreCluster'),
    name: clusterName,
    ...(namespace ? { namespace } : {}),
    spec: {
      instances: 1,
      storage: { size: '1Gi' },
      bootstrap: { initdb: { database, owner: 'app' } },
    },
  });

  typeKroRole({
    id: graphResourceId(resourceName, 'modelStoreRole'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: `${kubernetesNameSegment(database)}-model-store`, ...(namespace ? { namespace } : {}), labels },
    rules: [
      { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [secretName] },
      { apiGroups: ['postgresql.cnpg.io'], resources: ['clusters'], verbs: ['get', 'list', 'watch'] },
    ],
  });

  if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
    emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, labels);
  }
}

function emitApplicationModelMigrationResources(state: ApplicationScopeState, model: ApplicationRuntimeModelContract, provider: ApplicationModelStoreProvider, clusterName: string, secretName: string, secretKey: string, database: string, namespace: string | undefined, labels: Readonly<Record<string, string>>): void {
  const resourceName = kubernetesNameSegment(model.name);
  const jobName = provider.migrations?.jobName ?? `${resourceName}-migration`;
  const statusPath = `status.applik8s.jobs.${jobName}`;
  const migrationConfigMapName = `${jobName}-migration`;
  const statusRuntimeConfigMapName = `${jobName}-status-runtime`;
  const migrationPlan = applicationModelMigrationPlan(model);
  const migrationSql = applicationModelMigrationSql(model);
  const migrationJobRef = { apiVersion: 'batch/v1', kind: 'Job', name: jobName, ...(namespace ? { namespace } : {}) };
  const clusterRef = { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(namespace ? { namespace } : {}) };
  const phaseStatusContract = applicationGeneratedJobPhaseStatusContract({
    statusResource: clusterRef,
    statusPath,
    statusShape: applicationGeneratedJobDurableStatus({ jobName, idempotencyKey: 'metadata.generation', currentStep: 'provider-readiness' }),
  });
  const terminalFailureStatus = applicationGeneratedJobDurableStatus({
    jobName,
    phase: 'Failed',
    idempotencyKey: 'metadata.generation',
    currentStep: 'schema-drift',
    retryCount: applicationGeneratedJobRetry().maxAttempts ?? 0,
    terminalFailure: {
      reason: 'GeneratedMigrationFailed',
      message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`,
      failedStep: 'schema-drift',
      partialEffects: [
        { operation: 'runMigrationJob', ref: migrationJobRef, status: 'visible' },
        { operation: 'readMigrationSql', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: migrationConfigMapName, ...(namespace ? { namespace } : {}) }, status: 'visible' },
      ],
    },
    conditions: [{ type: 'Failed', status: 'True', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} reached a terminal failure.`, observedGeneration: 0 }],
  });
  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationSql'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: migrationConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: { 'migration.sql': migrationSql },
  });

  typeKroJob({
    id: graphResourceId(jobName, 'modelMigrationJob'),
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: jobName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      backoffLimit: 3,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'OnFailure',
          containers: [{
            name: 'migration',
            image: 'postgres:16-alpine',
            command: ['sh', '-c', 'echo "applik8s-model-migration applying $APPLIK8S_MODEL_STORE_MODEL"; for attempt in $(seq 1 60); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/migration.sql && exit 0; echo "applik8s-model-migration retry $attempt"; sleep 5; done; exit 1'],
            env: [
              { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: secretName, key: secretKey } } },
              { name: 'DATABASE_URL_SECRET_KEY', value: secretKey },
              { name: 'APPLIK8S_MODEL_STORE_CLUSTER', value: clusterName },
              { name: 'APPLIK8S_MODEL_STORE_DATABASE', value: database },
              { name: 'APPLIK8S_MODEL_STORE_MODEL', value: model.name },
              { name: 'APPLIK8S_MIGRATION_STATUS_PATH', value: statusPath },
            ],
            volumeMounts: [{ name: 'applik8s-model-migration', mountPath: '/migrations', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-model-migration', configMap: { name: migrationConfigMapName } }],
        },
      },
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationDiagnostics'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${jobName}-diagnostics`, ...(namespace ? { namespace } : {}), labels },
    data: {
      model: resourceName,
      database,
      cluster: clusterName,
      connectionSecret: secretName,
      connectionSecretKey: secretKey,
      phaseStatusResource: `postgresql.cnpg.io/v1/Cluster/${namespace ? `${namespace}/` : ''}${clusterName}`,
      phaseStatusPath: statusPath,
      phaseStatusContract: JSON.stringify(phaseStatusContract, null, 2),
      durableStatusTemplate: JSON.stringify(phaseStatusContract.statusShape, null, 2),
      terminalFailureStatus: JSON.stringify(terminalFailureStatus, null, 2),
      semantics: 'generatedIdempotentPostgresMigration',
      migrationConfigMap: migrationConfigMapName,
      migrationSql,
      compatibilityPolicy: JSON.stringify({ mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' }),
      driftPolicy: 'failClosed',
      migrationPlan: JSON.stringify(migrationPlan, null, 2),
      failureModes: JSON.stringify({ missingCredentials: 'blockBeforeSql', badSql: 'terminalFailureWithJobLogs', incompatibleTableOrIndex: 'schemaDriftFailClosed', destructiveChange: 'rejectWithoutExplicitPlan' }, null, 2),
      driftDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-failed', severity: 'error', reason: 'SchemaDriftDetected', message: `Generated migration for model ${model.name} detected existing database schema drift or incompatible table/index shape. Provide an explicit migration plan or repair the database before retrying.`, retryable: false }, null, 2),
      failureDiagnostic: JSON.stringify({ event: 'applik8s-model-migration-failed', severity: 'error', reason: 'GeneratedMigrationFailed', message: `Generated migration for model ${model.name} failed. Inspect job/${jobName} logs and the migration SQL ConfigMap.`, retryable: true }, null, 2),
    },
  });

  typeKroConfigMap({
    id: graphResourceId(jobName, 'modelMigrationStatusRuntime'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: statusRuntimeConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: generatedJobStatusRuntimeBundle([{ jobName, jobKind: 'Job', statusPath, materialization: 'kubernetes-job' }], state.appResource),
  });

  registerApplicationGeneratedJobStatusTarget(state, {
    resourceName: jobName,
    namespace,
    statusPath,
    jobKind: 'Job',
    materialization: 'kubernetes-job',
  });
}

function emitApplicationServerResources(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationGeneratedWorkloadBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const sourceFileName = options.sourceFileName ?? 'server.mjs';
  const namespace = options.namespace;
  const runtimeIndexBackend = runtimeIndexBackendConfig(options.indexBackend, namespace, resourceName);
  const runtimeModels = applicationServerRuntimeModels(options.models ?? {});
  const captures = serializeApplicationServerCaptures(options.captures ?? {});
  const captureAliases = serializedApplicationServerCaptureAliases(captures);
  assertRuntimeBindingNames({ ...(options.resources ?? {}), ...(options.indexes ?? {}), ...(options.models ?? {}), ...captures, ...captureAliases });
  assertDistinctRuntimeBindingNames({ resources: options.resources ?? {}, indexes: options.indexes ?? {}, models: options.models ?? {}, captures, captureAliases });
  const serializedRoutes = serializeApplicationServerRoutes(
    routes,
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {}), ...Object.keys(captures), ...Object.keys(captureAliases)]),
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {})])
  );
  const rawSourceBundle = options.source
    ? { [sourceFileName]: options.source }
    : options.command
      ? undefined
      : generatedApplicationServerBundle(sourceFileName, serializedRoutes, options.resources ?? {}, options.indexes ?? {}, runtimeModels, captures, runtimeIndexBackend, options.cache ?? []);
  const sourceBundle = rawSourceBundle ? kroSafeJavaScriptSourceBundle(rawSourceBundle) : undefined;
  const mountedSourceBundle = sourceBundle ? mountedConfigMapSourceBundle(sourceBundle) : undefined;
  const serverPermissions = inferApplicationServerPermissions({
    routes,
    resources: options.resources ?? {},
    indexes: options.indexes ?? {},
    indexBackend: runtimeIndexBackend,
    cache: options.cache ?? [],
    explicit: options.permissions ?? [],
  });
  const env = {
    NODE_OPTIONS: '--enable-source-maps',
    APPLIK8S_SERVER_NAMESPACE: namespace ?? 'default',
    ...(runtimeIndexBackend ? {
      APPLIK8S_INDEX_BACKEND: runtimeIndexBackend.kind,
      APPLIK8S_INDEX_VALKEY_HOST: runtimeIndexBackend.host,
      APPLIK8S_INDEX_VALKEY_PORT: String(runtimeIndexBackend.port),
    } : {}),
    ...(options.env ?? {}),
  };
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'server',
    'app.kubernetes.io/managed-by': 'applik8s',
    ...(options.labels ?? {}),
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const appVolumeMounts = [
    ...(sourceBundle ? [{ name: 'applik8s-server-source', mountPath: '/app', readOnly: true }] : []),
    ...(options.volumeMounts ?? []),
  ];
  const appVolumes = [
    ...(mountedSourceBundle ? [{ name: 'applik8s-server-source', configMap: { name: sourceConfigMapName, items: mountedSourceBundle.items } }] : []),
    ...(options.volumes ?? []),
  ];

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });

  if (serverPermissions.length > 0) {
    typeKroRole({
      id: id('role'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      rules: serverPermissions.map((rule) => ({
        apiGroups: [...rule.apiGroups],
        resources: [...rule.resources],
        verbs: [...rule.verbs],
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
      })),
    });
    typeKroRoleBinding({
      id: id('roleBinding'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
    });
  }

  if (sourceBundle) {
    typeKroConfigMap({
      id: id('source'),
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
      data: mountedSourceBundle?.data ?? sourceBundle,
    });
  }

  emitIndexBackendResources(resourceName, namespace, labels, options.indexBackend);
  emitValkeyIndexerResources(resourceName, namespace, labels, runtimeIndexBackend, options.indexes ?? {}, options.cache ?? []);

  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: options.replicas ?? 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'server',
            image: options.image ?? 'node:22-alpine',
            command: [...(options.command ?? ['node', `/app/${sourceFileName}`])],
            ...(options.args ? { args: [...options.args] } : {}),
            env: [
              ...Object.entries(env).map(([envName, value]) => ({ name: envName, value })),
              ...modelStoreEnvironmentVariables(runtimeModels, namespace),
            ],
            ports: [{ name: 'http', containerPort: 8080 }],
            ...(appVolumeMounts.length > 0 ? { volumeMounts: appVolumeMounts } : {}),
          }],
          ...(appVolumes.length > 0 ? { volumes: appVolumes } : {}),
        },
      },
    },
  });

  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: serviceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      selector: labels,
      ports: [{ name: 'http', port: options.service?.port ?? 80, targetPort: 8080 }],
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.server only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function emitApplicationAggregateResources<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationGeneratedWorkloadBinding {
  const source = options.source;
  const target = options.target;
  assertApplicationAggregateTarget(name, target);
  const namespace = target.namespace;
  const resourceName = `${kubernetesNameSegment(name)}-aggregate`;
  const serviceAccountName = resourceName;
  const sourceConfigMapName = `${resourceName}-source`;
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'aggregate',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const sourceRuntimeResource = applicationRuntimeResource(source.resource);
  const targetRuntimeResource = applicationRuntimeResource(target.resource);
  const reduceSource = serializeApplicationAggregateFunction(`app.aggregate ${name} reduce`, options.reduce, new Set(['stats', 'event']));
  const statusSource = serializeApplicationAggregateFunction(`app.aggregate ${name} status`, target.status, new Set(['stats']));
  const sourceBundle = kroSafeJavaScriptSourceBundle({
    'aggregate.mjs': generatedApplicationAggregateSource({
      name,
      source: sourceRuntimeResource,
      sourceOptions: source.options,
      target: targetRuntimeResource,
      targetName: target.name,
      ...(target.namespace ? { targetNamespace: target.namespace } : {}),
      initial: options.initial,
      reduceSource,
      statusSource,
      flushEveryMs: parseDurationMs(options.flush?.every ?? '2s'),
      maxEvents: options.flush?.maxEvents ?? 500,
    }),
  });
  const permissions = mergeApplicationPermissionRules([
    { apiGroups: [apiGroupForApiVersion(source.resource.apiVersion)], resources: [source.resource.plural], verbs: ['get', 'list', 'watch'] },
    { apiGroups: [apiGroupForApiVersion(target.resource.apiVersion)], resources: [`${target.resource.plural}/status`], verbs: ['patch'] },
  ]);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    rules: permissions.map((rule) => ({ apiGroups: [...rule.apiGroups], resources: [...rule.resources], verbs: [...rule.verbs] })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: sourceBundle,
  });
  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'aggregate',
            image: 'node:22-alpine',
            command: ['node', '/app/aggregate.mjs'],
            env: [{ name: 'APPLIK8S_AGGREGATE_NAMESPACE', value: namespace ?? 'default' }],
            volumeMounts: [{ name: 'applik8s-aggregate-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-aggregate-source', configMap: { name: sourceConfigMapName } }],
        },
      },
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.aggregate only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function assertApplicationAggregateTarget(name: string, target: ApplicationAggregateStatusTarget<object>): void {
  if (!target || typeof target !== 'object') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target must be an explicit status target.`);
  }
  if (!target.resource?.apiVersion || !target.resource.kind || !target.resource.plural) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.resource must be a resource definition.`);
  }
  if (!target.name) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.name is required.`);
  }
  if (typeof target.status !== 'function') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.status(stats) mapper is required.`);
  }
}

function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function serializeApplicationAggregateFunction(label: string, value: (...args: never[]) => unknown, allowedIdentifiers: ReadonlySet<string>): string {
  const source = normalizeSerializableFunctionSource(value.toString().trim());
  if (!source || source.includes('[native code]')) {
    throw new Error(`${label} must be a serializable JavaScript function.`);
  }
  try {
    Function(`return (${source});`);
  } catch (_error) {
    throw new Error(`${label} must be a serializable JavaScript function expression.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), allowedIdentifiers);
  if (unsupported.length > 0) {
    throw new Error(`${label} cannot serialize closure identifier(s): ${unsupported.join(', ')}. Inline constants inside the function or pass values through resource state.`);
  }
  return source;
}

function normalizeSerializableFunctionSource(source: string): string {
  if (/^async\(/.test(source)) {
    return source.replace(/^async\(/, 'async (');
  }
  return /^[$A-Z_a-z][$\w]*\s*\(/.test(source) ? `function ${source}` : source;
}

function parseDurationMs(duration: string): number {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) {
    throw new Error(`app.aggregate flush.every must be a duration like "500ms", "2s", or "1m".`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : 60_000;
  return Math.max(1, Math.round(value * multiplier));
}

function applicationRuntimeResource(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>): ApplicationServerRuntimeResource {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
  };
}

function modelStoreEnvironmentVariables(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, serverNamespace: string | undefined): readonly { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }[] {
  const byEnvName = new Map<string, { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }>();
  for (const model of Object.values(models)) {
    const secretNamespace = model.secretNamespace ?? 'default';
    const podNamespace = serverNamespace ?? 'default';
    if (secretNamespace !== podNamespace) {
      throw new Error(`app.server cannot bind model ${JSON.stringify(model.name)} because its ModelStore Secret ${model.secretName} is in namespace ${secretNamespace}, but the server is in namespace ${podNamespace}. Run the server in the same namespace or provide a same-namespace connectionSecret.`);
    }
    byEnvName.set(model.connectionEnvName, {
      name: model.connectionEnvName,
      valueFrom: { secretKeyRef: { name: model.secretName, key: model.secretKey } },
    });
  }
  return [...byEnvName.values()];
}

function assertRuntimeBindingNames(bindings: Readonly<Record<string, unknown>>): void {
  for (const name of Object.keys(bindings)) {
    if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
      throw new Error(`app.server runtime binding ${JSON.stringify(name)} must be a valid JavaScript identifier.`);
    }
  }
}

function assertDistinctRuntimeBindingNames(bindings: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
  const seen = new Map<string, string>();
  for (const [kind, values] of Object.entries(bindings)) {
    for (const name of Object.keys(values)) {
      const previous = seen.get(name);
      if (previous) {
        throw new Error(`app.server runtime binding ${JSON.stringify(name)} is declared as both ${previous} and ${kind}. Use distinct resource, index, and capture names.`);
      }
      seen.set(name, kind);
    }
  }
}

function serializeApplicationServerCaptures(captures: Readonly<Record<string, ApplicationServerCaptureValue>>): SerializedApplicationServerCaptures {
  const captureNames = new Set(Object.keys(captures));
  const captureBindingNames = new Set(captureNames);
  for (const [name, value] of Object.entries(captures)) {
    if (typeof value === 'function') {
      const aliasName = applicationServerFunctionCaptureAliasName(name, value.name);
      if (aliasName) {
        captureBindingNames.add(aliasName);
      }
    }
  }
  const serialized: Record<string, SerializedApplicationServerCapture> = {};
  for (const [name, value] of Object.entries(captures)) {
    if (typeof value === 'function') {
      serialized[name] = serializeApplicationServerFunctionCapture(name, value, captureBindingNames);
      continue;
    }
    if (isJsonSerializableValue(value)) {
      serialized[name] = { kind: 'json', value };
      continue;
    }
      throw new Error(`app.server capture ${JSON.stringify(name)} must be JSON-serializable.`);
  }
  return serialized;
}

function serializeApplicationServerFunctionCapture(name: string, value: ApplicationServerCaptureFunction, captureNames: ReadonlySet<string>): SerializedApplicationServerFunctionCapture {
  const source = value.toString().trim();
  if (!source || source.includes('[native code]')) {
    throw new Error(`app.server capture ${JSON.stringify(name)} must be a serializable JavaScript function.`);
  }
  try {
    Function(`return (${source});`);
  } catch (_error) {
    throw new Error(`app.server capture ${JSON.stringify(name)} must be a serializable JavaScript function expression.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), captureNames);
  if (unsupported.length > 0) {
    throw new Error(`app.server capture ${JSON.stringify(name)} cannot serialize closure identifier(s): ${unsupported.join(', ')}. Pass every referenced value through app.server captures or inline constants inside the capture function.`);
  }
  const aliasName = applicationServerFunctionCaptureAliasName(name, value.name);
  return { kind: 'function', source, ...(aliasName ? { aliasName } : {}) };
}

function applicationServerFunctionCaptureAliasName(captureName: string, functionName: string): string | undefined {
  if (!functionName || functionName === captureName || !/^[$A-Z_a-z][$\w]*$/.test(functionName)) {
    return undefined;
  }
  return functionName;
}

function serializedApplicationServerCaptureAliases(captures: SerializedApplicationServerCaptures): Readonly<Record<string, unknown>> {
  const aliases: Record<string, unknown> = {};
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      aliases[capture.aliasName] = capture;
    }
  }
  return aliases;
}

function isJsonSerializableValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonSerializableValue);
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.values(value).every(isJsonSerializableValue);
  }
  return false;
}

function serializeApplicationServerRoutes(
  routes: readonly ApplicationServerRoute[],
  bindingNames: ReadonlySet<string>,
  dynamicAccessDisallowedBindings: ReadonlySet<string>
): readonly SerializedApplicationServerRouteWithDependencies[] {
  return routes.map((route) => serializeApplicationServerRoute(route, bindingNames, dynamicAccessDisallowedBindings));
}

function serializeApplicationServerRoute(
  route: ApplicationServerRoute,
  bindingNames: ReadonlySet<string>,
  dynamicAccessDisallowedBindings: ReadonlySet<string>
): SerializedApplicationServerRouteWithDependencies {
  try {
    Function(`return (${route.handlerSource});`);
  } catch (error) {
    const location = route.handlerSourceLocation ? ` at ${route.handlerSourceLocation.file}:${route.handlerSourceLocation.line}:${route.handlerSourceLocation.column}` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`app.server route ${route.method} ${route.path} must be a serializable JavaScript function expression (${route.handlerSourceKind ?? 'unknown'}${location}): ${message}`);
  }
  const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
  const dynamicAccesses = routeDynamicBindingAccesses(analysis, dynamicAccessDisallowedBindings);
  if (dynamicAccesses.length > 0) {
    throw new Error(`app.server route ${route.method} ${route.path} uses unsupported dynamic binding access: ${dynamicAccesses.join(', ')}. Use direct methods like Resource.create(...) or index.query(...) so permissions can be inferred.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analysis, bindingNames);
  const dependencies = applicationRouteSourceDependencies(route, unsupported, bindingNames);
  if (unsupported.length > 0 && !dependencies) {
    throw new Error(`app.server route ${route.method} ${route.path} cannot serialize closure identifier(s): ${unsupported.join(', ')}. Pass serializable values through app.server captures, pass resources/indexes through app.server bindings, or inline constants inside the handler.`);
  }
  return dependencies ? { ...route, handlerDependencySource: dependencies.source, handlerDependencyResolveDir: dependencies.resolveDir } : route;
}

function inferApplicationServerPermissions(request: ApplicationServerPermissionInferenceRequest): readonly ApplicationPermissionRule[] {
  const cachedIndexes = new Set(request.indexBackend ? request.cache : []);
  const inferred: ApplicationPermissionRule[] = [];
  for (const route of request.routes) {
    const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
    for (const [name, resource] of Object.entries(request.resources)) {
      for (const operation of resourceOperationsInSource(analysis, name)) {
        inferred.push(resourceOperationPermission(resource, operation));
      }
    }
    for (const [name, index] of Object.entries(request.indexes)) {
      if (!cachedIndexes.has(index) && routeAnalysisCallsMethod(analysis, name, 'query')) {
        inferred.push(resourceOperationPermission(index.resource, 'query'));
      }
    }
  }
  return mergeApplicationPermissionRules([...request.explicit, ...inferred]);
}

type ApplicationServerResourceOperation = 'create' | 'get' | 'query' | 'patch' | 'delete' | 'increment';

const resourceOperationVerbs: Readonly<Record<ApplicationServerResourceOperation, readonly string[]>> = {
  create: ['create'],
  get: ['get'],
  query: ['get', 'list'],
  patch: ['patch'],
  delete: ['delete'],
  increment: ['create', 'get', 'patch'],
};

function resourceOperationsInSource(analysis: ApplicationServerRouteSourceAnalysis, bindingName: string): readonly ApplicationServerResourceOperation[] {
  // typecast: resourceOperationVerbs is keyed by every ApplicationServerResourceOperation, so Object.keys narrows back to that union here.
  return (Object.keys(resourceOperationVerbs) as ApplicationServerResourceOperation[]).filter((operation) => routeAnalysisCallsMethod(analysis, bindingName, operation));
}

function routeAnalysisCallsMethod(analysis: ApplicationServerRouteSourceAnalysis, bindingName: string, methodName: string): boolean {
  return analysis.memberCalls.some((call) => call.objectName === bindingName && call.methodName === methodName) || analysis.methodAliases.some((alias) => alias.objectName === bindingName && alias.methodName === methodName && analysis.functionCalls.has(alias.aliasName));
}

function routeDynamicBindingAccesses(analysis: ApplicationServerRouteSourceAnalysis, bindingNames: ReadonlySet<string>): readonly string[] {
  const dynamicAccesses = new Set<string>();
  for (const bindingName of bindingNames) {
    if (new RegExp(`\\b${escapeRegExp(bindingName)}\\s*\\[`).test(analysis.strippedSource)) {
      dynamicAccesses.add(bindingName);
    }
  }
  return [...dynamicAccesses].sort();
}

function resourceOperationPermission(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'plural'>, operation: ApplicationServerResourceOperation): ApplicationPermissionRule {
  return {
    apiGroups: [apiGroupForApiVersion(resource.apiVersion)],
    resources: [resource.plural],
    verbs: resourceOperationVerbs[operation],
  };
}

function mergeApplicationPermissionRules(permissions: readonly ApplicationPermissionRule[]): readonly ApplicationPermissionRule[] {
  const merged = new Map<string, { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames?: string[] }>();
  for (const permission of permissions) {
    const apiGroups = [...permission.apiGroups].sort();
    const resources = [...permission.resources].sort();
    const resourceNames = permission.resourceNames ? [...permission.resourceNames].sort() : undefined;
    const key = JSON.stringify({ apiGroups, resources, resourceNames });
    const existing = merged.get(key);
    if (existing) {
      existing.verbs = unique([...existing.verbs, ...permission.verbs]);
      continue;
    }
    merged.set(key, {
      apiGroups,
      resources,
      verbs: unique([...permission.verbs]),
      ...(resourceNames ? { resourceNames } : {}),
    });
  }
  return [...merged.values()];
}

function apiGroupForApiVersion(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function analyzeApplicationServerRouteSource(source: string): ApplicationServerRouteSourceAnalysis {
  const strippedSource = stripCommentsAndStrings(source);
  const declaredIdentifiers = declaredRouteIdentifiers(strippedSource);
  const functionCalls = routeFunctionCalls(strippedSource);
  const memberCalls = routeMemberCalls(strippedSource);
  const methodAliases = routeMethodAliases(strippedSource);
  const freeIdentifiers = routeFreeIdentifiers(strippedSource, declaredIdentifiers);
  return { strippedSource, declaredIdentifiers, memberCalls, methodAliases, functionCalls, freeIdentifiers };
}

function routeMemberCalls(source: string): readonly ApplicationServerMemberCall[] {
  const calls: ApplicationServerMemberCall[] = [];
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    calls.push({ objectName: match[1] ?? '', methodName: match[2] ?? '' });
  }
  return calls.filter((call) => call.objectName.length > 0 && call.methodName.length > 0);
}

function routeMethodAliases(source: string): readonly ApplicationServerMethodAlias[] {
  const aliases: ApplicationServerMethodAlias[] = [];
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\b/g)) {
    aliases.push({ aliasName: match[1] ?? '', objectName: match[2] ?? '', methodName: match[3] ?? '' });
  }
  return aliases.filter((alias) => alias.aliasName.length > 0 && alias.objectName.length > 0 && alias.methodName.length > 0);
}

function routeFunctionCalls(source: string): ReadonlySet<string> {
  const calls = new Set<string>();
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1] ?? '';
    const index = match.index ?? 0;
    if (!name || previousNonWhitespace(source, index) === '.') {
      continue;
    }
    calls.add(name);
  }
  return calls;
}

function routeFreeIdentifiers(source: string, declared: ReadonlySet<string>): readonly string[] {
  const unsupported = new Set<string>();
  const identifiers = source.matchAll(/\b[A-Za-z_$][\w$]*\b/g);
  for (const match of identifiers) {
    const name = match[0];
    const index = match.index ?? 0;
    if (declared.has(name) || routeKeywords.has(name)) {
      continue;
    }
    const previous = previousNonWhitespace(source, index);
    const next = nextNonWhitespace(source, index + name.length);
    if (previous === '.' || next === ':' || isDeclarationIdentifier(source, index, name)) {
      continue;
    }
    unsupported.add(name);
  }
  return [...unsupported].sort();
}

function unsupportedRouteFreeIdentifiers(analysis: ApplicationServerRouteSourceAnalysis, bindingNames: ReadonlySet<string>): readonly string[] {
  const allowed = new Set([
    ...bindingNames,
    ...analysis.declaredIdentifiers,
    'Array',
    'Boolean',
    'Date',
    'Error',
    'JSON',
    'Math',
    'Number',
    'Object',
    'Promise',
    'RegExp',
    'Response',
    'String',
    'any',
    'boolean',
    'URL',
    'URLSearchParams',
    'clearTimeout',
    'console',
    'decodeURIComponent',
    'encodeURIComponent',
    'globalThis',
    'parseFloat',
    'parseInt',
    'process',
    'setTimeout',
    'string',
    'undefined',
    'unknown',
    'void',
  ]);
  return analysis.freeIdentifiers.filter((name) => !allowed.has(name) && !routeKeywords.has(name));
}

function applicationRouteSourceDependencies(route: ApplicationServerRoute, unsupported: readonly string[], bindingNames: ReadonlySet<string>): ApplicationRouteSourceDependencies | undefined {
  if (unsupported.length === 0) {
    return undefined;
  }
  if (!route.handlerSourceLocation || route.handlerSourceKind !== 'source') {
    return undefined;
  }
  const fileSource = readFileSync(route.handlerSourceLocation.file, 'utf8');
  const topLevelBindings = applicationRouteTopLevelBindings(fileSource, bindingNames);
  const included = new Map<string, ApplicationRouteTopLevelBinding>();
  const unresolved = new Set<string>();
  const queue = [...unsupported];
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index] ?? '';
    if (!name || bindingNames.has(name) || included.has(name) || routeKeywords.has(name) || unresolved.has(name)) {
      continue;
    }
    const binding = topLevelBindings.get(name);
    if (!binding) {
      unresolved.add(name);
      continue;
    }
    included.set(name, binding);
    if (binding.kind === 'declaration') {
      const nested = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(binding.analysisSource), new Set([...bindingNames, ...included.keys()]));
      for (const nestedName of nested) {
        if (!included.has(nestedName) && !unresolved.has(nestedName)) {
          queue.push(nestedName);
        }
      }
    }
  }
  if (unresolved.size > 0) {
    throw new Error(`app.server route ${route.method} ${route.path} cannot serialize closure identifier(s): ${[...unresolved].sort().join(', ')}. Pass serializable values through app.server captures, pass resources/indexes through app.server bindings, or move helper code to module scope/imports.`);
  }
  const imports = unique([...included.values()].filter((binding) => binding.kind === 'import').map((binding) => binding.source));
  const declarations = unique([...included.values()].filter((binding) => binding.kind === 'declaration').map((binding) => binding.source));
  return { source: [...imports, ...declarations].join('\n\n'), resolveDir: dirname(route.handlerSourceLocation.file) };
}

function applicationRouteTopLevelBindings(source: string, bindingNames: ReadonlySet<string>): ReadonlyMap<string, ApplicationRouteTopLevelBinding> {
  const bindings = new Map<string, ApplicationRouteTopLevelBinding>();
  let index = 0;
  let depth = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0) {
      const importBinding = topLevelImportBindingAt(source, index);
      if (importBinding) {
        for (const name of importBinding.names) {
          bindings.set(name, { name, source: importBinding.source, analysisSource: importBinding.source, kind: 'import' });
        }
        index = importBinding.end;
        continue;
      }
      const declaration = topLevelDeclarationBindingAt(source, index, bindingNames);
      if (declaration) {
        for (const name of declaration.names) {
          bindings.set(name, { name, source: declaration.source, analysisSource: transpileRouteDependencySourceForAnalysis(declaration.source), kind: 'declaration' });
        }
        index = declaration.end;
        continue;
      }
    }
    index += 1;
  }
  return bindings;
}

function transpileRouteDependencySourceForAnalysis(source: string): string {
  try {
    return transformSync(source, { loader: 'ts', format: 'esm', target: 'node22' }).code;
  } catch (_error) {
    return source;
  }
}

function topLevelImportBindingAt(source: string, index: number): { readonly names: readonly string[]; readonly source: string; readonly end: number } | undefined {
  if (!keywordAt(source, index, 'import') || source.slice(index).match(/^import\s*\(/)) {
    return undefined;
  }
  const end = statementSourceEnd(source, index);
  const importSource = source.slice(index, end).trim();
  if (/^import\s+type\b/.test(importSource)) {
    return { names: [], source: importSource, end };
  }
  return { names: importedLocalNames(importSource), source: importSource, end };
}

function topLevelDeclarationBindingAt(source: string, index: number, bindingNames: ReadonlySet<string>): { readonly names: readonly string[]; readonly source: string; readonly end: number } | undefined {
  const snippet = source.slice(index);
  const functionMatch = snippet.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
  if (functionMatch) {
    const open = source.indexOf('{', index + functionMatch[0].length);
    const close = open >= 0 ? matchingDelimiter(source, open, '{', '}') : undefined;
    const end = close === undefined ? statementSourceEnd(source, index) : close + 1;
    const names = [functionMatch[1] ?? ''].filter((name) => name && !bindingNames.has(name));
    return { names, source: stripTopLevelExport(source.slice(index, end).trim()), end };
  }
  const classMatch = snippet.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (classMatch) {
    const open = source.indexOf('{', index + classMatch[0].length);
    const close = open >= 0 ? matchingDelimiter(source, open, '{', '}') : undefined;
    const end = close === undefined ? statementSourceEnd(source, index) : close + 1;
    const names = [classMatch[1] ?? ''].filter((name) => name && !bindingNames.has(name));
    return { names, source: stripTopLevelExport(source.slice(index, end).trim()), end };
  }
  const variableMatch = snippet.match(/^(?:export\s+)?(?:const|let|var)\s+/);
  if (variableMatch) {
    const end = statementSourceEnd(source, index);
    const declarationSource = stripTopLevelExport(source.slice(index, end).trim());
    const names = variableDeclarationNames(declarationSource).filter((name) => !bindingNames.has(name));
    return { names, source: declarationSource, end };
  }
  return undefined;
}

function importedLocalNames(source: string): readonly string[] {
  const names: string[] = [];
  const defaultMatch = source.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/);
  if (defaultMatch?.[1]) {
    names.push(defaultMatch[1]);
  }
  const namespaceMatch = source.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch?.[1]) {
    names.push(namespaceMatch[1]);
  }
  const named = source.match(/\{([^}]*)\}/)?.[1];
  if (named) {
    for (const part of named.split(',')) {
      const match = part.trim().match(/^(?:type\s+)?[A-Za-z_$][\w$]*(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      const local = match?.[1] ?? part.trim().replace(/^type\s+/, '').split(/\s+/)[0];
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) {
        names.push(local);
      }
    }
  }
  return unique(names);
}

function variableDeclarationNames(source: string): readonly string[] {
  const names: string[] = [];
  const body = source.replace(/^(?:const|let|var)\s+/, '').replace(/;\s*$/, '');
  for (const part of splitTopLevelArguments(body)) {
    const name = part.trim().match(/^([A-Za-z_$][\w$]*)\b/)?.[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function statementSourceEnd(source: string, start: number): number {
  let index = start;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '(') {
      parens += 1;
    } else if (character === ')') {
      parens -= 1;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (character === ';' && parens === 0 && braces === 0 && brackets === 0) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function stripTopLevelExport(source: string): string {
  return source.replace(/^export\s+/, '');
}

function keywordAt(source: string, index: number, keyword: string): boolean {
  return source.startsWith(keyword, index) && !/[A-Za-z0-9_$]/.test(source[index - 1] ?? '') && !/[A-Za-z0-9_$]/.test(source[index + keyword.length] ?? '');
}

const routeKeywords = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
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
  'var',
  'void',
  'while',
]);

function stripCommentsAndStrings(source: string): string {
  const output = [...source];

  const blank = (start: number, end: number): void => {
    for (let position = start; position < end; position += 1) {
      if (output[position] !== '\n' && output[position] !== '\r') {
        output[position] = ' ';
      }
    }
  };

  const scanQuotedString = (start: number, quote: string): number => {
    let position = start + 1;
    while (position < source.length) {
      if (source[position] === '\\') {
        position += 2;
        continue;
      }
      if (source[position] === quote) {
        position += 1;
        break;
      }
      position += 1;
    }
    blank(start, position);
    return position;
  };

  const scanRegexLiteral = (start: number): number => {
    let position = start + 1;
    let inCharacterClass = false;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\') {
        position += 2;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        position += 1;
        while (/[A-Za-z]/.test(source[position] ?? '')) {
          position += 1;
        }
        break;
      }
      position += 1;
    }
    blank(start, position);
    return position;
  };

  const scanTemplate = (start: number): number => {
    output[start] = ' ';
    let position = start + 1;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\') {
        blank(position, Math.min(position + 2, source.length));
        position += 2;
        continue;
      }
      if (character === '`') {
        output[position] = ' ';
        return position + 1;
      }
      if (character === '$' && source[position + 1] === '{') {
        blank(position, position + 2);
        const close = scanRange(position + 2, true);
        if (close < source.length) {
          output[close] = ' ';
          position = close + 1;
          continue;
        }
        return close;
      }
      output[position] = character === '\n' || character === '\r' ? character : ' ';
      position += 1;
    }
    return position;
  };

  const scanRange = (start: number, stopOnBrace: boolean): number => {
    let position = start;
    while (position < source.length) {
      const character = source[position];
      const next = source[position + 1];
      if (stopOnBrace && character === '}') {
        return position;
      }
      if (character === '/' && next === '/') {
        let end = position + 2;
        while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
          end += 1;
        }
        blank(position, end);
        position = end;
        continue;
      }
      if (character === '/' && next === '*') {
        const end = source.indexOf('*/', position + 2);
        const commentEnd = end === -1 ? source.length : end + 2;
        blank(position, commentEnd);
        position = commentEnd;
        continue;
      }
      if (character === '/' && isRegexLiteralStart(source, position)) {
        position = scanRegexLiteral(position);
        continue;
      }
      if (character === '\'' || character === '"') {
        position = scanQuotedString(position, character);
        continue;
      }
      if (character === '`') {
        position = scanTemplate(position);
        continue;
      }
      if (stopOnBrace && character === '{') {
        const close = scanRange(position + 1, true);
        position = close < source.length ? close + 1 : close;
        continue;
      }
      position += 1;
    }
    return position;
  };

  scanRange(0, false);
  return output.join('');
}

function isRegexLiteralStart(source: string, index: number): boolean {
  const previous = previousNonWhitespace(source, index);
  return previous === undefined || ['(', ',', '=', ':', '[', '{', '!', '?', ';'].includes(previous);
}

function declaredRouteIdentifiers(source: string): ReadonlySet<string> {
  const declared = new Set<string>();
  const parameterList = source.match(/^(?:async\s*)?(?:function\s*)?\(?\s*([^)=]*)\s*\)?\s*=>|^async\s+function\s*[^()]*\(([^)]*)\)|^function\s*[^()]*\(([^)]*)\)/);
  addParameterIdentifiers(declared, parameterList?.[1] ?? parameterList?.[2] ?? parameterList?.[3] ?? '');
  for (const match of source.matchAll(/\(([^)]*)\)\s*=>/g)) {
    addParameterIdentifiers(declared, match[1] ?? '');
  }
  for (const match of source.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  declared.delete('');
  return declared;
}

function addParameterIdentifiers(declared: Set<string>, parameters: string): void {
  for (const part of parameters.split(',')) {
    const name = part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
    if (name) {
      declared.add(name);
    }
  }
}

function previousNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index - 1; position >= 0; position -= 1) {
    if (!/\s/.test(source[position] ?? '')) {
      return source[position];
    }
  }
  return undefined;
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index; position < source.length; position += 1) {
    if (!/\s/.test(source[position] ?? '')) {
      return source[position];
    }
  }
  return undefined;
}

function isDeclarationIdentifier(source: string, index: number, name: string): boolean {
  const prefix = source.slice(Math.max(0, index - 32), index);
  return /(?:const|let|var|function)\s+$/.test(prefix) || /catch\s*\(\s*$/.test(prefix) || /for\s*\(\s*(?:const|let|var)\s+$/.test(prefix) || prefix.endsWith(`${name}.`);
}

function graphResourceId(name: string, suffix: string): string {
  const parts = `${name}-${suffix}`.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [first = 'resource', ...rest] = parts;
  return `${first.slice(0, 1).toLowerCase()}${first.slice(1)}${rest.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')}`;
}

function runtimeIndexBackendConfig(backend: ApplicationIndexBackend | undefined, namespace: string | undefined, resourceName: string): ApplicationRuntimeIndexBackend | undefined {
  if (!backend) {
    return undefined;
  }
  if (backend.kind === 'valkey') {
    const name = backend.name ?? `${resourceName}-index`;
    const backendNamespace = backend.namespace ?? namespace ?? 'default';
    return {
      kind: 'valkey',
      host: backend.host ?? `${name}.${backendNamespace}.svc.cluster.local`,
      port: backend.port ?? 6379,
    };
  }
  return undefined;
}

function emitIndexBackendResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationIndexBackend | undefined): void {
  if (backend?.kind !== 'valkey' || backend.provision === false || backend.host) {
    return;
  }
  const name = backend.name ?? `${resourceName}-index`;
  if (backend.provisioner === 'hyperspike') {
    emitHyperspikeValkeyResource(resourceName, namespace, labels, backend, name);
    return;
  }
  emitStandaloneValkeyResources(resourceName, namespace, labels, backend, name);
}

function emitHyperspikeValkeyResource(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const spec = {
    shards: 1,
    replicas: 0,
    anonymousAuth: true,
    ...(backend.spec ?? {}),
  };
  typeKroValkey({
    name,
    namespace: backend.namespace ?? namespace,
    id: graphResourceId(resourceName, 'valkeyIndex'),
    // typecast: TypeKro's Valkey factory accepts its CRD spec shape; applik8s keeps the backend option structurally typed to avoid leaking the provider package into public API types.
    spec: spec as never,
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(namespace ? { namespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: `${name}.${backend.namespace ?? namespace ?? 'default'}.svc.cluster.local`,
      port: String(backend.port ?? 6379),
    },
  });
}

function emitStandaloneValkeyResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const backendNamespace = backend.namespace ?? namespace;
  const backendLabels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'index-backend',
    'app.kubernetes.io/part-of': resourceName,
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(name, suffix);
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: backendLabels },
      template: {
        metadata: { labels: backendLabels },
        spec: {
          containers: [{
            name: 'valkey',
            image: backend.image ?? 'valkey/valkey:8.1-alpine',
            args: ['valkey-server', '--save', ''],
            ports: [{ name: 'valkey', containerPort: backend.port ?? 6379 }],
          }],
        },
      },
    },
  });
  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      selector: backendLabels,
      ports: [{ name: 'valkey', port: backend.port ?? 6379, targetPort: backend.port ?? 6379 }],
    },
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: `${name}.${backend.namespace ?? namespace ?? 'default'}.svc.cluster.local`,
      port: String(backend.port ?? 6379),
    },
  });
}

function emitValkeyIndexerResources(
  resourceName: string,
  namespace: string | undefined,
  labels: Readonly<Record<string, string>>,
  backend: ApplicationRuntimeIndexBackend | undefined,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  cache: readonly ResourceIndex<object, object>[]
): void {
  if (backend?.kind !== 'valkey') {
    return;
  }
  const cachedIndexes = runtimeIndexTable(indexes, backend, cache);
  if (Object.keys(cachedIndexes).length === 0) {
    return;
  }
  const indexerName = `${resourceName}-indexer`;
  const indexerLabels = { ...labels, 'app.kubernetes.io/component': 'indexer', 'app.kubernetes.io/name': indexerName };
  const sourceName = `${indexerName}-source`;
  const id = (suffix: string) => graphResourceId(indexerName, suffix);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    rules: indexerPermissionRules(cachedIndexes).map((rule) => ({
      apiGroups: [...rule.apiGroups],
      resources: [...rule.resources],
      verbs: [...rule.verbs],
      ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
    })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    subjects: [{ kind: 'ServiceAccount', name: indexerName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: indexerName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    data: { 'indexer.mjs': generatedValkeyIndexerSource(cachedIndexes) },
  });
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: indexerLabels },
      template: {
        metadata: { labels: indexerLabels },
        spec: {
          serviceAccountName: indexerName,
          containers: [{
            name: 'indexer',
            image: 'node:22-alpine',
            command: ['node', '/app/indexer.mjs'],
            env: [
              { name: 'APPLIK8S_SERVER_NAMESPACE', value: namespace ?? 'default' },
              { name: 'APPLIK8S_INDEX_VALKEY_HOST', value: backend.host },
              { name: 'APPLIK8S_INDEX_VALKEY_PORT', value: String(backend.port) },
            ],
            volumeMounts: [{ name: 'applik8s-indexer-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-indexer-source', configMap: { name: sourceName } }],
        },
      },
    },
  });
}

function indexerPermissionRules(indexes: Readonly<Record<string, ApplicationServerRuntimeIndex>>): readonly ApplicationPermissionRule[] {
  const rules = new Map<string, ApplicationPermissionRule>();
  for (const index of Object.values(indexes)) {
    const [group = ''] = index.resource.apiVersion.includes('/') ? index.resource.apiVersion.split('/') : [''];
    const key = `${group}/${index.resource.plural}`;
    rules.set(key, { apiGroups: [group], resources: [index.resource.plural], verbs: ['get', 'list', 'watch'] });
  }
  return [...rules.values()];
}

function createRouteRecorder(routes: ApplicationServerRoute[]): ApplicationServer {
  const record = (method: ApplicationServerRoute['method'], path: string, handler: ApplicationRouteHandler) => {
    const extracted = extractApplicationRouteHandlerSource(method);
    const fallbackSource = normalizeSerializableFunctionSource(handler.toString().trim());
    routes.push({
      id: routeId(method, path, routes.length),
      method,
      path,
      handlerSource: extracted?.source ?? fallbackSource,
      handlerSourceKind: extracted ? 'source' : 'functionToString',
      ...(extracted ? { handlerSourceLocation: extracted.location } : {}),
    });
  };
  return {
    get(path, handler) {
      record('GET', path, handler);
    },
    post(path, handler) {
      record('POST', path, handler);
    },
  };
}

function routeId(method: ApplicationServerRoute['method'], path: string, index: number): string {
  const safePath = path.split('/').filter(Boolean).join('-') || 'root';
  return `${method.toLowerCase()}-${safePath}-${index}`.replace(/[^a-z0-9-]+/g, '-');
}

const applicationModulePath = fileURLToPath(import.meta.url);

function extractApplicationRouteHandlerSource(method: ApplicationServerRoute['method']): { readonly source: string; readonly location: ApplicationRouteSourceLocation } | undefined {
  const previousStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Math.max(previousStackTraceLimit, 50);
  const stack = new Error().stack;
  Error.stackTraceLimit = previousStackTraceLimit;
  const location = applicationRouteCallsiteLocation(stack);
  if (!location) {
    debugRouteSourceExtraction('no callsite location');
    return undefined;
  }
  try {
    const fileSource = readFileSync(location.file, 'utf8');
    const expression = routeHandlerExpressionAtLocation(fileSource, location, method);
    if (!expression) {
      debugRouteSourceExtraction(`no route expression at ${location.file}:${location.line}:${location.column}`);
      return undefined;
    }
    return { source: transpileRouteHandlerExpression(expression), location };
  } catch (error) {
    debugRouteSourceExtraction(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function debugRouteSourceExtraction(message: string): void {
  if (process.env.APPLIK8S_DEBUG_ROUTE_SOURCE === '1') {
    console.error(`[applik8s] route source extraction fallback: ${message}`);
  }
}

function applicationRouteCallsiteLocation(stack: string | undefined): ApplicationRouteSourceLocation | undefined {
  if (!stack) {
    return undefined;
  }
  for (const line of stack.split('\n')) {
    const match = line.match(/\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?$/);
    if (!match) {
      continue;
    }
    const rawFile = match[1] ?? '';
    const file = rawFile.startsWith('file://') ? fileURLToPath(rawFile) : rawFile;
    if (!file || isApplicationRouteInternalStackFrame(line, file) || file.includes('/node_modules/') || !existsSync(file) || !/\.[cm]?[jt]sx?$/.test(file)) {
      continue;
    }
    return { file, line: Number(match[2]), column: Number(match[3]) };
  }
  return undefined;
}

function isApplicationRouteInternalStackFrame(line: string, file: string): boolean {
  if (file === applicationModulePath && !isGeneratedDiscoveryEntrypoint(file)) {
    return true;
  }
  return /\bat (?:extractApplicationRouteHandlerSource|applicationRouteCallsiteLocation|record|Object\.(?:get|post))\b/.test(line);
}

function isGeneratedDiscoveryEntrypoint(file: string): boolean {
  return file.includes('/.applik8s-tmp/discovery-') && file.endsWith('/entrypoint.mjs');
}

function routeHandlerExpressionAtLocation(source: string, location: ApplicationRouteSourceLocation, method: ApplicationServerRoute['method']): string | undefined {
  const position = sourceOffsetForLineColumn(source, location.line, location.column);
  const methodName = method.toLowerCase();
  const searchStart = Math.max(0, position - 4000);
  const searchEnd = Math.min(source.length, position + 8000);
  const windowSource = source.slice(searchStart, searchEnd);
  const calls: { readonly openParen: number; readonly closeParen: number; readonly distance: number }[] = [];
  const callPattern = new RegExp(`\\.\\s*${methodName}\\s*\\(`, 'g');
  for (const match of windowSource.matchAll(callPattern)) {
    const openParen = searchStart + (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParen = matchingDelimiter(source, openParen, '(', ')');
    if (closeParen === undefined) {
      continue;
    }
    calls.push({ openParen, closeParen, distance: position >= openParen && position <= closeParen ? 0 : Math.abs(openParen - position) });
  }
  const call = calls.sort((left, right) => left.distance - right.distance)[0];
  if (!call) {
    return undefined;
  }
  const args = splitTopLevelArguments(source.slice(call.openParen + 1, call.closeParen));
  return args[1]?.trim();
}

function sourceOffsetForLineColumn(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    if (source[offset] === '\n') {
      currentLine += 1;
    }
    offset += 1;
  }
  return Math.min(source.length, offset + Math.max(0, column - 1));
}

function transpileRouteHandlerExpression(source: string): string {
  const wrapped = `const __applik8sRouteHandler = (${source});\nexport { __applik8sRouteHandler };\n`;
  const output = transformSync(wrapped, { loader: 'ts', format: 'esm', target: 'node22' }).code.trim();
  const prefix = 'const __applik8sRouteHandler = ';
  const start = output.indexOf(prefix);
  const end = output.lastIndexOf(';\nexport');
  if (start < 0 || end < 0 || end <= start + prefix.length) {
    throw new Error('Generated server route source transform did not produce the expected wrapper.');
  }
  return output.slice(start + prefix.length, end).trim();
}

function splitTopLevelArguments(source: string): readonly string[] {
  const args: string[] = [];
  let start = 0;
  let index = 0;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '(') {
      parens += 1;
    } else if (character === ')') {
      parens -= 1;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (character === ',' && parens === 0 && braces === 0 && brackets === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  args.push(source.slice(start));
  return args;
}

function matchingDelimiter(source: string, openIndex: number, open: string, close: string): number | undefined {
  let depth = 0;
  let index = openIndex;
  while (index < source.length) {
    const character = source[index];
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return undefined;
}

function quotedSourceEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function templateSourceEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '$' && source[index + 1] === '{') {
      index = templateExpressionSourceEnd(source, index + 2);
      continue;
    }
    if (source[index] === '`') {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function templateExpressionSourceEnd(source: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
}

function lineCommentEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start + 2);
  return end < 0 ? source.length : end + 1;
}

function blockCommentEnd(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2);
  return end < 0 ? source.length : end + 2;
}

function regexLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
    } else if (character === ']') {
      inCharacterClass = false;
    } else if (character === '/' && !inCharacterClass) {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index] ?? '')) {
        index += 1;
      }
      return index;
    } else if (character === '\n' || character === '\r') {
      return start + 1;
    }
    index += 1;
  }
  return source.length;
}

function generatedApplicationAggregateSource(request: {
  readonly name: string;
  readonly source: ApplicationServerRuntimeResource;
  readonly sourceOptions: ResourceIndex<object, object>['options'];
  readonly target: ApplicationServerRuntimeResource;
  readonly targetName: string;
  readonly targetNamespace?: string;
  readonly initial: object;
  readonly reduceSource: string;
  readonly statusSource: string;
  readonly flushEveryMs: number;
  readonly maxEvents: number;
}): string {
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

const aggregateName = ${JSON.stringify(request.name)};
const sourceResource = ${JSON.stringify(request.source)};
const sourceOptions = ${JSON.stringify(request.sourceOptions)};
const targetResource = ${JSON.stringify(request.target)};
const targetName = ${JSON.stringify(request.targetName)};
const targetNamespace = ${JSON.stringify(request.targetNamespace ?? null)};
const initialStats = ${JSON.stringify(request.initial)};
const flushEveryMs = ${request.flushEveryMs};
const maxEvents = ${request.maxEvents};
const reduce = (${request.reduceSource});
const status = (${request.statusSource});
const objectStore = new Map();
let stats = structuredClone(initialStats);
let pendingEvents = 0;
let flushing = false;

void startWatchLoop();
setInterval(() => {
  flushAggregate().catch((error) => logError('flush-failed', error));
}, flushEveryMs);

async function syncAggregate() {
  const response = await kubernetesRequest({ method: 'GET', path: listPath(sourceResource, { namespace: aggregateNamespace(), labelSelector: pushdownLabelSelector(sourceOptions) }) });
  stats = structuredClone(initialStats);
  objectStore.clear();
  for (const item of Array.isArray(response.items) ? response.items : []) {
    applySnapshotObject(item);
  }
  await flushAggregate(true);
  return response.metadata?.resourceVersion;
}

async function startWatchLoop() {
  let resourceVersion;
  for (;;) {
    try {
      resourceVersion = resourceVersion ?? await syncAggregate();
      resourceVersion = await watchAggregate(resourceVersion) ?? await syncAggregate();
    } catch (error) {
      logError('watch-failed', error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      resourceVersion = undefined;
    }
  }
}

async function watchAggregate(resourceVersion) {
  const response = await kubernetesRequest({ method: 'GET', path: listPath(sourceResource, { namespace: aggregateNamespace(), labelSelector: pushdownLabelSelector(sourceOptions), watch: true, resourceVersion }), stream: true });
  let latestResourceVersion = resourceVersion;
  let buffer = '';
  response.setEncoding('utf8');
  for await (const chunk of response) {
    buffer += chunk;
    const lines = buffer.split('\\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line);
      if (event.type === 'BOOKMARK') {
        continue;
      }
      latestResourceVersion = event.object?.metadata?.resourceVersion ?? latestResourceVersion;
      applySourceObject(event.type, event.object);
      if (pendingEvents >= maxEvents) {
        await flushAggregate();
      }
    }
  }
  return latestResourceVersion;
}

function applyAggregateEvent(event) {
  stats = reduce(stats, event);
  pendingEvents += 1;
  return stats;
}

function applySnapshotObject(item) {
  if (!sourceObjectMatches(item)) {
    return;
  }
  const key = objectKey(item);
  if (!key) {
    return;
  }
  applyAggregateEvent({ type: 'created', object: item, previous: undefined });
  objectStore.set(key, item);
}

function applySourceObject(kubernetesEventType, item) {
  if (!item) {
    return;
  }
  const key = objectKey(item);
  if (!key) {
    return;
  }
  const previous = objectStore.get(key);
  if (kubernetesEventType === 'DELETED') {
    if (!previous) {
      return;
    }
    applyAggregateEvent({ type: 'deleted', object: item, previous });
    objectStore.delete(key);
    return;
  }
  if (!sourceObjectMatches(item)) {
    if (previous) {
      applyAggregateEvent({ type: 'deleted', object: item, previous });
      objectStore.delete(key);
    }
    return;
  }
  applyAggregateEvent({ type: previous ? 'updated' : 'created', object: item, previous });
  objectStore.set(key, item);
}

async function flushAggregate(force = false) {
  if (flushing || (!force && pendingEvents === 0)) {
    return;
  }
  flushing = true;
  try {
    const nextStatus = status(stats);
    await patchTargetStatus(nextStatus);
    pendingEvents = 0;
  } finally {
    flushing = false;
  }
}

async function patchTargetStatus(nextStatus) {
  if (!nextStatus || typeof nextStatus !== 'object' || Array.isArray(nextStatus)) {
    throw new Error('Aggregate status mapper must return an object.');
  }
  return kubernetesRequest({
    method: 'PATCH',
    path: objectPath(targetResource, targetNamespace ?? aggregateNamespace(), targetName) + '/status',
    body: { status: nextStatus },
      contentType: 'application/merge-patch+json',
  });
}

function aggregateNamespace() {
  return process.env.APPLIK8S_AGGREGATE_NAMESPACE || 'default';
}

function sourceObjectMatches(item) {
  return applyIndexFilter([item], sourceOptions.filter).length === 1;
}

function objectKey(item) {
  const name = item.metadata?.name;
  if (!name) {
    return undefined;
  }
  return (item.metadata?.namespace || aggregateNamespace()) + '/' + name;
}

function pushdownLabelSelector(options) {
  const filter = options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    return { matchLabels: { [filter.left.value]: String(filter.right) } };
  }
  return undefined;
}

function applyIndexFilter(items, filter) {
  if (!filter || filter.expressionKind !== 'predicate' || filter.operator !== 'eq') {
    return items;
  }
  if (filter.left?.expressionKind === 'label') {
    return items.filter((item) => item.metadata?.labels?.[filter.left.value] === String(filter.right));
  }
  if (filter.left?.expressionKind === 'field') {
    return items.filter((item) => valueAtPath(item, filter.left.value) === filter.right);
  }
  return items;
}

function valueAtPath(source, path) {
  return path.split('.').reduce((current, part) => current && typeof current === 'object' ? current[part] : undefined, source);
}

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.watch) {
    params.set('watch', 'true');
  }
  if (query.resourceVersion) {
    params.set('resourceVersion', query.resourceVersion);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  return labels.join(',');
}

function collectionPath(resource, namespace) {
  const groupPath = apiGroupPath(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return groupPath + '/namespaces/' + encodeURIComponent(namespace) + '/' + resource.plural;
  }
  return groupPath + '/' + resource.plural;
}

function objectPath(resource, namespace, name) {
  return collectionPath(resource, namespace) + '/' + encodeURIComponent(name);
}

function apiGroupPath(apiVersion) {
  if (apiVersion.includes('/')) {
    const [group, version] = apiVersion.split('/');
    return '/apis/' + group + '/' + version;
  }
  return '/api/' + apiVersion;
}

async function kubernetesRequest(options) {
  const token = (await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8')).trim();
  const namespace = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').catch(() => 'default');
  const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  const path = options.path.replace(/__NAMESPACE__/g, namespace.trim());
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      method: options.method,
      host,
      port,
      path,
      rejectUnauthorized: false,
      headers: {
        authorization: 'Bearer ' + token,
        accept: options.stream ? 'application/json' : 'application/json',
        ...(options.body ? { 'content-type': options.contentType || 'application/json' } : {}),
      },
    }, (response) => {
      if (options.stream) {
        if ((response.statusCode || 0) >= 400) {
          reject(new Error('Kubernetes watch failed with HTTP ' + response.statusCode));
          return;
        }
        resolve(response);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if ((response.statusCode || 0) >= 400) {
          reject(new Error(body || 'Kubernetes request failed with HTTP ' + response.statusCode));
          return;
        }
        resolve(body ? JSON.parse(body) : {});
      });
    });
    request.on('error', reject);
    if (options.body) {
      request.write(JSON.stringify(options.body));
    }
    request.end();
  });
}

function logError(event, error) {
  console.error(JSON.stringify({ level: 'error', component: 'applik8s-aggregate', aggregate: aggregateName, event, message: error instanceof Error ? error.message : String(error) }));
}
`.trimStart();
}

function generatedValkeyIndexerSource(indexes: Readonly<Record<string, ApplicationServerRuntimeIndex>>): string {
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';

const runtimeIndexes = ${JSON.stringify(indexes)};
const syncIntervalMs = Number(process.env.APPLIK8S_INDEX_SYNC_INTERVAL_MS || 5000);

await syncAllIndexes();
for (const index of Object.values(runtimeIndexes)) {
  startWatchLoop(index);
}
setInterval(() => {
  syncAllIndexes().catch((error) => {
    console.error(JSON.stringify({ level: 'error', component: 'applik8s-indexer', message: error instanceof Error ? error.message : String(error) }));
  });
}, syncIntervalMs).unref();

process.stdin.resume();

async function syncAllIndexes() {
  for (const index of Object.values(runtimeIndexes)) {
    await syncIndex(index);
  }
}

async function syncIndex(index) {
  if (index.backend?.kind !== 'valkey') {
    return;
  }
  const namespace = defaultNamespace();
  const response = await kubernetesRequest({ method: 'GET', path: listPath(index.resource, { namespace, labelSelector: pushdownLabelSelector(index) }) });
  const items = applyIndexFilter(Array.isArray(response.items) ? response.items : [], index.options.filter);
  const partitioned = new Map();
  for (const item of items) {
    const partition = indexPartition(index, item);
    if (!partition) {
      continue;
    }
    const member = itemMember(item);
    if (!member) {
      continue;
    }
    const current = partitioned.get(partition) || [];
    current.push({ item, member, score: indexScore(index, item) });
    partitioned.set(partition, current);
  }
  const partitionsKey = valkeyPartitionsKey(index, namespace);
  const oldPartitions = await valkeyCommand(index.backend, ['SMEMBERS', partitionsKey]);
  for (const partition of Array.isArray(oldPartitions) ? oldPartitions : []) {
    await valkeyCommand(index.backend, ['DEL', valkeyPartitionKey(index, namespace, String(partition))]);
  }
  await valkeyCommand(index.backend, ['DEL', partitionsKey]);
  for (const [partition, entries] of partitioned.entries()) {
    const partitionKey = valkeyPartitionKey(index, namespace, partition);
    await valkeyCommand(index.backend, ['SADD', partitionsKey, partition]);
    for (const entry of entries) {
      await valkeyCommand(index.backend, ['SET', valkeyObjectKey(index, entry.member), JSON.stringify(entry.item)]);
      await valkeyCommand(index.backend, ['ZADD', partitionKey, String(entry.score), entry.member]);
    }
  }
  console.log(JSON.stringify({ level: 'info', component: 'applik8s-indexer', index: index.name, partitions: partitioned.size, items: items.length }));
  return response.metadata?.resourceVersion;
}

function startWatchLoop(index) {
  if (index.backend?.kind !== 'valkey') {
    return;
  }
  void (async () => {
    let resourceVersion;
    for (;;) {
      try {
        resourceVersion = await syncIndex(index);
        await watchIndex(index, resourceVersion);
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', component: 'applik8s-indexer', index: index.name, message: error instanceof Error ? error.message : String(error) }));
        await sleep(2000);
      }
    }
  })();
}

async function watchIndex(index, resourceVersion) {
  const namespace = defaultNamespace();
  const path = listPath(index.resource, { namespace, labelSelector: pushdownLabelSelector(index), watch: true, resourceVersion });
  await kubernetesWatch({ method: 'GET', path }, async (event) => {
    if (!event || event.type === 'BOOKMARK') {
      return;
    }
    const object = event.object;
    if (!object) {
      return;
    }
    if (event.type === 'DELETED') {
      await removeIndexedItem(index, object);
      return;
    }
    if (event.type === 'ADDED' || event.type === 'MODIFIED') {
      await upsertIndexedItem(index, object);
    }
  });
}

async function upsertIndexedItem(index, item) {
  const member = itemMember(item);
  if (!member) {
    return;
  }
  await removeIndexedMember(index, item.metadata?.namespace || defaultNamespace(), member);
  if (applyIndexFilter([item], index.options.filter).length === 0) {
    return;
  }
  const partition = indexPartition(index, item);
  if (!partition) {
    return;
  }
  const namespace = item.metadata?.namespace || defaultNamespace();
  await valkeyCommand(index.backend, ['SET', valkeyObjectKey(index, member), JSON.stringify(item)]);
  await valkeyCommand(index.backend, ['SADD', valkeyPartitionsKey(index, namespace), partition]);
  await valkeyCommand(index.backend, ['ZADD', valkeyPartitionKey(index, namespace, partition), String(indexScore(index, item)), member]);
}

async function removeIndexedItem(index, item) {
  const member = itemMember(item);
  if (!member) {
    return;
  }
  await removeIndexedMember(index, item.metadata?.namespace || defaultNamespace(), member);
}

async function removeIndexedMember(index, namespace, member) {
  const partitions = await valkeyCommand(index.backend, ['SMEMBERS', valkeyPartitionsKey(index, namespace)]);
  for (const partition of Array.isArray(partitions) ? partitions : []) {
    await valkeyCommand(index.backend, ['ZREM', valkeyPartitionKey(index, namespace, String(partition)), member]);
  }
  await valkeyCommand(index.backend, ['DEL', valkeyObjectKey(index, member)]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushdownLabelSelector(index) {
  const filter = index.options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    return { matchLabels: { [filter.left.value]: String(filter.right) } };
  }
  return undefined;
}

function indexPartition(index, item) {
  const partition = index.options.partitionBy;
  if (partition?.expressionKind === 'label') {
    return item.metadata?.labels?.[partition.value];
  }
  return undefined;
}

function itemMember(item) {
  const namespace = item.metadata?.namespace || defaultNamespace();
  const name = item.metadata?.name;
  return name ? namespace + '/' + name : undefined;
}

function indexScore(index, item) {
  const orderBy = index.options.orderBy;
  const value = orderBy?.expression ? valueAtPath(item, orderBy.expression.value) : item.metadata?.creationTimestamp;
  const timestamp = Date.parse(String(value || ''));
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function applyIndexFilter(items, filter) {
  if (!filter || filter.expressionKind !== 'predicate' || filter.operator !== 'eq') {
    return items;
  }
  if (filter.left?.expressionKind === 'label') {
    return items.filter((item) => item.metadata?.labels?.[filter.left.value] === String(filter.right));
  }
  if (filter.left?.expressionKind === 'field') {
    return items.filter((item) => valueAtPath(item, filter.left.value) === filter.right);
  }
  return items;
}

function valueAtPath(source, path) {
  return path.split('.').reduce((current, part) => current && typeof current === 'object' ? current[part] : undefined, source);
}

function valkeyPartitionsKey(index, namespace) {
  return 'applik8s:index:' + index.name + ':partitions:' + namespace;
}

function valkeyPartitionKey(index, namespace, partition) {
  return 'applik8s:index:' + index.name + ':partition:' + namespace + ':' + String(partition);
}

function valkeyObjectKey(index, member) {
  return 'applik8s:index:' + index.name + ':object:' + member;
}

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.watch) {
    params.set('watch', 'true');
  }
  if (query.resourceVersion) {
    params.set('resourceVersion', query.resourceVersion);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  return labels.join(',');
}

function collectionPath(resource, namespace) {
  const prefix = apiPrefix(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return prefix + '/namespaces/' + encodeURIComponent(namespace || defaultNamespace()) + '/' + encodeURIComponent(resource.plural);
  }
  return prefix + '/' + encodeURIComponent(resource.plural);
}

function apiPrefix(apiVersion) {
  if (!apiVersion.includes('/')) {
    return '/api/' + encodeURIComponent(apiVersion);
  }
  const [group, version] = apiVersion.split('/');
  return '/apis/' + encodeURIComponent(group) + '/' + encodeURIComponent(version);
}

function defaultNamespace() {
  return process.env.APPLIK8S_SERVER_NAMESPACE || 'default';
}

async function kubernetesRequest({ method, path }) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const response = await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, data }));
    });
    request.on('error', reject);
    request.end();
  });
  const parsed = response.data ? JSON.parse(response.data) : undefined;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(parsed?.message || 'Kubernetes request failed with HTTP ' + response.statusCode);
  }
  return parsed;
}

async function kubernetesWatch({ method, path }, onEvent) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    }, (response) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => reject(new Error('Kubernetes watch failed with HTTP ' + (response.statusCode || 0) + ': ' + body)));
        return;
      }
      let buffer = '';
      let queue = Promise.resolve();
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim().length === 0) {
            continue;
          }
          queue = queue.then(() => onEvent(JSON.parse(line)));
        }
      });
      response.on('end', () => {
        queue.then(resolve, reject);
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function valkeyCommand(backend, parts) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: backend.host, port: backend.port }, () => {
      socket.write(encodeResp(parts));
    });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      try {
        const parsed = parseResp(buffer);
        socket.end();
        resolve(parsed.value);
      } catch (error) {
        if (!(error instanceof IncompleteRespError)) {
          socket.destroy();
          reject(error);
        }
      }
    });
    socket.on('error', reject);
  });
}

function encodeResp(parts) {
  return '*' + parts.length + '\\r\\n' + parts.map((part) => {
    const value = String(part);
    return '$' + Buffer.byteLength(value) + '\\r\\n' + value + '\\r\\n';
  }).join('');
}

class IncompleteRespError extends Error {}

function parseResp(input, offset = 0) {
  if (offset >= input.length) {
    throw new IncompleteRespError('Incomplete RESP value');
  }
  const type = input[offset];
  const lineEnd = input.indexOf('\\r\\n', offset);
  if (lineEnd === -1) {
    throw new IncompleteRespError('Incomplete RESP line');
  }
  const line = input.slice(offset + 1, lineEnd);
  const next = lineEnd + 2;
  if (type === '+') {
    return { value: line, offset: next };
  }
  if (type === ':') {
    return { value: Number(line), offset: next };
  }
  if (type === '-') {
    throw new Error(line);
  }
  if (type === '$') {
    const length = Number(line);
    if (length < 0) {
      return { value: undefined, offset: next };
    }
    const end = next + length;
    if (input.length < end + 2) {
      throw new IncompleteRespError('Incomplete RESP bulk string');
    }
    return { value: input.slice(next, end), offset: end + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    const values = [];
    let current = next;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(input, current);
      values.push(parsed.value);
      current = parsed.offset;
    }
    return { value: values, offset: current };
  }
  throw new Error('Unsupported RESP type ' + type);
}
`.trimStart();
}

function generatedApplicationServerBundle(
  sourceFileName: string,
  routes: readonly SerializedApplicationServerRouteWithDependencies[],
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): Readonly<Record<string, string>> {
  const routeModules = generatedApplicationServerRouteModules(routes);
  const bundledEntrypoint = bundleApplicationServerEntrypoint(
    sourceFileName,
    generatedApplicationServerHonoEntrypointSource()
  );
  return {
    ...bundledEntrypoint,
    'runtime.mjs': generatedApplicationServerRuntimeSource(resources, indexes, models, indexBackend, cache),
    ...generatedApplicationRuntimeModuleBundle(),
    'bindings.mjs': generatedApplicationServerBindingsSource(resources, indexes, models, captures),
    'routes.mjs': generatedApplicationServerRoutesSource(routeModules),
    'routes.manifest.json': `${JSON.stringify(routeModules.map(routeManifestEntry), null, 2)}\n`,
    ...Object.fromEntries(routeModules.map((module) => [module.fileName, generatedApplicationServerRouteModuleSource(module, resources, indexes, models, captures)])),
  };
}

function kroSafeJavaScriptSourceBundle(bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(bundle).map(([fileName, source]) => [
    fileName,
    isJavaScriptSourceFile(fileName) ? lowerTemplateLiteralsForKro(fileName, source) : source,
  ]));
}

function mountedConfigMapSourceBundle(bundle: Readonly<Record<string, string>>): { readonly data: Readonly<Record<string, string>>; readonly items: { key: string; path: string }[] } {
  const usedKeys = new Set<string>();
  const data: Record<string, string> = {};
  const items: { key: string; path: string }[] = [];

  for (const [fileName, source] of Object.entries(bundle)) {
    assertSafeConfigMapVolumePath(fileName);
    const key = configMapSourceKey(fileName, usedKeys);
    usedKeys.add(key);
    data[key] = source;
    items.push({ key, path: fileName });
  }

  return { data, items };
}

function configMapSourceKey(fileName: string, usedKeys: ReadonlySet<string>): string {
  const baseKey = fileName.replaceAll('/', '__').replace(/[^A-Za-z0-9._-]/g, '_') || 'source';
  let key = baseKey;
  let attempt = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey}-${attempt}`;
    attempt += 1;
  }
  return key;
}

function assertSafeConfigMapVolumePath(fileName: string): void {
  if (fileName.startsWith('/') || fileName.split('/').some((part) => part.length === 0 || part === '..')) {
    throw new Error(`Generated server source file ${JSON.stringify(fileName)} is not a safe ConfigMap volume path.`);
  }
}

function isJavaScriptSourceFile(fileName: string): boolean {
  return fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs');
}

function lowerTemplateLiteralsForKro(fileName: string, source: string): string {
  if (!source.includes('${')) {
    return source;
  }
  const diagnosticHeader = source.match(/^(?:\/\/ applik8s-route-[^\n]*\n)+/)?.[0] ?? '';
  const transformed = transformSync(source, {
    loader: 'js',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    minifyWhitespace: true,
    supported: { 'template-literal': false },
  }).code;
  const withoutComments = stripJavaScriptLineComments(stripJavaScriptBlockComments(transformed));
  const output = diagnosticHeader && !withoutComments.startsWith(diagnosticHeader) ? `${diagnosticHeader}${withoutComments}` : withoutComments;
  if (output.includes('${')) {
    const index = output.indexOf('${');
    const context = output.slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ');
    throw new Error(`Generated JavaScript source ${fileName} still contains raw \`\${\` after template lowering near ${JSON.stringify(context)}; KRO cannot embed it safely.`);
  }
  return output;
}

function stripJavaScriptLineComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '*' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function stripJavaScriptBlockComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '/' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function previousSignificantCharacter(source: string): string | undefined {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const character = source[index];
    if (character && !/\s/.test(character)) {
      return character;
    }
  }
  return undefined;
}

function canStartJavaScriptRegexLiteral(previous: string | undefined): boolean {
  return !previous || '({[=,:;!&|?+-*~^<>'.includes(previous);
}

function generatedApplicationServerRouteModules(routes: readonly SerializedApplicationServerRouteWithDependencies[]): readonly GeneratedApplicationServerRouteModule[] {
  return routes.map((route) => ({
    route,
    fileName: `route-${route.id}.mjs`,
    exportName: `route_${route.id.replace(/[^A-Za-z0-9_$]/g, '_')}`,
  }));
}

function bundleApplicationServerEntrypoint(sourceFileName: string, source: string): Readonly<Record<string, string>> {
  const result = buildSync({
    stdin: {
      contents: source,
      resolveDir: process.cwd(),
      sourcefile: 'applik8s-generated-server.entry.mjs',
      loader: 'js',
    },
    outfile: sourceFileName,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['./routes.mjs', './runtime.mjs', './bindings.mjs', './route-*.mjs', './runtime/*'],
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    sourcemap: true,
    sourcesContent: false,
    write: false,
  });
  const files = Object.fromEntries(result.outputFiles.map((file) => [file.path.split('/').pop() ?? file.path, file.text]));
  const bundledSource = files[sourceFileName] ?? result.outputFiles.find((file) => !file.path.endsWith('.map'))?.text;
  const sourceMap = files[`${sourceFileName}.map`] ?? result.outputFiles.find((file) => file.path.endsWith('.map'))?.text;
  if (!bundledSource || !sourceMap) {
    throw new Error(`Generated server bundling did not produce ${sourceFileName} and ${sourceFileName}.map.`);
  }
  return { [sourceFileName]: bundledSource, [`${sourceFileName}.map`]: sourceMap };
}

function generatedApplicationServerHonoEntrypointSource(): string {
  return `
import { Hono } from 'hono';
import { createServer } from 'node:http';
import { routes } from './routes.mjs';

const applik8sServerRuntime = 'hono';

const app = new Hono();

for (const route of routes) {
  app.on(route.method, route.path, async (context) => {
    try {
      const url = new URL(context.req.url);
      const result = await route.handler({
        query: Object.fromEntries(url.searchParams.entries()),
        formData: async () => honoFormData(context.req),
      });
      return honoResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      const stack = error instanceof Error && error.stack ? error.stack.split('\\n').slice(0, 12) : undefined;
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-route-failure', runtime: applik8sServerRuntime, route: routeDiagnostics(route), message, statusCode, diagnostic: error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : undefined, ...(stack ? { stack } : {}) }));
      return context.text('Route ' + route.id + ' (' + route.method + ' ' + route.path + ') failed: ' + message, statusCode);
    }
  });
}

app.notFound((context) => {
  const url = new URL(context.req.url);
  return context.text('No route for ' + context.req.method + ' ' + url.pathname, 404);
});

createServer(async (incoming, outgoing) => {
  try {
    const request = nodeRequestToFetchRequest(incoming);
    const response = await app.fetch(request);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-request-failure', runtime: applik8sServerRuntime, message }));
    outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    outgoing.end(message);
  }
}).listen(8080, '0.0.0.0');

function nodeRequestToFetchRequest(request) {
  const host = request.headers.host || '127.0.0.1';
  const url = 'http://' + host + (request.url || '/');
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  const method = request.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, { method, headers, ...(hasBody ? { body: request, duplex: 'half' } : {}) });
}

async function writeFetchResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      outgoing.end();
      return;
    }
    outgoing.write(Buffer.from(chunk.value));
  }
}

async function honoFormData(request) {
  const data = await request.raw.formData();
  return { string: (name) => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  } };
}

function honoResponse(result) {
  if (result instanceof Response) {
    return result;
  }
  if (result && typeof result === 'object' && 'redirect' in result) {
    return new Response(null, { status: 303, headers: { location: String(result.redirect) } });
  }
  if (result && typeof result === 'object' && typeof result.html === 'string') {
    return new Response(result.html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response(JSON.stringify(result ?? null), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function routeDiagnostics(route) {
  return {
    id: route.id,
    method: route.method,
    path: route.path,
    module: route.module,
    sourceKind: route.sourceKind,
    sourceLocation: route.sourceLocation,
    bundleInputs: route.bundleInputs,
  };
}
`.trimStart();
}

function generatedApplicationServerRoutesSource(routeModules: readonly GeneratedApplicationServerRouteModule[]): string {
  const imports = routeModules.map((module) => `import { ${module.exportName} } from './${module.fileName}';`).join('\n');
  const routeEntries = routeModules.map((module) => `  { ${routeRuntimeMetadataProperties(module)}, handler: ${module.exportName} }`).join(',\n');
  return `
${imports}

export const routes = [
${routeEntries}
];
`.trimStart();
}

function routeManifestEntry(module: GeneratedApplicationServerRouteModule): object {
  return {
    id: module.route.id,
    method: module.route.method,
    path: module.route.path,
    module: module.fileName,
    export: module.exportName,
    sourceKind: module.route.handlerSourceKind ?? 'functionToString',
    sourceLocation: module.route.handlerSourceLocation ?? null,
    bundleInputs: routeBundleInputs(module),
  };
}

function routeRuntimeMetadataProperties(module: GeneratedApplicationServerRouteModule): string {
  return [
    `id: ${JSON.stringify(module.route.id)}`,
    `method: ${JSON.stringify(module.route.method)}`,
    `path: ${JSON.stringify(module.route.path)}`,
    `module: ${JSON.stringify(module.fileName)}`,
    `sourceKind: ${JSON.stringify(module.route.handlerSourceKind ?? 'functionToString')}`,
    `sourceLocation: ${JSON.stringify(module.route.handlerSourceLocation ?? null)}`,
    `bundleInputs: ${JSON.stringify(routeBundleInputs(module))}`,
  ].join(', ');
}

function routeBundleInputs(module: GeneratedApplicationServerRouteModule): readonly string[] {
  const source = module.route.handlerDependencySource;
  if (!source) {
    return [];
  }
  const bundled = bundledApplicationServerRouteModuleSource(module, '');
  return bundled.inputs.map((input) => input.split('/').pop() ?? input);
}

function generatedApplicationServerBindingsSource(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const resourceBindings = Object.keys(resources).map((name) => `const ${name} = resourceClients[${JSON.stringify(name)}];`).join('\n');
  const indexBindings = Object.keys(indexes).map((name) => `const ${name} = indexClients[${JSON.stringify(name)}];`).join('\n');
  const modelBindings = Object.keys(models).map((name) => `const ${name} = modelClients[${JSON.stringify(name)}];`).join('\n');
  const captureBindings = generatedApplicationServerCaptureBindings(captures);
  const exports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  return `
import { createRuntimeBindings } from './runtime.mjs';

const { resourceClients, indexClients, modelClients } = createRuntimeBindings();
${resourceBindings}
${indexBindings}
${modelBindings}
${captureBindings}

${exports.length > 0 ? `export { ${exports.join(', ')} };` : 'export {};'}
`.trimStart();
}

function generatedApplicationServerRouteModuleSource(
  module: GeneratedApplicationServerRouteModule,
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const imports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  const sourceLocation = module.route.handlerSourceLocation ? `${module.route.handlerSourceLocation.file}:${module.route.handlerSourceLocation.line}:${module.route.handlerSourceLocation.column}` : 'unavailable';
  const bindingImport = imports.length > 0 ? `import { ${imports.join(', ')} } from './bindings.mjs';\n` : '';
  const bundledRoute = module.route.handlerDependencySource ? bundledApplicationServerRouteModuleSource(module, bindingImport) : undefined;
  const routeSource = bundledRoute
    ? bundledRoute.source
    : `
// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}
// applik8s-route-source-location: ${sourceLocation}
${bindingImport}
export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart();
  const header = `// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}\n// applik8s-route-source-location: ${sourceLocation}\n${bundledRoute ? `// applik8s-route-bundle-inputs: ${bundledRoute.inputs.map((input) => input.split('/').pop() ?? input).join(', ')}\n` : ''}`;
  return routeSource.startsWith('// applik8s-route-source-kind:') ? routeSource : `${header}${routeSource}`;
}

function bundledApplicationServerRouteModuleSource(module: GeneratedApplicationServerRouteModule, bindingImport: string): ApplicationRouteModuleBundle {
  const result = buildSync({
    stdin: {
      contents: `
${module.route.handlerDependencySource ?? ''}

export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart(),
      resolveDir: module.route.handlerDependencyResolveDir ?? process.cwd(),
      sourcefile: `${module.fileName}.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    metafile: true,
    sourcemap: false,
    write: false,
  });
  const bundled = result.outputFiles[0]?.text;
  if (!bundled) {
    throw new Error(`Generated server route bundling did not produce ${module.fileName}.`);
  }
  return { source: `${bindingImport}${bundled}`, inputs: Object.keys(result.metafile?.inputs ?? {}) };
}

function generatedApplicationServerBindingNames(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): readonly string[] {
  const names = new Set<string>([...Object.keys(resources), ...Object.keys(indexes), ...Object.keys(models), ...Object.keys(captures)]);
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      names.add(capture.aliasName);
    }
  }
  return [...names];
}

function generatedApplicationServerCaptureBindings(captures: SerializedApplicationServerCaptures): string {
  const bindings = ['const captures = {};'];
  for (const [name, capture] of Object.entries(captures)) {
    const expression = capture.kind === 'json' ? JSON.stringify(capture.value) : `(${capture.source})`;
    bindings.push(`const ${name} = captures[${JSON.stringify(name)}] = ${expression};`);
    if (capture.kind === 'function' && capture.aliasName) {
      bindings.push(`const ${capture.aliasName} = ${name};`);
    }
  }
  return bindings.join('\n');
}
