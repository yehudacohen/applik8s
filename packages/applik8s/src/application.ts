import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnyResourceDefinition, JsonValue, OperatorDeploymentOptions, ResourceDefinition, ResourceIndex } from '@applik8s/core';
import type { CrdOptions } from '@applik8s/sdk';
import { sdk as baseSdk, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import type { TypeKroListenerComposition, TypeKroListenerCompositionDefinition } from '@applik8s/typekro-adapter';
import { typeKro } from '@applik8s/typekro-adapter';
import { buildSync, transformSync } from 'esbuild';
import type { Enhanced, KroCompatibleType, MagicAssignableShape, SerializationOptions } from 'typekro';
import { createResource } from 'typekro';
import { valkey as typeKroValkey } from 'typekro/valkey';
import type { EntityDefinition } from './dsl.js';

export interface KubernetesApplicationScope {
  readonly api: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly server: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  operator<TBinding>(operator: (options: OperatorDeploymentOptions) => TBinding, options: OperatorDeploymentOptions): TBinding;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options?: ApplicationModelOptions): never;
  defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding;
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation>;
  aggregate<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent>;
}

export type ApplicationServerRegistrar = (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void) => ApplicationServerBinding;

export type ApplicationCrdOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'kind' | 'spec' | 'status'> & {
  readonly kind?: string;
};

export interface ApplicationModelOptions {
  readonly name?: string;
  readonly store?: unknown;
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
  readonly captures?: Readonly<Record<string, ApplicationServerCaptureValue>>;
  readonly cache?: readonly ResourceIndex<object, object>[];
  readonly indexBackend?: ApplicationIndexBackend;
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export interface ApplicationValkeyIndexBackend {
  readonly kind: 'valkey';
  readonly provisioner?: 'deployment' | 'hyperspike';
  readonly name?: string;
  readonly namespace?: string;
  readonly host?: string;
  readonly port?: number;
  readonly image?: string;
  readonly provision?: boolean;
  readonly spec?: Readonly<Record<string, unknown>>;
}

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

interface ApplicationScopeState {
  readonly resources: Record<string, AnyResourceDefinition>;
  readonly indexes: Record<string, ResourceIndex<object, object>>;
  readonly defaults: { indexes?: unknown };
  readonly providers: { indexes?: unknown };
}

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

export interface ApplicationDefaults {
  readonly models?: unknown;
  readonly indexes?: unknown;
  readonly counters?: unknown;
  readonly events?: unknown;
  readonly expose?: unknown;
}

export interface ApplicationDefaultsBinding {
  readonly kind: 'applicationDefaults';
  readonly defaults: ApplicationDefaults;
}

export interface ApplicationProviderToken<TImplementation = unknown> {
  readonly name?: string;
  readonly description?: string;
  readonly __implementation?: TImplementation;
}

export interface ApplicationProviderBinding<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: TImplementation;
}

export const IndexStore: ApplicationProviderToken<ApplicationIndexBackend | 'valkey'> = {
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
};

export const ModelStore: ApplicationProviderToken<unknown> = {
  name: 'ModelStore',
  description: 'Default app-scoped storage-backed model provider.',
};

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, ModelStore } as const;

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

export const kubernetesComposition: KubernetesApplicationCompositionFunction = (definition, compositionFn, options) => typeKro.kubernetesComposition(
  definition,
  applicationCompositionWrapper(compositionFn),
  options
);

export const app: KubernetesApplicationCompositionFunction = kubernetesComposition;

export const sdk = Object.assign({}, baseSdk, { app, kubernetesComposition });

function applicationCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  const wrapped = (spec: TSpec) => {
    const context = createApplicationContext();
    return withApplicationOperatorResourceCollection(context.state, () => compositionFn(spec, context.scope));
  };
  Object.defineProperty(wrapped, 'toString', { value: () => compositionFn.toString() });
  return wrapped;
}

