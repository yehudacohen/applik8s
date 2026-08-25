import { createHash } from 'node:crypto';
import type { ApplicationAuthorizationReceipt, JsonValue } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { type } from 'arktype';
import type { ApplicationLakehousePublication } from './application-lakehouse.js';
import { createApplicationLakehousePublication } from './application-lakehouse-publication.js';
import {
  type ApplicationStagedEffectReference,
  emitApplicationManagedEvent,
} from './application-managed-effects-api.js';
import type { ApplicationLakehouseDatasetProvider, ApplicationQualifiedProviderToken } from './application-providers.js';

export { type };

export interface DslExpression {
  readonly expressionKind: string;
  readonly value: string;
  eq(value: unknown): DslPredicate;
  desc(): DslOrdering;
  asc(): DslOrdering;
}

export interface DslPredicate {
  readonly expressionKind: 'predicate';
  readonly left: DslExpression;
  readonly operator: 'eq';
  readonly right: unknown;
}

export interface DslOrdering {
  readonly expressionKind: 'ordering';
  readonly expression: DslExpression;
  readonly direction: 'asc' | 'desc';
}

export interface EntityDefinition<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly kind: 'applik8sEntity';
  readonly name: string;
  readonly spec: SchemaInput<TSpec>;
  readonly status?: SchemaInput<TStatus>;
}

export interface CommandDefinition<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly kind: 'applik8sCommand';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly errors: { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> };
}

export interface EventDefinition<TPayload extends object> {
  readonly kind: 'applik8sEvent';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly payload: SchemaInput<TPayload>;
  emit(payload: TPayload): ApplicationStagedEffectReference;
}

export interface PublishedEventDefinition<TPayload extends object> extends EventDefinition<TPayload> {
  publish<TRow extends object>(
    dataset: ApplicationQualifiedProviderToken<ApplicationLakehouseDatasetProvider>,
    row: SchemaInput<TRow>,
    transform: (event: TPayload, output: { append(row: TRow): TRow }) => TRow,
  ): ApplicationLakehousePublication<TRow>;
}

const applicationEventEmitterSymbol = Symbol.for(
  'applik8s.applicationEventEmitter',
);

/** Framework-owned lookup used by recursive callback dependency inference. */
export function applicationEventDefinitionFor(
  value: unknown,
): EventDefinition<object> | undefined {
  if (typeof value === 'object' && value !== null) {
    if (Reflect.get(value, 'kind') !== 'applik8sEvent') return undefined;
    // typecast: the stable event discriminant is checked before erasing only its payload generic for compiler inference.
    return value as EventDefinition<object>;
  }
  if (typeof value !== 'function') return undefined;
  const definition = Reflect.get(value, applicationEventEmitterSymbol);
  return definition
    && typeof definition === 'object'
    && Reflect.get(definition, 'kind') === 'applik8sEvent'
    // typecast: the emitter's private symbol and event discriminant jointly prove this framework-created definition.
    ? definition as EventDefinition<object>
    : undefined;
}

export interface StreamDefinition<TPayload extends object> {
  readonly kind: 'applik8sStream';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly payload: SchemaInput<TPayload>;
}

export interface WorkflowDefinition<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly kind: 'applik8sWorkflow';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly errors: { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> };
  readonly signals: { readonly [TName in keyof TSignals]: SchemaInput<TSignals[TName]> };
}

export interface ApplicationMessageEnvelope<TPayload extends object> {
  readonly id: string;
  readonly contract: { readonly name: string; readonly version: string };
  readonly payload: TPayload;
  readonly recordedAt: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  /** Bounded framework telemetry carrier for an internal durable handoff. */
  readonly telemetry?: import('@applik8s/core').ApplicationTelemetryEnvelopeV1;
  readonly attempt?: number;
  readonly partitionKey?: string;
  readonly routing?: Readonly<Record<string, string>>;
  readonly expectedRevision?: string;
  readonly stateRevision?: ApplicationStateRevisionRef;
  readonly trustedContext?: {
    readonly values: Readonly<Record<string, JsonValue>>;
    readonly digest: string;
    /** Opaque data-isolation scopes computed by the secret-holding admission boundary. */
    readonly changeScopes?: Readonly<Record<string, string>>;
  };
  /** Canonical admission proof persisted for execution/pre-commit revalidation. */
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
}

export interface ApplicationStateRevisionRef {
  readonly authority: 'model';
  readonly model: string;
  readonly target: string;
  readonly revision: string;
}

