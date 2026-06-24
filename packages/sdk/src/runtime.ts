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
  KubernetesObject,
  ObjectRef,
  OperatorDefinition,
  OperatorDeploymentOptions,
  PermissionRule,
  ResourceDefinition,
  ResourceEventSources,
  ResourceVersionDefinition,
  ResourceObject,
  Result,
  SecretRef,
} from '@applik8s/core';
import type {
  Applik8sSdk,
  CallableOperator,
  CrdInstanceInput,
  CrdOptions,
  OperatorOptions,
} from './interfaces.js';
import { normalizeSchema, toRuntimeSchema } from './schema-runtime.js';

type StoredHandler = (...args: readonly unknown[]) => unknown;

export interface RunnableHandlerRegistration<TSpec extends object = object, TStatus extends object = object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> extends HandlerRegistration<TSpec, TStatus, TCapabilities> {
  readonly handler: StoredHandler;
}

type ResourceHandlers<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet> = {
  readonly registrations: readonly RunnableHandlerRegistration<TSpec, TStatus, TCapabilities>[];
  register(event: HandlerEventType, handlerStyle: 'proxy' | 'context', handler: StoredHandler, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
};

export const sdk: Applik8sSdk = {
  crd,
  operator,
  secretRef,
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
    permissions: permissionFactory(options.apiVersion, plural),
    on,
    eventMetadata: [],
  });
  return definition;
}

export function operator<TCapabilities extends CapabilityClientSet = CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>> = Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(
  options: OperatorOptions<TCapabilities, TResources>
): CallableOperator<TCapabilities, TResources> {
  const definition: OperatorDefinition<TCapabilities, TResources> = {
    name: options.name,
    resources: options.resources,
    handlers: options.handlers,
    trustLevel: options.trustLevel ?? 'trustedApplication',
    effects: options.effects ?? { mode: 'planned', replayable: true },
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.deployment ? { deployment: options.deployment } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };

  const deploy = (deployment: OperatorDeploymentOptions) => {
    const mergedDefinition: OperatorDefinition<TCapabilities, TResources> = {
      ...definition,
      deployment: { ...definition.deployment, ...deployment },
    };
    // typecast: deployed local factories erase capability-specific resource maps while preserving runtime resource identity.
    const factories = deployedFactories(options.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>, deployment.namespace);

    const deployed = Object.assign(
      {
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
    return deployed as ReturnType<CallableOperator<TCapabilities, TResources>>;
  };

  // typecast: the concrete local operator carries the exact definition and erased runtime factories; public generics are compile-time API guarantees.
  return Object.assign(deploy, { definition }) as unknown as CallableOperator<TCapabilities, TResources>;
}

export function secretRef(name: string, key: string, namespace?: string): SecretRef {
  return {
    name,
    key,
    ...(namespace ? { namespace } : {}),
  };
}

export function isRunnableHandlerRegistration(value: unknown): value is RunnableHandlerRegistration {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'handler') === 'function');
}

function createEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet>(handlers: ResourceHandlers<TSpec, TStatus, TCapabilities>) {
  return {
    context: {
      reconcile: (handler: StoredHandler) => handlers.register('reconcile', 'context', handler),
      created: (handler: StoredHandler) => handlers.register('created', 'context', handler),
      updated: (handler: StoredHandler) => handlers.register('updated', 'context', handler),
      deleted: (handler: StoredHandler) => handlers.register('deleted', 'context', handler),
      finalize: (handler: StoredHandler, options?: FinalizeHandlerOptions) => handlers.register('finalize', 'context', handler, options),
      statusChanged: (handler: StoredHandler) => handlers.register('statusChanged', 'context', handler),
    },
    reconcile: (handler: StoredHandler) => handlers.register('reconcile', 'proxy', handler),
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
      registrations.push(registration);
      return registration;
    },
  };
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

function withDefaultNamespace<TSpec extends object>(input: CrdInstanceInput<TSpec>, defaultNamespace?: string): CrdInstanceInput<TSpec> {
  if (input.namespace || !defaultNamespace) {
    return input;
  }
  return { ...input, namespace: defaultNamespace };
}

function permissionFactory(apiVersion: string, plural: string) {
  const apiGroup = apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
  const rule = (verbs: readonly string[]): Result<PermissionRule> => ok({ apiGroups: [apiGroup], resources: [plural], verbs });
  return {
    watch: () => rule(['get', 'list', 'watch']),
    read: () => rule(['get', 'list']),
    apply: () => rule(['create', 'update', 'patch']),
    patch: () => rule(['patch']),
    patchStatus: () => ok({ apiGroups: [apiGroup], resources: [`${plural}/status`], verbs: ['get', 'patch', 'update'] }),
    delete: () => rule(['delete']),
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
