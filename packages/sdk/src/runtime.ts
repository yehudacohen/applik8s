// typecast-file-boundary: The SDK runtime validates guest/host handler payloads and operation effects before restoring resource-specific generics.
import type {
  AnyKubernetesObject,
  AnyResourceDefinition,
  Applik8sError,
  CapabilityClientSet,
  CapabilityDescriptor,
  CapabilityKind,
  FinalizeHandlerOptions,
  HandlerEventType,
  HandlerRegistration,
  KubernetesConnectionCapabilityDescriptor,
  KubernetesObject,
  ObjectRef,
  OperatorDefinition,
  OperatorDeploymentOptions,
  PermissionRule,
  ResourceDefinition,
  ResourceEventSources,
  ResourceObject,
  ResourceVersionDefinition,
  Result,
  SecretRef,
} from '@applik8s/core';
import type {
  Applik8sSdk,
  CallableOperator,
  CrdInstanceInput,
  CrdOptions,
  OperatorOptions,
  ScopedOperatorOptions,
} from './interfaces.js';
import { normalizeSchema, toRuntimeSchema } from './schema-runtime.js';

type StoredHandler = (...args: readonly unknown[]) => unknown;

const handlerSourceModuleSymbol = Symbol.for('applik8s.handlerSourceModule');

export interface RunnableHandlerRegistration<TSpec extends object = object, TStatus extends object = object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> extends HandlerRegistration<TSpec, TStatus, TCapabilities> {
  readonly handler: StoredHandler;
}

export type OperatorDeploymentInterceptor = <TCapabilities extends CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(
  definition: OperatorDefinition<TCapabilities, TResources>,
  deployment: OperatorDeploymentOptions,
  next: () => unknown
) => unknown | undefined;

let operatorDeploymentInterceptor: OperatorDeploymentInterceptor | undefined;

export function setOperatorDeploymentInterceptor(interceptor: OperatorDeploymentInterceptor | undefined): () => void {
  const previous = operatorDeploymentInterceptor;
  operatorDeploymentInterceptor = interceptor
    ? (definition, deployment, next) => interceptor(definition, deployment, () => previous ? previous(definition, deployment, next) : next())
    : undefined;
  return () => {
    operatorDeploymentInterceptor = previous;
  };
}

type ResourceHandlers<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet> = {
  readonly registrations: readonly RunnableHandlerRegistration<TSpec, TStatus, TCapabilities>[];
  register(event: HandlerEventType, handlerStyle: 'proxy' | 'context', handler: StoredHandler, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
};

export const sdk: Applik8sSdk = {
  crd,
  operator,
  watch: (source) => ({
    enqueue: (target, options) => {
      const exactNamespace = options?.map ? options.namespace : undefined;
      if (exactNamespace === 'all') throw new Error('Exact secondary-watch mappings cannot use namespace: "all"; select the source or operator namespace.');
      return {
        // Resource definitions may also be callable authoring handles. Persist
        // only their portable Kubernetes identity so JSON bundle emission never
        // drops a function-valued secondary-watch target.
        source: watchResourceIdentity(source),
        target: watchResourceIdentity(target),
        ...(options?.watch ? { watch: options.watch } : {}),
        mapper: options?.map
          ? { ...options.map, ...(exactNamespace ? { namespace: exactNamespace } : {}) }
          : { mode: 'all', ...(options?.namespace ? { namespace: options.namespace } : {}) },
      };
    },
  }),
  secretRef,
  withPermissions,
  permissions: builtInPermissions(),
  kubernetes: {
    resource: kubernetesReadResource,
    connection: {
      required: (options) => kubernetesConnectionDescriptor(options),
    },
    Deployment: kubernetesReadResource({ apiVersion: 'apps/v1', kind: 'Deployment', plural: 'deployments' }),
    Service: kubernetesReadResource({ apiVersion: 'v1', kind: 'Service', plural: 'services' }),
    Namespace: kubernetesReadResource({ apiVersion: 'v1', kind: 'Namespace', plural: 'namespaces', scope: 'Cluster' }),
    PersistentVolume: kubernetesReadResource({ apiVersion: 'v1', kind: 'PersistentVolume', plural: 'persistentvolumes', scope: 'Cluster' }),
  },
  schema: {
    fromArkType: (source) => ok(toRuntimeSchema(source)),
    fromJsonSchema: (source) => ok(toRuntimeSchema(source)),
    fromCustom: (source) => ok(toRuntimeSchema(source)),
  },
  external: {
    http: (options) => capabilityDescriptor('http', options.baseUrl, options.auth, options.timeoutMs),
    cloudApi: (options) => capabilityDescriptor(options.kind ?? 'cloudApi', options.endpoint, options.auth, options.timeoutMs),
    database: (options) => capabilityDescriptor(options.kind ?? 'database', options.endpoint, options.auth, options.timeoutMs),
    queue: (options) => capabilityDescriptor(options.kind ?? 'queue', options.endpoint, options.auth, options.timeoutMs),
    objectStore: (options) => capabilityDescriptor(options.kind ?? 'objectStore', options.endpoint, options.auth, options.timeoutMs),
    identity: (options) => capabilityDescriptor(options.kind ?? 'identity', options.endpoint, options.auth, options.timeoutMs),
  },
  isApplik8sError,
};

function watchResourceIdentity(resource: {
  readonly apiVersion: AnyResourceDefinition['apiVersion'];
  readonly kind: AnyResourceDefinition['kind'];
  readonly plural: AnyResourceDefinition['plural'];
  readonly scope: AnyResourceDefinition['scope'];
}): Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'> {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
  };
}

