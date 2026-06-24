import type {
  AnyKubernetesObject,
  ApplyOperation,
  ApplyOperationInput,
  ApplyTargetOptions,
  ApplyTargetInput,
  CapabilityClientSet,
  ConfigMapFactoryConfig,
  DeleteOptions,
  DeleteOperationInput,
  DeleteTargetInput,
  DeleteTargetOptions,
  EventOperation,
  FinalizerOperationSpec,
  GraphApplication,
  HandlerEventType,
  HandlerProxyScope,
  HandlerResult,
  JsonObject,
  JsonPatch,
  KubernetesFactoryConfig,
  KubernetesObject,
  NormalizedOperationPlan,
  ObjectRef,
  Operation,
  OperationPlanInput,
  OperationTarget,
  PatchOperation,
  PartialStatus,
  PatchLikeOperation,
  ReconcileId,
  ResourceDefinition,
  ResourceObject,
  StatusOperation,
} from '@applik8s/core';

type MutableHandlerResult<TStatus extends object> = {
  apply?: readonly ApplyOperationInput[];
  patch?: readonly PatchLikeOperation[];
  delete?: readonly DeleteOperationInput[];
  status?: PartialStatus<TStatus>;
  events?: readonly EventOperation[];
  finalizers?: readonly FinalizerOperationSpec[];
  requeue?: NonNullable<HandlerResult<TStatus>['requeue']>;
};

export interface HandlerProxyRecorder<TSpec extends object, TStatus extends object> {
  readonly scope: HandlerProxyScope<TSpec, TStatus>;
  result(): HandlerResult<TStatus>;
  normalizedPlan(): NormalizedOperationPlan<TStatus>;
}

export interface HandlerProxyRecorderOptions {
  readonly event?: HandlerEventType;
  readonly reconcileId?: ReconcileId;
  readonly capabilities?: CapabilityClientSet;
}

