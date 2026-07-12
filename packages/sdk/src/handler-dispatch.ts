import type {
  AnyKubernetesObject,
  AnyResourceDefinition,
  Applik8sErrorCode,
  ApplyOperation,
  ApplyOperationInput,
  ApplyTargetInput,
  ApplyTargetOptions,
  CapabilityClient,
  CapabilityClientSet,
  CapabilityDescriptor,
  CapabilityPayload,
  CapabilityRequestPayload,
  CapabilityResponsePayload,
  ConfigMapFactoryConfig,
  DeleteOperationInput,
  DeleteOptions,
  DeleteTargetInput,
  DeleteTargetOptions,
  EventOperation,
  FinalizerOperationSpec,
  HandlerContext,
  HandlerEventType,
  HandlerProxyScope,
  HandlerResult,
  JsonPatch,
  KubernetesFactoryConfig,
  NormalizedOperationPlan,
  ObjectRef,
  Operation,
  OperationPlanInput,
  OperationTarget,
  PlanTargetOptions,
  OperatorDefinition,
  RequeuePolicy,
  ResourceDefinition,
  ResourceGetQuery,
  ResourceObject,
  ResourceReadClient,
  ResourceReadQuery,
  Result,
} from '@applik8s/core';
import { isRunnableHandlerRegistration, type RunnableHandlerRegistration } from './runtime.js';

export interface HandlerDispatchHostImports {
  readonly capabilityRequest?: CapabilityRequestImport;
  readonly kubernetesRead?: KubernetesReadImport;
}

export type CapabilityRequestImport = (requestJson: string) => CapabilityImportResult;
export type KubernetesReadImport = (requestJson: string) => CapabilityImportResult;

type CapabilityImportResult = string | { readonly tag: 'ok' | 'err'; readonly val: string } | { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

export async function dispatchOperatorHandler(operator: OperatorDefinition, inputJson: string, hostImports: HandlerDispatchHostImports = {}): Promise<string> {
  // typecast: Rust validates the handler input schema before passing JSON across the WASM boundary; the dispatcher narrows the parsed payload to that contract.
  const input = JSON.parse(inputJson) as HandlerInputPayload;
  const registration = operator.handlers.find((handler) => isRunnableHandlerRegistration(handler) && handler.id === input.handlerId);
  if (!registration || !isRunnableHandlerRegistration(registration)) {
    throw new Error(`No handler registered for ${input.handlerId}.`);
  }
  if (registration.resource.apiVersion !== input.object.apiVersion || registration.resource.kind !== input.object.kind) {
    throw new Error(`Handler ${input.handlerId} is registered for ${registration.resource.apiVersion}/${registration.resource.kind}, not ${input.object.apiVersion}/${input.object.kind}.`);
  }

  const reconcileId = input.runtime?.reconcileId ?? 'runtime-reconcile';
  const invocation = await invokeRunnableHandler(registration, input.object, input.event, reconcileId, capabilityClients(input.capabilities ?? {}, reconcileId, hostImports), { ...operator.resources, ...(operator.reads ?? {}) }, hostImports.kubernetesRead);
  if (!invocation.ok) {
    throw new Error(invocation.error.message);
  }
  return JSON.stringify(invocation.value.plan);
}

export function dispatchOperatorHandlerSync(operator: OperatorDefinition, inputJson: string, hostImports: HandlerDispatchHostImports = {}): string {
  // typecast: Rust validates the handler input schema before passing JSON across the WASM boundary; the dispatcher narrows the parsed payload to that contract.
  const input = JSON.parse(inputJson) as HandlerInputPayload;
  const registration = operator.handlers.find((handler) => isRunnableHandlerRegistration(handler) && handler.id === input.handlerId);
  if (!registration || !isRunnableHandlerRegistration(registration)) {
    throw new Error(`No handler registered for ${input.handlerId}.`);
  }
  if (registration.resource.apiVersion !== input.object.apiVersion || registration.resource.kind !== input.object.kind) {
    throw new Error(`Handler ${input.handlerId} is registered for ${registration.resource.apiVersion}/${registration.resource.kind}, not ${input.object.apiVersion}/${input.object.kind}.`);
  }

  const reconcileId = input.runtime?.reconcileId ?? 'runtime-reconcile';
  const invocation = invokeRunnableHandlerSync(registration, input.object, input.event, reconcileId, capabilityClients(input.capabilities ?? {}, reconcileId, hostImports), { ...operator.resources, ...(operator.reads ?? {}) }, hostImports.kubernetesRead);
  if (!invocation.ok) {
    throw new Error(invocation.error.message);
  }
  return JSON.stringify(invocation.value.plan);
}

interface HandlerInputPayload {
  readonly handlerId: string;
  readonly event: HandlerEventType;
  readonly object: AnyKubernetesObject;
  readonly capabilities?: Readonly<Record<string, CapabilityDescriptor>>;
  readonly runtime?: { readonly reconcileId?: string };
}

interface InvocationResult {
  readonly result: HandlerResult;
  readonly plan: NormalizedOperationPlan;
}

async function invokeRunnableHandler(registration: RunnableHandlerRegistration, object: AnyKubernetesObject, event: HandlerEventType, reconcileId: string, capabilities: CapabilityClientSet, resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, kubernetesRead?: KubernetesReadImport): Promise<Result<InvocationResult>> {
  const recorder = createRecorder(toResourceObject(object), { event, reconcileId, capabilities, resources, ...(kubernetesRead ? { kubernetesRead } : {}) });
  try {
    if (registration.handlerStyle === 'context') {
      const returned = await registration.handler(toResourceObject(object), createContext(recorder, object));
      const explicit = normalizeReturnedHandlerResult(returned);
      if (!explicit.ok) {
        return explicit;
      }
      const result = explicit.value ?? recorder.result();
      return ok({ result, plan: normalizeHandlerResult(result) });
    }

    const returned = await registration.handler(recorder.scope);
    const explicit = normalizeReturnedHandlerResult(returned);
    if (!explicit.ok) {
      return explicit;
    }
    const result = mergeHandlerResults(recorder.result(), explicit.value);
    return ok({ result, plan: normalizeHandlerResult(result) });
  } catch (cause) {
    return err('HANDLER_TRAP', handlerFailureMessage(cause));
  }
}

function invokeRunnableHandlerSync(registration: RunnableHandlerRegistration, object: AnyKubernetesObject, event: HandlerEventType, reconcileId: string, capabilities: CapabilityClientSet, resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, kubernetesRead?: KubernetesReadImport): Result<InvocationResult> {
  const recorder = createRecorder(toResourceObject(object), { event, reconcileId, capabilities, resources, ...(kubernetesRead ? { kubernetesRead } : {}) });
  try {
    if (registration.handlerStyle === 'context') {
      const returned = registration.handler(toResourceObject(object), createContext(recorder, object));
      if (isPromiseLike(returned)) {
        throw new Error('Async handlers are not supported by the wasm component dispatcher in v0.1.');
      }
      const explicit = normalizeReturnedHandlerResult(returned);
      if (!explicit.ok) {
        return explicit;
      }
      const result = explicit.value ?? recorder.result();
      return ok({ result, plan: normalizeHandlerResult(result) });
    }

    const returned = registration.handler(recorder.scope);
    if (isPromiseLike(returned)) {
      throw new Error('Async handlers are not supported by the wasm component dispatcher in v0.1.');
    }
    const explicit = normalizeReturnedHandlerResult(returned);
    if (!explicit.ok) {
      return explicit;
    }
    const result = mergeHandlerResults(recorder.result(), explicit.value);
    return ok({ result, plan: normalizeHandlerResult(result) });
  } catch (cause) {
    return err('HANDLER_TRAP', handlerFailureMessage(cause));
  }
}

function handlerFailureMessage(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return 'Handler threw an unknown error.';
  }
  const stack = cause.stack?.split('\n').slice(0, 12).join('\n');
  if (!stack) {
    return cause.message;
  }
  return stack.includes(cause.message) ? stack : `${cause.message}\n${stack}`;
}

