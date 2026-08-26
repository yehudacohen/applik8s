// typecast-file-boundary: untrusted host requests, normalized schemas, and heterogeneous handler registrations are validated before restoring authored handler generics.
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
  OperatorDefinition,
  PatchTargetOptions,
  PlanTargetOptions,
  RemoteApplyTargetOptions,
  RemoteDeleteTargetOptions,
  RemotePatchTargetOptions,
  RequeuePolicy,
  ResourceDefinition,
  ResourceGetQuery,
  ResourceObject,
  ResourceReadClient,
  ResourceReadQuery,
  Result,
  TrackableExecutionRun,
  TrackExecutionOptions,
  TrackedExecutionObservation,
} from '@applik8s/core';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core/canonical-json';
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
  const descriptors = input.capabilities ?? operator.capabilities ?? {};
  const invocation = await invokeRunnableHandler(registration, input.object, input.event, reconcileId, capabilityClients(descriptors, reconcileId, hostImports), descriptors, { ...operator.resources, ...(operator.reads ?? {}) }, hostImports.kubernetesRead, input.runtime);
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
  const descriptors = input.capabilities ?? operator.capabilities ?? {};
  const invocation = invokeRunnableHandlerSync(registration, input.object, input.event, reconcileId, capabilityClients(descriptors, reconcileId, hostImports), descriptors, { ...operator.resources, ...(operator.reads ?? {}) }, hostImports.kubernetesRead, input.runtime);
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
  readonly runtime?: {
    readonly operatorName?: string;
    readonly reconcileId?: string;
    readonly identityEnvelope?: {
      readonly apiVersion?: string;
      readonly application?: string;
      readonly operation?: string;
      readonly execution?: string;
      readonly attempt?: string;
      readonly causalPrincipalId?: string;
      readonly telemetry?: {
        readonly version?: string;
        readonly traceparent?: string;
        readonly tracestate?: string;
        readonly identity?: { readonly attempt?: number };
      };
    };
  };
}

interface InvocationResult {
  readonly result: HandlerResult;
  readonly plan: NormalizedOperationPlan;
}

async function invokeRunnableHandler(registration: RunnableHandlerRegistration, object: AnyKubernetesObject, event: HandlerEventType, reconcileId: string, capabilities: CapabilityClientSet, capabilityDescriptors: Readonly<Record<string, CapabilityDescriptor>>, resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, kubernetesRead?: KubernetesReadImport, runtime?: HandlerInputPayload['runtime']): Promise<Result<InvocationResult>> {
  const recorder = createRecorder(toResourceObject(object), { event, reconcileId, capabilities, capabilityDescriptors, resources, ...(kubernetesRead ? { kubernetesRead } : {}) });
  const restoreWorkflowRuntime = installWorkflowGatewayRuntime(capabilities, object, event, runtime);
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
  } finally {
    restoreWorkflowRuntime();
  }
}

function invokeRunnableHandlerSync(registration: RunnableHandlerRegistration, object: AnyKubernetesObject, event: HandlerEventType, reconcileId: string, capabilities: CapabilityClientSet, capabilityDescriptors: Readonly<Record<string, CapabilityDescriptor>>, resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, kubernetesRead?: KubernetesReadImport, runtime?: HandlerInputPayload['runtime']): Result<InvocationResult> {
  const recorder = createRecorder(toResourceObject(object), { event, reconcileId, capabilities, capabilityDescriptors, resources, ...(kubernetesRead ? { kubernetesRead } : {}) });
  const restoreWorkflowRuntime = installWorkflowGatewayRuntime(capabilities, object, event, runtime);
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
  } finally {
    restoreWorkflowRuntime();
  }
}

const applicationWorkflowRuntimeResolverSymbol = Symbol.for(
  'applik8s.workflowRuntimeResolver',
);

interface WorkflowGatewayReference {
  readonly id: string;
  readonly admittedAt: string;
}

interface WorkflowGatewayObservation {
  readonly phase: 'Admitted' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled' | 'TimedOut';
  readonly progress?: unknown;
  readonly result?: object;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
  readonly admittedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

interface WorkflowGatewayResultOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

function installWorkflowGatewayRuntime(
  capabilities: CapabilityClientSet,
  object: AnyKubernetesObject,
  event: HandlerEventType,
  runtime: HandlerInputPayload['runtime'],
): () => void {
  const gatewayRuntime = workflowGatewayRuntime(capabilities, object, event, runtime);
  if (!gatewayRuntime) return () => undefined;
  const previous = Reflect.get(globalThis, applicationWorkflowRuntimeResolverSymbol);
  Reflect.set(globalThis, applicationWorkflowRuntimeResolverSymbol, () => gatewayRuntime);
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, applicationWorkflowRuntimeResolverSymbol);
    } else {
      Reflect.set(globalThis, applicationWorkflowRuntimeResolverSymbol, previous);
    }
  };
}