export function createHandlerProxyRecorder<TSpec extends object, TStatus extends object>(
  object: ResourceObject<TSpec, TStatus>,
  options: HandlerProxyRecorderOptions = {}
): HandlerProxyRecorder<TSpec, TStatus> {
  const applyOperations: ApplyOperationInput[] = [];
  const patchOperations: PatchOperation[] = [];
  const deleteOperations: DeleteOperationInput[] = [];
  const eventOperations: EventOperation[] = [];
  const finalizerOperations: FinalizerOperationSpec[] = [];
  const statusOperations: StatusOperation<object>[] = [];
  let requeueOperation: HandlerResult<TStatus>['requeue'];
  let statusTouched = false;

  // typecast: an absent status means an empty draft for this resource's status type.
  const statusDraft = createTrackedDraft((object.status ?? {}) as TStatus, () => {
    statusTouched = true;
  });

  const applyPlan = (plan: OperationPlanInput<TStatus>): void => {
    for (const resource of [...(plan.apply ?? []), ...(plan.resources ?? [])]) {
      applyOperations.push(resource);
    }
    for (const patch of plan.patch ?? []) {
      if (patch.kind === 'patch') {
        patchOperations.push(patch);
      } else {
        statusOperations.push(patch);
      }
    }
    for (const ref of plan.delete ?? []) {
      deleteOperations.push(ref);
    }
    for (const event of plan.events ?? []) {
      eventOperations.push(event);
    }
    for (const finalizer of plan.finalizers ?? []) {
      finalizerOperations.push(finalizer);
    }
    if (plan.status) {
      Object.assign(statusDraft, plan.status);
      statusTouched = true;
    }
    if (plan.requeue) {
      requeueOperation = plan.requeue;
    }
  };

  const renderApplyTarget = (target: OperationTarget<TStatus>, targetOptions?: ApplyTargetOptions): void => {
    const fastPath = precomputedApplyOperations(target, targetOptions);
    if (fastPath) {
      mergeNormalizedPlan(fastPath);
      return;
    }
    const rendered = target.adapter.renderApply(target, targetOptions);
    if (rendered.ok) {
      mergeNormalizedPlan(rendered.value.operations);
    }
  };

  const renderDeleteTarget = (target: OperationTarget<TStatus>, targetOptions?: DeleteTargetOptions): void => {
    const fastPath = precomputedDeleteOperations(target, targetOptions);
    if (fastPath) {
      mergeNormalizedPlan(fastPath);
      return;
    }
    const rendered = target.adapter.renderDelete(target, targetOptions);
    if (rendered.ok) {
      mergeNormalizedPlan(rendered.value.operations);
    }
  };

  const mergeNormalizedPlan = (operations: readonly Operation<TStatus>[]): void => {
    for (const operation of operations) {
      switch (operation.kind) {
        case 'apply':
          applyOperations.push(operation);
          break;
        case 'patch':
          patchOperations.push(operation);
          break;
        case 'delete':
          deleteOperations.push(operation);
          break;
        case 'status':
          statusOperations.push(operation);
          break;
        case 'event':
          eventOperations.push(operation);
          break;
        case 'finalizer':
          finalizerOperations.push(operation);
          break;
        case 'requeue':
          requeueOperation = operation.policy;
          break;
      }
    }
  };

  const k8s = {
    Job: (config: KubernetesFactoryConfig) => kubernetesFactory('batch/v1', 'Job', config),
    Deployment: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'Deployment', config),
    Service: (config: KubernetesFactoryConfig) => kubernetesFactory('v1', 'Service', config),
    ConfigMap: (config: ConfigMapFactoryConfig) => configMapFactory(config),
    StatefulSet: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'StatefulSet', config),
  };

  // typecast: the runtime object implements HandlerProxyScope overloads, but TypeScript cannot infer overloaded method compatibility from a single implementation object.
  const scope = {
    object,
    spec: object.spec,
    metadata: object.metadata,
    event: options.event ?? 'reconcile',
    reconcileId: options.reconcileId ?? 'test-reconcile',
    capabilities: options.capabilities ?? {},
    names: {
      dnsSafe(input: string, nameOptions?: { readonly maxLength?: number; readonly collisionSuffixLength?: number }) {
        return input
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, nameOptions?.maxLength ?? 63);
      },
      withHash(prefix: string, input: string, nameOptions?: { readonly maxLength?: number; readonly collisionSuffixLength?: number }) {
        const hash = stableHash(input).slice(0, nameOptions?.collisionSuffixLength ?? 8);
        return this.dnsSafe(`${prefix}-${hash}`, nameOptions);
      },
    },
    k8s,
    batch: k8s,
    status: statusDraft,
    resources: {
      apply(resource: AnyKubernetesObject, options?: ApplyTargetOptions) {
        applyOperations.push(applyInput(resource, options));
      },
      applyTarget(target: OperationTarget<TStatus> | ApplyTargetInput<TStatus>) {
        renderApplyTarget('target' in target ? target.target : target, 'options' in target ? target.options : undefined);
      },
      delete(ref: ObjectRef) {
        deleteOperations.push(ref);
      },
      deleteTarget(target: OperationTarget<TStatus> | DeleteTargetInput<TStatus>) {
        renderDeleteTarget('target' in target ? target.target : target, 'options' in target ? target.options : undefined);
      },
      patch(ref: ObjectRef, patch: JsonPatch) {
        patchOperations.push({ kind: 'patch', ref, patch });
      },
    },
    events: {
      record(event: EventOperation) {
        eventOperations.push(event);
      },
      normal(reason: string, message: string, regarding?: ObjectRef) {
        eventOperations.push({ kind: 'event', type: 'Normal', reason, message, ...(regarding ? { regarding } : {}) });
      },
      warning(reason: string, message: string, regarding?: ObjectRef) {
        eventOperations.push({ kind: 'event', type: 'Warning', reason, message, ...(regarding ? { regarding } : {}) });
      },
    },
    finalizers: {
      add(finalizer: string) {
        finalizerOperations.push({ kind: 'finalizer', operation: 'add', finalizer });
      },
      remove(finalizer: string) {
        finalizerOperations.push({ kind: 'finalizer', operation: 'remove', finalizer });
      },
    },
    apply(value: OperationPlanInput<TStatus> | OperationTarget<TStatus> | readonly OperationTarget<TStatus>[] | AnyKubernetesObject, targetOptions?: ApplyTargetOptions | OperationPlanInput<TStatus>) {
      if (isReadonlyArray(value)) {
        for (const item of value) {
          renderApplyTarget(item, isApplyTargetOptions(targetOptions) ? targetOptions : undefined);
        }
        if (isOperationPlan(targetOptions)) {
          applyPlan(targetOptions);
        }
        return;
      }
      if (isKubernetesObject(value)) {
        applyOperations.push(applyInput(value, isApplyTargetOptions(targetOptions) ? targetOptions : undefined));
        return;
      }
      if (isOperationTarget<TStatus>(value)) {
        renderApplyTarget(value, isApplyTargetOptions(targetOptions) ? targetOptions : undefined);
        return;
      }
      applyPlan(value);
    },
    applyGraph(application: GraphApplication<object, TStatus, object>) {
      const rendered = application.adapter.render(application.graph, application.spec);
      if (rendered.ok) {
        mergeNormalizedPlan(rendered.value.operations);
      }
    },
    delete(value: ObjectRef | OperationTarget<TStatus> | readonly OperationTarget<TStatus>[] | AnyKubernetesObject, targetOptions?: DeleteOptions | DeleteTargetOptions | OperationPlanInput<TStatus>) {
      if (isReadonlyArray(value)) {
        for (const item of value) {
          renderDeleteTarget(item, isDeleteTargetOptions(targetOptions) ? targetOptions : undefined);
        }
        if (isOperationPlan(targetOptions)) {
          applyPlan(targetOptions);
        }
        return;
      }
      if (isOperationTarget<TStatus>(value)) {
        renderDeleteTarget(value, isDeleteTargetOptions(targetOptions) ? targetOptions : undefined);
        return;
      }
      if (isKubernetesObject(value)) {
        const ref = objectRef(value.apiVersion, value.kind, value.metadata.name, value.metadata.namespace);
        deleteOperations.push(isDeleteOptions(targetOptions) ? { kind: 'delete', ref, options: targetOptions } : ref);
        return;
      }
      deleteOperations.push(isDeleteOptions(targetOptions) ? { kind: 'delete', ref: value, options: targetOptions } : value);
    },
    patch(ref: ObjectRef, patch: JsonPatch) {
      patchOperations.push({ kind: 'patch', ref, patch });
    },
    setStatus(resource: ResourceDefinition<object, object>, name: string, status: object, namespace?: string) {
      statusOperations.push({
        kind: 'status',
        ref: objectRef(resource.apiVersion, resource.kind, name, namespace),
        status,
      });
    },
    recordEvent(event: EventOperation) {
      eventOperations.push(event);
    },
    requeue(policy: NonNullable<HandlerResult<TStatus>['requeue']>) {
      requeueOperation = policy;
    },
    plan(target: OperationTarget<TStatus>, targetOptions?: object) {
      // typecast: test helper accepts the public plan options shape but only forwards apply-target options to the fast path.
      const fastPath = precomputedApplyOperations(target, targetOptions as ApplyTargetOptions | undefined);
      if (fastPath) {
        // typecast: literal true preserves the Result discriminant for the local testing fast path.
        return { ok: true as const, value: { operations: fastPath } };
      }
      return target.adapter.renderApply(target, targetOptions);
    },
  } as unknown as HandlerProxyScope<TSpec, TStatus>;

  return {
    scope,
    result() {
      const result: MutableHandlerResult<TStatus> = {};
      if (applyOperations.length > 0) {
        result.apply = applyOperations;
      }
      const patches = [...patchOperations, ...statusOperations];
      if (patches.length > 0) {
        result.patch = patches;
      }
      if (deleteOperations.length > 0) {
        result.delete = deleteOperations;
      }
      if (statusTouched) {
        result.status = cloneJson(statusDraft);
      }
      if (eventOperations.length > 0) {
        result.events = eventOperations;
      }
      if (finalizerOperations.length > 0) {
        result.finalizers = finalizerOperations;
      }
      if (requeueOperation) {
        result.requeue = requeueOperation;
      }
      return result;
    },
    normalizedPlan() {
      const operations: Operation<TStatus>[] = [];
      const finalizers = splitFinalizers(finalizerOperations);
      operations.push(...finalizers.add);
      for (const resource of applyOperations) {
        operations.push(isApplyOperation(resource) ? resource : { kind: 'apply', resource });
      }
      for (const patch of patchOperations) {
        operations.push(patch);
      }
      for (const input of deleteOperations) {
        operations.push(isDeleteOperation(input) ? input : { kind: 'delete', ref: input });
      }
      if (statusTouched) {
        operations.push({ kind: 'status', status: cloneJson(statusDraft) });
      }
      for (const statusOperation of statusOperations) {
        // typecast: other-resource status operations are valid normalized operations, but Operation<TStatus> only models the primary resource status type.
        operations.push(statusOperation as StatusOperation<TStatus>);
      }
      for (const event of eventOperations) {
        operations.push(event);
      }
      operations.push(...finalizers.remove);
      if (requeueOperation) {
        operations.push({ kind: 'requeue', policy: requeueOperation });
      }
      return { operations };
    },
  };
}