function kubernetesConnectionDescriptor(options: import('./interfaces.js').KubernetesConnectionRequirementOptions): KubernetesConnectionCapabilityDescriptor {
  return {
    name: '',
    kind: 'kubernetes',
    permissions: options.permissions,
    kubernetesConnection: { endpointPolicy: options.endpointPolicy },
    execution: {
      liveExecution: 'hostProtocol',
      protocol: 'applik8s.kubernetes-connection/v1alpha1',
      audit: { recordRequests: true, recordResponses: false, includePayloads: false },
      redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
      idempotency: { requiredForMutations: true, keySource: 'notApplicable' },
    },
    sensitive: true,
  };
}

export function crd<TSpec extends object, TStatus extends object>(options: CrdOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> {
  const scope = options.scope ?? 'Namespaced';
  const plural = options.plural ?? pluralize(options.kind);
  const spec = normalizeSchema(options.spec, `${options.kind}.spec`);
  const status = options.status ? normalizeSchema(options.status, `${options.kind}.status`) : undefined;
  let definition: ResourceDefinition<TSpec, TStatus>;
  const handlers = createResourceHandlers<TSpec, TStatus, CapabilityClientSet>(options.kind, () => definition);

  const factory = (input: CrdInstanceInput<TSpec>): ResourceObject<TSpec, TStatus> => ({
    apiVersion: options.apiVersion,
    kind: options.kind,
    metadata: {
      name: input.name,
      ...(input.namespace ? { namespace: input.namespace } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.annotations ? { annotations: input.annotations } : {}),
    },
    spec: input.spec,
  });

  const version: ResourceVersionDefinition<TSpec, TStatus> = {
    name: versionName(options.apiVersion),
    served: true,
    storage: true,
    spec,
    ...(status ? { status } : {}),
    compatibility: { conversionStrategy: 'none' },
  };

  // typecast: createEventSources stores handler closures in local runnable registrations while preserving the public ResourceEventSources call shape.
  const on = createEventSources(handlers) as unknown as ResourceEventSources<TSpec, TStatus, CapabilityClientSet>;

  // typecast: resource ownership is a literal marker added to the callable CRD factory object.
  definition = Object.assign(factory, {
    apiVersion: options.apiVersion,
    kind: options.kind,
    plural,
    scope,
    spec,
    ...(status ? { status } : {}),
    ...(options.statusConvention ? { statusConvention: options.statusConvention } : {}),
    statusSubresource: Boolean(status),
    ...(options.additionalPrinterColumns ? { additionalPrinterColumns: options.additionalPrinterColumns } : {}),
    versions: [version],
    permissions: permissionFactory(options.apiVersion, plural, scope),
    on,
    eventMetadata: [],
    instance: factory,
    index: (name: string, indexOptions: import('@applik8s/core').ResourceIndexOptions) => createResourceIndex(definition, name, indexOptions),
    create: unavailableResourceAction(options.kind, 'create'),
    get: unavailableResourceAction(options.kind, 'get'),
    query: unavailableResourceAction(options.kind, 'query'),
    patch: unavailableResourceAction(options.kind, 'patch'),
    delete: unavailableResourceAction(options.kind, 'delete'),
    increment: unavailableResourceAction(options.kind, 'increment'),
    resourceOwnership: 'owned' as const, // typecast: literal ownership marker distinguishes SDK-owned CRDs from external TypeKro resources.
  });
  Object.defineProperties(definition, {
    instance: { value: factory, enumerable: false },
    index: { value: (name: string, indexOptions: import('@applik8s/core').ResourceIndexOptions) => createResourceIndex(definition, name, indexOptions), enumerable: false },
    create: { value: unavailableResourceAction(options.kind, 'create'), enumerable: false },
    get: { value: unavailableResourceAction(options.kind, 'get'), enumerable: false },
    query: { value: unavailableResourceAction(options.kind, 'query'), enumerable: false },
    patch: { value: unavailableResourceAction(options.kind, 'patch'), enumerable: false },
    delete: { value: unavailableResourceAction(options.kind, 'delete'), enumerable: false },
    increment: { value: unavailableResourceAction(options.kind, 'increment'), enumerable: false },
  });
  return definition;
}

function kubernetesReadResource<TSpec extends object = object, TStatus extends object = object>(options: import('./interfaces.js').KubernetesReadResourceOptions): import('@applik8s/core').KubernetesReadResourceDefinition<TSpec, TStatus> {
  const plural = options.plural ?? pluralize(options.kind);
  return {
    apiVersion: options.apiVersion,
    kind: options.kind,
    plural,
    scope: options.scope ?? 'Namespaced',
    access: options.access ?? 'local',
    ...(options.namespaces ? { namespaces: options.namespaces } : {}),
    permissions: { read: () => permissionFactory(options.apiVersion, plural, options.scope ?? 'Namespaced').read() },
  };
}

function createResourceIndex<TSpec extends object, TStatus extends object>(resource: ResourceDefinition<TSpec, TStatus>, name: string, options: import('@applik8s/core').ResourceIndexOptions): import('@applik8s/core').ResourceIndex<TSpec, TStatus> {
  return {
    name,
    resource: {
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      plural: resource.plural,
      scope: resource.scope,
    },
    options,
    async query() {
      throw new Error(`Resource.index(${JSON.stringify(name)}) query requires the generated applik8s index runtime.`);
    },
  };
}

function unavailableResourceAction(kind: string, action: string) {
  return async () => {
    throw new Error(`${kind}.${action}(...) is only available inside a generated applik8s runtime scope.`);
  };
}

export function operator<TDescriptors extends Readonly<Record<string, CapabilityDescriptor>>, TResources extends import('./interfaces.js').ResourceDefinitionMap>(options: ScopedOperatorOptions<TDescriptors, TResources>): import('./interfaces.js').CallableOperator<import('./interfaces.js').CapabilityClientsFor<TDescriptors>, import('./interfaces.js').OperatorScopedResources<TResources, import('./interfaces.js').CapabilityClientsFor<TDescriptors>>>;
export function operator<TCapabilities extends CapabilityClientSet = CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>> = Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(options: OperatorOptions<TCapabilities, TResources>): CallableOperator<TCapabilities, TResources>;
// biome-ignore lint/suspicious/noExplicitAny: TypeScript overload implementations require an erased return compatible with both invariant callable-operator instantiations.
export function operator(optionsInput: unknown): any {
  // typecast: overloads validate either the legacy registration array or the capability-scoped registration callback before this erased runtime implementation.
  const options = optionsInput as OperatorOptions | ScopedOperatorOptions<Readonly<Record<string, CapabilityDescriptor>>, import('./interfaces.js').ResourceDefinitionMap>;
  const handlers = typeof options.handlers === 'function'
    // typecast: operator-scoped resources are the same runtime definitions with capability-aware event types supplied only at the TypeScript boundary.
    ? options.handlers({ resources: options.resources as unknown as import('./interfaces.js').OperatorScopedResources<import('./interfaces.js').ResourceDefinitionMap, import('./interfaces.js').CapabilityClientsFor<Readonly<Record<string, CapabilityDescriptor>>>> })
    : options.handlers;
  const definition: OperatorDefinition = {
    name: options.name,
    resources: options.resources,
    ...(options.reads ? { reads: options.reads } : {}),
    handlers,
    ...(options.secondaryWatches ? { secondaryWatches: options.secondaryWatches } : {}),
    trustLevel: options.trustLevel ?? 'trustedApplication',
    effects: options.effects ?? { mode: 'planned', replayable: true },
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.deployment ? { deployment: options.deployment } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };

  const deploy = (deployment: OperatorDeploymentOptions) => {
    const defaultDeploy = () => {
    const mergedDefinition: OperatorDefinition = {
      ...definition,
      deployment: { ...definition.deployment, ...deployment },
    };
    const factories = deployedFactories(options.resources, deployment.namespace);

      const deployed = Object.assign(
      {
        installKind: 'applik8sOperatorDeployment',
        operatorName: definition.name,
        operator: mergedDefinition,
        deployment: mergedDefinition.deployment,
        status: {
          ready: false,
          phase: 'Pending',
          message: `${definition.name} deployment has not been reconciled by a runtime.`
        },
        definition: mergedDefinition,
        ...(deployment.namespace ? { namespace: deployment.namespace } : {}),
        crdFactories: factories,
        resources: factories,
        resource(kind: string, input: CrdInstanceInput<object>) {
          const factory = Reflect.get(factories, kind);
          if (typeof factory !== 'function') {
            throw new Error(`Unknown resource kind or alias: ${kind}`);
          }
          return factory(input);
        },
      },
      factories
    );
    // typecast: deployed callable operators attach erased local factories at runtime while the public return type preserves the exact resource map.
    return deployed;
    };
    const intercepted = operatorDeploymentInterceptor?.(definition, deployment, defaultDeploy);
    if (intercepted !== undefined) {
      // typecast: extension interceptors can provide an alternate deployment binding while preserving the callable operator public surface.
      return intercepted as ReturnType<CallableOperator>;
    }
    return defaultDeploy();
  };

  // typecast: the concrete local operator carries the exact definition and erased runtime factories; public generics are compile-time API guarantees.
  return Object.assign(deploy, { definition }) as unknown as CallableOperator;
}

export function secretRef(name: string, key: string, namespace?: string): SecretRef {
  return {
    name,
    key,
    ...(namespace ? { namespace } : {}),
  };
}

export function withPermissions<TRegistration extends HandlerRegistration<object, object, CapabilityClientSet>>(registration: TRegistration, permissions: readonly PermissionRule[]): TRegistration {
  const decorated = { ...registration, permissions: [...(registration.permissions ?? []), ...permissions] };
  const sourceModule = Reflect.get(registration, handlerSourceModuleSymbol);
  if (isHandlerSourceMetadata(sourceModule)) attachHandlerSourceModule(decorated, sourceModule);
  return decorated;
}

export function isRunnableHandlerRegistration(value: unknown): value is RunnableHandlerRegistration {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'handler') === 'function');
}

function createEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet>(handlers: ResourceHandlers<TSpec, TStatus, TCapabilities>) {
  return {
    context: {
      reconcile: (handler: StoredHandler) => handlers.register('reconcile', 'context', handler),
      create: (handler: StoredHandler) => handlers.register('created', 'context', handler),
      update: (handler: StoredHandler) => handlers.register('updated', 'context', handler),
      delete: (handler: StoredHandler) => handlers.register('deleted', 'context', handler),
      created: (handler: StoredHandler) => handlers.register('created', 'context', handler),
      updated: (handler: StoredHandler) => handlers.register('updated', 'context', handler),
      deleted: (handler: StoredHandler) => handlers.register('deleted', 'context', handler),
      finalize: (handler: StoredHandler, options?: FinalizeHandlerOptions) => handlers.register('finalize', 'context', handler, options),
      statusChanged: (handler: StoredHandler) => handlers.register('statusChanged', 'context', handler),
    },
    reconcile: (handler: StoredHandler) => handlers.register('reconcile', 'proxy', handler),
    create: (handler: StoredHandler) => handlers.register('created', 'proxy', handler),
    update: (handler: StoredHandler) => handlers.register('updated', 'proxy', handler),
    delete: (handler: StoredHandler) => handlers.register('deleted', 'proxy', handler),
    created: (handler: StoredHandler) => handlers.register('created', 'proxy', handler),
    updated: (handler: StoredHandler) => handlers.register('updated', 'proxy', handler),
    deleted: (handler: StoredHandler) => handlers.register('deleted', 'proxy', handler),
    finalize: (handler: StoredHandler, options?: FinalizeHandlerOptions) => handlers.register('finalize', 'proxy', handler, options),
    statusChanged: (handler: StoredHandler) => handlers.register('statusChanged', 'proxy', handler),
  };
}