function capabilityClients(descriptors: Readonly<Record<string, CapabilityDescriptor>>, reconcileId: string, hostImports: HandlerDispatchHostImports): CapabilityClientSet {
  const clients: Record<string, CapabilityClient> = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    clients[name] = hostImports.capabilityRequest ? hostCapabilityClient(name, descriptor, reconcileId, hostImports.capabilityRequest) : deniedCapabilityClient(name, descriptor);
  }
  return clients;
}

function deniedCapabilityClient(name: string, descriptor: CapabilityDescriptor): CapabilityClient {
  const request = async () => {
    throw new Error(`Capability ${name} is declared but live capability execution is not implemented by this runtime host.`);
  };
  return {
    descriptor,
    get: request,
    post: request,
    put: request,
    delete: request,
  };
}

function hostCapabilityClient(name: string, descriptor: CapabilityDescriptor, reconcileId: string, capabilityRequest: CapabilityRequestImport): CapabilityClient {
  const request = async (method: CapabilityRequestPayload['method'], path: string, bodyOrOptions?: unknown, maybeOptions?: CapabilityRequestPayload['options']) => {
    const options = method === 'GET' || method === 'DELETE'
      // typecast: GET/DELETE use the third public argument slot for CapabilityRequestOptions rather than a body.
      ? bodyOrOptions as CapabilityRequestPayload['options']
      : maybeOptions;
    if (requiresIdempotencyKey(descriptor, method) && !options?.idempotencyKey?.trim()) {
      throw new Error(`Capability ${name} ${method} ${path} requires options.idempotencyKey for retry-safe external effects.`);
    }
    const payloadBase = {
      capabilityName: name,
      method,
      path,
      reconcileId,
    };
    const payload: CapabilityRequestPayload = method === 'GET' || method === 'DELETE'
      // typecast: GET/DELETE third argument is the public CapabilityRequestOptions bag; JSON validation happens at the host boundary.
      ? compactCapabilityRequest({ ...payloadBase, options })
      // typecast: mutation bodies are constrained by the public CapabilityPayload type at call sites and serialized through the runtime contract.
      : compactCapabilityRequest({ ...payloadBase, body: bodyOrOptions as CapabilityPayload, options });
    const response = decodeCapabilityImportResult(capabilityRequest(JSON.stringify(payload)));
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.value;
  };
  return {
    descriptor,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    delete: (path, options) => request('DELETE', path, options),
  };
}