function workflowGatewayRuntime(
  capabilities: CapabilityClientSet,
  object: AnyKubernetesObject,
  event: HandlerEventType,
  runtime: HandlerInputPayload['runtime'],
) {
  const contracts = new Map<string, CapabilityClient>();
  for (const capability of Object.values(capabilities)) {
    const gateway = capability.descriptor.workflowGateway;
    if (gateway?.protocol !== 'applik8s.workflow-gateway/v1alpha1') continue;
    for (const contract of gateway.contracts) {
      const existing = contracts.get(contract);
      if (existing && existing !== capability) {
        throw new Error(
          `Workflow contract ${contract} is exposed by more than one generated workflow gateway.`,
        );
      }
      contracts.set(contract, capability);
    }
  }
  if (contracts.size === 0) return undefined;
  const capabilityFor = (contract: string): CapabilityClient => {
    const capability = contracts.get(contract);
    if (!capability) {
      throw new Error(
        `Workflow ${contract} is not declared in this operator's generated workflow gateway authority.`,
      );
    }
    return capability;
  };
  const observe = async (
    contract: string,
    id: string,
    admittedAt: string,
    options: WorkflowGatewayResultOptions = {},
  ): Promise<WorkflowGatewayObservation> => {
    throwIfWorkflowGatewayAborted(options.signal, id);
    const capability = capabilityFor(contract);
    const value = await capability.get(
      `/v1/workflows/${encodeURIComponent(contract)}/runs/${encodeURIComponent(id)}?admittedAt=${encodeURIComponent(admittedAt)}`,
      { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
    );
    return workflowGatewayObservation(value, id);
  };
  const start = async (
    contract: string,
    input: object,
    metadata?: object,
  ) => {
    const capability = capabilityFor(contract);
    const idempotencyKey = typeof Reflect.get(metadata ?? {}, 'idempotencyKey') === 'string'
      ? String(Reflect.get(metadata ?? {}, 'idempotencyKey'))
      : undefined;
    if (!idempotencyKey) {
      throw new Error(
        `Workflow ${contract}.start(...) from a resource handler requires metadata.idempotencyKey so retries adopt the same durable run.`,
      );
    }
    const adopted = trackedWorkflowGatewayReference(
      object,
      contract,
      idempotencyKey,
    );
    if (adopted) {
      return workflowGatewayProviderRun(
        contract,
        adopted,
        idempotencyKey,
        observe,
        capability,
      );
    }
    const value = await capability.post(
      `/v1/workflows/${encodeURIComponent(contract)}/runs`,
      {
        input,
        metadata,
        source: workflowGatewayReconcileSource(object, event, runtime),
      },
      { idempotencyKey },
    );
    const reference = workflowGatewayReference(value, contract);
    return workflowGatewayProviderRun(
      contract,
      reference,
      idempotencyKey,
      observe,
      capability,
    );
  };
  return {
    async run(contract: string, input: object, metadata?: object, options?: WorkflowGatewayResultOptions) {
      const run = await start(contract, input, metadata);
      return run.result(options);
    },
    start,
    async schedule(contract: string) {
      throw new Error(
        `Workflow ${contract}.schedule(...) is not available from a Kubernetes reconcile handler; declare its schedule in the application graph.`,
      );
    },
    async reconcileSchedule(contract: string) {
      throw new Error(
        `Workflow ${contract}.reconcile(...) is not available from a Kubernetes reconcile handler; declare its schedule in the application graph.`,
      );
    },
    async signal(contract: string) {
      throw new Error(
        `Legacy workflow-run signals for ${contract} are not exposed through the resource tracking gateway; use typed signal events.`,
      );
    },
  };
}

function workflowGatewayReconcileSource(
  object: AnyKubernetesObject,
  event: HandlerEventType,
  runtime: HandlerInputPayload['runtime'],
) {
  const reconcileId = runtime?.reconcileId;
  if (!reconcileId?.trim()) {
    throw new Error('Private workflow admission requires the host-derived reconcile identity.');
  }
  return Object.freeze({
    protocol: 'applik8s.kubernetes-reconcile/v1alpha1',
    reconcileId,
    event,
    resource: Object.freeze({
      apiVersion: object.apiVersion,
      kind: object.kind,
      name: object.metadata.name,
      ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}),
      ...(object.metadata.uid ? { uid: object.metadata.uid } : {}),
      ...(object.metadata.generation !== undefined
        ? { generation: object.metadata.generation }
        : {}),
    }),
    ...(runtime?.operatorName ? { operatorName: runtime.operatorName } : {}),
    ...(runtime?.identityEnvelope
      ? { identityEnvelope: Object.freeze({ ...runtime.identityEnvelope }) }
      : {}),
  });
}

