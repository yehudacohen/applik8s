// typecast-file-boundary: Actor protocol members are schema-validated before their generic erased dispatch representation is used.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { type ApplicationMutationOperation, decorateApplicationMutationOperation, observeApplicationOperationAuthority } from '@applik8s/client';
import { type ApplicationActorNode, type ApplicationAuthorizationReceipt, applicationOperationId, validateApplicationAuthorizationReceipt } from '@applik8s/core';
import { sha256Hex } from '@applik8s/deployment-contract';
import type { SchemaInput } from '@applik8s/sdk';
import {
  expandApplicationCallbackDependencies,
  serializeApplicationCallback,
} from './application-callback.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import { withApplicationManagedEffects } from './application-managed-effects.js';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import { applicationCallableProviderDependencies } from './application-provider-dependencies.js';
import { runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
import { declaredSchema, validateMessage } from './application-workflow-serialization.js';

export interface ApplicationActorKeySchema {
  readonly json?: unknown;
  assert(value: unknown): string;
}

export interface ApplicationActorStateDefinition<TState extends object> {
  readonly kind: 'applicationActorState';
  readonly version: number;
  readonly schema: SchemaInput<TState>;
  readonly migrate: Readonly<Record<number, (previous: object) => TState | Promise<TState>>>;
}

export type ApplicationActorStateInput<TState extends object> =
  | SchemaInput<TState>
  | ApplicationActorStateDefinition<TState>;

export interface ApplicationActorCommand<TInput extends object, TOutput extends object> {
  readonly kind: 'actorCommand';
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
}

export interface ApplicationActorMessage<TInput extends object> {
  readonly kind: 'actorMessage';
  readonly input: SchemaInput<TInput>;
}

export interface ApplicationActorAlarm<TInput extends object> {
  readonly kind: 'actorAlarm';
  readonly input: SchemaInput<TInput>;
}

export interface ApplicationActorConnectionMessage<TInput extends object> {
  readonly kind: 'actorConnectionMessage';
  readonly input: SchemaInput<TInput>;
}

export interface ApplicationActorConnection<TInput extends object> {
  readonly kind: 'actorConnection';
  readonly input: SchemaInput<TInput>;
}

export interface ApplicationActorDisconnection<TInput extends object> {
  readonly kind: 'actorDisconnection';
  readonly input: SchemaInput<TInput>;
}

export interface ApplicationActorBroadcast<TInput extends object> {
  readonly kind: 'actorBroadcast';
  readonly input: SchemaInput<TInput>;
}

export type ApplicationActorProtocolMember =
  | ApplicationActorCommand<object, object>
  | ApplicationActorMessage<object>
  | ApplicationActorAlarm<object>
  | ApplicationActorConnectionMessage<object>
  | ApplicationActorConnection<object>
  | ApplicationActorDisconnection<object>
  | ApplicationActorBroadcast<object>;
/**
 * A protocol constraint intentionally carries only the discriminant. Keeping
 * author schemas out of the contextual constraint preserves each member's
 * inferred input/output type instead of widening the whole protocol to the
 * erased runtime union.
 */
export type ApplicationActorProtocol = Readonly<Record<string, { readonly kind: ApplicationActorProtocolMember['kind'] }>>;
export type ApplicationActorProtocolShape = Readonly<Record<string, unknown>>;
type ErasedApplicationActorProtocol = Readonly<Record<string, ApplicationActorProtocolMember>>;
export type ValidApplicationActorProtocol<TProtocol extends ApplicationActorProtocolShape> = {
  readonly [TName in keyof TProtocol]: TProtocol[TName] extends { readonly kind: ApplicationActorProtocolMember['kind'] }
    ? TProtocol[TName]
    : never;
};

type ActorInput<T> = T extends { readonly input: SchemaInput<infer TInput extends object> } ? TInput : never;
type ActorOutput<T> = T extends { readonly output: SchemaInput<infer TOutput extends object> } ? TOutput : never;
type ActorInputsOfKind<TProtocol extends ApplicationActorProtocolShape, TKind extends string> = {
  [TName in keyof TProtocol]: TProtocol[TName] extends { readonly kind: TKind } ? ActorInput<TProtocol[TName]> : never;
}[keyof TProtocol];

type ApplicationActorAuthorityFacet<TTarget> = Pick<
  ApplicationMutationOperation<object, object, TTarget>,
  'operation' | 'authority' | 'permission' | 'requires' | 'applicationPolicy' | 'public' | 'all' | 'on' | 'where' | 'authorize'
>;

type ApplicationActorCommandCall<TInput extends object, TOutput extends object> =
  ((key: string, input: TInput, options?: ApplicationActorInvocationOptions) => Promise<TOutput>)
  & ApplicationActorAuthorityFacet<{ readonly key: string }>;

type ApplicationActorMessageCall<TInput extends object> = {
  readonly send: ((key: string, input: TInput, options?: ApplicationActorInvocationOptions) => Promise<ApplicationActorAdmissionReceipt>)
    & ApplicationActorAuthorityFacet<{ readonly key: string }>;
};

export interface ApplicationActorConnectionOptions<TDisconnect extends object = object> {
  readonly lease?: string;
  readonly disconnect?: {
    readonly member: string;
    readonly input: TDisconnect;
  };
}

export type ApplicationActorClientConnection<TProtocol extends ApplicationActorProtocolShape> = {
  readonly id: string;
  readonly actor: string;
  readonly key: string;
  readonly state: 'connecting' | 'open' | 'closing' | 'closed';
  readonly on: {
    [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorBroadcast' } ? TName : never]:
      (listener: (value: ActorInput<TProtocol[TName]>, receipt: ApplicationActorBroadcastReceipt) => void) => () => void;
  };
  close(input?: ActorInputsOfKind<TProtocol, 'actorDisconnection'>): Promise<void>;
} & {
  [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorConnectionMessage' } ? TName : never]:
    (input: ActorInput<TProtocol[TName]>) => Promise<ApplicationActorAdmissionReceipt>;
};

type ApplicationActorScopedProtocolOperation<TInput extends object, TProtocol extends ApplicationActorProtocolShape> =
  ((key: string, input: TInput, options?: ApplicationActorConnectionOptions<ActorInputsOfKind<TProtocol, 'actorDisconnection'>>) => Promise<ApplicationActorClientConnection<TProtocol>>)
  & ApplicationActorAuthorityFacet<{ readonly key: string }>;

type ApplicationActorAlarmScheduleCall<TInput extends object> =
  ((key: string, at: string | Date, input: TInput, options?: ApplicationActorInvocationOptions) => Promise<ApplicationActorAlarmReceipt>)
  & ApplicationActorAuthorityFacet<{ readonly key: string }>;

export interface ApplicationActorReference {
  readonly apiVersion: 'applik8s.actorReference/v1alpha1';
  readonly actor: string;
  readonly key: string;
}

export interface ApplicationActorInvocationOptions {
  readonly idempotencyKey?: string;
}

export interface ApplicationActorAdmissionReceipt {
  readonly operationId: string;
  readonly actor: string;
  readonly key: string;
  readonly member: string;
  readonly state: 'committed';
  readonly revision: number;
  readonly replayed: boolean;
}

export interface ApplicationActorAlarmReceipt {
  readonly alarmId: string;
  readonly actor: string;
  readonly key: string;
  readonly member: string;
  readonly scheduledAt: string;
  readonly state: 'scheduled' | 'cancelled';
}

export interface ApplicationActorBroadcastReceipt {
  readonly broadcastId: string;
  readonly actor: string;
  readonly key: string;
  readonly member: string;
  readonly revision: number;
}

/** One ordinary application fact committed in the actor provider's outbox. */
export interface ApplicationActorOutboxEvent {
  readonly effectId: string;
  readonly operationId: string;
  readonly contract: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly payload: object;
  readonly recordedAt: string;
  readonly partitionKey: string;
}

export interface ApplicationActorConnectionContext {
  readonly id: string;
  readonly principal: { readonly id: string };
  readonly causalPrincipal: { readonly id: string };
  /**
   * Canonical authority admitted for the current realtime protocol turn.
   * The connection provider persists the signed connection-admission receipt,
   * while ApplicationHost replaces it with a freshly authorized receipt for
   * each connect, message, and disconnection callback.
   */
  readonly authorizationReceipt: ApplicationAuthorizationReceipt;
  readonly trustedContextDigest: string;
  readonly connectedAt: string;
  readonly leaseExpiresAt: string;
  readonly disconnectionReason?: 'closed' | 'transport-error' | 'lease-expired' | 'connection-admission-failed';
}

export interface ApplicationActorRealtimeInvocation {
  readonly kind: 'connection' | 'connectionMessage' | 'disconnection';
  readonly member: string;
  readonly key: string;
  readonly input: object;
  readonly connection: ApplicationActorConnectionContext;
  readonly idempotencyKey: string;
}

type ApplicationActorBroadcasts<TProtocol extends ApplicationActorProtocolShape> = {
  [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorBroadcast' } ? TName : never]:
    (input: ActorInput<TProtocol[TName]>) => Promise<ApplicationActorBroadcastReceipt>;
};

type ApplicationActorBoundAlarms<TProtocol extends ApplicationActorProtocolShape> = {
  [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorAlarm' } ? TName : never]: {
    schedule(at: string | Date, input: ActorInput<TProtocol[TName]>, options?: ApplicationActorInvocationOptions): Promise<ApplicationActorAlarmReceipt>;
    cancel(): Promise<ApplicationActorAlarmReceipt>;
  };
};

export interface ApplicationActorTurn<TState extends object, TProtocol extends ApplicationActorProtocolShape = ApplicationActorProtocol> {
  readonly key: string;
  readonly operationId: string;
  readonly principal: { readonly id: string };
  readonly causalPrincipal: { readonly id: string };
  readonly authorizationReceipt: ApplicationActorTurnAuthority['authorizationReceipt'];
  readonly trustedContextDigest: string;
  state(): Promise<Readonly<TState>>;
  setState(next: TState): Promise<void>;
  readonly broadcast: ApplicationActorBroadcasts<TProtocol>;
  /** Transactionally staged, identity-bound actor alarms. */
  readonly alarms: ApplicationActorBoundAlarms<TProtocol>;
}

type ApplicationActorHandlers<TState extends object, TProtocol extends ApplicationActorProtocolShape> = {
  initialize(handler: (actor: Pick<ApplicationActorTurn<TState>, 'key'>) => TState | Promise<TState>): void;
} & {
  [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorBroadcast' } ? never : TName]: TProtocol[TName] extends { readonly kind: 'actorConnectionMessage' }
    ? (handler: (actor: ApplicationActorTurn<TState, TProtocol>, connection: ApplicationActorConnectionContext, input: ActorInput<TProtocol[TName]>) => void | Promise<void>) => void
    : TProtocol[TName] extends { readonly kind: 'actorConnection' | 'actorDisconnection' }
      ? (handler: (actor: ApplicationActorTurn<TState, TProtocol>, connection: ApplicationActorConnectionContext, input: ActorInput<TProtocol[TName]>) => void | Promise<void>) => void
    : TProtocol[TName] extends { readonly kind: 'actorCommand' }
    ? (handler: (actor: ApplicationActorTurn<TState, TProtocol>, input: ActorInput<TProtocol[TName]>) => ActorOutput<TProtocol[TName]> | Promise<ActorOutput<TProtocol[TName]>>) => void
    : (handler: (actor: ApplicationActorTurn<TState, TProtocol>, input: ActorInput<TProtocol[TName]>) => void | Promise<void>) => void;
};

type ApplicationActorAlarms<TProtocol extends ApplicationActorProtocolShape> = {
  [TName in keyof TProtocol as TProtocol[TName] extends { readonly kind: 'actorAlarm' } ? TName : never]: {
    readonly schedule: ApplicationActorAlarmScheduleCall<ActorInput<TProtocol[TName]>>;
    cancel(key: string): Promise<ApplicationActorAlarmReceipt>;
  };
};

type ApplicationActorCalls<TProtocol extends ApplicationActorProtocolShape> = {
  [TName in keyof TProtocol]: TProtocol[TName] extends { readonly kind: 'actorCommand' }
    ? ApplicationActorCommandCall<ActorInput<TProtocol[TName]>, ActorOutput<TProtocol[TName]>>
    : TProtocol[TName] extends { readonly kind: 'actorMessage' }
      ? ApplicationActorMessageCall<ActorInput<TProtocol[TName]>>
      : TProtocol[TName] extends { readonly kind: 'actorConnection' }
        ? ApplicationActorScopedProtocolOperation<ActorInput<TProtocol[TName]>, TProtocol>
        : never;
};

type HydratedApplicationActorCalls<TProtocol extends ApplicationActorProtocolShape> = {
  [TName in keyof TProtocol]: TProtocol[TName] extends { readonly kind: 'actorCommand' }
    ? (input: ActorInput<TProtocol[TName]>, options?: ApplicationActorInvocationOptions) => Promise<ActorOutput<TProtocol[TName]>>
    : TProtocol[TName] extends { readonly kind: 'actorMessage' }
      ? { send(input: ActorInput<TProtocol[TName]>, options?: ApplicationActorInvocationOptions): Promise<ApplicationActorAdmissionReceipt> }
      : TProtocol[TName] extends { readonly kind: 'actorConnection' }
        ? (input: ActorInput<TProtocol[TName]>, options?: ApplicationActorConnectionOptions<ActorInputsOfKind<TProtocol, 'actorDisconnection'>>) => Promise<ApplicationActorClientConnection<TProtocol>>
        : never;
};

export type ApplicationActorHandle<TState extends object, TProtocol extends ApplicationActorProtocolShape> = ApplicationActorCalls<TProtocol> & {
  readonly kind: 'applicationActor';
  readonly id: string;
  readonly key: ApplicationActorKeySchema;
  readonly state: SchemaInput<TState>;
  readonly protocol: TProtocol;
  readonly graphNode: ApplicationActorNode;
  readonly on: ApplicationActorHandlers<TState, TProtocol>;
  readonly alarms: ApplicationActorAlarms<TProtocol>;
  reference(key: string): ApplicationActorReference;
  hydrate(reference: ApplicationActorReference): HydratedApplicationActorCalls<TProtocol>;
};

export const actor = Object.freeze({
  command<TInput extends object, TOutput extends object>(options: { readonly input: SchemaInput<TInput>; readonly output: SchemaInput<TOutput> }): ApplicationActorCommand<TInput, TOutput> {
    return Object.freeze({ kind: 'actorCommand', ...options });
  },
  message<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorMessage<TInput> {
    return Object.freeze({ kind: 'actorMessage', input });
  },
  alarm<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorAlarm<TInput> {
    return Object.freeze({ kind: 'actorAlarm', input });
  },
  connectionMessage<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorConnectionMessage<TInput> {
    return Object.freeze({ kind: 'actorConnectionMessage', input });
  },
  connection<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorConnection<TInput> {
    return Object.freeze({ kind: 'actorConnection', input });
  },
  disconnection<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorDisconnection<TInput> {
    return Object.freeze({ kind: 'actorDisconnection', input });
  },
  broadcast<TInput extends object>(input: SchemaInput<TInput>): ApplicationActorBroadcast<TInput> {
    return Object.freeze({ kind: 'actorBroadcast', input });
  },
});

/** Declares a persisted actor state revision and its forward migrations. */
export function actorState<TState extends object>(options: {
  readonly version: number;
  readonly schema: SchemaInput<TState>;
  readonly migrate?: Readonly<Record<number, (previous: object) => TState | Promise<TState>>>;
}): ApplicationActorStateDefinition<TState> {
  if (!Number.isSafeInteger(options.version) || options.version < 1) {
    throw new Error('actorState({ version }) must be a positive safe integer.');
  }
  const migrate = Object.freeze({ ...(options.migrate ?? {}) });
  for (const [revision, migration] of Object.entries(migrate)) {
    const from = Number(revision);
    if (!Number.isSafeInteger(from) || from < 1 || from >= options.version || typeof migration !== 'function') {
      throw new Error(`actorState migration ${JSON.stringify(revision)} must be a function for a prior positive revision.`);
    }
  }
  return Object.freeze({ kind: 'applicationActorState', version: options.version, schema: options.schema, migrate });
}

interface ActorDefinitionRuntime<TState extends object> {
  readonly id: string;
  readonly state: SchemaInput<TState>;
  readonly stateVersion: number;
  readonly migrations: Readonly<Record<number, (previous: object) => TState | Promise<TState>>>;
  readonly protocol: ErasedApplicationActorProtocol;
  readonly initialize?: (actor: Pick<ApplicationActorTurn<TState>, 'key'>) => TState | Promise<TState>;
  readonly handlers: ReadonlyMap<string, (...args: never[]) => unknown>;
}

const actorDefinitionRuntimeByHandle = new WeakMap<object, () => ActorDefinitionRuntime<object>>();
const actorDefinitionObservers = new WeakMap<object, Set<() => void>>();

export function replayApplicationActorDefinition(
  source: ApplicationActorHandle<object, ApplicationActorProtocol>,
  target: ApplicationActorHandle<object, ApplicationActorProtocol>,
): void {
  const readDefinition = actorDefinitionRuntimeByHandle.get(source);
  if (!readDefinition) throw new Error(`Actor ${source.id} has no definition metadata to replay.`);
  const definition = readDefinition();
  if (definition.initialize) target.on.initialize(definition.initialize);
  for (const [member, handler] of definition.handlers) {
    const register = Reflect.get(target.on, member);
    if (typeof register !== 'function') throw new Error(`Actor ${target.id}.${member} cannot replay its handler.`);
    Reflect.apply(register, target.on, [handler]);
  }
}

export function observeApplicationActorDefinition(
  actor: ApplicationActorHandle<object, ApplicationActorProtocol>,
  observer: () => void,
): () => void {
  const observers = actorDefinitionObservers.get(actor);
  if (!observers) throw new Error(`Actor ${actor.id} has no observable definition metadata.`);
  observers.add(observer);
  return () => observers.delete(observer);
}

export interface ApplicationActorRuntimeInvocation<TState extends object> {
  readonly definition: ActorDefinitionRuntime<TState>;
  readonly member: string;
  readonly memberKind: ApplicationActorProtocolMember['kind'];
  readonly key: string;
  readonly input: object;
  readonly connection?: ApplicationActorConnectionContext;
  readonly idempotencyKey?: string;
  readonly authority?: ApplicationActorTurnAuthority;
}

export interface ApplicationActorTurnAuthority {
  readonly principal: { readonly id: string };
  readonly causalPrincipal: { readonly id: string };
  readonly authorizationReceipt: ApplicationAuthorizationReceipt | { readonly id: string; readonly authorityRevision: string };
  readonly trustedContextDigest: string;
}

export interface ApplicationActorInvocationAuthorityRequest {
  readonly actor: string;
  readonly member: string;
  readonly memberKind: ApplicationActorProtocolMember['kind'];
  readonly key: string;
  readonly input: object;
  readonly transport: 'direct' | 'control-plane';
  readonly current: ApplicationActorTurnAuthority;
}

export type ApplicationActorInvocationAuthorityResolver = (
  request: ApplicationActorInvocationAuthorityRequest,
) => ApplicationActorTurnAuthority | Promise<ApplicationActorTurnAuthority>;

let actorInvocationAuthorityResolver: ApplicationActorInvocationAuthorityResolver | undefined;

export function installApplicationActorInvocationAuthorityResolver(
  resolver: ApplicationActorInvocationAuthorityResolver,
): () => void {
  if (actorInvocationAuthorityResolver) {
    throw new Error('Application actor invocation authority resolver is already installed.');
  }
  actorInvocationAuthorityResolver = resolver;
  return () => {
    if (actorInvocationAuthorityResolver === resolver) actorInvocationAuthorityResolver = undefined;
  };
}

export interface ApplicationActorRuntime {
  invoke<TState extends object>(request: ApplicationActorRuntimeInvocation<TState>): Promise<{ readonly result?: object; readonly receipt: ApplicationActorAdmissionReceipt }>;
  scheduleAlarm<TState extends object>(request: {
    readonly definition: ActorDefinitionRuntime<TState>;
    readonly member: string;
    readonly key: string;
    readonly input: object;
    readonly scheduledAt: string;
    readonly idempotencyKey?: string;
    readonly authority?: ApplicationActorTurnAuthority;
  }): Promise<ApplicationActorAlarmReceipt>;
  cancelAlarm(actor: string, member: string, key: string): Promise<ApplicationActorAlarmReceipt>;
}

export interface ApplicationActorConnectionRuntime {
  connect<TProtocol extends ApplicationActorProtocolShape>(request: {
    readonly actor: string;
    readonly key: string;
    readonly member: string;
    readonly input: object;
    readonly protocol: TProtocol;
    readonly options?: ApplicationActorConnectionOptions;
  }): Promise<ApplicationActorClientConnection<TProtocol>>;
}

interface ApplicationActorCallFrame {
  readonly actor: string;
  readonly keyDigest: string;
  readonly member: string;
}

const actorCallStack = new AsyncLocalStorage<readonly ApplicationActorCallFrame[]>();
const actorAuthority = new AsyncLocalStorage<ApplicationActorTurnAuthority>();

/** Compiler/runtime-only admission seam; client payloads can never populate this authority. */
export function withApplicationActorTurnAuthority<T>(
  authority: ApplicationActorTurnAuthority,
  callback: () => T,
): T {
  return actorAuthority.run(authority, callback);
}

export class ApplicationActorCallCycleError extends Error {
  readonly code = 'ACTOR_CALL_CYCLE';

  constructor(readonly path: readonly ApplicationActorCallFrame[]) {
    super(`Actor call cycle detected: ${path.map(({ actor, keyDigest, member }) => `${actor}[${keyDigest}].${member}`).join(' -> ')}.`);
    this.name = 'ApplicationActorCallCycleError';
  }
}

export class ApplicationActorIdempotencyConflictError extends Error {
  readonly code = 'ACTOR_IDEMPOTENCY_CONFLICT';

  constructor(readonly actor: string, readonly member: string) {
    super(`Actor ${actor}.${member} received an idempotency key already committed for a different invocation.`);
    this.name = 'ApplicationActorIdempotencyConflictError';
  }
}

async function invokeApplicationActorRuntime<TState extends object>(
  request: ApplicationActorRuntimeInvocation<TState>,
): Promise<{ readonly result?: object; readonly receipt: ApplicationActorAdmissionReceipt }> {
  const stack = actorCallStack.getStore() ?? [];
  const frame: ApplicationActorCallFrame = {
    actor: request.definition.id,
    keyDigest: stableDigest(request.key).slice(0, 16),
    member: request.member,
  };
  const cycleAt = stack.findIndex(({ actor, keyDigest }) => actor === frame.actor && keyDigest === frame.keyDigest);
  if (cycleAt >= 0) throw new ApplicationActorCallCycleError([...stack.slice(cycleAt), frame]);
  const currentAuthority = request.authority ?? actorAuthority.getStore();
  const authority = currentAuthority
    ? await resolveApplicationActorInvocationAuthority(
        {
          actor: request.definition.id,
          member: request.member,
          memberKind: request.memberKind,
          key: request.key,
          input: request.input,
          transport: 'direct',
          current: currentAuthority,
        },
      )
    : undefined;
  return actorCallStack.run([...stack, frame], () => actorRuntime().invoke({
    ...request,
    ...(authority ? { authority } : {}),
  }));
}

export async function resolveApplicationActorInvocationAuthority(
  request: ApplicationActorInvocationAuthorityRequest,
): Promise<ApplicationActorTurnAuthority> {
  const operationId = applicationOperationId({
    domain: 'actors',
    owner: request.actor,
    operation: request.member,
  });
  const receipt = request.current.authorizationReceipt;
  if ('operationId' in receipt && receipt.operationId === operationId) {
    return request.current;
  }
  if (!actorInvocationAuthorityResolver) {
    if ('operationId' in receipt) {
      throw new Error(
        `Actor ${request.actor}.${request.member} requires target-specific authority, but no actor authority resolver is installed.`,
      );
    }
    return request.current;
  }
  return actorInvocationAuthorityResolver(request);
}

/**
 * Admits a provider-delivered alarm through the same schema, handler, receipt,
 * serialization, and telemetry path as an application-scheduled alarm.
 * Provider adapters use this internal transport seam; application code keeps
 * using `Actor.alarms.<name>.schedule(...)`.
 */
export async function executeApplicationActorAlarm(
  handle: ApplicationActorHandle<object, ApplicationActorProtocol>,
  request: {
    readonly member: string;
    readonly key: string;
    readonly input: object;
    readonly idempotencyKey: string;
    readonly authority?: ApplicationActorTurnAuthority;
  },
): Promise<ApplicationActorAdmissionReceipt> {
  const readDefinition = actorDefinitionRuntimeByHandle.get(handle);
  if (!readDefinition) throw new Error(`Actor ${handle.id} has no runtime definition.`);
  const definition = readDefinition();
  const member = definition.protocol[request.member];
  if (member?.kind !== 'actorAlarm') {
    throw new Error(`Actor ${handle.id}.${request.member} is not a declared alarm.`);
  }
  const result = await invokeApplicationActorRuntime({
    definition,
    member: request.member,
    memberKind: 'actorAlarm',
    key: validateActorKey(handle.key, request.key, `${handle.id}.key`),
    input: validateMessage(
      member.input,
      request.input,
      `${handle.id}.${request.member}.input`,
    ),
    idempotencyKey: request.idempotencyKey,
    ...(request.authority ? { authority: request.authority } : {}),
  });
  return result.receipt;
}

/**
 * Trusted gateway/provider seam for a realtime actor turn. Application source
 * keeps declaring `Actor.on.<member>`; it never receives a provider socket.
 */
export async function executeApplicationActorRealtime(
  handle: ApplicationActorHandle<object, ApplicationActorProtocol>,
  request: ApplicationActorRealtimeInvocation,
): Promise<ApplicationActorAdmissionReceipt> {
  const readDefinition = actorDefinitionRuntimeByHandle.get(handle);
  if (!readDefinition) throw new Error(`Actor ${handle.id} has no runtime definition.`);
  const definition = readDefinition();
  const member = definition.protocol[request.member];
  const expectedKind = request.kind === 'connection'
    ? 'actorConnection'
    : request.kind === 'connectionMessage'
      ? 'actorConnectionMessage'
      : 'actorDisconnection';
  if (member?.kind !== expectedKind) throw new Error(`Actor ${handle.id}.${request.member} is not a declared ${request.kind} member.`);
  const key = validateActorKey(handle.key, request.key, `${handle.id}.key`);
  const input = validateMessage(member.input, request.input, `${handle.id}.${request.member}.input`);
  const connection = validateActorConnectionContext(request.connection, handle.id, request.member, key, input);
  const result = await invokeApplicationActorRuntime({
    definition,
    member: request.member,
    memberKind: expectedKind,
    key,
    input,
    connection,
    idempotencyKey: request.idempotencyKey,
  });
  return result.receipt;
}

const actorRuntimeResolvers: Array<() => ApplicationActorRuntime | undefined> = [];
export function installApplicationActorRuntimeResolver(resolver: () => ApplicationActorRuntime | undefined): () => void {
  actorRuntimeResolvers.push(resolver);
  return () => { const index = actorRuntimeResolvers.lastIndexOf(resolver); if (index >= 0) actorRuntimeResolvers.splice(index, 1); };
}

function actorRuntime(): ApplicationActorRuntime {
  for (let index = actorRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = actorRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  throw new Error('No ActorRuntime is installed for this execution boundary.');
}

const actorConnectionRuntimeResolvers: Array<() => ApplicationActorConnectionRuntime | undefined> = [];
export function installApplicationActorConnectionRuntimeResolver(resolver: () => ApplicationActorConnectionRuntime | undefined): () => void {
  actorConnectionRuntimeResolvers.push(resolver);
  return () => {
    const index = actorConnectionRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) actorConnectionRuntimeResolvers.splice(index, 1);
  };
}

function actorConnectionRuntime(): ApplicationActorConnectionRuntime {
  for (let index = actorConnectionRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = actorConnectionRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  throw new Error('No authorized actor connection runtime is installed for this execution boundary.');
}

export function createApplicationActor<TState extends object, const TProtocol extends ApplicationActorProtocolShape>(
  id: string,
  options: { readonly key: ApplicationActorKeySchema; readonly state: ApplicationActorStateInput<TState>; readonly protocol: TProtocol },
): ApplicationActorHandle<TState, TProtocol> {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id)) throw new Error(`Actor identity ${JSON.stringify(id)} must be a stable lower-case identifier.`);
  validateActorProtocol(options.protocol, id);
  const reserved = new Set(['on', 'initialize', 'finalize', 'reference', 'hydrate', 'alarms', 'broadcast', 'state', 'protocol', 'kind', 'id', 'key']);
  for (const name of Object.keys(options.protocol)) if (reserved.has(name)) throw new Error(`Actor protocol member ${name} collides with a framework member.`);
  const runtimeProtocol = options.protocol as unknown as ErasedApplicationActorProtocol;
  const stateDefinition = normalizeActorState(options.state);
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const memberOperations = new Map<string, ApplicationActorAuthorityFacet<{ readonly key: string }>>();
  const observers = new Set<() => void>();
  let initialize: ActorDefinitionRuntime<TState>['initialize'];
  const definition = (): ActorDefinitionRuntime<TState> => ({
    id,
    state: stateDefinition.schema,
    stateVersion: stateDefinition.version,
    migrations: stateDefinition.migrate,
    protocol: runtimeProtocol,
    ...(initialize ? { initialize } : {}),
    handlers,
  });
  const graphNode = (): ApplicationActorNode => {
    const dependencyBindings = Object.fromEntries(
      [
        ...(initialize ? [['initialize', initialize] as const] : []),
        ...[...handlers].map(([member, callback]) => [member, callback] as const),
      ].flatMap(([member, callback]) => {
        const expanded = expandApplicationCallbackDependencies({ calls: [callback] });
        return [
          ...Object.entries(expanded.bindings).map(([identifier, value]) => [
            `${member}:${identifier}`,
            value,
          ] as const),
          [`${member}:generatedActorProviderDependencies`, callback] as const,
        ];
      }),
    );
    const providerBindings = applicationCallableProviderDependencies(
      dependencyBindings,
    );
    return ({
    id: `actor.${id}`,
    kind: 'actor',
    name: id,
    stability: 'experimental',
    definition: {
      id,
      key: declaredSchema(options.key as unknown as SchemaInput<object>, `${id}.key`),
      state: declaredSchema(stateDefinition.schema, `${id}.state`),
      stateVersion: stateDefinition.version,
      migrationDigest: stableDigest(Object.entries(stateDefinition.migrate).map(([from, migration]) => ({ from: Number(from), source: migration.toString() }))),
      migrations: Object.entries(stateDefinition.migrate).map(([from, migration]) => ({
        from: Number(from),
        callback: serializeApplicationCallback({ registrar: 'actorState', argumentIndex: 0, property: from, label: `Actor ${id} state migration ${from}`, callback: migration as (...args: never[]) => unknown, allowDeferredResolution: true }),
      })),
      protocol: Object.entries(runtimeProtocol).map(([name, member]) => {
        const declaredAuthority = memberOperations.get(name)?.operation.authority;
        const authority = declaredAuthority ?? (
          member.kind === 'actorConnectionMessage' || member.kind === 'actorDisconnection'
            ? {
                classification: 'application-policy' as const,
                permissionIds: [],
                grantable: false,
                delegable: false,
                scope: { kind: 'all' as const },
                transports: ['http', 'control-plane'] as const,
              }
            : undefined
        );
        return {
        name,
        kind: member.kind === 'actorCommand'
          ? 'command'
          : member.kind === 'actorMessage'
            ? 'message'
            : member.kind === 'actorConnectionMessage'
              ? 'connectionMessage'
              : member.kind === 'actorConnection'
                ? 'connection'
                : member.kind === 'actorDisconnection'
                  ? 'disconnection'
                  : member.kind === 'actorBroadcast'
                    ? 'broadcast'
                    : 'alarm',
        input: declaredSchema(member.input, `${id}.${name}.input`),
        ...(member.kind === 'actorCommand' ? { output: declaredSchema(member.output, `${id}.${name}.output`) } : {}),
        ...(authority ? { authority } : {}),
      };
      }),
      requirements: actorCapabilityRequirements(runtimeProtocol),
    },
    runtime: { interface: 'ActorRuntime', nodeId: applicationProviderGraphNodeId('ActorRuntime') },
    ...(providerBindings.length > 0 ? { providerBindings } : {}),
    handlers: [...handlers].map(([member, callback]) => ({
      member,
      callback: serializeApplicationCallback({ registrar: 'actor', argumentIndex: 1, property: member, label: `Actor ${id}.${member}`, callback: callback as (...args: never[]) => unknown, allowDeferredResolution: true }),
    })),
    ...(initialize ? { initialize: serializeApplicationCallback({ registrar: 'actor', argumentIndex: 1, property: 'initialize', label: `Actor ${id}.initialize`, callback: initialize as (...args: never[]) => unknown, allowDeferredResolution: true }) } : {}),
    semantics: { serialization: 'fullTurnPerIdentity', admission: 'idempotentReceipt', references: 'inertAddress' },
    });
  };
  const target: Record<string, unknown> = {
    kind: 'applicationActor', id, key: options.key, state: stateDefinition.schema, protocol: options.protocol,
    get graphNode() { return Object.freeze(graphNode()); },
    reference(key: string): ApplicationActorReference {
      const validated = validateActorKey(options.key, key, `${id}.key`);
      return Object.freeze({ apiVersion: 'applik8s.actorReference/v1alpha1', actor: id, key: validated });
    },
  };
  const calls: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(runtimeProtocol)) {
    const contract = {
      apiVersion: 'applik8s.operation/v1alpha1' as const,
      kind: 'applicationOperation' as const,
      id: applicationOperationId({ domain: 'actors', owner: id, operation: name }),
      model: id,
      name,
      operation: 'custom' as const,
      transport: 'runtime' as const,
      version: 'v1',
    };
    if (member.kind === 'actorCommand') {
      const call = async (key: string, input: object, invocation: ApplicationActorInvocationOptions = {}) => {
        const response = await invokeApplicationActorRuntime({ definition: definition(), member: name, memberKind: member.kind, key: validateActorKey(options.key, key, `${id}.key`), input: validateMessage(member.input, input, `${id}.${name}.input`), ...invocation });
        return validateMessage(member.output, response.result, `${id}.${name}.output`);
      };
      calls[name] = decorateApplicationMutationOperation(call as never, contract, { input: member.input, output: member.output });
    } else if (member.kind === 'actorMessage') {
      const send = async (key: string, input: object, invocation: ApplicationActorInvocationOptions = {}) => (await invokeApplicationActorRuntime({ definition: definition(), member: name, memberKind: member.kind, key: validateActorKey(options.key, key, `${id}.key`), input: validateMessage(member.input, input, `${id}.${name}.input`), ...invocation })).receipt;
      calls[name] = { send: decorateApplicationMutationOperation(send as never, contract) };
    } else if (member.kind === 'actorConnection') {
      const connect = async (key: string, input: object, connectionOptions: ApplicationActorConnectionOptions = {}) => actorConnectionRuntime().connect({
        actor: id,
        key: validateActorKey(options.key, key, `${id}.key`),
        member: name,
        input: validateMessage(member.input, input, `${id}.${name}.input`),
        protocol: options.protocol,
        options: connectionOptions,
      });
      calls[name] = decorateApplicationMutationOperation(connect as never, contract, { input: member.input, output: member.input });
    }
    const operation = typeof calls[name] === 'function'
      ? calls[name]
      : calls[name] && typeof calls[name] === 'object'
        ? Reflect.get(calls[name] as object, 'send')
        : undefined;
    if (typeof operation === 'function') {
      memberOperations.set(name, operation as unknown as ApplicationActorAuthorityFacet<{ readonly key: string }>);
      observeApplicationOperationAuthority(operation as never, () => { for (const observer of observers) observer(); });
    }
  }
  Object.assign(target, calls);
  target.alarms = Object.fromEntries(Object.entries(runtimeProtocol).flatMap(([name, member]) => {
    if (member.kind !== 'actorAlarm') return [];
    const schedule = async (key: string, at: string | Date, input: object, invocation: ApplicationActorInvocationOptions = {}) => {
          const scheduledAt = actorAlarmTimestamp(at, id, name);
          const keyValue = validateActorKey(options.key, key, `${id}.key`);
          const inputValue = validateMessage(member.input, input, `${id}.${name}.input`);
          const currentAuthority = actorAuthority.getStore();
          const authority = currentAuthority
            ? await resolveApplicationActorInvocationAuthority({ actor: id, member: name, memberKind: member.kind, key: keyValue, input: inputValue, transport: 'control-plane', current: currentAuthority })
            : undefined;
          return actorRuntime().scheduleAlarm({ definition: definition(), member: name, key: keyValue, input: inputValue, scheduledAt, ...invocation, ...(authority ? { authority } : {}) });
        };
    const operation = decorateApplicationMutationOperation(schedule as never, {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: applicationOperationId({ domain: 'actors', owner: id, operation: name }),
      model: id,
      name,
      operation: 'custom',
      transport: 'runtime',
      version: 'v1',
    });
    memberOperations.set(name, operation as unknown as ApplicationActorAuthorityFacet<{ readonly key: string }>);
    observeApplicationOperationAuthority(operation, () => { for (const observer of observers) observer(); });
    return [[name, {
        schedule: operation,
        cancel: (key: string) => actorRuntime().cancelAlarm(id, name, validateActorKey(options.key, key, `${id}.key`)),
      }]];
  }));
  target.hydrate = (reference: ApplicationActorReference) => {
    if (reference.apiVersion !== 'applik8s.actorReference/v1alpha1' || reference.actor !== id) throw new Error(`Actor reference does not address ${id}.`);
    return Object.fromEntries(Object.entries(calls).map(([name, call]) => [name, typeof call === 'function'
      ? (input: object, invocation?: ApplicationActorInvocationOptions) => Reflect.apply(call, target, [reference.key, input, invocation])
      : { send: (input: object, invocation?: ApplicationActorInvocationOptions) => Reflect.apply(Reflect.get(call as object, 'send'), call, [reference.key, input, invocation]) }]));
  };
  target.on = new Proxy({ initialize(handler: ActorDefinitionRuntime<TState>['initialize']) { if (initialize) throw new Error(`Actor ${id} initialize handler is already registered.`); initialize = handler; for (const observer of observers) observer(); } }, {
    get(value, property) {
      if (property === 'initialize') return Reflect.get(value, property);
      if (typeof property !== 'string' || !runtimeProtocol[property] || runtimeProtocol[property].kind === 'actorBroadcast') return undefined;
      return (handler: (...args: never[]) => unknown) => {
        if (handlers.has(property)) throw new Error(`Actor ${id}.${property} handler is already registered.`);
        handlers.set(property, handler);
        for (const observer of observers) observer();
      };
    },
  });
  const handle = Object.freeze(target) as ApplicationActorHandle<TState, TProtocol>;
  actorDefinitionRuntimeByHandle.set(handle, definition as unknown as () => ActorDefinitionRuntime<object>);
  actorDefinitionObservers.set(handle, observers);
  return handle;
}

function actorCapabilityRequirements(protocol: ErasedApplicationActorProtocol): ApplicationActorNode['definition']['requirements'] {
  const kinds = new Set(Object.values(protocol).map(({ kind }) => kind));
  const realtimeConnections = kinds.has('actorConnection') || kinds.has('actorDisconnection') || kinds.has('actorConnectionMessage');
  return {
    durableState: true,
    serializedTurns: true,
    // Ordinary typed events are ambient inside every actor turn, so every
    // qualified actor provider must offer the durable outbox boundary even
    // when the declared protocol contains no realtime broadcasts.
    transactionalOutbox: true,
    durableAlarms: kinds.has('actorAlarm'),
    realtimeConnections,
    connectionLeases: realtimeConnections,
    realtimeMessages: kinds.has('actorConnectionMessage'),
    realtimeBroadcast: kinds.has('actorBroadcast'),
  };
}

function normalizeActorState<TState extends object>(
  value: ApplicationActorStateInput<TState>,
): ApplicationActorStateDefinition<TState> {
  if (value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationActorState') {
    return value as ApplicationActorStateDefinition<TState>;
  }
  return Object.freeze({
    kind: 'applicationActorState' as const,
    version: 1,
    schema: value as SchemaInput<TState>,
    migrate: Object.freeze({}),
  });
}

function validateActorProtocol(protocol: ApplicationActorProtocolShape, id: string): void {
  const kinds = new Set<ApplicationActorProtocolMember['kind']>([
    'actorCommand', 'actorMessage', 'actorAlarm', 'actorConnectionMessage', 'actorConnection', 'actorDisconnection', 'actorBroadcast',
  ]);
  for (const [name, value] of Object.entries(protocol)) {
    if (!value || typeof value !== 'object' || !kinds.has(Reflect.get(value, 'kind') as ApplicationActorProtocolMember['kind']) || !Reflect.get(value, 'input')) {
      throw new Error(`Actor ${id} protocol member ${name} must be declared with actor.command/message/alarm/connection/broadcast.`);
    }
    if (Reflect.get(value, 'kind') === 'actorCommand' && !Reflect.get(value, 'output')) {
      throw new Error(`Actor ${id} command ${name} requires an output schema.`);
    }
  }
}

export interface DeterministicApplicationActorRuntime extends ApplicationActorRuntime {
  inspect(actor: string, key: string): { readonly revision: number; readonly state: object } | undefined;
  broadcasts(actor: string, key: string): readonly { readonly member: string; readonly value: object; readonly receipt: ApplicationActorBroadcastReceipt }[];
  tick(at?: Date): Promise<readonly ApplicationActorAdmissionReceipt[]>;
  /** Retries committed event effects which have not yet been acknowledged. */
  drainEffects(): Promise<void>;
  snapshot(): ApplicationActorRuntimeSnapshot;
}

export interface ApplicationActorRuntimeSnapshot {
  readonly apiVersion: 'applik8s.actorRuntimeSnapshot/v1alpha1';
  readonly states: readonly { readonly identity: string; readonly revision: number; readonly stateVersion: number; readonly state: object }[];
  readonly receipts: readonly {
    readonly scope: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly result?: object;
    readonly receipt: ApplicationActorAdmissionReceipt;
  }[];
  readonly alarms: readonly { readonly alarmId: string; readonly actor: string; readonly member: string; readonly key: string; readonly input: object; readonly scheduledAt: string; readonly idempotencyKey?: string; readonly authority?: ApplicationActorTurnAuthority }[];
  readonly broadcasts: readonly { readonly identity: string; readonly records: readonly { readonly member: string; readonly value: object; readonly receipt: ApplicationActorBroadcastReceipt }[] }[];
  readonly effects?: readonly ApplicationActorOutboxEvent[];
}

export function createDeterministicApplicationActorRuntime(options: {
  readonly snapshot?: ApplicationActorRuntimeSnapshot;
  readonly persist?: (snapshot: ApplicationActorRuntimeSnapshot) => void | Promise<void>;
  readonly deliverEvent?: (event: ApplicationActorOutboxEvent) => void | Promise<void>;
} = {}): DeterministicApplicationActorRuntime {
  if (options.snapshot && options.snapshot.apiVersion !== 'applik8s.actorRuntimeSnapshot/v1alpha1') throw new Error('Actor runtime snapshot has an unsupported schema version.');
  const states = new Map((options.snapshot?.states ?? []).map(({ identity, revision, stateVersion, state }) => [identity, { revision, stateVersion: stateVersion || 1, state }]));
  const receipts = new Map((options.snapshot?.receipts ?? []).map(({ scope, operationId, fingerprint, result, receipt }) => {
    const restoredScope = scope || `${receipt.actor}:${receipt.key}:${receipt.member}`;
    return [actorReceiptKey(restoredScope, operationId), { scope: restoredScope, operationId, fingerprint: fingerprint || '', ...(result ? { result } : {}), receipt }];
  }));
  const tails = new Map<string, Promise<void>>();
  const definitions = new Map<string, ActorDefinitionRuntime<object>>();
  const alarms = new Map((options.snapshot?.alarms ?? []).map(({ alarmId, actor, ...alarm }) => [alarmId, { actor, ...alarm }]));
  const published = new Map((options.snapshot?.broadcasts ?? []).map(({ identity, records }) => [identity, [...records]]));
  const effects = new Map((options.snapshot?.effects ?? []).map((effect) => [effect.effectId, effect]));
  let persistence = Promise.resolve();
  let draining: Promise<void> | undefined;
  let runtime!: DeterministicApplicationActorRuntime;
  const persistSnapshot = options.persist;
  const persist = async (): Promise<void> => {
    if (!persistSnapshot) return;
    const snapshot = runtime.snapshot();
    const next = persistence.then(() => persistSnapshot(snapshot));
    persistence = next.then(() => undefined, () => undefined);
    await next;
  };
  runtime = {
    invoke(request) {
      definitions.set(request.definition.id, request.definition as unknown as ActorDefinitionRuntime<object>);
      const identity = `${request.definition.id}:${request.key}`;
      const operationId = request.idempotencyKey?.trim() || `actor_${randomUUID()}`;
      const scope = `${identity}:${request.member}`;
      const fingerprint = stableDigest({ identity, member: request.member, input: request.input });
      const receiptKey = actorReceiptKey(scope, operationId);
      const previous = tails.get(identity) ?? Promise.resolve();
      let release!: () => void;
      const turn = new Promise<void>((resolve) => { release = resolve; });
      const tail = previous.then(() => turn);
      tails.set(identity, tail);
      return previous.then(async () => {
        const prior = receipts.get(receiptKey);
        if (prior) {
          if (prior.fingerprint && prior.fingerprint !== fingerprint) throw new ApplicationActorIdempotencyConflictError(request.definition.id, request.member);
          return { ...(prior.result ? { result: prior.result } : {}), receipt: { ...prior.receipt, replayed: true } };
        }
        const persistedCurrent = states.get(identity);
        let current = persistedCurrent;
        if (!current) {
          if (!request.definition.initialize) throw new Error(`Actor ${request.definition.id} has no initialize handler for absent key ${request.key}.`);
          current = { revision: 0, stateVersion: request.definition.stateVersion, state: validateMessage(request.definition.state, await request.definition.initialize({ key: request.key }), `${request.definition.id}.state`) };
        } else {
          current = await migrateApplicationActorState(request.definition, current, request.key);
        }
        const currentRevision = current.revision;
        const ephemeral = request.memberKind === 'actorConnectionMessage';
        const frameworkStateChanged = !persistedCurrent || persistedCurrent.stateVersion !== request.definition.stateVersion;
        const committedRevision = ephemeral && !frameworkStateChanged ? currentRevision : currentRevision + 1;
        const handler = request.definition.handlers.get(request.member)
          ?? (request.memberKind === 'actorConnection' || request.memberKind === 'actorDisconnection'
            ? (async () => undefined) as (...args: never[]) => unknown
            : undefined);
        if (!handler) throw new Error(`Actor ${request.definition.id}.${request.member} has no registered handler.`);
        let staged = current.state;
        const stagedBroadcasts: Array<{ member: string; value: object }> = [];
        const stagedEffects: Array<Omit<ApplicationActorOutboxEvent, 'effectId' | 'operationId' | 'recordedAt' | 'partitionKey'>> = [];
        const stagedAlarms: Array<
          | { readonly kind: 'schedule'; readonly alarmId: string; readonly member: string; readonly input: object; readonly scheduledAt: string; readonly idempotencyKey?: string; readonly authority: ApplicationActorTurnAuthority }
          | { readonly kind: 'cancel'; readonly alarmId: string; readonly member: string }
        > = [];
        const authority = actorTurnAuthority(request, operationId);
        const broadcast = Object.fromEntries(Object.entries(request.definition.protocol).flatMap(([name, member]) => member.kind === 'actorBroadcast'
          ? [[name, async (input: object) => {
              const value = validateMessage(member.input, input, `${request.definition.id}.${name}.input`);
              stagedBroadcasts.push({ member: name, value });
              return { broadcastId: `broadcast_${stableDigest({ operationId, name, index: stagedBroadcasts.length - 1 })}`, actor: request.definition.id, key: request.key, member: name, revision: committedRevision };
            }]]
          : []));
        const boundAlarms = Object.fromEntries(Object.entries(request.definition.protocol).flatMap(([name, member]) => member.kind === 'actorAlarm'
          ? [[name, {
              schedule: async (at: string | Date, input: object, invocation: ApplicationActorInvocationOptions = {}) => {
                if (ephemeral) throw new Error('Ephemeral actor connection messages cannot schedule durable alarms.');
                const scheduledAt = actorAlarmTimestamp(at, request.definition.id, name);
                const alarmId = actorAlarmId(request.definition.id, name, request.key);
                const admittedInput = validateMessage(member.input, input, `${request.definition.id}.${name}.input`);
                const alarmAuthority = await resolveApplicationActorInvocationAuthority({ actor: request.definition.id, member: name, memberKind: member.kind, key: request.key, input: admittedInput, transport: 'control-plane', current: authority });
                stagedAlarms.push({ kind: 'schedule', alarmId, member: name, input: admittedInput, scheduledAt, authority: alarmAuthority, ...(invocation.idempotencyKey ? { idempotencyKey: invocation.idempotencyKey } : {}) });
                return { alarmId, actor: request.definition.id, key: request.key, member: name, scheduledAt, state: 'scheduled' as const };
              },
              cancel: async () => {
                if (ephemeral) throw new Error('Ephemeral actor connection messages cannot cancel durable alarms.');
                const alarmId = actorAlarmId(request.definition.id, name, request.key);
                stagedAlarms.push({ kind: 'cancel', alarmId, member: name });
                const scheduledAt = alarms.get(alarmId)?.scheduledAt ?? new Date(0).toISOString();
                return { alarmId, actor: request.definition.id, key: request.key, member: name, scheduledAt, state: 'cancelled' as const };
              },
            }]]
          : []));
        const actor: ApplicationActorTurn<object> = {
          key: request.key,
          operationId,
          ...authority,
          async state() { return Object.freeze(structuredClone(staged)); },
          async setState(next) {
            if (ephemeral) throw new Error('Ephemeral actor connection messages cannot mutate durable state.');
            staged = validateMessage(request.definition.state, next, `${request.definition.id}.state`);
          },
          broadcast,
          alarms: boundAlarms,
        };
        const result = await runApplicationTelemetryBoundary({ kind: 'actor', identity: `${request.definition.id}.${request.member}`, attributes: { 'applik8s.actor.key_digest': stableDigest(request.key).slice(0, 16) } }, async () => withApplicationManagedEffects({
          commandId: operationId,
          routingContext: {},
          emit(contract, payload) {
            if (ephemeral) throw new Error('Ephemeral actor connection messages cannot emit durable application events.');
            const name = typeof Reflect.get(contract, 'name') === 'string' ? String(Reflect.get(contract, 'name')) : contract.id;
            const version = typeof Reflect.get(contract, 'version') === 'string' ? String(Reflect.get(contract, 'version')) : 'v1';
            const schema = Reflect.get(contract, 'payload');
            const value = schema ? validateMessage(schema as SchemaInput<object>, payload, `${contract.id}.payload`) : structuredClone(payload);
            const sequence = stagedEffects.length;
            stagedEffects.push({ contract: { id: contract.id, name, version }, payload: value });
            return { kind: 'applicationStagedEffect', effect: 'event', contract: contract.id, sequence };
          },
          invoke() {
            throw new Error('Actor turns cannot synchronously stage command results; use a typed actor call or durable workflow.');
          },
          }, async () => withApplicationActorTurnAuthority({
            principal: { id: `actor:${request.definition.id}:${stableDigest(request.key).slice(0, 24)}` },
            causalPrincipal: authority.causalPrincipal,
            authorizationReceipt: authority.authorizationReceipt,
            trustedContextDigest: authority.trustedContextDigest,
          }, () => Reflect.apply(handler, undefined, request.connection
            ? [actor, request.connection, request.input]
            : [actor, request.input]))));
        const committed = {
          revision: committedRevision,
          stateVersion: request.definition.stateVersion,
          state: staged,
        };
        states.set(identity, committed);
        for (const operation of stagedAlarms) {
          if (operation.kind === 'cancel') alarms.delete(operation.alarmId);
          else alarms.set(operation.alarmId, { actor: request.definition.id, member: operation.member, key: request.key, input: operation.input, scheduledAt: operation.scheduledAt, authority: operation.authority, ...(operation.idempotencyKey ? { idempotencyKey: operation.idempotencyKey } : {}) });
        }
        if (stagedBroadcasts.length > 0) {
          const records = published.get(identity) ?? [];
          for (const [index, item] of stagedBroadcasts.entries()) records.push({
            ...item,
            receipt: { broadcastId: `broadcast_${stableDigest({ operationId, name: item.member, index })}`, actor: request.definition.id, key: request.key, member: item.member, revision: committed.revision },
          });
          published.set(identity, records);
        }
        const receipt: ApplicationActorAdmissionReceipt = { operationId, actor: request.definition.id, key: request.key, member: request.member, state: 'committed', revision: committed.revision, replayed: false };
        const recordedAt = new Date().toISOString();
        for (const [index, effect] of stagedEffects.entries()) {
          const record: ApplicationActorOutboxEvent = {
            ...effect,
            effectId: `actor_effect_${stableDigest({ identity, operationId, index, contract: effect.contract.id })}`,
            operationId,
            recordedAt,
            partitionKey: request.key,
          };
          effects.set(record.effectId, record);
        }
        const record = { scope, operationId, fingerprint, ...(result && typeof result === 'object' ? { result: result as object } : {}), receipt };
        receipts.set(receiptKey, record);
        await persist();
        await runtime.drainEffects().catch(() => undefined);
        return record;
      }).finally(() => { release(); if (tails.get(identity) === tail) tails.delete(identity); });
    },
    async scheduleAlarm(request) {
      definitions.set(request.definition.id, request.definition as unknown as ActorDefinitionRuntime<object>);
      const alarmId = actorAlarmId(request.definition.id, request.member, request.key);
      alarms.set(alarmId, { actor: request.definition.id, member: request.member, key: request.key, input: request.input, scheduledAt: request.scheduledAt, ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}), ...(request.authority ? { authority: request.authority } : {}) });
      await persist();
      return { alarmId, actor: request.definition.id, key: request.key, member: request.member, scheduledAt: request.scheduledAt, state: 'scheduled' };
    },
    async cancelAlarm(actor, member, key) {
      const alarmId = actorAlarmId(actor, member, key);
      const existing = alarms.get(alarmId);
      alarms.delete(alarmId);
      await persist();
      return { alarmId, actor, key, member, scheduledAt: existing?.scheduledAt ?? new Date(0).toISOString(), state: 'cancelled' };
    },
    inspect(actor, key) {
      const found = states.get(`${actor}:${key}`);
      return found ? { revision: found.revision, state: found.state } : undefined;
    },
    broadcasts(actor, key) { return published.get(`${actor}:${key}`) ?? []; },
    async drainEffects() {
      if (!options.deliverEvent || effects.size === 0) return;
      if (draining) return draining;
      draining = (async () => {
        for (const effect of [...effects.values()].sort((left, right) => left.effectId.localeCompare(right.effectId))) {
          await options.deliverEvent?.(effect);
          effects.delete(effect.effectId);
          await persist();
        }
      })();
      try { await draining; } finally { draining = undefined; }
    },
    async tick(at = new Date()) {
      const due = [...alarms.entries()].filter(([, alarm]) => Date.parse(alarm.scheduledAt) <= at.getTime()).sort((left, right) => left[1].scheduledAt.localeCompare(right[1].scheduledAt) || left[0].localeCompare(right[0]));
      const admitted: ApplicationActorAdmissionReceipt[] = [];
      for (const [alarmId, alarm] of due) {
        alarms.delete(alarmId);
        const definition = definitions.get(alarm.actor);
        if (!definition) throw new Error(`Actor alarm ${alarmId} cannot resume until actor definition ${alarm.actor} is registered in this process.`);
        const result = await this.invoke({ definition: definition as never, member: alarm.member, memberKind: 'actorAlarm', key: alarm.key, input: alarm.input, idempotencyKey: alarm.idempotencyKey ?? alarmId, ...(alarm.authority ? { authority: alarm.authority } : {}) });
        admitted.push(result.receipt);
      }
      await persist();
      return admitted;
    },
    snapshot: () => ({
      apiVersion: 'applik8s.actorRuntimeSnapshot/v1alpha1',
      states: [...states].map(([identity, value]) => ({ identity, ...structuredClone(value) })).sort((left, right) => left.identity.localeCompare(right.identity)),
      receipts: [...receipts.values()].map((value) => structuredClone(value)).sort((left, right) => left.scope.localeCompare(right.scope) || left.operationId.localeCompare(right.operationId)),
      alarms: [...alarms].map(([alarmId, value]) => ({ alarmId, ...structuredClone(value) })).sort((left, right) => left.alarmId.localeCompare(right.alarmId)),
      broadcasts: [...published].map(([identity, records]) => ({ identity, records: structuredClone(records) })).sort((left, right) => left.identity.localeCompare(right.identity)),
      effects: [...effects.values()].map((effect) => structuredClone(effect)).sort((left, right) => left.effectId.localeCompare(right.effectId)),
    }),
  };
  return runtime;
}

async function migrateApplicationActorState<TState extends object>(
  definition: ActorDefinitionRuntime<TState>,
  current: { readonly revision: number; readonly stateVersion: number; readonly state: object },
  key: string,
): Promise<{ readonly revision: number; readonly stateVersion: number; readonly state: object }> {
  if (current.stateVersion > definition.stateVersion) {
    throw new Error(`Actor ${definition.id}[${stableDigest(key).slice(0, 16)}] state revision ${current.stateVersion} is newer than runtime revision ${definition.stateVersion}; rollback is unsupported.`);
  }
  if (current.stateVersion === definition.stateVersion) {
    return { ...current, state: validateMessage(definition.state, current.state, `${definition.id}.state`) };
  }
  let value = structuredClone(current.state);
  for (let from = current.stateVersion; from < definition.stateVersion; from += 1) {
    const migration = definition.migrations[from];
    if (!migration) throw new Error(`Actor ${definition.id} state revision ${from} has no declared migration to revision ${from + 1}.`);
    value = await migration(Object.freeze(structuredClone(value)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Actor ${definition.id} migration ${from} returned a non-object state.`);
  }
  return {
    revision: current.revision,
    stateVersion: definition.stateVersion,
    state: validateMessage(definition.state, value, `${definition.id}.state`),
  };
}

function validateActorKey(schema: ApplicationActorKeySchema, value: unknown, label: string): string {
  try {
    const key = schema.assert(value);
    if (typeof key !== 'string' || key.length === 0) throw new Error('must be a non-empty string');
    return key;
  } catch (cause) {
    throw new Error(`${label} failed schema validation.`, { cause });
  }
}

function validateActorConnectionContext(
  connection: ApplicationActorConnectionContext,
  actor: string,
  member: string,
  key: string,
  input: object,
): ApplicationActorConnectionContext {
  const connectedAt = Date.parse(connection.connectedAt);
  const leaseExpiresAt = Date.parse(connection.leaseExpiresAt);
  if (!connection.id?.trim()
    || !connection.principal?.id?.trim()
    || !connection.causalPrincipal?.id?.trim()
    || !connection.authorizationReceipt?.id?.trim()
    || !connection.authorizationReceipt?.authorityRevision?.trim()
    || !connection.trustedContextDigest?.trim()) {
    throw new Error(`Actor ${actor}.${member} received an incomplete framework connection identity.`);
  }
  if (!Number.isFinite(connectedAt) || !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= connectedAt) {
    throw new Error(`Actor ${actor}.${member} received an invalid connection lease.`);
  }
  const receiptDiagnostics = validateApplicationAuthorizationReceipt(connection.authorizationReceipt);
  const expectedOperationId = applicationOperationId({ domain: 'actors', owner: actor, operation: member });
  if (receiptDiagnostics.length > 0
    || connection.authorizationReceipt.operationId !== expectedOperationId
    || connection.authorizationReceipt.principal.id !== connection.principal.id
    || connection.authorizationReceipt.trustedContextDigest !== connection.trustedContextDigest
    || connection.authorizationReceipt.inputDigest !== applicationOperationInputDigest(input)
    || applicationOperationInputDigest(connection.authorizationReceipt.target) !== applicationOperationInputDigest({ kind: 'target', model: actor, identity: { key } })
    || (connection.authorizationReceipt.expiresAt !== undefined && Date.now() >= Date.parse(connection.authorizationReceipt.expiresAt))) {
    throw new Error(`Actor ${actor}.${member} received mismatched or expired realtime authority.`);
  }
  return Object.freeze(structuredClone(connection));
}

function actorTurnAuthority<TState extends object>(
  request: ApplicationActorRuntimeInvocation<TState>,
  operationId: string,
): ApplicationActorTurnAuthority {
  if (request.authority) return request.authority;
  if (request.connection) {
    return {
      principal: request.connection.principal,
      causalPrincipal: request.connection.causalPrincipal,
      authorizationReceipt: request.connection.authorizationReceipt,
      trustedContextDigest: request.connection.trustedContextDigest,
    };
  }
  return {
    principal: { id: 'applik8s:application' },
    causalPrincipal: { id: 'applik8s:application' },
    authorizationReceipt: { id: `internal:${operationId}`, authorityRevision: 'application-runtime' },
    trustedContextDigest: stableDigest({ authority: 'application-runtime' }),
  };
}

function actorReceiptKey(scope: string, operationId: string): string {
  return `${scope}\u0000${operationId}`;
}

function actorAlarmId(actor: string, member: string, key: string): string {
  return `alarm_${sha256Hex(`${actor}\u0000${key}\u0000${member}`).slice(0, 32)}`;
}

function actorAlarmTimestamp(at: string | Date, actor: string, member: string): string {
  const parsed = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Actor alarm ${actor}.${member} requires a valid timestamp.`);
  return parsed.toISOString();
}


function stableDigest(value: unknown): string {
  return sha256Hex(stableActorJson(value));
}

function stableActorJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableActorJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableActorJson(entry)}`)
      .join(',')}}`;
  }
  throw new Error(`Actor identity values must be JSON-serializable; received ${typeof value}.`);
}