function createApplicationContext(): ApplicationContext {
  const servers: Record<string, ApplicationServerBinding> = {};
  const state: ApplicationScopeState = { resources: {}, indexes: {}, defaults: {}, providers: {} };
  const server = (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void) => {
    const routes: ApplicationServerRoute[] = [];
    configure(createRouteRecorder(routes));
    const resolvedOptions = applicationServerOptionsWithScope(state, options, routes);
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
      return resource;
    },
    model(entity, _options) {
      throw new Error(`app.model(${JSON.stringify(entity.name)}) requires a storage-backed ModelStore implementation. v0.2 intentionally fails closed for model-backed application data; use app.crd(entity, { apiVersion, ... }) for Kubernetes control-plane state until app.model storage semantics land in v0.3.`);
    },
    defaults(defaults) {
      if ('models' in defaults) {
        throw new Error('app.defaults({ models: ... }) requires storage-backed app.model semantics, which are not enabled in v0.2. Use app.crd(entity, ...) for Kubernetes control-plane state or defer model-backed data to v0.3.');
      }
      if ('indexes' in defaults) {
        state.defaults.indexes = defaults.indexes;
      }
      return { kind: 'applicationDefaults', defaults };
    },
    provide(token, implementation) {
      applyApplicationProvider(state, token, implementation);
      return { kind: 'applicationProvider', token, implementation };
    },
    aggregate(name, options) {
      collectApplicationIndexes(state, { [options.source.name]: options.source });
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
  const resources = { ...inferredResources, ...(options.resources ?? {}) };
  const indexes = { ...inferredIndexes, ...(options.indexes ?? {}) };
  const indexBackend = options.indexBackend ?? defaultApplicationIndexBackend(state, options, indexes);
  const cache = options.cache ?? (indexBackend && isValkeyIndexDefault(defaultApplicationIndexProvider(state)) ? Object.values(indexes) : undefined);
  return {
    ...options,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
    ...(cache && cache.length > 0 ? { cache } : {}),
    ...(indexBackend ? { indexBackend } : {}),
  };
}

function inferredApplicationServerResources(resources: Readonly<Record<string, AnyResourceDefinition>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, AnyResourceDefinition>> {
  return Object.fromEntries(Object.entries(resources).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || analysis.memberCalls.some((call) => call.objectName === name))));
}

function inferredApplicationServerIndexes(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ResourceIndex<object, object>>> {
  return Object.fromEntries(Object.entries(indexes).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || routeAnalysisCallsMethod(analysis, name, 'query'))));
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

function defaultApplicationIndexBackend(state: ApplicationScopeState, options: ApplicationServerOptions, indexes: Readonly<Record<string, ResourceIndex<object, object>>>): ApplicationIndexBackend | undefined {
  const provider = defaultApplicationIndexProvider(state);
  if ((options.cache?.length ?? 0) > 0 || (Object.keys(indexes).length > 0 && isValkeyIndexDefault(provider))) {
    return applicationIndexBackend(provider) ?? { kind: 'valkey' };
  }
  return undefined;
}

function defaultApplicationIndexProvider(state: ApplicationScopeState): unknown {
  return state.defaults.indexes ?? state.providers.indexes;
}

function applicationIndexBackend(value: unknown): ApplicationIndexBackend | undefined {
  if (value === 'valkey') {
    return { kind: 'valkey' };
  }
  if (value && typeof value === 'object' && Reflect.get(value, 'kind') === 'valkey') {
    // typecast: app.provide/defaults accept structurally typed provider values; this narrows the supported v0.2 IndexStore provider slice.
    return value as ApplicationIndexBackend;
  }
  return undefined;
}

function isValkeyIndexDefault(value: unknown): boolean {
  return value === 'valkey' || Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'valkey');
}

function applyApplicationProvider<TImplementation>(state: ApplicationScopeState, token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): void {
  if (applicationProviderTokenName(token) === 'IndexStore') {
    if (!isValkeyIndexDefault(implementation)) {
      throw new Error('app.provide(IndexStore, ...) currently supports only the Valkey index backend provider slice. Use "valkey" or { kind: "valkey", ... } for v0.2.');
    }
    state.providers.indexes = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'ModelStore') {
    throw new Error('app.provide(ModelStore, ...) requires storage-backed app.model semantics, which are not enabled in v0.2. This fails closed so CRDs are not treated as a hidden database.');
  }
}

function applicationProviderTokenName(token: ApplicationProviderToken<unknown>): string | undefined {
  return token.name;
}

function collectApplicationResources(state: ApplicationScopeState, resources: Readonly<Record<string, AnyResourceDefinition>>): void {
  for (const [name, resource] of Object.entries(resources)) {
    state.resources[name] = resource;
  }
}