function workflowGatewayProviderRun(
  contract: string,
  reference: WorkflowGatewayReference,
  idempotencyKey: string,
  observe: (
    contract: string,
    id: string,
    admittedAt: string,
    options?: WorkflowGatewayResultOptions,
  ) => Promise<WorkflowGatewayObservation>,
  capability: CapabilityClient,
) {
  return {
    id: reference.id,
    __idempotencyKey: idempotencyKey,
    result: (options?: WorkflowGatewayResultOptions) =>
      waitForWorkflowGatewayResult(
        () => observe(contract, reference.id, reference.admittedAt, options),
        reference.id,
        options,
      ),
    observe: (options?: WorkflowGatewayResultOptions) =>
      observe(contract, reference.id, reference.admittedAt, options),
    cancel: async (
      options?: Omit<WorkflowGatewayResultOptions, 'pollIntervalMs'>,
    ) => {
      throwIfWorkflowGatewayAborted(options?.signal, reference.id);
      await capability.delete(
        `/v1/workflows/${encodeURIComponent(contract)}/runs/${encodeURIComponent(reference.id)}`,
        {
          idempotencyKey: `cancel:${reference.id}`,
          ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        },
      );
    },
    __cancelReference: async (
      runId: string,
      options?: Omit<WorkflowGatewayResultOptions, 'pollIntervalMs'>,
    ) => {
      throwIfWorkflowGatewayAborted(options?.signal, runId);
      await capability.delete(
        `/v1/workflows/${encodeURIComponent(contract)}/runs/${encodeURIComponent(runId)}`,
        {
          idempotencyKey: `cancel:${runId}`,
          ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        },
      );
    },
  };
}

function trackedWorkflowGatewayReference(
  object: AnyKubernetesObject,
  contract: string,
  idempotencyKey: string,
): WorkflowGatewayReference | undefined {
  const framework = object.status && typeof object.status === 'object'
    ? Reflect.get(object.status, 'applik8s')
    : undefined;
  const records = framework && typeof framework === 'object'
    ? Reflect.get(framework, 'trackedExecutions')
    : undefined;
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    return undefined;
  }
  const matches = Object.values(records).filter((candidate) =>
    candidate
    && typeof candidate === 'object'
    && Reflect.get(candidate, 'resourceUid') === object.metadata.uid
    && Reflect.get(candidate, 'workflow') === contract
    && Reflect.get(candidate, 'idempotencyKey') === idempotencyKey
    && typeof Reflect.get(candidate, 'run') === 'string'
    && typeof Reflect.get(candidate, 'admittedAt') === 'string'
  );
  if (matches.length > 1) {
    throw new Error(
      `Workflow ${contract}.start(...) found multiple tracked runs for idempotency key ${JSON.stringify(idempotencyKey)}.`,
    );
  }
  const match = matches[0];
  return match
    ? {
        id: String(Reflect.get(match, 'run')),
        admittedAt: String(Reflect.get(match, 'admittedAt')),
      }
    : undefined;
}

function workflowGatewayReference(value: unknown, contract: string): WorkflowGatewayReference {
  if (!value || typeof value !== 'object') {
    throw new Error(`Workflow gateway returned an invalid start response for ${contract}.`);
  }
  const id = Reflect.get(value, 'id');
  const admittedAt = Reflect.get(value, 'admittedAt');
  if (typeof id !== 'string' || id.length === 0 || typeof admittedAt !== 'string') {
    throw new Error(`Workflow gateway returned an invalid start response for ${contract}.`);
  }
  return { id, admittedAt };
}

function workflowGatewayObservation(value: unknown, runId: string): WorkflowGatewayObservation {
  if (!value || typeof value !== 'object') {
    throw new Error(`Workflow gateway returned an invalid observation for ${runId}.`);
  }
  const phase = Reflect.get(value, 'phase');
  const admittedAt = Reflect.get(value, 'admittedAt');
  if (
    !new Set(['Admitted', 'Running', 'Succeeded', 'Failed', 'Cancelled', 'TimedOut']).has(String(phase))
    || typeof admittedAt !== 'string'
  ) {
    throw new Error(`Workflow gateway returned an invalid observation for ${runId}.`);
  }
  // typecast: phase and required timestamps are checked above; the private
  // gateway emits the remaining bounded JSON observation fields.
  return value as WorkflowGatewayObservation;
}