function requiresIdempotencyKey(descriptor: CapabilityDescriptor, method: CapabilityRequestPayload['method']): boolean {
  return method !== 'GET'
    && (descriptor.policy?.idempotencyKeyRequired === true
      || descriptor.execution?.idempotency.requiredForMutations === true);
}

function decodeCapabilityImportResult(result: CapabilityImportResult): CapabilityResponsePayload {
  if (typeof result === 'string') {
    return parseCapabilityResponse(result);
  }
  if ('tag' in result) {
    if (result.tag === 'err') {
      return { ok: false, error: { code: 'CAPABILITY_DENIED', message: result.val, severity: 'error', context: {} } };
    }
    return parseCapabilityResponse(result.val);
  }
  if (result.ok) {
    return parseCapabilityResponse(result.value);
  }
  return { ok: false, error: { code: 'CAPABILITY_DENIED', message: result.error, severity: 'error', context: {} } };
}

function parseCapabilityResponse(responseJson: string): CapabilityResponsePayload {
  // typecast: host responses cross the WIT boundary as JSON strings and are validated structurally below before use.
  const parsed = JSON.parse(responseJson) as CapabilityResponsePayload;
  if (parsed.ok === true && Object.hasOwn(parsed, 'value')) {
    return parsed;
  }
  if (parsed.ok === false && parsed.error && typeof parsed.error === 'object') {
    return parsed;
  }
  return { ok: false, error: { code: 'CAPABILITY_DENIED', message: 'Capability host returned an invalid response payload.', severity: 'error', context: {} } };
}

function compactCapabilityRequest(request: Readonly<Record<string, unknown>>): CapabilityRequestPayload {
  // typecast: removing undefined optional fields preserves the runtime capability request schema while satisfying exactOptionalPropertyTypes.
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as unknown as CapabilityRequestPayload;
}

function createReadClients(resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, reconcileId: string, kubernetesRead: KubernetesReadImport | undefined) {
  const clients: Record<string, unknown> = {};
  const readFor = <TSpec extends object, TStatus extends object>(resource: Pick<ResourceDefinition<TSpec, TStatus>, 'apiVersion' | 'kind' | 'plural' | 'scope'>) => readClient(resource, reconcileId, kubernetesRead);
  Object.defineProperty(clients, 'resource', {
    value: readFor,
    enumerable: false,
  });
  Object.defineProperty(clients, 'kind', {
    value: <TSpec extends object, TStatus extends object>(kindOrAlias: string) => {
      const client = clients[kindOrAlias];
      if (!client) {
        throw new Error(`Unknown typed read resource kind or alias: ${kindOrAlias}`);
      }
      // typecast: clients are registered from operator resources; callers supply the compile-time spec/status they expect for the selected kind or alias.
      return client as ResourceReadClient<TSpec, TStatus>;
    },
    enumerable: false,
  });
  for (const [alias, resource] of Object.entries(resources)) {
    // typecast: resource registry entries are normalized AnyResourceDefinition values, and readFor only needs the structural ResourceDefinition fields.
    clients[alias] = readFor(resource as ResourceDefinition<object, object>);
    clients[resource.kind] = clients[alias];
    clients[uncapitalize(resource.kind)] = clients[alias];
  }
  return clients;
}

function readClient<TSpec extends object, TStatus extends object>(resource: Pick<ResourceDefinition<TSpec, TStatus>, 'apiVersion' | 'kind' | 'plural' | 'scope'>, reconcileId: string, kubernetesRead: KubernetesReadImport | undefined) {
  const request = async (operation: 'get' | 'list', query: ResourceGetQuery | ResourceReadQuery | undefined) => {
    if (!kubernetesRead) {
      throw new Error('Typed Kubernetes reads require the kubernetes-read host import, but this runtime did not provide it.');
    }
    const response = decodeCapabilityImportResult(kubernetesRead(JSON.stringify({
      operation,
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      plural: resource.plural,
      scope: resource.scope,
      query: query ?? {},
      reconcileId,
    })));
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    return response.value;
  };
  return {
    async get(query: ResourceGetQuery) {
      const value = await request('get', query);
      if (value === null || value === undefined) {
        return undefined;
      }
      // typecast: kubernetes-read returns JSON for the requested resource; toResourceObject validates Kubernetes object shape before exposing typed spec/status.
      return toResourceObject(value as AnyKubernetesObject) as ResourceObject<TSpec, TStatus>;
    },
    async list(query?: ResourceReadQuery) {
      const value = await request('list', query);
      if (!value || typeof value !== 'object' || !Array.isArray(Reflect.get(value, 'items'))) {
        throw new Error('kubernetes-read host returned an invalid list response.');
      }
      // typecast: Array.isArray above proves the reflected items field is an array before iterating it.
      const items = Reflect.get(value, 'items') as unknown[];
      const continueToken = Reflect.get(value, 'continueToken');
      return {
        // typecast: each list item came from the requested Kubernetes resource; toResourceObject validates object shape before typed spec/status exposure.
        items: items.map((item) => toResourceObject(item as AnyKubernetesObject) as ResourceObject<TSpec, TStatus>),
        ...(typeof continueToken === 'string' && continueToken.length > 0 ? { continueToken } : {}),
      };
    },
  };
}

