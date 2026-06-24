import type {
  AnyKubernetesObject,
  AnyResourceDefinition,
  Applik8sError,
  ApplyOperation,
  ApplyOperationInput,
  CapabilityClient,
  CapabilityClientSet,
  CapabilityDescriptor,
  CapabilityPayload,
  ConditionStatus,
  DeleteOperation,
  DeleteOptions,
  EventOperation,
  ExternalEffectRecord,
  FinalizerOperationSpec,
  GraphApplication,
  HandlerAbiDefinition,
  HandlerContext,
  HandlerEventType,
  HandlerResult,
  JsonObject,
  JsonValue,
  JsonPatch,
  LifecyclePlan,
  ManagedByMetadata,
  NormalizedOperationPlan,
  ObjectRef,
  Operation,
  OperationPlanInput,
  OperationTarget,
  OperatorDefinition,
  PermissionRule,
  RequeuePolicy,
  Result,
  PatchOperation,
  StatusOperation,
} from '@applik8s/core';
import { isRunnableHandlerRegistration, type RunnableHandlerRegistration } from '@applik8s/sdk';
import type {
  Applik8sTestingApi,
  FakeCapability,
  ManifestMatcher,
  OperatorTestHarness,
  ResourceMatcher,
  SchemaMatcher,
  TestAssertionFailure,
  TestOperatorTarget,
  TestRunOptions,
  TestRunResult,
} from './interfaces.js';
import { createHandlerProxyRecorder } from './proxy.js';

export const testing: Applik8sTestingApi = {
  testOperator,
  replayOperator: () => ({
    async replay() {
      return err('HANDLER_NOT_FOUND', 'Replay harness is not implemented in the local vertical slice.');
    },
  }),
};

export function testOperator<TCapabilities extends CapabilityClientSet = CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>> = Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(
  target: TestOperatorTarget<TCapabilities, TResources>
): OperatorTestHarness {
  // typecast: the local harness erases capability-specific resource maps because it only needs runtime handler metadata.
  return new LocalOperatorTestHarness(resolveDefinition(target) as unknown as OperatorDefinition);
}

class LocalOperatorTestHarness implements OperatorTestHarness {
  readonly #objects: AnyKubernetesObject[] = [];
  readonly #capabilities = new Map<string, FakeCapability>();
  readonly #expectations: Expectation[] = [];

  constructor(readonly definition: OperatorDefinition) {}

  given(...objects: readonly AnyKubernetesObject[]): OperatorTestHarness {
    this.#objects.push(...objects);
    return this;
  }

  givenCapability(name: string, capability: FakeCapability): OperatorTestHarness {
    this.#capabilities.set(name, capability);
    return this;
  }

  async reconcile(ref: ObjectRef): Promise<Result<HandlerResult>> {
    const run = await this.run({ reconcile: ref, failFast: true });
    if (!run.ok) {
      return run;
    }
    return ok(run.value.handlerResult ?? {});
  }