async function waitForWorkflowGatewayResult(
  read: () => Promise<WorkflowGatewayObservation>,
  runId: string,
  options: WorkflowGatewayResultOptions = {},
): Promise<object> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  while (true) {
    throwIfWorkflowGatewayAborted(options.signal, runId);
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out observing workflow run ${runId}.`);
    }
    const observation = await read();
    if (observation.phase === 'Succeeded') return observation.result ?? {};
    if (observation.phase === 'Failed') {
      throw new Error(observation.error?.message ?? `Workflow run ${runId} failed.`);
    }
    if (observation.phase === 'Cancelled' || observation.phase === 'TimedOut') {
      throw new Error(`Workflow run ${runId} ended in phase ${observation.phase}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function throwIfWorkflowGatewayAborted(signal: AbortSignal | undefined, runId: string): void {
  if (signal?.aborted) throw new Error(`Workflow observation for ${runId} was cancelled.`);
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

function createReadClients(resources: Readonly<Record<string, Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>>>, reconcileId: string, kubernetesRead: KubernetesReadImport | undefined, connection?: string) {
  const clients: Record<string, unknown> = {};
  const readFor = <TSpec extends object, TStatus extends object>(resource: Pick<ResourceDefinition<TSpec, TStatus>, 'apiVersion' | 'kind' | 'plural' | 'scope'>) => readClient(resource, reconcileId, kubernetesRead, connection);
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

function readClient<TSpec extends object, TStatus extends object>(resource: Pick<ResourceDefinition<TSpec, TStatus>, 'apiVersion' | 'kind' | 'plural' | 'scope'>, reconcileId: string, kubernetesRead: KubernetesReadImport | undefined, connection?: string) {
  const request = async (operation: 'get' | 'list', query: ResourceGetQuery | ResourceReadQuery | undefined) => {
    if (!kubernetesRead) {
      throw new Error('Typed Kubernetes reads require the kubernetes-read host import, but this runtime did not provide it.');
    }
    if (connection && operation === 'list') {
      const limit = query && 'limit' in query ? query.limit : undefined;
      if (!Number.isInteger(limit) || (limit ?? 0) < 1 || (limit ?? 0) > 500) {
        throw new Error('Connection-scoped Kubernetes list requires limit between 1 and 500 for bounded pagination.');
      }
    }
    const response = decodeCapabilityImportResult(kubernetesRead(JSON.stringify({
      ...(connection ? { protocol: 'applik8s.kubernetes-connection/v1alpha1', connection } : {}),
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
  readonly capabilityDescriptors: Readonly<Record<string, CapabilityDescriptor>>;
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
  let statusSnapshot = canonicalJsonV1String(
    status,
    canonicalJsonCompatibleV1Policy,
  );

  const k8s = {
    Job: (config: KubernetesFactoryConfig) => kubernetesFactory('batch/v1', 'Job', config),
    Deployment: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'Deployment', config),
    Service: (config: KubernetesFactoryConfig) => kubernetesFactory('v1', 'Service', config),
    ConfigMap: (config: ConfigMapFactoryConfig) => configMapFactory(config),
    StatefulSet: (config: KubernetesFactoryConfig) => kubernetesFactory('apps/v1', 'StatefulSet', config),
  };
  const read = createReadClients(options.resources, options.reconcileId, options.kubernetesRead);
  const connection = (name: string) => {
    const descriptor = options.capabilityDescriptors[name];
    if (descriptor?.kind !== 'kubernetes' || descriptor.execution?.protocol !== 'applik8s.kubernetes-connection/v1alpha1') {
      throw new Error(`Kubernetes connection ${name} is not declared by this operator.`);
    }
    return {
      name,
      read: createReadClients(options.resources, options.reconcileId, options.kubernetesRead, name),
      resources: {
        apply(resource: AnyKubernetesObject, connectionOptions: RemoteApplyTargetOptions) {
          apply.push(remoteApplyInput(resource, name, connectionOptions));
        },
        patch(ref: ObjectRef, jsonPatch: JsonPatch, connectionOptions: RemotePatchTargetOptions) {
          patch.push({ kind: 'patch', ref, patch: jsonPatch, connection: name, authority: connectionOptions.authority });
        },
        delete(ref: ObjectRef, connectionOptions: RemoteDeleteTargetOptions) {
          deletes.push(remoteDeleteInput(ref, name, connectionOptions));
        },
      },
    };
  };

  // typecast: the literal object implements the overloaded HandlerProxyScope surface used by generated dispatcher calls.
  const scope = {
    object,
    spec: object.spec,
    metadata: object.metadata,
    event: options.event,
    reconcileId: options.reconcileId,
    capabilities: options.capabilities,
    read,
    kubernetes: { connection },
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
      delete(ref: ObjectRef, options?: DeleteTargetOptions) {
        deletes.push(deleteInput(ref, options));
      },
      deleteTarget(target: OperationTarget<TStatus> | DeleteTargetInput<TStatus>) {
        renderDeleteTarget('target' in target ? target.target : target, 'options' in target ? target.options : undefined);
      },
      patch(ref: ObjectRef, jsonPatch: JsonPatch, _options?: PatchTargetOptions) {
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
    async track<TResult extends object, TProgress = unknown>(
      key: string,
      run: TrackableExecutionRun<TResult, TProgress>,
      trackOptions: TrackExecutionOptions = {},
    ): Promise<TrackedExecutionObservation<TResult, TProgress>> {
      return trackExecution({
        key,
        run,
        options: trackOptions,
        object,
        status,
        finalizers,
        events,
        setRequeue(policy) {
          requeue = policy;
        },
      });
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
        deletes.push(deleteInput(ref, isDeleteTargetOptions(targetOptions) ? targetOptions : undefined));
        return;
      }
      deletes.push(deleteInput(value, isDeleteTargetOptions(targetOptions) ? targetOptions : undefined));
    },
    patch(ref: ObjectRef, jsonPatch: JsonPatch, _options?: PatchTargetOptions) {
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
      if (
        canonicalJsonV1String(status, canonicalJsonCompatibleV1Policy)
        !== statusSnapshot
      ) {
        result.status = cloneJson(status);
        statusSnapshot = canonicalJsonV1String(
          status,
          canonicalJsonCompatibleV1Policy,
        );
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

const maximumTrackedResultBytes = 32 * 1_024;
const maximumTrackedProgressBytes = 8 * 1_024;

interface PersistedTrackedExecution {
  readonly resourceUid: string;
  readonly resourceGeneration: number;
  readonly workflow: string;
  readonly workflowRevision: string;
  readonly run: string;
  readonly idempotencyKey?: string;
  readonly phase: TrackedExecutionObservation<object>['phase'];
  readonly admittedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly progress?: unknown;
  readonly result?: object;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly onGenerationChange: 'supersede' | 'cancel';
  readonly onDelete:
    | { readonly action: 'detach' }
    | {
        readonly action: 'cancel';
        readonly timeoutMs: number;
        readonly onTimeout: 'detach' | 'block';
      };
  readonly cancellationRequestedAt?: string;
  readonly detached?: boolean;
  readonly superseded?: {
    readonly resourceGeneration: number;
    readonly workflow: string;
    readonly workflowRevision: string;
    readonly run: string;
    readonly phase: TrackedExecutionObservation<object>['phase'];
    readonly supersededAt: string;
    readonly cancellationRequested: boolean;
  };
}

async function trackExecution<
  TSpec extends object,
  TStatus extends object,
  TResult extends object,
  TProgress,
>(input: {
  readonly key: string;
  readonly run: TrackableExecutionRun<TResult, TProgress>;
  readonly options: TrackExecutionOptions;
  readonly object: ResourceObject<TSpec, TStatus>;
  readonly status: TStatus;
  readonly finalizers: FinalizerOperation[];
  readonly events: EventOperation[];
  readonly setRequeue: (policy: RequeuePolicy) => void;
}): Promise<TrackedExecutionObservation<TResult, TProgress>> {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(input.key)) {
    throw new Error(
      `job.track(...) key ${JSON.stringify(input.key)} must be a lowercase DNS label.`,
    );
  }
  const uid = input.object.metadata.uid;
  const generation = input.object.metadata.generation;
  if (
    typeof uid !== 'string'
    || uid.length === 0
    || !Number.isSafeInteger(generation)
    || (generation ?? 0) < 1
  ) {
    throw new Error(
      'job.track(...) requires a live Kubernetes object UID and generation.',
    );
  }
  const onGenerationChange =
    input.options.onGenerationChange ?? 'supersede';
  const onDelete = normalizeTrackDeletePolicy(input.options.onDelete);
  const records = trackedExecutionRecords(input.status);
  const existing = persistedTrackedExecution(records[input.key]);
  if (
    existing
    && existing.resourceUid !== uid
  ) {
    throw new Error(
      `job.track(${JSON.stringify(input.key)}) status belongs to a different Kubernetes resource UID.`,
    );
  }
  let superseded: PersistedTrackedExecution['superseded'];
  if (
    existing
    && existing.resourceGeneration !== generation
    && existing.run !== input.run.reference.run
    && !terminalTrackedExecutionPhase(existing.phase)
  ) {
    if (onGenerationChange === 'cancel') {
      if (!input.run.__cancelReference) {
        throw new Error(
          `job.track(${JSON.stringify(input.key)}) cannot cancel prior run ${existing.run}; the selected WorkflowEngine does not implement reference cancellation.`,
        );
      }
      await input.run.__cancelReference(existing.run, { timeoutMs: 5_000 });
    }
    superseded = {
      resourceGeneration: existing.resourceGeneration,
      workflow: existing.workflow,
      workflowRevision: existing.workflowRevision,
      run: existing.run,
      phase: existing.phase,
      supersededAt: new Date().toISOString(),
      cancellationRequested: onGenerationChange === 'cancel',
    };
    input.events.push({
      kind: 'event',
      type: 'Normal',
      reason: onGenerationChange === 'cancel'
        ? 'WorkflowGenerationCancelled'
        : 'WorkflowGenerationSuperseded',
      message: onGenerationChange === 'cancel'
        ? `Workflow run ${existing.run} for generation ${existing.resourceGeneration} was asked to cancel before tracking generation ${generation}.`
        : `Workflow run ${existing.run} for generation ${existing.resourceGeneration} was superseded by generation ${generation} and continues under workflow retention.`,
    });
  }

  let observation = await input.run.observe({ timeoutMs: 5_000 });
  assertTrackedObservation(input.run, observation);
  let cancellationRequestedAt = existing?.cancellationRequestedAt;
  let detached = false;
  const deleting = typeof input.object.metadata.deletionTimestamp === 'string';
  const finalizer = `tracking.applik8s.dev/${input.key}`;
  const activeFinalizers = new Set(input.object.metadata.finalizers ?? []);
  const addTrackingFinalizer = (): void => {
    if (activeFinalizers.has(finalizer)) return;
    input.finalizers.push({
      kind: 'finalizer',
      operation: 'add',
      finalizer,
    });
    activeFinalizers.add(finalizer);
  };
  const removeTrackingFinalizer = (): void => {
    if (!activeFinalizers.has(finalizer)) return;
    input.finalizers.push({
      kind: 'finalizer',
      operation: 'remove',
      finalizer,
    });
    activeFinalizers.delete(finalizer);
  };
  if (
    onDelete.action === 'cancel'
    && !deleting
    && !terminalTrackedExecutionPhase(observation.phase)
  ) {
    addTrackingFinalizer();
  }
  if (
    deleting
    && onDelete.action === 'cancel'
    && !terminalTrackedExecutionPhase(observation.phase)
  ) {
    cancellationRequestedAt ??= new Date().toISOString();
    await input.run.cancel({ timeoutMs: Math.min(5_000, onDelete.timeoutMs) });
    observation = await input.run.observe({ timeoutMs: 5_000 });
    assertTrackedObservation(input.run, observation);
    const elapsed = Date.now() - Date.parse(cancellationRequestedAt);
    if (
      !terminalTrackedExecutionPhase(observation.phase)
      && elapsed >= onDelete.timeoutMs
    ) {
      if (onDelete.onTimeout === 'detach') {
        detached = true;
        removeTrackingFinalizer();
        input.events.push({
          kind: 'event',
          type: 'Warning',
          reason: 'WorkflowCancellationTimedOut',
          message: `Workflow run ${observation.reference.run} did not cancel within ${onDelete.timeoutMs}ms and was detached.`,
        });
      } else {
        input.setRequeue({
          afterSeconds: 5,
          reason: 'workflow cancellation is still pending',
        });
      }
    }
  }
  if (
    onDelete.action === 'cancel'
    && terminalTrackedExecutionPhase(observation.phase)
  ) {
    removeTrackingFinalizer();
  }

  records[input.key] = persistedObservation({
    observation,
    resourceUid: uid,
    resourceGeneration: generation as number,
    ...(input.run.__idempotencyKey
      ? { runIdempotencyKey: input.run.__idempotencyKey }
      : {}),
    onGenerationChange,
    onDelete,
    ...(cancellationRequestedAt ? { cancellationRequestedAt } : {}),
    ...(detached ? { detached: true } : {}),
    ...(superseded ? { superseded } : {}),
  });
  if (
    !deleting
    && !terminalTrackedExecutionPhase(observation.phase)
  ) {
    input.setRequeue({
      afterSeconds: Math.max(
        1,
        Math.ceil(
          parseTrackedDuration(
            input.options.updates?.minInterval ?? '30s',
            'updates.minInterval',
          ) / 1_000,
        ),
      ),
      reason: 'bounded workflow tracking resync',
    });
  }
  return observation;
}

function normalizeTrackDeletePolicy(
  policy: TrackExecutionOptions['onDelete'],
): PersistedTrackedExecution['onDelete'] {
  if (policy === undefined || policy === 'detach') {
    return { action: 'detach' };
  }
  return {
    action: 'cancel',
    timeoutMs: parseTrackedDuration(policy.timeout, 'onDelete.timeout'),
    onTimeout: policy.onTimeout,
  };
}

function parseTrackedDuration(value: string, field: string): number {
  const match = /^([1-9][0-9]*)(ms|s|m|h)$/.exec(value.trim());
  const multiplier = match
    ? { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
        match[2] as 'ms' | 's' | 'm' | 'h'
      ]
    : undefined;
  const result = match && multiplier
    ? Number(match[1]) * multiplier
    : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 1 || result > 24 * 3_600_000) {
    throw new Error(
      `job.track(...) ${field} must be a positive bounded duration no greater than 24h.`,
    );
  }
  return result;
}

function trackedExecutionRecords(
  status: object,
): Record<string, unknown> {
  let framework = Reflect.get(status, 'applik8s');
  if (framework === undefined) {
    framework = {};
    Reflect.set(status, 'applik8s', framework);
  }
  if (!framework || typeof framework !== 'object' || Array.isArray(framework)) {
    throw new Error('status.applik8s is reserved for framework state.');
  }
  let records = Reflect.get(framework, 'trackedExecutions');
  if (records === undefined) {
    records = {};
    Reflect.set(framework, 'trackedExecutions', records);
  }
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(
      'status.applik8s.trackedExecutions is reserved for framework state.',
    );
  }
  return records as Record<string, unknown>;
}

function persistedTrackedExecution(
  value: unknown,
): PersistedTrackedExecution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const resourceUid = Reflect.get(value, 'resourceUid');
  const resourceGeneration = Reflect.get(value, 'resourceGeneration');
  const workflow = Reflect.get(value, 'workflow');
  const workflowRevision = Reflect.get(value, 'workflowRevision');
  const run = Reflect.get(value, 'run');
  const phase = Reflect.get(value, 'phase');
  const onGenerationChange = Reflect.get(value, 'onGenerationChange');
  if (
    typeof resourceUid !== 'string'
    || !Number.isSafeInteger(resourceGeneration)
    || typeof workflow !== 'string'
    || typeof workflowRevision !== 'string'
    || typeof run !== 'string'
    || !trackedExecutionPhase(phase)
    || (
      onGenerationChange !== 'supersede'
      && onGenerationChange !== 'cancel'
    )
  ) {
    throw new Error(
      'status.applik8s.trackedExecutions contains invalid canonical tracking state.',
    );
  }
  return value as PersistedTrackedExecution;
}

function persistedObservation<
  TResult extends object,
  TProgress,
>(input: {
  readonly observation: TrackedExecutionObservation<TResult, TProgress>;
  readonly resourceUid: string;
  readonly resourceGeneration: number;
  readonly runIdempotencyKey?: string;
  readonly onGenerationChange: 'supersede' | 'cancel';
  readonly onDelete: PersistedTrackedExecution['onDelete'];
  readonly cancellationRequestedAt?: string;
  readonly detached?: boolean;
  readonly superseded?: PersistedTrackedExecution['superseded'];
}): PersistedTrackedExecution {
  const progress = boundedTrackedValue(
    input.observation.progress,
    maximumTrackedProgressBytes,
    'progress',
  );
  const result = boundedTrackedValue(
    input.observation.result,
    maximumTrackedResultBytes,
    'result',
  );
  return {
    resourceUid: input.resourceUid,
    resourceGeneration: input.resourceGeneration,
    workflow: input.observation.reference.workflow,
    workflowRevision: input.observation.workflowRevision,
    run: input.observation.reference.run,
    ...(input.runIdempotencyKey
      ? { idempotencyKey: input.runIdempotencyKey }
      : {}),
    phase: input.observation.phase,
    admittedAt: input.observation.admittedAt,
    ...(input.observation.startedAt
      ? { startedAt: input.observation.startedAt }
      : {}),
    ...(input.observation.finishedAt
      ? { finishedAt: input.observation.finishedAt }
      : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(result !== undefined ? { result: result as object } : {}),
    ...(input.observation.error ? { error: input.observation.error } : {}),
    onGenerationChange: input.onGenerationChange,
    onDelete: input.onDelete,
    ...(input.cancellationRequestedAt
      ? { cancellationRequestedAt: input.cancellationRequestedAt }
      : {}),
    ...(input.detached ? { detached: true } : {}),
    ...(input.superseded ? { superseded: input.superseded } : {}),
  };
}

function boundedTrackedValue(
  value: unknown,
  maximumBytes: number,
  field: string,
): unknown {
  if (value === undefined) return undefined;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > maximumBytes) {
    throw new Error(
      `job.track(...) ${field} exceeds its ${maximumBytes}-byte status bound; persist an artifact reference instead.`,
    );
  }
  return cloneJson(value);
}

function assertTrackedObservation<TResult extends object, TProgress>(
  run: TrackableExecutionRun<TResult, TProgress>,
  observation: TrackedExecutionObservation<TResult, TProgress>,
): void {
  if (
    observation.reference.provider !== 'workflow'
    || observation.reference.workflow !== run.reference.workflow
    || observation.reference.run !== run.reference.run
    || observation.workflowRevision !== run.workflowRevision
  ) {
    throw new Error(
      'WorkflowEngine returned an observation for a different tracked execution.',
    );
  }
}

function trackedExecutionPhase(
  value: unknown,
): value is TrackedExecutionObservation<object>['phase'] {
  return [
    'Admitted',
    'Running',
    'Succeeded',
    'Failed',
    'Cancelled',
    'TimedOut',
  ].includes(String(value));
}

function terminalTrackedExecutionPhase(
  phase: TrackedExecutionObservation<object>['phase'],
): boolean {
  return ['Succeeded', 'Failed', 'Cancelled', 'TimedOut'].includes(phase);
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
    kubernetes: recorder.scope.kubernetes,
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
    patch(ref: ObjectRef, jsonPatch: JsonPatch, _options?: PatchTargetOptions) {
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
        const operation = deleteInput(ref, isDeleteTargetOptions(options) ? options : undefined);
        recorder.scope.delete(ref, isDeleteTargetOptions(options) ? options : undefined);
        return operation;
      }
      // typecast: operation targets and target arrays have returned above, so the remaining overload branch is an ObjectRef delete.
      const ref = value as ObjectRef;
      const operation = deleteInput(ref, isDeleteTargetOptions(options) ? options : undefined);
      recorder.scope.delete(ref, isDeleteTargetOptions(options) ? options : undefined);
      return operation;
    },
    recordEvent(event: EventOperation) {
      return event;
    },
    requeue(policy: RequeuePolicy) {
      return { kind: 'requeue', policy };
    },
    noop() {
      return ok(recorder.result());
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

function remoteApplyInput(resource: AnyKubernetesObject, connection: string, options: RemoteApplyTargetOptions): ApplyOperation {
  return {
    kind: 'apply',
    resource,
    connection,
    authority: options.authority,
    ...(options.fieldManager ? { fieldManager: options.fieldManager } : {}),
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.ownership ? { ownership: options.ownership } : {}),
  };
}

function deleteInput(ref: ObjectRef, options: DeleteTargetOptions | undefined): Extract<Operation, { kind: 'delete' }> {
  const deleteOptions = options?.propagationPolicy || options?.gracePeriodSeconds !== undefined
    ? {
      ...(options?.propagationPolicy ? { propagationPolicy: options.propagationPolicy } : {}),
      ...(options?.gracePeriodSeconds !== undefined ? { gracePeriodSeconds: options.gracePeriodSeconds } : {}),
    }
    : undefined;
  return {
    kind: 'delete',
    ref,
    ...(deleteOptions ? { options: deleteOptions } : {}),
  };
}

function remoteDeleteInput(ref: ObjectRef, connection: string, options: RemoteDeleteTargetOptions): Extract<Operation, { kind: 'delete' }> {
  const localOptions: DeleteTargetOptions = {
    ...(options.propagationPolicy ? { propagationPolicy: options.propagationPolicy } : {}),
    ...(options.gracePeriodSeconds !== undefined ? { gracePeriodSeconds: options.gracePeriodSeconds } : {}),
  };
  return { ...deleteInput(ref, localOptions), connection, authority: options.authority };
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
    const deleteOptions = options?.propagationPolicy || options?.gracePeriodSeconds !== undefined
      ? {
        ...(options.propagationPolicy ? { propagationPolicy: options.propagationPolicy } : {}),
        ...(options.gracePeriodSeconds !== undefined ? { gracePeriodSeconds: options.gracePeriodSeconds } : {}),
      }
      : operation.options;
    const next: Extract<Operation, { kind: 'delete' }> = {
      kind: 'delete', ref: operation.ref,
      ...(deleteOptions ? { options: deleteOptions } : {}),
      ...(operation.authority ? { authority: operation.authority } : {}),
    };
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