interface Recorder<TSpec extends object = object, TStatus extends object = object> {
  readonly scope: HandlerProxyScope<TSpec, TStatus>;
  result(): HandlerResult<TStatus>;
}

interface RecorderOptions {
  readonly event: HandlerEventType;
  readonly reconcileId: string;
  readonly capabilities: CapabilityClientSet;
  readonly resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>;
  readonly kubernetesRead?: KubernetesReadImport;
}

function createRecorder<TSpec extends object, TStatus extends object>(object: ResourceObject<TSpec, TStatus>, options: RecorderOptions): Recorder<TSpec, TStatus> {
  const apply: ApplyOperationInput[] = [];
  const patch: Operation[] = [];
  const deletes: DeleteOperationInput[] = [];
  const events: EventOperation[] = [];
  const finalizers: FinalizerOperation[] = [];
  let requeue: RequeuePolicy | undefined;
  // typecast: an absent Kubernetes status is represented as an empty draft for the resource-specific status type.
  const status = cloneJson((object.status ?? {}) as TStatus);
  let statusSnapshot = JSON.stringify(status);

  const k8s = {
    Job: (config: KubernetesFactoryConfig) => kubernetesFactory('batch/v1', 'Job', config),
    Deployment: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'Deployment', config),
    Service: (config: KubernetesFactoryConfig) => kubernetesFactory('v1', 'Service', config),
    ConfigMap: (config: ConfigMapFactoryConfig) => configMapFactory(config),
    StatefulSet: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'StatefulSet', config),
  };
  const read = createReadClients(options.resources, options.reconcileId, options.kubernetesRead);

  // typecast: the literal object implements the overloaded HandlerProxyScope surface used by generated dispatcher calls.
  const scope = {
    object,
    spec: object.spec,
    metadata: object.metadata,
    event: options.event,
    reconcileId: options.reconcileId,
    capabilities: options.capabilities,
    read,
    names: {
      dnsSafe(input: string, nameOptions?: { readonly maxLength?: number }) {
        return input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, nameOptions?.maxLength ?? 63);
      },
      withHash(prefix: string, input: string, nameOptions?: { readonly maxLength?: number; readonly collisionSuffixLength?: number }) {
        return this.dnsSafe(`${prefix}-${stableHash(input).slice(0, nameOptions?.collisionSuffixLength ?? 8)}`, nameOptions);
      },
    },
    k8s,
    batch: k8s,
    status,
    resources: {
      apply(resource: AnyKubernetesObject, options?: ApplyTargetOptions) {
        apply.push(applyInput(resource, options));
      },
      applyTarget(target: OperationTarget<TStatus> | ApplyTargetInput<TStatus>) {
        renderApplyTarget('target' in target ? target.target : target, 'options' in target ? target.options : undefined);
      },
      delete(ref: ObjectRef) {
        deletes.push(ref);
      },
      deleteTarget(target: OperationTarget<TStatus> | DeleteTargetInput<TStatus>) {
        renderDeleteTarget('target' in target ? target.target : target, 'options' in target ? target.options : undefined);
      },
      patch(ref: ObjectRef, jsonPatch: JsonPatch) {
        patch.push({ kind: 'patch', ref, patch: jsonPatch });
      },
    },
    events: {
      record(event: EventOperation) {
        events.push(event);
      },
      normal(reason: string, message: string, regarding?: ObjectRef) {
        events.push({ kind: 'event', type: 'Normal', reason, message, ...(regarding ? { regarding } : {}) });
      },
      warning(reason: string, message: string, regarding?: ObjectRef) {
        events.push({ kind: 'event', type: 'Warning', reason, message, ...(regarding ? { regarding } : {}) });
      },
    },
    finalizers: {
      add(finalizer: string) {
        finalizers.push({ kind: 'finalizer', operation: 'add', finalizer });
      },
      remove(finalizer: string) {
        finalizers.push({ kind: 'finalizer', operation: 'remove', finalizer });
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
        apply.push(applyInput(value, isApplyTargetOptions(targetOptions) ? targetOptions : undefined));
        return;
      }
      if (isOperationTarget<TStatus>(value)) {
        renderApplyTarget(value, isApplyTargetOptions(targetOptions) ? targetOptions : undefined);
        return;
      }
      applyPlan(value);
    },
    applyGraph(application: Parameters<HandlerProxyScope<TSpec, TStatus>['applyGraph']>[0]) {
      const rendered = application.adapter.render(application.graph, application.spec);
      if (!rendered.ok) {
        throw new Error(rendered.error.message);
      }
      mergeNormalizedPlan(rendered.value.operations);
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
        deletes.push(isDeleteOptions(targetOptions) ? { kind: 'delete', ref, options: targetOptions } : ref);
        return;
      }
      deletes.push(isDeleteOptions(targetOptions) ? { kind: 'delete', ref: value, options: targetOptions } : value);
    },
    patch(ref: ObjectRef, jsonPatch: JsonPatch) {
      patch.push({ kind: 'patch', ref, patch: jsonPatch });
    },
    setStatus(resource: ResourceDefinition<object, object>, name: string, nextStatus: object, namespace?: string) {
      patch.push({ kind: 'status', ref: objectRef(resource.apiVersion, resource.kind, name, namespace), status: nextStatus });
    },
    recordEvent(event: EventOperation) {
      events.push(event);
    },
    requeue(policy: RequeuePolicy) {
      requeue = policy;
    },
    plan(target: OperationTarget<TStatus>, targetOptions?: PlanTargetOptions) {
      if (targetOptions?.dryRun) {
        const fastPath = precomputedDryRunOperations(target, targetOptions);
        if (fastPath) {
          return ok({ operations: fastPath });
        }
        return missingDryRunPlan<TStatus>();
      }
      const fastPath = precomputedApplyOperations(target, targetOptions);
      if (fastPath) {
        return ok({ operations: fastPath });
      }
      return target.adapter.renderApply(target, targetOptions);
    },
  } as unknown as HandlerProxyScope<TSpec, TStatus>;

  function renderApplyTarget(target: OperationTarget<TStatus>, targetOptions?: ApplyTargetOptions): void {
    const fastPath = precomputedApplyOperations(target, targetOptions);
    if (fastPath) {
      mergeNormalizedPlan(fastPath);
      return;
    }
    const rendered = target.adapter.renderApply(target, targetOptions);
    if (!rendered.ok) {
      throw new Error(rendered.error.message);
    }
    mergeNormalizedPlan(rendered.value.operations);
  }

  function renderDeleteTarget(target: OperationTarget<TStatus>, targetOptions?: DeleteTargetOptions): void {
    const fastPath = precomputedDeleteOperations(target, targetOptions);
    if (fastPath) {
      mergeNormalizedPlan(fastPath);
      return;
    }
    const rendered = target.adapter.renderDelete(target, targetOptions);
    if (!rendered.ok) {
      throw new Error(rendered.error.message);
    }
    mergeNormalizedPlan(rendered.value.operations);
  }

  function mergeNormalizedPlan(operations: readonly Operation<TStatus>[]): void {
    for (const operation of operations) {
      switch (operation.kind) {
        case 'apply':
          apply.push(operation);
          break;
        case 'patch':
        case 'status':
          // typecast: target-rendered status operations are runtime-valid normalized operations; the recorder stores them in the erased handler-result patch/status bucket.
          patch.push(operation as Operation);
          break;
        case 'delete':
          deletes.push(operation);
          break;
        case 'event':
          events.push(operation);
          break;
        case 'finalizer':
          finalizers.push(operation);
          break;
        case 'requeue':
          requeue = operation.policy;
          break;
      }
    }
  }

  function applyPlan(plan: OperationPlanInput<TStatus>): void {
    for (const resource of [...(plan.apply ?? []), ...(plan.resources ?? [])]) {
      apply.push(resource);
    }
    for (const operation of plan.patch ?? []) {
      patch.push(operation);
    }
    for (const ref of plan.delete ?? []) {
      deletes.push(ref);
    }
    for (const event of plan.events ?? []) {
      events.push(event);
    }
    for (const finalizer of plan.finalizers ?? []) {
      finalizers.push(finalizer);
    }
    if (plan.status) {
      Object.assign(status, plan.status);
    }
    if (plan.requeue) {
      requeue = plan.requeue;
    }
  }

  return {
    scope,
    result() {
      const result: MutableHandlerResult<TStatus> = {};
      if (apply.length > 0) {
        result.apply = apply;
      }
      if (patch.length > 0) {
        result.patch = patch.filter((operation): operation is Extract<Operation, { kind: 'patch' | 'status' }> => operation.kind === 'patch' || operation.kind === 'status');
      }
      if (deletes.length > 0) {
        result.delete = deletes;
      }
      if (JSON.stringify(status) !== statusSnapshot) {
        result.status = cloneJson(status);
        statusSnapshot = JSON.stringify(status);
      }
      if (events.length > 0) {
        result.events = events;
      }
      if (finalizers.length > 0) {
        result.finalizers = finalizers;
      }
      if (requeue) {
        result.requeue = requeue;
      }
      return result;
    },
  };
}