  async run(options: TestRunOptions = {}): Promise<Result<TestRunResult>> {
    const selected = this.#selectObject(options.reconcile);
    if (!selected.ok) {
      return selected;
    }
    const event = options.event ?? 'reconcile';
    const handler = this.#selectHandler(selected.value, event);
    if (!handler.ok) {
      return handler;
    }
    const capabilities = buildCapabilityClients(this.definition.capabilities ?? {}, this.#capabilities);
    if (!capabilities.ok) {
      return capabilities;
    }

    const invocation = await invokeHandler(handler.value, selected.value, capabilities.value);
    if (!invocation.ok) {
      return invocation;
    }

    const failures = this.#evaluateExpectations(invocation.value.result, invocation.value.plan);
    if (options.failFast && failures.length > 0) {
      return err('HANDLER_OUTPUT_INVALID', failures[0]?.message ?? 'Expectation failed.');
    }

    return ok({
      handlerResult: invocation.value.result,
      normalizedPlan: invocation.value.plan,
      assertionsPassed: this.#expectations.length - failures.length,
      assertionFailures: failures,
    });
  }

  expectApply(match: AnyKubernetesObject | ResourceMatcher): OperatorTestHarness {
    this.#expectations.push({ kind: 'apply', match });
    return this;
  }

  expectPatch(ref: ObjectRef, patch?: JsonPatch): OperatorTestHarness {
    this.#expectations.push(patch === undefined ? { kind: 'patch', ref } : { kind: 'patch', ref, patch });
    return this;
  }

  expectDelete(ref: ObjectRef): OperatorTestHarness {
    this.#expectations.push({ kind: 'delete', ref });
    return this;
  }

  expectFinalizer(finalizer: string, operation?: 'add' | 'remove'): OperatorTestHarness {
    this.#expectations.push(operation === undefined ? { kind: 'finalizer', finalizer } : { kind: 'finalizer', finalizer, operation });
    return this;
  }

  expectStatus(status: JsonObject): OperatorTestHarness {
    this.#expectations.push({ kind: 'status', status });
    return this;
  }

  expectCondition(reason: string, status?: ConditionStatus): OperatorTestHarness {
    this.#expectations.push(status === undefined ? { kind: 'condition', reason } : { kind: 'condition', reason, status });
    return this;
  }

  expectExternalEffect(effect: ExternalEffectRecord): OperatorTestHarness {
    this.#expectations.push({ kind: 'externalEffect', effect });
    return this;
  }

  expectEvent(reason: string): OperatorTestHarness {
    this.#expectations.push({ kind: 'event', reason });
    return this;
  }

  expectRbac(rule: PermissionRule): OperatorTestHarness {
    this.#expectations.push({ kind: 'rbac', rule });
    return this;
  }

  expectManifest(manifest: ManifestMatcher): OperatorTestHarness {
    this.#expectations.push({ kind: 'manifest', manifest });
    return this;
  }

  expectSchema(resourceKind: string, assertion: SchemaMatcher): OperatorTestHarness {
    this.#expectations.push({ kind: 'schema', resourceKind, assertion });
    return this;
  }

  expectAbi(_abi: HandlerAbiDefinition): OperatorTestHarness {
    this.#expectations.push({ kind: 'unsupported', expectation: 'abi' });
    return this;
  }

  expectManagedBy(_metadata: ManagedByMetadata): OperatorTestHarness {
    this.#expectations.push({ kind: 'unsupported', expectation: 'managedBy' });
    return this;
  }

  expectLifecycle(_plan: LifecyclePlan): OperatorTestHarness {
    this.#expectations.push({ kind: 'unsupported', expectation: 'lifecycle' });
    return this;
  }

  expectRequeue(afterSeconds?: number): OperatorTestHarness {
    this.#expectations.push(afterSeconds === undefined ? { kind: 'requeue' } : { kind: 'requeue', afterSeconds });
    return this;
  }

  expectNoop(): OperatorTestHarness {
    this.#expectations.push({ kind: 'noop' });
    return this;
  }

  #selectObject(ref: ObjectRef | undefined): Result<AnyKubernetesObject> {
    if (!ref) {
      const first = this.#objects[0];
      if (!first) {
        return err('RESOURCE_NOT_FOUND', 'No objects were provided to the test harness.');
      }
      return ok(first);
    }
    const object = this.#objects.find((candidate) => objectMatchesRef(candidate, ref));
    if (!object) {
      return err('RESOURCE_NOT_FOUND', `No given object matched ${ref.apiVersion}/${ref.kind}/${ref.name}.`);
    }
    return ok(object);
  }

  #selectHandler(object: AnyKubernetesObject, event: HandlerEventType): Result<RunnableHandlerRegistration> {
    const handler = this.definition.handlers.find((registration) => {
      if (!isRunnableHandlerRegistration(registration)) {
        return false;
      }
      return registration.event === event && registration.resource.apiVersion === object.apiVersion && registration.resource.kind === object.kind;
    });
    if (!handler || !isRunnableHandlerRegistration(handler)) {
      return err('HANDLER_NOT_FOUND', `No ${event} handler found for ${object.apiVersion}/${object.kind}.`);
    }
    return ok(handler);
  }

  #evaluateExpectations(result: HandlerResult, plan: NormalizedOperationPlan): readonly TestAssertionFailure[] {
    const failures: TestAssertionFailure[] = [];
    for (const expectation of this.#expectations) {
      const failure = evaluateExpectation(expectation, result, plan, this.definition);
      if (failure) {
        failures.push(failure);
      }
    }
    return failures;
  }
}