function splitFinalizers(finalizers: readonly FinalizerOperationSpec[]): { add: FinalizerOperationSpec[]; remove: FinalizerOperationSpec[] } {
  const add: FinalizerOperationSpec[] = [];
  const remove: FinalizerOperationSpec[] = [];
  for (const finalizer of finalizers) {
    if (finalizer.operation === 'add') {
      add.push(finalizer);
    } else {
      remove.push(finalizer);
    }
  }
  return { add, remove };
}

function createTrackedDraft<T extends object>(source: T, onWrite: () => void): T {
  // typecast: JSON cloning preserves the caller-provided JSON-compatible draft shape at runtime.
  const draft = cloneJson(source) as T;
  const proxies = new WeakMap<object, object>();

  const wrap = (value: object): object => {
    const existing = proxies.get(value);
    if (existing) {
      return existing;
    }
    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        const nested: unknown = Reflect.get(target, property, receiver);
        if (nested && typeof nested === 'object') {
          return wrap(nested);
        }
        return nested;
      },
      set(target, property, value, receiver) {
        onWrite();
        return Reflect.set(target, property, value, receiver);
      },
      deleteProperty(target, property) {
        onWrite();
        return Reflect.deleteProperty(target, property);
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };

  // typecast: ES6 Proxy preserves the target's structural shape while adding write tracking.
  return wrap(draft) as T;
}