type MutableHandlerResult<TStatus extends object> = {
  apply?: NonNullable<HandlerResult<TStatus>['apply']>;
  patch?: NonNullable<HandlerResult<TStatus>['patch']>;
  delete?: NonNullable<HandlerResult<TStatus>['delete']>;
  status?: NonNullable<HandlerResult<TStatus>['status']>;
  events?: NonNullable<HandlerResult<TStatus>['events']>;
  finalizers?: NonNullable<HandlerResult<TStatus>['finalizers']>;
  requeue?: NonNullable<HandlerResult<TStatus>['requeue']>;
  diagnostics?: NonNullable<HandlerResult<TStatus>['diagnostics']>;
};

type FinalizerOperation = NonNullable<HandlerResult<object>['finalizers']>[number];

function createContext(recorder: Recorder, object: AnyKubernetesObject): HandlerContext<object, object> {
  const context = {
    object: toResourceObject(object),
    event: recorder.scope.event,
    reconcileId: recorder.scope.reconcileId,
    capabilities: recorder.scope.capabilities,
    read: recorder.scope.read,
    names: recorder.scope.names,
    k8s: recorder.scope.k8s,
    batch: recorder.scope.batch,
    apply(value: OperationPlanInput<object> | OperationTarget<object> | readonly OperationTarget<object>[] | AnyKubernetesObject, options?: ApplyTargetOptions | OperationPlanInput<object>) {
      // typecast: context apply forwards the same runtime overload set implemented by the recorder scope.
      const apply = recorder.scope.apply as (value: OperationPlanInput<object> | OperationTarget<object> | readonly OperationTarget<object>[] | AnyKubernetesObject, options?: ApplyTargetOptions | OperationPlanInput<object>) => void;
      apply(value, options);
      return ok(recorder.result());
    },
    applyGraph(application: Parameters<HandlerContext<object, object>['applyGraph']>[0]) {
      const rendered = application.adapter.render(application.graph, application.spec);
      if (!rendered.ok) {
        return err(rendered.error.code, rendered.error.message);
      }
      // typecast: context handlers are erased to object status at dispatch time; the proxy scope applies the same graph adapter contract for normalized operation merging.
      const applyGraph = recorder.scope.applyGraph as (application: Parameters<HandlerContext<object, object>['applyGraph']>[0]) => void;
      applyGraph(application);
      return ok(recorder.result());
    },
    plan(target: OperationTarget<object>, options?: PlanTargetOptions) {
      if (options?.dryRun) {
        const fastPath = precomputedDryRunOperations(target, options);
        if (fastPath) {
          return ok({ operations: fastPath });
        }
        return missingDryRunPlan<object>();
      }
      const fastPath = precomputedApplyOperations(target, options);
      if (fastPath) {
        return ok({ operations: fastPath });
      }
      return target.adapter.renderApply(target, options);
    },
    status(status: object) {
      return { kind: 'status', status };
    },
    patch(ref: ObjectRef, jsonPatch: JsonPatch) {
      return { kind: 'patch', ref, patch: jsonPatch };
    },
    delete(value: ObjectRef | OperationTarget<object> | readonly OperationTarget<object>[] | AnyKubernetesObject, options?: DeleteOptions | DeleteTargetOptions | OperationPlanInput<object>) {
      if (isOperationTarget<object>(value)) {
        // typecast: this branch has narrowed to the operation-target delete overload implemented by the recorder scope.
        const deleteTarget = recorder.scope.delete as (value: OperationTarget<object>, options?: DeleteTargetOptions | OperationPlanInput<object>) => void;
        deleteTarget(value, isDeleteTargetOptions(options) || isOperationPlan(options) ? options : undefined);
        return ok(recorder.result());
      }
      if (Array.isArray(value)) {
        // typecast: this branch has narrowed to the operation-target array delete overload implemented by the recorder scope.
        const deleteTarget = recorder.scope.delete as (value: OperationTarget<object> | readonly OperationTarget<object>[], options?: DeleteTargetOptions | OperationPlanInput<object>) => void;
        deleteTarget(value, isDeleteTargetOptions(options) || isOperationPlan(options) ? options : undefined);
        return ok(recorder.result());
      }
      if (isKubernetesObject(value)) {
        const ref = objectRef(value.apiVersion, value.kind, value.metadata.name, value.metadata.namespace);
        recorder.scope.delete(ref, isDeleteOptions(options) ? options : undefined);
        return { kind: 'delete', ref, ...(isDeleteOptions(options) ? { options } : {}) };
      }
      // typecast: operation targets and target arrays have returned above, so the remaining overload branch is an ObjectRef delete.
      const ref = value as ObjectRef;
      recorder.scope.delete(ref, isDeleteOptions(options) ? options : undefined);
      return { kind: 'delete', ref, ...(isDeleteOptions(options) ? { options } : {}) };
    },
    recordEvent(event: EventOperation) {
      return event;
    },
    requeue(policy: RequeuePolicy) {
      return { kind: 'requeue', policy };
    },
    noop() {
      return ok({});
    },
  };
  // typecast: the dispatcher context implements the runtime-compatible subset of HandlerContext overloads.
  return context as unknown as HandlerContext<object, object>;
}