export interface ApplicationCommandObservation {
  readonly commandId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly target: { readonly model: string; readonly key: string };
  readonly phase: 'completed' | 'rejected';
  readonly replayed: boolean;
  /** Opaque revision of the durable command result, including durable rejections. */
  readonly resultRevision: string;
  /** Present only when the outcome can be linked truthfully to an existing model state. */
  readonly stateRevision?: ApplicationStateRevisionRef;
}

export function field(path: string): DslExpression {
  return expression('field', path);
}

export function label(name: string): DslExpression {
  return expression('label', name);
}

export function entity<TSpec extends object, TStatus extends object = Record<string, never>>(
  name: string,
  options: { readonly spec: SchemaInput<TSpec>; readonly status?: SchemaInput<TStatus> }
): EntityDefinition<TSpec, TStatus> {
  return {
    kind: 'applik8sEntity',
    name,
    spec: options.spec,
    ...(options.status ? { status: options.status } : {}),
  };
}

export function command<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
>(
  id: string,
  options: {
    readonly input: SchemaInput<TInput>;
    readonly output: SchemaInput<TOutput>;
    readonly errors?: { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> };
  }
): CommandDefinition<TInput, TOutput, TErrors> {
  const identity = applicationContractIdentity('command', id);
  return {
    kind: 'applik8sCommand',
    id,
    ...identity,
    input: options.input,
    output: options.output,
    // typecast: omitted errors are the empty mapped error contract represented by TErrors's default.
    errors: (options.errors ?? {}) as { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> },
  };
}

export function event<TPayload extends object>(
  id: string,
  options: { readonly payload: SchemaInput<TPayload> }
): PublishedEventDefinition<TPayload> {
  const identity = applicationContractIdentity('event', id);
  const emit = (payload: TPayload) =>
    emitApplicationManagedEvent(definition, payload);
  const definition: PublishedEventDefinition<TPayload> = {
    kind: 'applik8sEvent',
    id,
    ...identity,
    payload: options.payload,
    emit,
    publish(dataset, row, transform) {
      return createApplicationLakehousePublication(definition, dataset, row, transform);
    },
  };
  Object.defineProperty(emit, applicationEventEmitterSymbol, {
    value: definition,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(definition);
}

/** Defines an inert, versioned public replay contract. Materialize it with app.stream(...). */
export function stream<TPayload extends object>(
  id: string,
  options: { readonly payload: SchemaInput<TPayload> }
): StreamDefinition<TPayload> {
  const identity = applicationContractIdentity('stream', id);
  return { kind: 'applik8sStream', id, ...identity, payload: options.payload };
}

export function workflow<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
>(
  id: string,
  options: {
    readonly input: SchemaInput<TInput>;
    readonly output: SchemaInput<TOutput>;
    readonly errors?: { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> };
    readonly signals?: { readonly [TName in keyof TSignals]: SchemaInput<TSignals[TName]> };
  }
): WorkflowDefinition<TInput, TOutput, TErrors, TSignals> {
  const identity = applicationContractIdentity('workflow', id);
  return {
    kind: 'applik8sWorkflow',
    id,
    ...identity,
    input: options.input,
    output: options.output,
    // typecast: omitted errors and signals are empty mapped contracts represented by their defaults.
    errors: (options.errors ?? {}) as { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> },
    // typecast: omitted signals are the empty mapped signal contract represented by TSignals's default.
    signals: (options.signals ?? {}) as { readonly [TName in keyof TSignals]: SchemaInput<TSignals[TName]> },
  };
}

export const metadata = {
  creationTimestamp: expression('metadata', 'metadata.creationTimestamp'),
  name: expression('metadata', 'metadata.name'),
};

export function now(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function expression(expressionKind: string, value: string): DslExpression {
  const current: DslExpression = {
    expressionKind,
    value,
    eq(right) {
      return { expressionKind: 'predicate', left: current, operator: 'eq', right };
    },
    desc() {
      return { expressionKind: 'ordering', expression: current, direction: 'desc' };
    },
    asc() {
      return { expressionKind: 'ordering', expression: current, direction: 'asc' };
    },
  };
  return current;
}

function applicationContractIdentity(kind: 'command' | 'event' | 'stream' | 'task' | 'workflow', id: string): { readonly name: string; readonly version: string } {
  const match = /^(.*)\.(v[1-9][0-9]*)$/.exec(id.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`applik8s ${kind} contract ${JSON.stringify(id)} must end with an explicit version such as ".v1".`);
  }
  return { name: match[1], version: match[2] };
}