function kubernetesFactory(apiVersion: string, kind: string, config: KubernetesFactoryConfig): KubernetesObject<JsonObject, JsonObject> {
  const metadata: KubernetesObject<JsonObject, JsonObject>['metadata'] = {
    name: config.name,
    ...(config.namespace ? { namespace: config.namespace } : {}),
    ...(config.labels ? { labels: config.labels } : {}),
    ...(config.annotations ? { annotations: config.annotations } : {}),
  };

  return {
    apiVersion,
    kind,
    metadata,
    spec: {
      ...(config.spec ?? {}),
      ...(config.image ? { image: config.image } : {}),
      ...(config.env ? { env: config.env } : {}),
    },
  };
}

function configMapFactory(config: ConfigMapFactoryConfig): KubernetesObject<JsonObject, JsonObject> & { readonly data?: Readonly<Record<string, string>>; readonly binaryData?: Readonly<Record<string, string>>; readonly immutable?: boolean } {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: config.name,
      ...(config.namespace ? { namespace: config.namespace } : {}),
      ...(config.labels ? { labels: config.labels } : {}),
      ...(config.annotations ? { annotations: config.annotations } : {}),
    },
    ...(config.data ? { data: config.data } : {}),
    ...(config.binaryData ? { binaryData: config.binaryData } : {}),
    ...(config.immutable !== undefined ? { immutable: config.immutable } : {}),
  };
}

function objectRef(apiVersion: string, kind: string, name: string, namespace?: string): ObjectRef {
  return {
    apiVersion,
    kind,
    name,
    ...(namespace ? { namespace } : {}),
  };
}

function isKubernetesObject(value: unknown): value is AnyKubernetesObject {
  return Boolean(value && typeof value === 'object' && 'apiVersion' in value && 'kind' in value && 'metadata' in value);
}