type Expectation =
  | { readonly kind: 'apply'; readonly match: AnyKubernetesObject | ResourceMatcher }
  | { readonly kind: 'patch'; readonly ref: ObjectRef; readonly patch?: JsonPatch }
  | { readonly kind: 'delete'; readonly ref: ObjectRef }
  | { readonly kind: 'finalizer'; readonly finalizer: string; readonly operation?: 'add' | 'remove' }
  | { readonly kind: 'status'; readonly status: JsonObject }
  | { readonly kind: 'condition'; readonly reason: string; readonly status?: ConditionStatus }
  | { readonly kind: 'externalEffect'; readonly effect: ExternalEffectRecord }
  | { readonly kind: 'event'; readonly reason: string }
  | { readonly kind: 'rbac'; readonly rule: PermissionRule }
  | { readonly kind: 'manifest'; readonly manifest: ManifestMatcher }
  | { readonly kind: 'schema'; readonly resourceKind: string; readonly assertion: SchemaMatcher }
  | { readonly kind: 'requeue'; readonly afterSeconds?: number }
  | { readonly kind: 'noop' }
  | { readonly kind: 'unsupported'; readonly expectation: string };

interface InvocationResult {
  readonly result: HandlerResult;
  readonly plan: NormalizedOperationPlan;
}

async function invokeHandler(registration: RunnableHandlerRegistration, object: AnyKubernetesObject, capabilities: CapabilityClientSet): Promise<Result<InvocationResult>> {
  const recorder = createHandlerProxyRecorder(toResourceObject(object), { event: registration.event, reconcileId: 'test-reconcile', capabilities });

  try {
    if (registration.handlerStyle === 'proxy') {
      const returned = await registration.handler(recorder.scope);
      const explicit = normalizeReturnedHandlerResult(returned);
      if (!explicit.ok) {
        return explicit;
      }
      const result = mergeHandlerResults(recorder.result(), explicit.value);
      return ok({ result, plan: normalizeHandlerResult(result) });
    }

    const context = createContext(recorder, object);
    const returned = await registration.handler(object, context);
    const explicit = normalizeReturnedHandlerResult(returned);
    if (!explicit.ok) {
      return explicit;
    }
    const result = explicit.value ?? recorder.result();
    return ok({ result, plan: normalizeHandlerResult(result) });
  } catch (cause) {
    if (isApplik8sError(cause)) {
      return { ok: false, error: cause };
    }
    return err('HANDLER_TRAP', cause instanceof Error ? cause.message : 'Handler threw an unknown error.');
  }
}