function createResourceHandlers<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet>(kind: string, resource: () => ResourceDefinition<TSpec, TStatus, TCapabilities>): ResourceHandlers<TSpec, TStatus, TCapabilities> {
  const registrations: RunnableHandlerRegistration<TSpec, TStatus, TCapabilities>[] = [];

  return {
    registrations,
    register(event, handlerStyle, handler, options) {
      const finalizers = event === 'finalize' ? normalizeFinalizeHandlerOptions(options) : undefined;
      const registration: RunnableHandlerRegistration<TSpec, TStatus, TCapabilities> = {
        id: `${kind}.${event}.${registrations.length}`,
        event,
        resource: resource(),
        handlerStyle,
        handler,
        ...(finalizers && finalizers.length > 0 ? { finalizers } : {}),
      };
      const handlerSourceModule = Reflect.get(handler, handlerSourceModuleSymbol);
      const sourceModule = isHandlerSourceMetadata(handlerSourceModule)
        ? handlerSourceModule
        : inferHandlerSourceModule();
      if (sourceModule) attachHandlerSourceModule(registration, sourceModule);
      registrations.push(registration);
      return registration;
    },
  };
}

interface HandlerSourceMetadata { readonly file: string; readonly line: number; readonly column: number; }

function attachHandlerSourceModule(registration: object, sourceModule: HandlerSourceMetadata): void {
  Object.defineProperty(registration, handlerSourceModuleSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: sourceModule,
  });
}