function normalizeReturnedHandlerResult(value: unknown): Result<HandlerResult | undefined> {
  if (isPromiseLike(value)) {
    return err('HANDLER_OUTPUT_INVALID', 'Handler returned a Promise; async handlers are not supported by the wasm component dispatcher in v0.1.');
  }
  if (value === undefined) {
    return ok(undefined);
  }
  if (isResult(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    // typecast: normalizeHandlerResult validates the returned structural handler result into a normalized operation plan.
    return ok(value as HandlerResult);
  }
  return err('HANDLER_OUTPUT_INVALID', 'Handler returned a non-object value.');
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  // typecast: promise detection only needs to inspect an optional then property on an unknown object/function.
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { readonly then?: unknown }).then === 'function');
}

function normalizeHandlerResult(result: HandlerResult): NormalizedOperationPlan {
  const operations: Operation[] = [];
  const finalizers = splitFinalizers(result.finalizers);
  operations.push(...finalizers.add);
  for (const resource of result.apply ?? []) {
    operations.push(isApplyOperation(resource) ? resource : { kind: 'apply', resource });
  }
  for (const operation of result.patch ?? []) {
    operations.push(operation);
  }
  for (const input of result.delete ?? []) {
    operations.push(isDeleteOperation(input) ? input : { kind: 'delete', ref: input });
  }
  if (result.status) {
    operations.push({ kind: 'status', status: result.status });
  }
  for (const event of result.events ?? []) {
    operations.push(event);
  }
  operations.push(...finalizers.remove);
  if (result.requeue) {
    operations.push({ kind: 'requeue', policy: result.requeue });
  }
  return result.diagnostics ? { operations, diagnostics: result.diagnostics } : { operations };
}