function isOperationTarget<TStatus extends object>(value: unknown): value is OperationTarget<TStatus> {
  // typecast: operation targets use a private structural discriminant at the handler boundary.
  return Boolean(value && typeof value === 'object' && (value as { readonly targetKind?: unknown }).targetKind === 'operationTarget');
}

function precomputedApplyOperations<TStatus extends object>(target: OperationTarget<TStatus>, options?: ApplyTargetOptions): Operation<TStatus>[] | undefined {
  // typecast: TypeKro targets may carry pre-rendered Kubernetes resources for component-safe execution.
  const resources = (target as { readonly __applik8sApplyResources?: unknown }).__applik8sApplyResources;
  if (!Array.isArray(resources)) {
    return undefined;
  }
  // typecast: precomputed target resources are validated by the target constructor and normalized to operation-plan entries here.
  return resources.map((resource) => applyInput(resource as AnyKubernetesObject, options) as Operation<TStatus>);
}

function precomputedDeleteOperations<TStatus extends object>(target: OperationTarget<TStatus>, options?: DeleteTargetOptions): Operation<TStatus>[] | undefined {
  // typecast: TypeKro targets may carry pre-rendered object refs for component-safe deletion.
  const refs = (target as { readonly __applik8sDeleteRefs?: unknown }).__applik8sDeleteRefs;
  if (!Array.isArray(refs)) {
    return undefined;
  }
  return refs.map((ref) => {
    // typecast: precomputed target delete refs are object references emitted by the target constructor.
    const operation: { kind: 'delete'; ref: ObjectRef; options?: DeleteOptions } = { kind: 'delete', ref: ref as ObjectRef };
    if (options?.propagationPolicy || options?.gracePeriodSeconds !== undefined) {
      operation.options = {
        ...(options.propagationPolicy ? { propagationPolicy: options.propagationPolicy } : {}),
        ...(options.gracePeriodSeconds !== undefined ? { gracePeriodSeconds: options.gracePeriodSeconds } : {}),
      };
    }
    // typecast: delete operations are valid normalized operations for any handler status type.
    return operation as Operation<TStatus>;
  });
}

function isReadonlyArray<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

function isOperationPlan<TStatus extends object>(value: unknown): value is OperationPlanInput<TStatus> {
  return Boolean(value && typeof value === 'object' && ('status' in value || 'requeue' in value || 'apply' in value || 'delete' in value));
}

function isDeleteOperation(input: DeleteOperationInput): input is Extract<Operation, { kind: 'delete' }> {
  return 'kind' in input && input.kind === 'delete';
}

function isApplyOperation(input: ApplyOperationInput): input is ApplyOperation {
  return 'kind' in input && input.kind === 'apply';
}

function applyInput(resource: AnyKubernetesObject, options: ApplyTargetOptions | undefined): ApplyOperationInput {
  if (!options) {
    return resource;
  }
  return {
    kind: 'apply',
    resource,
    ...(options.fieldManager ? { fieldManager: options.fieldManager } : {}),
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.ownership ? { ownership: options.ownership } : options.owner ? { ownership: { mode: 'reference', ref: options.owner } } : {}),
  };
}

function isDeleteOptions(value: DeleteOptions | DeleteTargetOptions | OperationPlanInput<object> | undefined): value is DeleteOptions {
  return Boolean(value && !isOperationPlan(value) && ('propagationPolicy' in value || 'gracePeriodSeconds' in value));
}

function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function cloneJson<T>(value: T): T {
  // typecast: JSON.parse returns unknown data, and callers constrain T to JSON-compatible contract values in this module.
  return JSON.parse(JSON.stringify(value)) as T;
}

function isApplyTargetOptions<TStatus extends object>(value: ApplyTargetOptions | OperationPlanInput<TStatus> | undefined): value is ApplyTargetOptions {
  return Boolean(value && typeof value === 'object' && ('fieldManager' in value || 'force' in value || 'owner' in value || 'ownership' in value));
}

function isDeleteTargetOptions<TStatus extends object>(value: DeleteOptions | DeleteTargetOptions | OperationPlanInput<TStatus> | undefined): value is DeleteTargetOptions {
  return Boolean(value && typeof value === 'object' && !isOperationPlan(value) && ('owner' in value || 'propagationPolicy' in value || 'gracePeriodSeconds' in value));
}