function inferHandlerSourceModule(): HandlerSourceMetadata | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    const match = line.match(/(?:file:\/\/)?((?:\/[^(\s]+|[A-Za-z]:\\[^)]+?)):(\d+):(\d+)\)?$/);
    if (!match?.[1]) continue;
    const file = decodeURIComponent(match[1].replace(/^file:\/\//, ''));
    const normalized = file.replaceAll('\\', '/');
    if (
      normalized.endsWith('/packages/sdk/src/runtime.ts')
      || normalized.endsWith('/packages/sdk/dist/runtime.js')
      || normalized.includes('/node_modules/@applik8s/sdk/dist/runtime.js')
    ) continue;
    return { file, line: Number(match[2]), column: Number(match[3]) };
  }
  return undefined;
}

function isHandlerSourceMetadata(value: unknown): value is HandlerSourceMetadata {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'file') === 'string' && typeof Reflect.get(value, 'line') === 'number' && typeof Reflect.get(value, 'column') === 'number');
}

function normalizeFinalizeHandlerOptions(options: FinalizeHandlerOptions | undefined): readonly string[] | undefined {
  if (!options) {
    return undefined;
  }
  return [...new Set([...(options.finalizer ? [options.finalizer] : []), ...(options.finalizers ?? [])].filter((finalizer) => finalizer.length > 0))];
}

function deployedFactories<TCapabilities extends CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(resources: TResources, defaultNamespace?: string): Readonly<Record<string, (input: CrdInstanceInput<object>) => KubernetesObject<object, object>>> {
  const factories: Record<string, (input: CrdInstanceInput<object>) => KubernetesObject<object, object>> = {};
  for (const [name, resource] of Object.entries(resources)) {
    factories[name] = (input) => createResourceObject(resource, withDefaultNamespace(input, defaultNamespace));
    factories[uncapitalize(name)] = factories[name];
  }
  return factories;
}