function splitFinalizers(finalizers: readonly FinalizerOperationSpec[] | undefined): { add: FinalizerOperationSpec[]; remove: FinalizerOperationSpec[] } {
  const add: FinalizerOperationSpec[] = [];
  const remove: FinalizerOperationSpec[] = [];
  for (const finalizer of finalizers ?? []) {
    if (finalizer.operation === 'add') {
      add.push(finalizer);
    } else {
      remove.push(finalizer);
    }
  }
  return { add, remove };
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

function mergeHandlerResults<TStatus extends object>(recorded: HandlerResult<TStatus>, explicit: HandlerResult<TStatus> | undefined): HandlerResult<TStatus> {
  if (!explicit) {
    return recorded;
  }
  const status = mergeStatus(recorded.status, explicit.status);
  // typecast: malformed explicit status values must remain in the runtime payload so the Rust bridge can fail closed before Kubernetes effects.
  const mergedStatus = status as TStatus;
  return {
    ...(recorded.apply || explicit.apply ? { apply: [...(recorded.apply ?? []), ...(explicit.apply ?? [])] } : {}),
    ...(recorded.patch || explicit.patch ? { patch: [...(recorded.patch ?? []), ...(explicit.patch ?? [])] } : {}),
    ...(recorded.delete || explicit.delete ? { delete: [...(recorded.delete ?? []), ...(explicit.delete ?? [])] } : {}),
    ...(status !== undefined && (!isObjectRecord(status) || Object.keys(status).length > 0) ? { status: mergedStatus } : {}),
    ...(recorded.events || explicit.events ? { events: [...(recorded.events ?? []), ...(explicit.events ?? [])] } : {}),
    ...(recorded.finalizers || explicit.finalizers ? { finalizers: [...(recorded.finalizers ?? []), ...(explicit.finalizers ?? [])] } : {}),
    ...(explicit.requeue ?? recorded.requeue ? { requeue: explicit.requeue ?? recorded.requeue } : {}),
    ...(recorded.diagnostics || explicit.diagnostics ? { diagnostics: [...(recorded.diagnostics ?? []), ...(explicit.diagnostics ?? [])] } : {}),
  };
}

function mergeStatus(recorded: unknown, explicit: unknown): unknown {
  if (recorded === undefined) {
    return explicit;
  }
  if (explicit === undefined) {
    return recorded;
  }
  if (isObjectRecord(recorded) && isObjectRecord(explicit)) {
    return { ...recorded, ...explicit };
  }
  return explicit;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function kubernetesFactory(apiVersion: string, kind: string, config: KubernetesFactoryConfig): AnyKubernetesObject {
  return {
    apiVersion,
    kind,
    metadata: {
      name: config.name,
      ...(config.namespace ? { namespace: config.namespace } : {}),
      ...(config.labels ? { labels: config.labels } : {}),
      ...(config.annotations ? { annotations: config.annotations } : {}),
    },
    spec: {
      ...(config.spec ?? {}),
      ...(config.image ? { image: config.image } : {}),
      ...(config.env ? { env: config.env } : {}),
    },
  };
}

function configMapFactory(config: ConfigMapFactoryConfig): AnyKubernetesObject & { readonly data?: Readonly<Record<string, string>>; readonly binaryData?: Readonly<Record<string, string>>; readonly immutable?: boolean } {
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

function toResourceObject(object: AnyKubernetesObject): AnyKubernetesObject & { readonly spec: object } {
  return { ...object, spec: object.spec ?? {} };
}

function objectRef(apiVersion: string, kind: string, name: string, namespace?: string): ObjectRef {
  return { apiVersion, kind, name, ...(namespace ? { namespace } : {}) };
}

function isKubernetesObject(value: unknown): value is AnyKubernetesObject {
  return Boolean(value && typeof value === 'object' && 'apiVersion' in value && 'kind' in value && 'metadata' in value);
}

function isOperationTarget<TStatus extends object>(value: unknown): value is OperationTarget<TStatus> {
  // typecast: operation targets use a private structural discriminant at the handler boundary.
  return Boolean(value && typeof value === 'object' && (value as { readonly targetKind?: unknown }).targetKind === 'operationTarget');
}

function precomputedApplyOperations<TStatus extends object>(target: OperationTarget<TStatus>, options?: ApplyTargetOptions): Operation<TStatus>[] | undefined {
  const operations = target.operationTargetArtifacts?.applyPlan.operations;
  if (!operations) {
    return undefined;
  }
  return operations.map((operation) => operation.kind === 'apply'
    // typecast: artifact apply operations are valid normalized operations for any handler status type.
    ? applyInput(operation.resource, options) as Operation<TStatus>
    : operation);
}

function precomputedDeleteOperations<TStatus extends object>(target: OperationTarget<TStatus>, options?: DeleteTargetOptions): Operation<TStatus>[] | undefined {
  const operations = target.operationTargetArtifacts?.deletePlan.operations;
  if (!operations) {
    return undefined;
  }
  return operations.map((operation) => {
    if (operation.kind !== 'delete') {
      return operation;
    }
    const next: { kind: 'delete'; ref: ObjectRef; options?: DeleteOptions } = { kind: 'delete', ref: operation.ref };
    if (options?.propagationPolicy || options?.gracePeriodSeconds !== undefined) {
      next.options = {
        ...(options.propagationPolicy ? { propagationPolicy: options.propagationPolicy } : {}),
        ...(options.gracePeriodSeconds !== undefined ? { gracePeriodSeconds: options.gracePeriodSeconds } : {}),
      };
    } else if (operation.options) {
      next.options = operation.options;
    }
    // typecast: artifact delete operations are valid normalized operations for any handler status type.
    return next as Operation<TStatus>;
  });
}

function precomputedDryRunOperations<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Operation<TStatus>[] | undefined {
  const operations = target.operationTargetArtifacts?.dryRunPlan?.operations;
  if (!operations) {
    return undefined;
  }
  return operations.map((operation) => operation.kind === 'apply'
    // typecast: artifact dry-run apply operations are valid normalized operations for any handler status type.
    ? applyInput(operation.resource, options) as Operation<TStatus>
    : operation);
}

function missingDryRunPlan<TStatus extends object>(): Result<NormalizedOperationPlan<TStatus>> {
  return err('MANIFEST_INVALID', 'Operation target dry-run artifact is missing; dry-run planning fails closed.');
}

function isReadonlyArray<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

function isOperationPlan<TStatus extends object>(value: unknown): value is OperationPlanInput<TStatus> {
  return Boolean(value && typeof value === 'object' && ('status' in value || 'requeue' in value || 'apply' in value || 'delete' in value));
}

function isApplyTargetOptions<TStatus extends object>(value: ApplyTargetOptions | OperationPlanInput<TStatus> | undefined): value is ApplyTargetOptions {
  return Boolean(value && typeof value === 'object' && ('fieldManager' in value || 'force' in value || 'owner' in value || 'ownership' in value));
}

function isDeleteOptions(value: DeleteOptions | DeleteTargetOptions | OperationPlanInput<object> | undefined): value is DeleteOptions {
  return Boolean(value && typeof value === 'object' && !isOperationPlan(value) && ('propagationPolicy' in value || 'gracePeriodSeconds' in value));
}

function isDeleteTargetOptions<TStatus extends object>(value: DeleteOptions | DeleteTargetOptions | OperationPlanInput<TStatus> | undefined): value is DeleteTargetOptions {
  return Boolean(value && typeof value === 'object' && !isOperationPlan(value) && ('owner' in value || 'propagationPolicy' in value || 'gracePeriodSeconds' in value));
}

function isResult(value: unknown): value is Result<HandlerResult | undefined> {
  return Boolean(value && typeof value === 'object' && 'ok' in value);
}

function stableHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function uncapitalize(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function cloneJson<T>(value: T): T {
  // typecast: JSON parse/stringify returns the same JSON-compatible shape for runtime payloads used by applik8s handlers.
  return JSON.parse(JSON.stringify(value)) as T;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T = never>(code: Applik8sErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