function collectApplicationIndexes(state: ApplicationScopeState, indexes: Readonly<Record<string, ResourceIndex<object, object>>>): void {
  for (const [name, index] of Object.entries(indexes)) {
    state.indexes[name] = index;
  }
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

function emitApplicationServerResources(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationGeneratedWorkloadBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const sourceFileName = options.sourceFileName ?? 'server.mjs';
  const namespace = options.namespace;
  const runtimeIndexBackend = runtimeIndexBackendConfig(options.indexBackend, namespace, resourceName);
  const captures = serializeApplicationServerCaptures(options.captures ?? {});
  const captureAliases = serializedApplicationServerCaptureAliases(captures);
  assertRuntimeBindingNames({ ...(options.resources ?? {}), ...(options.indexes ?? {}), ...captures, ...captureAliases });
  assertDistinctRuntimeBindingNames({ resources: options.resources ?? {}, indexes: options.indexes ?? {}, captures, captureAliases });
  const serializedRoutes = serializeApplicationServerRoutes(
    routes,
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(captures), ...Object.keys(captureAliases)]),
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {})])
  );
  const rawSourceBundle = options.source
    ? { [sourceFileName]: options.source }
    : options.command
      ? undefined
      : generatedApplicationServerBundle(sourceFileName, serializedRoutes, options.resources ?? {}, options.indexes ?? {}, captures, runtimeIndexBackend, options.cache ?? []);
  const sourceBundle = rawSourceBundle ? kroSafeJavaScriptSourceBundle(rawSourceBundle) : undefined;
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
    ...(sourceBundle ? [{ name: 'applik8s-server-source', configMap: { name: sourceConfigMapName } }] : []),
    ...(options.volumes ?? []),
  ];

  createResource({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });

  if (serverPermissions.length > 0) {
    createResource({
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
    createResource({
      id: id('roleBinding'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
    });
  }

  if (sourceBundle) {
    createResource({
      id: id('source'),
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
      data: sourceBundle,
    });
  }

  emitIndexBackendResources(resourceName, namespace, labels, options.indexBackend);
  emitValkeyIndexerResources(resourceName, namespace, labels, runtimeIndexBackend, options.indexes ?? {}, options.cache ?? []);

  const deployment = createResource<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>({
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
            command: options.command ?? ['node', `/app/${sourceFileName}`],
            ...(options.args ? { args: options.args } : {}),
            env: Object.entries(env).map(([envName, value]) => ({ name: envName, value })),
            ports: [{ name: 'http', containerPort: 8080 }],
            ...(appVolumeMounts.length > 0 ? { volumeMounts: appVolumeMounts } : {}),
          }],
          ...(appVolumes.length > 0 ? { volumes: appVolumes } : {}),
        },
      },
    },
  });

  createResource({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: serviceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      selector: labels,
      ports: [{ name: 'http', port: options.service?.port ?? 80, targetPort: 8080 }],
    },
  });
  return { deployment };
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

  createResource({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });
  createResource({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    rules: permissions.map((rule) => ({ apiGroups: [...rule.apiGroups], resources: [...rule.resources], verbs: [...rule.verbs] })),
  });
  createResource({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
  });
  createResource({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: sourceBundle,
  });
  const deployment = createResource<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>({
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
  return { deployment };
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
  createResource({
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
  createResource({
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
  createResource({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      selector: backendLabels,
      ports: [{ name: 'valkey', port: backend.port ?? 6379, targetPort: backend.port ?? 6379 }],
    },
  });
  createResource({
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

  createResource({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
  });
  createResource({
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
  createResource({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    subjects: [{ kind: 'ServiceAccount', name: indexerName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: indexerName },
  });
  createResource({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    data: { 'indexer.mjs': generatedValkeyIndexerSource(cachedIndexes) },
  });
  createResource({
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
  captures: SerializedApplicationServerCaptures,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): Readonly<Record<string, string>> {
  const routeModules = generatedApplicationServerRouteModules(routes);
  const bundledEntrypoint = bundleApplicationServerEntrypoint(
    sourceFileName,
    generatedApplicationServerHonoEntrypointSource(routeModules, resources, indexes, captures, indexBackend, cache)
  );
  return {
    ...bundledEntrypoint,
    'runtime.mjs': generatedApplicationServerRuntimeSource(resources, indexes, indexBackend, cache),
    'bindings.mjs': generatedApplicationServerBindingsSource(resources, indexes, captures),
    'routes.mjs': generatedApplicationServerRoutesSource(routeModules),
    'routes.manifest.json': `${JSON.stringify(routeModules.map(routeManifestEntry), null, 2)}\n`,
    ...Object.fromEntries(routeModules.map((module) => [module.fileName, generatedApplicationServerRouteModuleSource(module, resources, indexes, captures)])),
  };
}

function kroSafeJavaScriptSourceBundle(bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(bundle).map(([fileName, source]) => [
    fileName,
    isJavaScriptSourceFile(fileName) ? lowerTemplateLiteralsForKro(fileName, source) : source,
  ]));
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
    supported: { 'template-literal': false },
  }).code;
  const withoutBlockComments = stripJavaScriptBlockComments(transformed);
  const output = diagnosticHeader && !withoutBlockComments.startsWith(diagnosticHeader) ? `${diagnosticHeader}${withoutBlockComments}` : withoutBlockComments;
  if (output.includes('${')) {
    const index = output.indexOf('${');
    const context = output.slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ');
    throw new Error(`Generated JavaScript source ${fileName} still contains raw \`\${\` after template lowering near ${JSON.stringify(context)}; KRO cannot embed it safely.`);
  }
  return output;
}

function stripJavaScriptBlockComments(source: string): string {
  let output = '';
  let index = 0;
  let quote: 'single' | 'double' | 'template' | undefined;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!quote && character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += character;
    if (quote) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if ((quote === 'single' && character === "'") || (quote === 'double' && character === '"') || (quote === 'template' && character === '`')) {
        quote = undefined;
      }
    } else if (character === "'") {
      quote = 'single';
    } else if (character === '"') {
      quote = 'double';
    } else if (character === '`') {
      quote = 'template';
    }
    index += 1;
  }
  return output;
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

function generatedApplicationServerHonoEntrypointSource(
  routeModules: readonly GeneratedApplicationServerRouteModule[],
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  captures: SerializedApplicationServerCaptures,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): string {
  const runtimeSource = stripGeneratedServerModuleSyntax(generatedApplicationServerRuntimeSource(resources, indexes, indexBackend, cache));
  const bindingsSource = stripGeneratedServerModuleSyntax(generatedApplicationServerBindingsSource(resources, indexes, captures));
  const routeSources = routeModules.map((module) => stripGeneratedServerModuleSyntax(generatedApplicationServerRouteModuleSource(module, resources, indexes, captures))).join('\n');
  const routesSource = stripGeneratedServerModuleSyntax(generatedApplicationServerRoutesSource(routeModules));
  return `
import { Hono } from 'hono';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';

const applik8sServerRuntime = 'hono';
${runtimeSource}
${bindingsSource}
${routeSources}
${routesSource}

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
      const stack = error instanceof Error && error.stack ? error.stack.split('\\n').slice(0, 12) : undefined;
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-route-failure', runtime: applik8sServerRuntime, route: routeDiagnostics(route), message, ...(stack ? { stack } : {}) }));
      return context.text('Route ' + route.id + ' (' + route.method + ' ' + route.path + ') failed: ' + message, 500);
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

function stripGeneratedServerModuleSyntax(source: string): string {
  return source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
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
  captures: SerializedApplicationServerCaptures
): string {
  const resourceBindings = Object.keys(resources).map((name) => `const ${name} = resourceClients[${JSON.stringify(name)}];`).join('\n');
  const indexBindings = Object.keys(indexes).map((name) => `const ${name} = indexClients[${JSON.stringify(name)}];`).join('\n');
  const captureBindings = generatedApplicationServerCaptureBindings(captures);
  const exports = generatedApplicationServerBindingNames(resources, indexes, captures);
  return `
import { createRuntimeBindings } from './runtime.mjs';

const { resourceClients, indexClients } = createRuntimeBindings();
${resourceBindings}
${indexBindings}
${captureBindings}

${exports.length > 0 ? `export { ${exports.join(', ')} };` : 'export {};'}
`.trimStart();
}

function generatedApplicationServerRouteModuleSource(
  module: GeneratedApplicationServerRouteModule,
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  captures: SerializedApplicationServerCaptures
): string {
  const imports = generatedApplicationServerBindingNames(resources, indexes, captures);
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
  captures: SerializedApplicationServerCaptures
): readonly string[] {
  const names = new Set<string>([...Object.keys(resources), ...Object.keys(indexes), ...Object.keys(captures)]);
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

function generatedApplicationServerRuntimeSource(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): string {
  const resourceTable = JSON.stringify(runtimeResourceTable(resources));
  const indexTable = JSON.stringify(runtimeIndexTable(indexes, indexBackend, cache));
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';

const runtimeResources = ${resourceTable};
const runtimeIndexes = ${indexTable};

export function createRuntimeBindings() {
  return {
    resourceClients: Object.fromEntries(Object.entries(runtimeResources).map(([name, resource]) => [name, createResourceClient(resource)])),
    indexClients: Object.fromEntries(Object.entries(runtimeIndexes).map(([name, index]) => [name, createIndexClient(index)])),
  };
}

export async function formData(request) {
  const body = await readBody(request);
  const params = new URLSearchParams(body);
  return { string: (name) => params.get(name) ?? '' };
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function createResourceClient(resource) {
  return {
    async create(input) {
      const object = asKubernetesObject(resource, input);
      return kubernetesRequest({ method: 'POST', path: collectionPath(resource, object.metadata?.namespace), body: object });
    },
    async get(query) {
      try {
        return await kubernetesRequest({ method: 'GET', path: objectPath(resource, query.namespace, query.name) });
      } catch (error) {
        if (error && typeof error === 'object' && error.statusCode === 404) {
          return undefined;
        }
        throw error;
      }
    },
    async query(query = {}) {
      const response = await kubernetesRequest({ method: 'GET', path: listPath(resource, query) });
      const items = Array.isArray(response.items) ? response.items : [];
      return { items: sortItems(items, query.orderBy), continueToken: response.metadata?.continue };
    },
    async patch(query, patch) {
      return kubernetesRequest({ method: 'PATCH', path: objectPath(resource, query.namespace, query.name), body: patch, contentType: 'application/json-patch+json' });
    },
    async delete(query) {
      await kubernetesRequest({ method: 'DELETE', path: objectPath(resource, query.namespace, query.name) });
      return { ref: { apiVersion: resource.apiVersion, kind: resource.kind, name: query.name, namespace: query.namespace }, deleted: true };
    },
    async increment(input) {
      return bufferResourceCounterIncrement(resource, input);
    },
  };
}

const resourceCounterBuffers = new Map();
let resourceCounterFlushTimer;
let resourceCounterFlushInFlight = false;

function bufferResourceCounterIncrement(resource, input) {
  if (!input || !input.name) {
    throw new Error(resource.kind + '.increment(...) requires a resource name.');
  }
  const amount = Number(input.amount ?? 1);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(resource.kind + '.increment(...) amount must be a positive finite number.');
  }
  const field = input.field || 'spec.count';
  const key = JSON.stringify({ apiVersion: resource.apiVersion, kind: resource.kind, namespace: input.namespace || defaultNamespace(), name: input.name, field });
  const existing = resourceCounterBuffers.get(key);
  const entry = existing || { resource, input: { ...input, field }, pending: 0 };
  entry.input = { ...entry.input, ...input, field };
  entry.pending += amount;
  resourceCounterBuffers.set(key, entry);
  ensureResourceCounterFlushTimer(input.flushMs);
  return { buffered: true, pending: entry.pending };
}

function ensureResourceCounterFlushTimer(flushMs) {
  if (resourceCounterFlushTimer) {
    return;
  }
  const interval = Number.isFinite(Number(flushMs)) && Number(flushMs) > 0 ? Number(flushMs) : 1000;
  resourceCounterFlushTimer = setInterval(() => {
    flushResourceCounterBuffers().catch((error) => {
      console.error(JSON.stringify({ event: 'applik8s-server-counter-flush-failure', message: error instanceof Error ? error.message : String(error) }));
    });
  }, interval);
  resourceCounterFlushTimer.unref?.();
}

async function flushResourceCounterBuffers() {
  if (resourceCounterFlushInFlight || resourceCounterBuffers.size === 0) {
    return;
  }
  resourceCounterFlushInFlight = true;
  const entries = [...resourceCounterBuffers.entries()];
  for (const [key, entry] of entries) {
    resourceCounterBuffers.delete(key);
  }
  try {
    const results = await Promise.allSettled(entries.map(([, entry]) => flushResourceCounterBuffer(entry)));
    const failures = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue;
      }
      const [key, failedEntry] = entries[index];
      const current = resourceCounterBuffers.get(key);
      if (current) {
        current.pending += failedEntry.pending;
      } else {
        resourceCounterBuffers.set(key, failedEntry);
      }
      failures.push(result.reason);
    }
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; '));
    }
  } finally {
    resourceCounterFlushInFlight = false;
  }
}

async function flushResourceCounterBuffer(entry) {
  const { resource, input, pending } = entry;
  const field = input.field || 'spec.count';
  const query = { name: input.name, namespace: input.namespace };
  try {
    const current = await kubernetesRequest({ method: 'GET', path: objectPath(resource, query.namespace, query.name) });
    const currentValue = valueAtPath(current, field);
    const nextValue = Number(currentValue ?? 0) + pending;
    const operation = currentValue === undefined ? 'add' : 'replace';
    await kubernetesRequest({ method: 'PATCH', path: objectPath(resource, query.namespace, query.name), body: [{ op: operation, path: jsonPointerForPath(field), value: nextValue }], contentType: 'application/json-patch+json' });
  } catch (error) {
    if (!error || typeof error !== 'object' || error.statusCode !== 404) {
      throw error;
    }
    const object = asKubernetesObject(resource, {
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      spec: input.spec || {},
    });
    const currentValue = valueAtPath(object, field);
    setValueAtPath(object, field, Number(currentValue ?? 0) + pending);
    await kubernetesRequest({ method: 'POST', path: collectionPath(resource, object.metadata?.namespace), body: object });
  }
}

function jsonPointerForPath(path) {
  return '/' + path.split('.').map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

function setValueAtPath(source, path, value) {
  const parts = path.split('.');
  let current = source;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

process.once('SIGTERM', () => {
  flushResourceCounterBuffers().finally(() => process.exit(0));
});

function createIndexClient(index) {
  return {
    async query(partition, query = {}) {
      const labels = indexLabels(index, partition);
      if (Object.keys(labels).length === 0) {
        throw new Error('Index ' + index.name + ' cannot be queried from a request path without a label partition or label filter.');
      }
      if (index.backend?.kind === 'valkey') {
        return queryValkeyIndex(index, partition, query);
      }
      const response = await kubernetesRequest({ method: 'GET', path: listPath(index.resource, { ...query, labels }) });
      const filtered = applyIndexFilter(Array.isArray(response.items) ? response.items : [], index.options.filter);
      const ordered = sortIndexedItems(filtered, index.options.orderBy);
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = query.limit ?? ordered.length;
      const items = ordered.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      const nextCursor = nextOffset < ordered.length ? String(nextOffset) : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
  };
}

async function queryValkeyIndex(index, partition, query) {
  const namespace = query.namespace || defaultNamespace();
  const offset = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? 50;
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const stop = start + Math.max(1, limit) - 1;
  const key = valkeyPartitionKey(index, namespace, partition);
  const descending = index.options.orderBy?.direction === 'desc';
  const members = await valkeyCommand(index.backend, descending ? ['ZREVRANGE', key, String(start), String(stop)] : ['ZRANGE', key, String(start), String(stop)]);
  if (!Array.isArray(members) || members.length === 0) {
    return { items: [] };
  }
  const objectKeys = members.map((member) => valkeyObjectKey(index, String(member)));
  const objects = await valkeyCommand(index.backend, ['MGET', ...objectKeys]);
  const items = (Array.isArray(objects) ? objects : []).map((value) => value ? JSON.parse(String(value)) : undefined).filter(Boolean);
  const nextCursor = items.length === limit ? String(start + items.length) : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function valkeyPartitionKey(index, namespace, partition) {
  return 'applik8s:index:' + index.name + ':partition:' + namespace + ':' + String(partition);
}

function valkeyObjectKey(index, member) {
  return 'applik8s:index:' + index.name + ':object:' + member;
}

function indexLabels(index, partition) {
  const labels = {};
  const partitionExpression = index.options.partitionBy;
  if (partitionExpression?.expressionKind === 'label') {
    labels[partitionExpression.value] = String(partition);
  }
  const filter = index.options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    labels[filter.left.value] = String(filter.right);
  }
  return labels;
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

function sortIndexedItems(items, orderBy) {
  if (!orderBy || orderBy.expressionKind !== 'ordering') {
    return items;
  }
  const path = orderBy.expression?.value;
  const direction = orderBy.direction === 'desc' ? -1 : 1;
  return [...items].sort((left, right) => String(valueAtPath(left, path) || '').localeCompare(String(valueAtPath(right, path) || '')) * direction);
}

function asKubernetesObject(resource, input) {
  if (input && typeof input === 'object' && input.apiVersion && input.kind && input.metadata) {
    return input;
  }
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: {
      name: input.name,
      ...(input.namespace ? { namespace: input.namespace } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.annotations ? { annotations: input.annotations } : {}),
    },
    spec: input.spec,
  };
}

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labels) {
    params.set('labelSelector', Object.entries(query.labels).map(([key, value]) => key + '=' + value).join(','));
  } else if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.fieldSelector) {
    params.set('fieldSelector', query.fieldSelector);
  }
  if (query.limit) {
    params.set('limit', String(query.limit));
  }
  if (query.continueToken) {
    params.set('continue', query.continueToken);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  const expressions = (selector.matchExpressions || []).map((expression) => {
    if (expression.operator === 'Exists' || expression.operator === 'DoesNotExist') {
      return expression.operator === 'DoesNotExist' ? '!' + expression.key : expression.key;
    }
    return expression.key + ' ' + (expression.operator === 'In' ? 'in' : 'notin') + ' (' + (expression.values || []).join(',') + ')';
  });
  return [...labels, ...expressions].join(',');
}

function sortItems(items, orderBy) {
  if (orderBy === 'metadata.name') {
    return [...items].sort((left, right) => String(left.metadata?.name || '').localeCompare(String(right.metadata?.name || '')));
  }
  if (orderBy === 'metadata.creationTimestamp') {
    return [...items].sort((left, right) => String(left.metadata?.creationTimestamp || '').localeCompare(String(right.metadata?.creationTimestamp || '')));
  }
  return items;
}

function collectionPath(resource, namespace) {
  const prefix = apiPrefix(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return prefix + '/namespaces/' + encodeURIComponent(namespace || defaultNamespace()) + '/' + encodeURIComponent(resource.plural);
  }
  return prefix + '/' + encodeURIComponent(resource.plural);
}

function objectPath(resource, namespace, name) {
  return collectionPath(resource, namespace) + '/' + encodeURIComponent(name);
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

async function kubernetesRequest({ method, path, body, contentType = 'application/json' }) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(payload ? { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, data }));
    });
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
  const parsed = response.data ? JSON.parse(response.data) : undefined;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(parsed?.message || 'Kubernetes request failed with HTTP ' + response.statusCode);
    error.statusCode = response.statusCode;
    throw error;
  }
  return parsed;
}

async function valkeyCommand(backend, parts) {
  const response = await new Promise((resolve, reject) => {
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
  return response;
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

export function writeResponse(response, result) {
  if (result && typeof result === 'object' && 'redirect' in result) {
    response.writeHead(303, { location: String(result.redirect) });
    response.end();
    return;
  }
  if (result && typeof result === 'object' && typeof result.html === 'string') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(result.html);
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(result ?? null));
}
`.trimStart();
}

function runtimeResourceTable(resources: Readonly<Record<string, AnyResourceDefinition>>): Readonly<Record<string, ApplicationServerRuntimeResource>> {
  // typecast: Object.fromEntries loses the keyed resource metadata shape, but each entry is built from AnyResourceDefinition fields above.
  return Object.fromEntries(Object.entries(resources).map(([name, resource]) => [name, {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
  }])) as Readonly<Record<string, ApplicationServerRuntimeResource>>;
}

function runtimeIndexTable(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, backend: ApplicationRuntimeIndexBackend | undefined, cache: readonly ResourceIndex<object, object>[]): Readonly<Record<string, ApplicationServerRuntimeIndex>> {
  const cached = new Set(cache);
  // typecast: Object.fromEntries loses the keyed index metadata shape, but each entry is built from ResourceIndex fields above.
  return Object.fromEntries(Object.entries(indexes).map(([name, index]) => [name, {
    name: index.name,
    resource: index.resource,
    options: index.options,
    ...(cached.has(index) && backend ? { backend } : {}),
  }])) as Readonly<Record<string, ApplicationServerRuntimeIndex>>;
}