function createContext(recorder: ReturnType<typeof createHandlerProxyRecorder>, object: AnyKubernetesObject): HandlerContext<object, object> {
  const context = {
    object: toResourceObject(object),
    event: recorder.scope.event,
    reconcileId: recorder.scope.reconcileId,
    capabilities: recorder.scope.capabilities,
    names: recorder.scope.names,
    k8s: recorder.scope.k8s,
    batch: recorder.scope.batch,
    apply(value: OperationPlanInput<object> | OperationTarget<object> | readonly OperationTarget<object>[], options?: object) {
      // typecast: this local harness forwards the overload implementation through the proxy recorder's runtime-compatible implementation.
      const apply = recorder.scope.apply as (value: OperationPlanInput<object> | OperationTarget<object> | readonly OperationTarget<object>[], options?: object) => void;
      apply(value, options);
      return ok(recorder.result());
    },
    applyGraph(application: GraphApplication<object, object, object>) {
      recorder.scope.applyGraph(application);
      return ok(recorder.result());
    },
    plan(target: OperationTarget<object>, options?: object) {
      return target.adapter.renderApply(target, options);
    },
    status(status: object): StatusOperation<object> {
      return { kind: 'status', status };
    },
    patch(ref: ObjectRef, patch: JsonPatch): PatchOperation {
      return { kind: 'patch', ref, patch };
    },
    delete(ref: ObjectRef, options?: DeleteOptions): DeleteOperation {
      recorder.scope.delete(ref, options);
      return { kind: 'delete', ref, ...(options ? { options } : {}) };
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
  // typecast: the context object implements the vertical-slice HandlerContext behavior; unimplemented overloads are outside this harness path.
  return context as unknown as HandlerContext<object, object>;
}

function normalizeReturnedHandlerResult(value: unknown): Result<HandlerResult | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (isResult(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    // typecast: handler results are structurally validated by normalizeHandlerResult for this local harness.
    return ok(value as HandlerResult);
  }
  return err('HANDLER_OUTPUT_INVALID', 'Handler returned a non-object value.');
}

function mergeHandlerResults<TStatus extends object>(recorded: HandlerResult<TStatus>, explicit: HandlerResult<TStatus> | undefined): HandlerResult<TStatus> {
  if (!explicit) {
    return recorded;
  }
  const result: MutableHandlerResult<TStatus> = {};
  assignIfPresent(result, 'apply', mergeArrays(recorded.apply, explicit.apply));
  assignIfPresent(result, 'patch', mergeArrays(recorded.patch, explicit.patch));
  assignIfPresent(result, 'delete', mergeArrays(recorded.delete, explicit.delete));
  const status = mergeStatus(recorded.status, explicit.status);
  // typecast: malformed explicit status values must remain visible in the local normalized plan so runtime validation tests can fail closed.
  const mergedStatus = status as TStatus;
  if (status !== undefined && (!isObjectRecord(status) || Object.keys(status).length > 0)) {
    result.status = mergedStatus;
  }
  assignIfPresent(result, 'events', mergeArrays(recorded.events, explicit.events));
  assignIfPresent(result, 'finalizers', mergeArrays(recorded.finalizers, explicit.finalizers));
  const requeue = explicit.requeue ?? recorded.requeue;
  if (requeue) {
    result.requeue = requeue;
  }
  assignIfPresent(result, 'diagnostics', mergeArrays(recorded.diagnostics, explicit.diagnostics));
  return result;
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

function normalizeHandlerResult(result: HandlerResult): NormalizedOperationPlan {
  const operations: Operation[] = [];
  const finalizers = splitFinalizers(result.finalizers);
  operations.push(...finalizers.add);
  for (const resource of result.apply ?? []) {
    operations.push(isApplyOperation(resource) ? resource : { kind: 'apply', resource });
  }
  for (const patch of result.patch ?? []) {
    operations.push(patch);
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

function isDeleteOperation(input: NonNullable<HandlerResult['delete']>[number]): input is Extract<Operation, { kind: 'delete' }> {
  return 'kind' in input && input.kind === 'delete';
}

function isApplyOperation(input: ApplyOperationInput): input is ApplyOperation {
  return 'kind' in input && input.kind === 'apply';
}

function applyInputResource(input: ApplyOperationInput): AnyKubernetesObject {
  return isApplyOperation(input) ? input.resource : input;
}

function evaluateExpectation(expectation: Expectation, result: HandlerResult, plan: NormalizedOperationPlan, definition: OperatorDefinition): TestAssertionFailure | undefined {
  switch (expectation.kind) {
    case 'apply':
      return (result.apply ?? []).some((resource) => resourceMatches(applyInputResource(resource), expectation.match)) ? undefined : failure('apply', 'Expected an apply operation was not recorded.', expectation.match);
    case 'patch':
      return plan.operations.some((operation) => operation.kind === 'patch' && objectRefsEqual(operation.ref, expectation.ref) && (expectation.patch === undefined || deepEqual(operation.patch, expectation.patch))) ? undefined : failure('patch', 'Expected a patch operation was not recorded.', expectation.ref);
    case 'delete':
      return plan.operations.some((operation) => operation.kind === 'delete' && objectRefsEqual(operation.ref, expectation.ref)) ? undefined : failure('delete', 'Expected a delete operation was not recorded.', expectation.ref);
    case 'finalizer':
      return plan.operations.some((operation) => operation.kind === 'finalizer' && operation.finalizer === expectation.finalizer && (expectation.operation === undefined || operation.operation === expectation.operation)) ? undefined : failure('finalizer', `Expected finalizer ${expectation.finalizer} was not recorded.`, plan.operations);
    case 'status':
      return objectContains(result.status ?? {}, expectation.status) ? undefined : failure('status', 'Expected status was not recorded.', result.status);
    case 'condition':
      return hasCondition(result.status, expectation.reason, expectation.status) ? undefined : failure('condition', `Expected condition reason ${expectation.reason}.`, result.status);
    case 'externalEffect':
      return hasExternalEffect(result.status, expectation.effect) ? undefined : failure('externalEffect', 'Expected external-effect status record was not found.', result.status);
    case 'event':
      return (result.events ?? []).some((event) => event.reason === expectation.reason) ? undefined : failure('event', `Expected event reason ${expectation.reason}.`, result.events);
    case 'rbac':
      return hasPermissionRule(definition.permissions ?? [], expectation.rule) ? undefined : failure('rbac', 'Expected explicit operator RBAC rule was not declared.', definition.permissions ?? []);
    case 'manifest':
      return manifestMatches(definition, expectation.manifest) ? undefined : failure('manifest', 'Expected operator manifest metadata did not match.', { name: definition.name, deployment: definition.deployment });
    case 'schema':
      return schemaMatches(definition, expectation.resourceKind, expectation.assertion) ? undefined : failure('schema', `Expected schema assertion for ${expectation.resourceKind} did not match.`);
    case 'requeue':
      return result.requeue && (expectation.afterSeconds === undefined || result.requeue.afterSeconds === expectation.afterSeconds) ? undefined : failure('requeue', 'Expected requeue policy was not recorded.', result.requeue);
    case 'noop':
      return plan.operations.length === 0 ? undefined : failure('noop', 'Expected no operations.', plan.operations);
    case 'unsupported':
      return failure(expectation.expectation, `The local test harness does not implement ${expectation.expectation} assertions yet.`);
  }
}

function objectRefsEqual(actual: ObjectRef, expected: ObjectRef): boolean {
  return actual.apiVersion === expected.apiVersion && actual.kind === expected.kind && actual.name === expected.name && actual.namespace === expected.namespace;
}

function hasExternalEffect(status: HandlerResult['status'], expected: ExternalEffectRecord): boolean {
  const effects = status ? Reflect.get(status, 'effects') : undefined;
  return Array.isArray(effects) && effects.some((effect) => effect && typeof effect === 'object' && Reflect.get(effect, 'capabilityName') === expected.capabilityName && Reflect.get(effect, 'idempotencyKey') === expected.idempotencyKey && Reflect.get(effect, 'phase') === expected.phase);
}

function hasPermissionRule(rules: readonly PermissionRule[], expected: PermissionRule): boolean {
  return rules.some((rule) => includesAll(rule.apiGroups, expected.apiGroups) && includesAll(rule.resources, expected.resources) && includesAll(rule.verbs, expected.verbs));
}

function includesAll(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every((value) => actual.includes(value));
}

function manifestMatches(definition: OperatorDefinition, matcher: ManifestMatcher): boolean {
  if (matcher.manifest && matcher.manifest.metadata.name !== definition.name) {
    return false;
  }
  if (matcher.operatorName && definition.name !== matcher.operatorName) {
    return false;
  }
  if (matcher.ownedCrds) {
    const owned = new Set(Object.values(definition.resources).map((resource) => `${resource.apiVersion}/${resource.kind}`));
    if (!matcher.ownedCrds.every((crd) => owned.has(crd))) {
      return false;
    }
  }
  return matcher.handlerAbi === undefined;
}

function schemaMatches(definition: OperatorDefinition, resourceKind: string, assertion: SchemaMatcher): boolean {
  const resource = Object.values(definition.resources).find((candidate) => candidate.kind === resourceKind);
  if (!resource) {
    return false;
  }
  const emitted = resource.spec.emitOpenApiSchema();
  const structural = emitted.ok && !emitted.value.diagnostics.some((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning');
  if (assertion.structural !== structural || !emitted.ok) {
    return false;
  }
  if (assertion.requiredFields && !includesAll(readStringArray(Reflect.get(emitted.value.schema, 'required')), assertion.requiredFields)) {
    return false;
  }
  if (assertion.preservesUnknownFields !== undefined && Reflect.get(emitted.value.schema, 'x-kubernetes-preserve-unknown-fields') !== assertion.preservesUnknownFields) {
    return false;
  }
  return true;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function resourceMatches(resource: AnyKubernetesObject, match: AnyKubernetesObject | ResourceMatcher): boolean {
  if ('metadata' in match && 'apiVersion' in match && 'kind' in match) {
    return deepEqual(resource, match);
  }
  if (match.apiVersion && resource.apiVersion !== match.apiVersion) {
    return false;
  }
  if (match.kind && resource.kind !== match.kind) {
    return false;
  }
  if (match.name && resource.metadata.name !== match.name) {
    return false;
  }
  if (match.namespace && resource.metadata.namespace !== match.namespace) {
    return false;
  }
  if (match.spec && !objectContains(resource.spec ?? {}, match.spec)) {
    return false;
  }
  return true;
}

function objectMatchesRef(object: AnyKubernetesObject, ref: ObjectRef): boolean {
  return object.apiVersion === ref.apiVersion && object.kind === ref.kind && object.metadata.name === ref.name && object.metadata.namespace === ref.namespace;
}

function objectContains(actual: object, expected: object): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = Reflect.get(actual, key);
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      return Boolean(actualValue && typeof actualValue === 'object' && objectContains(actualValue, expectedValue));
    }
    return deepEqual(actualValue, expectedValue);
  });
}

function hasCondition(status: HandlerResult['status'], reason: string, expectedStatus: ConditionStatus | undefined): boolean {
  const conditions = status ? Reflect.get(status, 'conditions') : undefined;
  return Array.isArray(conditions) && conditions.some((condition) => condition && typeof condition === 'object' && Reflect.get(condition, 'reason') === reason && (expectedStatus === undefined || Reflect.get(condition, 'status') === expectedStatus));
}

function resolveDefinition<TCapabilities extends CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(target: TestOperatorTarget<TCapabilities, TResources>): OperatorDefinition<TCapabilities, TResources> {
  if ('definition' in target) {
    return target.definition;
  }
  return target;
}

function buildCapabilityClients(descriptors: Readonly<Record<string, CapabilityDescriptor>>, fakes: ReadonlyMap<string, FakeCapability>): Result<CapabilityClientSet> {
  for (const name of fakes.keys()) {
    if (!(name in descriptors)) {
      return err('CAPABILITY_MISSING', `Fake capability ${name} was provided, but the operator does not declare it.`);
    }
  }

  const clients: Record<string, CapabilityClient> = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    clients[name] = fakeCapabilityClient(name, descriptor, fakes.get(name));
  }

  return ok(clients);
}

function fakeCapabilityClient(name: string, descriptor: CapabilityDescriptor, fake: FakeCapability | undefined): CapabilityClient {
  const request = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string): Promise<CapabilityPayload> => {
    const response = fake?.responses.find((candidate) => candidate.method === method && candidate.path === path);
    if (!response) {
      throw applik8sError('CAPABILITY_MISSING', `No fake response configured for capability ${name} ${method} ${path}.`, { capabilityName: name });
    }
    return response.response;
  };

  return {
    descriptor,
    get: (path) => request('GET', path),
    post: (path) => request('POST', path),
    put: (path) => request('PUT', path),
    delete: (path) => request('DELETE', path),
  };
}

function toResourceObject(object: AnyKubernetesObject): AnyKubernetesObject & { readonly spec: object } {
  return {
    ...object,
    spec: object.spec ?? {},
  };
}

function isResult(value: unknown): value is Result<HandlerResult | undefined> {
  return Boolean(value && typeof value === 'object' && 'ok' in value);
}

function isApplik8sError(value: unknown): value is Applik8sError {
  return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'code') === 'string' && typeof Reflect.get(value, 'message') === 'string' && typeof Reflect.get(value, 'severity') === 'string' && Reflect.get(value, 'context'));
}

function assignIfPresent<TStatus extends object, TKey extends keyof MutableHandlerResult<TStatus>>(result: MutableHandlerResult<TStatus>, key: TKey, value: MutableHandlerResult<TStatus>[TKey]): void {
  if (value !== undefined) {
    result[key] = value;
  }
}

function mergeArrays<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): readonly T[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? merged : undefined;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failure(expectation: string, message: string, actual?: unknown): TestAssertionFailure {
  return { expectation, message, ...(actual === undefined ? {} : { actual: toJsonValue(actual) }) };
}

function toJsonValue(value: unknown): JsonValue {
  // typecast: JSON serialization removes non-JSON values before the assertion payload is exposed.
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err(code: Applik8sError['code'], message: string): Result<never> {
  return { ok: false, error: applik8sError(code, message) };
}

function applik8sError(code: Applik8sError['code'], message: string, context: Applik8sError['context'] = {}): Applik8sError {
  return { code, message, severity: 'error', context };
}