function createResourceObject<TCapabilities extends CapabilityClientSet>(resource: AnyResourceDefinition<TCapabilities>, input: CrdInstanceInput<object>): KubernetesObject<object, object> {
  const object = {
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
  const eventSources = Reflect.get(resource, 'on');
  if (!eventSources) {
    return object;
  }
  Object.defineProperty(object, 'on', {
    value: eventSources,
    enumerable: false,
    configurable: false,
  });
  return object;
}

function withDefaultNamespace<TSpec extends object>(input: CrdInstanceInput<TSpec>, defaultNamespace?: string): CrdInstanceInput<TSpec> {
  if (input.namespace || !defaultNamespace) {
    return input;
  }
  return { ...input, namespace: defaultNamespace };
}

function permissionFactory(apiVersion: string, plural: string, scope: import('@applik8s/core').ResourceScope) {
  const apiGroup = apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
  const rule = (verbs: readonly string[]): PermissionRule => ({ apiGroups: [apiGroup], resources: [plural], verbs, scope });
  return {
    watch: () => rule(['get', 'list', 'watch']),
    read: () => rule(['get', 'list']),
    apply: () => rule(['create', 'update', 'patch']),
    patch: () => rule(['patch']),
    patchStatus: () => ({ apiGroups: [apiGroup], resources: [`${plural}/status`], verbs: ['get', 'patch', 'update'], scope }),
    delete: () => rule(['delete']),
    finalize: () => ({ apiGroups: [apiGroup], resources: [`${plural}/finalizers`], verbs: ['patch', 'update'], scope }),
    manage: () => [
      { apiGroups: [apiGroup], resources: [plural], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'], scope },
      { apiGroups: [apiGroup], resources: [`${plural}/status`], verbs: ['get', 'patch', 'update'], scope },
      { apiGroups: [apiGroup], resources: [`${plural}/finalizers`], verbs: ['patch', 'update'], scope },
    ],
  };
}

function builtInPermissions() {
  const scope = 'Namespaced' as const;
  return {
    k8s: {
      ConfigMap: builtInResourcePermissions('', 'configmaps'),
      Secret: builtInResourcePermissions('', 'secrets'),
      Service: builtInResourcePermissions('', 'services'),
      Deployment: builtInResourcePermissions('apps', 'deployments'),
      StatefulSet: builtInResourcePermissions('apps', 'statefulsets'),
      Job: builtInResourcePermissions('batch', 'jobs'),
    },
    events: {
      write: () => ({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'], scope }),
    },
  };
}

function builtInResourcePermissions(apiGroup: string, resource: string) {
  const scope = 'Namespaced' as const;
  const rule = (verbs: readonly string[]): PermissionRule => ({ apiGroups: [apiGroup], resources: [resource], verbs, scope });
  return {
    read: () => rule(['get', 'list']),
    watch: () => rule(['get', 'list', 'watch']),
    apply: () => rule(['get', 'create', 'update', 'patch']),
    patch: () => rule(['get', 'patch']),
    patchStatus: () => ({ apiGroups: [apiGroup], resources: [`${resource}/status`], verbs: ['get', 'patch', 'update'], scope }),
    delete: () => rule(['get', 'delete']),
    finalize: () => ({ apiGroups: [apiGroup], resources: [`${resource}/finalizers`], verbs: ['patch', 'update'], scope }),
    manage: () => [
      rule(['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']),
      { apiGroups: [apiGroup], resources: [`${resource}/status`], verbs: ['get', 'patch', 'update'], scope },
      { apiGroups: [apiGroup], resources: [`${resource}/finalizers`], verbs: ['patch', 'update'], scope },
    ],
  };
}

function capabilityDescriptor(kind: CapabilityKind, endpoint: string, auth: SecretRef | 'serviceAccount' | 'none' | undefined, timeoutMs: number | undefined): CapabilityDescriptor {
  const policy: CapabilityDescriptor['policy'] = timeoutMs === undefined ? { failureMode: 'rejectPromiseWithApplik8sError' } : { timeoutMs, failureMode: 'rejectPromiseWithApplik8sError' };
  return {
    name: endpoint,
    kind,
    endpoint,
    auth: auth === 'serviceAccount' ? { type: 'serviceAccount' } : auth === 'none' || !auth ? { type: 'none' } : { type: 'secretRef', secretRef: auth },
    policy,
  };
}

function versionName(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.slice(apiVersion.lastIndexOf('/') + 1) : apiVersion;
}

function pluralize(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('s')) {
    return `${lower}es`;
  }
  if (lower.endsWith('y')) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

function uncapitalize(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function isApplik8sError(value: unknown): value is Applik8sError {
  return Boolean(value && typeof value === 'object' && 'code' in value && 'message' in value && 'severity' in value && 'context' in value);
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function objectRefFor(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>, object: Pick<AnyKubernetesObject, 'metadata'>): ObjectRef {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    name: object.metadata.name,
    ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}),
  };
}
// typecast-file-boundary: The SDK runtime validates guest/host handler payloads and operation effects before restoring resource-specific generics.
