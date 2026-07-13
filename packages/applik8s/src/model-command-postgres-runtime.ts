import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { ApplicationRetryPolicy, JsonObject, JsonValue } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk';
import postgres from 'postgres';
import type { ApplicationCommandKey, ApplicationModelCommandContext, ApplicationModelCommandHandler, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelObject, ApplicationModelPatch, ApplicationRuntimeModelContract } from './application-models.js';
import type { ApplicationCommandObservation, ApplicationMessageEnvelope, ApplicationStateRevisionRef, CommandDefinition, EventDefinition } from './dsl.js';

export interface PostgresModelCommandMessage<TInput extends object> {
  readonly id: string;
  readonly input: TInput;
  readonly targetKey: string;
  readonly idempotencyKey: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly attempt?: number;
  readonly recordedAt?: string;
  readonly expectedRevision?: string;
}

export interface PostgresModelCommandExecution<
  TSpec extends object,
  TStatus extends object,
  TInput extends object,
  TOutput extends object,
> {
  readonly bindingId: string;
  readonly command: { readonly name: string; readonly version: string };
  readonly errors?: readonly string[];
  readonly schemas?: {
    readonly input: JsonObject;
    readonly output: JsonObject;
    readonly errors: Readonly<Record<string, JsonObject>>;
    readonly events?: Readonly<Record<string, JsonObject>>;
    readonly commands?: Readonly<Record<string, JsonObject>>;
  };
  readonly model: ApplicationRuntimeModelContract;
  readonly models?: readonly ApplicationRuntimeModelContract[];
  readonly historyModels?: readonly string[];
  readonly retry?: ApplicationRetryPolicy;
  readonly message: PostgresModelCommandMessage<TInput>;
  readonly history?: boolean;
  readonly outbox?: readonly EventDefinition<object>[];
  readonly commands?: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[];
  readonly ordering?: 'serial' | 'concurrent';
  readonly missingRoute?: string;
  readonly initialize?: (input: TInput) => TSpec;
  readonly handler: ApplicationModelCommandHandler<TSpec, TStatus, TInput, TOutput>;
  readonly databaseUrl?: string;
}

export interface PostgresModelCommandResult<TSpec extends object, TStatus extends object, TOutput extends object> {
  readonly replayed: boolean;
  readonly observation: ApplicationCommandObservation;
  readonly output: TOutput;
  readonly model: ApplicationModelObject<TSpec, TStatus>;
  readonly events: readonly ApplicationMessageEnvelope<object>[];
}

interface CommandResultRow {
  readonly output: unknown;
  readonly error: unknown;
  readonly model_revision: string;
  readonly target_key: string;
}

export class DurableCommandRejectedError extends Error {
  readonly code = 'applik8s-command-rejected';
  constructor(
    readonly rejection: { readonly name: string; readonly payload: object },
    readonly replayed: boolean,
    readonly observation: ApplicationCommandObservation,
  ) {
    super(`applik8s-command-rejected: ${rejection.name}`);
    this.name = 'DurableCommandRejectedError';
  }
}

class CommandRejectionSignal {
  constructor(readonly rejection: { readonly name: string; readonly payload: object }) {}
}

interface RejectedCommandOutcome {
  readonly rejected: true;
  readonly rejection: { readonly name: string; readonly payload: object };
  readonly replayed: boolean;
  readonly revision: string;
  readonly stateRevision?: ApplicationStateRevisionRef;
  readonly targetKey?: string;
}

interface ModelRow {
  readonly id: string;
  readonly spec: unknown;
  readonly status: unknown;
  readonly revision: string;
}

interface EmittedEvent {
  readonly definition: EventDefinition<object>;
  readonly payload: object;
}

interface EmittedCommand {
  readonly definition: CommandDefinition<object, object, Readonly<Record<string, object>>>;
  readonly payload: object;
  readonly targetKey: string;
  readonly idempotencyKey: string;
}

const commandConnections = new Map<string, postgres.Sql>();
const commandEffectBoundary = new AsyncLocalStorage<boolean>();
let commandEffectGuardsInstalled = false;

export function canonicalApplicationCommandKey(value: ApplicationCommandKey): string {
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return entries.map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`).join('&');
  }
  // ModelStore identities are persisted as strings. Scalar command keys must
  // therefore address the same literal id; adding a runtime type prefix would
  // make an otherwise valid key unable to load its aggregate.
  return String(value);
}

export async function closePostgresModelCommandRuntime(): Promise<void> {
  const clients = [...commandConnections.values()];
  commandConnections.clear();
  await Promise.all(clients.map((client) => client.end({ timeout: 1 })));
}

export async function executePostgresModelCommand<
  TSpec extends object,
  TStatus extends object,
  TInput extends object,
  TOutput extends object,
>(execution: PostgresModelCommandExecution<TSpec, TStatus, TInput, TOutput>): Promise<PostgresModelCommandResult<TSpec, TStatus, TOutput>> {
  installCommandEffectGuards();
  validateJsonMessageSchema(execution.schemas?.input, execution.message.input, `${execution.command.name}.${execution.command.version}.input`);
  const sql = postgresCommandDatabase(execution.model, execution.databaseUrl);
  const scope = commandScope(execution);
  const recordedAt = execution.message.recordedAt ?? new Date().toISOString();
  const outcome: PostgresModelCommandResult<TSpec, TStatus, TOutput> | RejectedCommandOutcome = await retryPostgresCommandTransaction(() => sql.begin(async (transaction) => {
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
    const completedRows = await transaction.unsafe('SELECT result.output, result.error, result.model_revision, inbox.target_key FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE result.scope = $1 LIMIT 1', [scope]);
    // typecast: the fixed projection comes from an Applik8s-owned command-results migration.
    const completed = completedRows[0] as CommandResultRow | undefined;
    if (completed) {
      if (completed.error) {
        return { rejected: true, rejection: durableRejection(completed.error), replayed: true, revision: completed.model_revision, targetKey: completed.target_key };
      }
      const current = await lockedModelObject<TSpec, TStatus>(transaction, execution.model, completed.target_key, false);
      if (!current) {
        throw new Error(`applik8s-command-result-state-missing: Durable result ${scope} exists but model ${execution.model.name}/${execution.message.targetKey} is missing.`);
      }
      // typecast: durable output is schema-bound to TOutput by the command binding that owns this scope.
      return {
        replayed: true,
        observation: commandObservation(execution, 'completed', true, completed.model_revision, true, undefined, completed.target_key),
        // typecast: durable output was validated against this binding's versioned output schema before it was committed.
        output: completed.output as TOutput,
        model: current,
        events: [],
      };
    }

    await transaction.unsafe('SAVEPOINT applik8s_command_handler');
    const serial = (execution.ordering ?? 'serial') === 'serial';
    let effectiveTargetKey = execution.message.targetKey;
    if (serial) await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [commandTargetScope(execution.bindingId, execution.model.name, effectiveTargetKey)]);
    let before = await lockedModelObject<TSpec, TStatus>(transaction, execution.model, effectiveTargetKey, serial);
    if (!before && execution.missingRoute) {
      effectiveTargetKey = execution.missingRoute;
      if (serial) await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [commandTargetScope(execution.bindingId, execution.model.name, effectiveTargetKey)]);
      before = await lockedModelObject<TSpec, TStatus>(transaction, execution.model, effectiveTargetKey, serial);
    }
    const effectiveExecution = effectiveTargetKey === execution.message.targetKey
      ? execution
      : { ...execution, message: { ...execution.message, targetKey: effectiveTargetKey } };
    if (execution.message.expectedRevision && before?.revision !== execution.message.expectedRevision) {
      const revision = before?.revision ?? commandDeterministicId(scope, 'rejected-missing-target-revision');
      const rejection = {
        name: 'revisionConflict',
        payload: { expectedRevision: execution.message.expectedRevision, actualRevision: before?.revision ?? null },
      };
      await recordCommandRejection(transaction, effectiveExecution, scope, rejection, revision);
      await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
      return {
        rejected: true,
        rejection,
        replayed: false,
        revision,
        targetKey: effectiveTargetKey,
        ...(before?.revision ? { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, before.revision) } : {}),
      };
    }
    if (!before) {
      if (!execution.initialize) {
        const rejection = { name: 'targetMissing', payload: { model: execution.model.name, targetKey: effectiveTargetKey } };
        await recordCommandRejection(transaction, effectiveExecution, scope, rejection, commandDeterministicId(scope, 'rejected-missing-target'));
        await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
        return { rejected: true, rejection, replayed: false, revision: commandDeterministicId(scope, 'rejected-missing-target'), targetKey: effectiveTargetKey };
      }
      before = {
        id: effectiveTargetKey,
        spec: execution.initialize(execution.message.input),
        revision: commandDeterministicId(scope, 'initial-revision'),
      };
      const initialized = await transaction.unsafe(
        `INSERT INTO ${quoteIdentifier(execution.model.tableName)} (id, spec, status, revision) VALUES ($1, $2::jsonb, NULL, $3)${serial ? '' : ' ON CONFLICT (id) DO NOTHING'} RETURNING id`,
        [before.id, postgresJson(transaction, before.spec), before.revision ?? commandDeterministicId(scope, 'initial-revision')],
      );
      if (!serial && initialized.length === 0) throw concurrentCommandModification();
    }

    let stagedSpec = before.spec;
    let stagedStatus = before.status;
    await transaction.unsafe(
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
      [scope, execution.bindingId, execution.model.name, effectiveTargetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input)],
    );
    const emitted: EmittedEvent[] = [];
    const allowedEvents = new Set((execution.outbox ?? []).map((definition) => definition.id));
    const allowedCommands = new Map((execution.commands ?? []).map((definition) => [definition.id, definition]));
    const emittedCommands: EmittedCommand[] = [];
    const target = commandTarget<TSpec, TStatus>(before, (patch) => {
      stagedSpec = { ...stagedSpec, ...(patch.spec ?? {}) };
      if (patch.status) {
        // typecast: model patch keys are constrained to Partial<TStatus>; merging them preserves the status contract.
        stagedStatus = { ...(stagedStatus ?? {}), ...patch.status } as TStatus;
      }
    }, () => stagedSpec, () => stagedStatus);
    const context: ApplicationModelCommandContext<Readonly<Record<string, object>>> = {
      commandId: execution.message.id,
      ...(execution.message.correlationId ? { correlationId: execution.message.correlationId } : {}),
      ...(execution.message.causationId ? { causationId: execution.message.causationId } : {}),
      attempt: execution.message.attempt ?? 1,
      now: recordedAt,
      models: commandParticipantClients(transaction, execution, scope),
      id: (idScope = 'default') => commandDeterministicId(scope, `handler:${idScope}`),
      emit(event, payload) {
        if (!allowedEvents.has(event.id)) {
          throw new Error(`applik8s-command-undeclared-outbox: Handler ${execution.bindingId} emitted ${event.id}, but it is not declared in transaction.outbox.`);
        }
        validateJsonMessageSchema(execution.schemas?.events?.[event.id], payload, `${event.name}.${event.version}.payload`);
        // typecast: the event and payload retain their generic relationship at the public emit call and are erased only for durable outbox storage.
        emitted.push({ definition: event as EventDefinition<object>, payload });
      },
      send(command, payload, options) {
        const declared = allowedCommands.get(command.id);
        if (!declared) throw new Error(`applik8s-command-undeclared-command-outbox: Handler ${execution.bindingId} sent ${command.id}, but it is not declared in transaction.commands.`);
        validateJsonMessageSchema(execution.schemas?.commands?.[command.id], payload, `${command.name}.${command.version}.input`);
        const targetKey = canonicalApplicationCommandKey(options.targetKey);
        emittedCommands.push({ definition: declared, payload, targetKey, idempotencyKey: options.idempotencyKey ?? commandDeterministicId(scope, `command-idempotency:${emittedCommands.length}:${command.id}`) });
      },
      reject(name, payload) {
        if (!execution.errors?.includes(name)) {
          throw new Error(`applik8s-command-undeclared-error: Handler ${execution.bindingId} rejected with ${name}, but the command does not declare that durable error.`);
        }
        validateJsonMessageSchema(execution.schemas?.errors[name], payload, `${execution.command.name}.${execution.command.version}.errors.${name}`);
        throw new CommandRejectionSignal({ name, payload });
      },
    };
    let output: TOutput;
    try {
      output = await commandEffectBoundary.run(true, () => execution.handler(target, execution.message.input, context));
      validateJsonMessageSchema(execution.schemas?.output, output, `${execution.command.name}.${execution.command.version}.output`);
    } catch (error) {
      if (!(error instanceof CommandRejectionSignal)) throw error;
      // A declared rejection is a durable result, but it must not commit any model,
      // transition, history, or outbox side effects attempted by the handler.
      await transaction.unsafe('ROLLBACK TO SAVEPOINT applik8s_command_handler');
      await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
      // The inbox insert happened after this savepoint and was rolled back with the
      // handler's model/participant/outbox effects. Recreate it before recording the
      // FK-backed durable rejection result.
      await recordCommandRejection(transaction, effectiveExecution, scope, error.rejection, before.revision ?? commandDeterministicId(scope, 'rejected'));
      return {
        rejected: true,
        rejection: error.rejection,
        replayed: false,
        revision: before.revision ?? commandDeterministicId(scope, 'rejected'),
        targetKey: effectiveTargetKey,
        ...(before.revision ? { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, before.revision) } : {}),
      };
    }
    await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
    const revision = commandDeterministicId(scope, `revision:${JSON.stringify(stagedSpec)}:${JSON.stringify(stagedStatus ?? null)}`);
    const after: ApplicationModelObject<TSpec, TStatus> = {
      id: before.id,
      spec: stagedSpec,
      ...(stagedStatus ? { status: stagedStatus } : {}),
      revision,
    };

    const updated = await transaction.unsafe(
      `UPDATE ${quoteIdentifier(execution.model.tableName)} SET spec = $2::jsonb, status = $3::jsonb, revision = $4, updated_at = now() WHERE id = $1${serial ? '' : ' AND revision = $5'} RETURNING id`,
      serial
        ? [after.id, postgresJson(transaction, after.spec), postgresJson(transaction, after.status ?? null), revision]
        : [after.id, postgresJson(transaction, after.spec), postgresJson(transaction, after.status ?? null), revision, before.revision ?? ''],
    );
    if (!serial && updated.length === 0) throw concurrentCommandModification();
    await transaction.unsafe(
      'INSERT INTO applik8s_model_transitions (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
      [commandDeterministicId(scope, 'transition'), scope, execution.model.name, effectiveTargetKey, postgresJson(transaction, before), postgresJson(transaction, after), revision],
    );
    if (execution.history) {
      await transaction.unsafe(
        'INSERT INTO applik8s_model_history (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
        [commandDeterministicId(scope, 'history'), scope, execution.model.name, effectiveTargetKey, postgresJson(transaction, before), postgresJson(transaction, after), revision],
      );
    }

    const envelopes: ApplicationMessageEnvelope<object>[] = [];
    for (const [index, item] of emitted.entries()) {
      const envelope: ApplicationMessageEnvelope<object> = {
        id: commandDeterministicId(scope, `event:${index}:${item.definition.id}`),
        contract: { name: item.definition.name, version: item.definition.version },
        payload: item.payload,
        recordedAt,
        ...(execution.message.tenant ? { tenant: execution.message.tenant } : {}),
        correlationId: execution.message.correlationId ?? execution.message.id,
        causationId: execution.message.id,
        ...(execution.message.traceparent ? { traceparent: execution.message.traceparent } : {}),
        attempt: execution.message.attempt ?? 1,
        partitionKey: effectiveTargetKey,
        stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, revision),
      };
      envelopes.push(envelope);
      await transaction.unsafe(
        'INSERT INTO applik8s_event_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [envelope.id, scope, item.definition.name, item.definition.version, effectiveTargetKey, postgresJson(transaction, envelope), postgresJson(transaction, item.payload)],
      );
    }
    for (const [index, item] of emittedCommands.entries()) {
      const envelope: ApplicationMessageEnvelope<object> = {
        id: commandDeterministicId(scope, `command:${index}:${item.definition.id}`),
        contract: { name: item.definition.name, version: item.definition.version },
        payload: item.payload,
        recordedAt,
        ...(execution.message.tenant ? { tenant: execution.message.tenant } : {}),
        correlationId: execution.message.correlationId ?? execution.message.id,
        causationId: execution.message.id,
        ...(execution.message.traceparent ? { traceparent: execution.message.traceparent } : {}),
        partitionKey: item.targetKey,
        routing: { targetKey: item.targetKey, idempotencyKey: item.idempotencyKey },
      };
      await transaction.unsafe(
        'INSERT INTO applik8s_command_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [envelope.id, scope, item.definition.name, item.definition.version, item.targetKey, postgresJson(transaction, envelope), postgresJson(transaction, item.payload)],
      );
    }
    await transaction.unsafe(
      'INSERT INTO applik8s_command_results (scope, output, error, model_revision) VALUES ($1, $2::jsonb, NULL, $3)',
      [scope, postgresJson(transaction, output), revision],
    );
    return {
      replayed: false,
      observation: commandObservation(execution, 'completed', false, revision, true, undefined, effectiveTargetKey),
      output,
      model: after,
      events: envelopes,
    };
  }), execution.retry);
  if ('rejected' in outcome) {
    throw new DurableCommandRejectedError(
      outcome.rejection,
      outcome.replayed,
      commandObservation(execution, 'rejected', outcome.replayed, outcome.revision, false, outcome.stateRevision, outcome.targetKey),
    );
  }
  return outcome;
}

function installCommandEffectGuards(): void {
  if (commandEffectGuardsInstalled) return;
  commandEffectGuardsInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  // typecast: the membrane preserves the complete platform fetch signature while adding only a transaction-context guard.
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    assertCommandEffectAllowed('fetch');
    return originalFetch(...args);
  }) as typeof fetch;
  // typecast: the guard installer intentionally reflects optional Node process escape hatches without widening the public runtime type.
  const processGlobals = process as unknown as Record<string, unknown>;
  // typecast: browser-compatible ambient constructors are optional globals, so reflection preserves runtimes where they are absent.
  const ambientGlobals = globalThis as unknown as Record<string, unknown>;
  installGuardedAmbientFunction(processGlobals, 'getBuiltinModule', 'process.getBuiltinModule');
  installGuardedAmbientFunction(processGlobals, 'binding', 'process.binding');
  installGuardedAmbientFunction(processGlobals, '_linkedBinding', 'process._linkedBinding');
  installGuardedAmbientConstructor(ambientGlobals, 'WebSocket', 'WebSocket');
  installGuardedAmbientConstructor(ambientGlobals, 'EventSource', 'EventSource');
}

function installGuardedAmbientFunction(target: Record<string, unknown>, property: string, effect: string): void {
  const original = target[property];
  if (typeof original !== 'function') return;
  target[property] = function guardedAmbientFunction(this: unknown, ...args: readonly unknown[]) {
    assertCommandEffectAllowed(effect);
    return Reflect.apply(original, this, args);
  };
}

function installGuardedAmbientConstructor(target: Record<string, unknown>, property: string, effect: string): void {
  const original = target[property];
  if (typeof original !== 'function') return;
  target[property] = new Proxy(original, {
    apply(callable, thisArgument, argumentsList) {
      assertCommandEffectAllowed(effect);
      return Reflect.apply(callable, thisArgument, argumentsList);
    },
    construct(callable, argumentsList, newTarget) {
      assertCommandEffectAllowed(effect);
      return Reflect.construct(callable, argumentsList, newTarget);
    },
  });
}

export function assertCommandEffectAllowed(effect: string): void {
  if (commandEffectBoundary.getStore()) {
    // typecast: framework errors carry a stable machine-readable code in addition to the native Error contract.
    const error = new Error(`applik8s-command-external-effect-forbidden: ${effect} is unavailable while a model command transaction is active. Emit a durable event/command or schedule a task instead.`) as Error & { code: string };
    error.code = 'APPLIK8S_COMMAND_EFFECT_FORBIDDEN';
    throw error;
  }
}

function commandObservation<TSpec extends object, TStatus extends object, TInput extends object, TOutput extends object>(
  execution: Pick<PostgresModelCommandExecution<TSpec, TStatus, TInput, TOutput>, 'message' | 'model'>,
  phase: ApplicationCommandObservation['phase'],
  replayed: boolean,
  revision: string,
  linkCurrentState: boolean,
  stateRevision?: ApplicationStateRevisionRef,
  targetKey = execution.message.targetKey,
): ApplicationCommandObservation {
  return {
    commandId: execution.message.id,
    correlationId: execution.message.correlationId ?? execution.message.id,
    ...(execution.message.causationId ? { causationId: execution.message.causationId } : {}),
    target: { model: execution.model.name, key: targetKey },
    phase,
    replayed,
    resultRevision: revision,
    ...(stateRevision
      ? { stateRevision }
      : linkCurrentState
        ? { stateRevision: modelStateRevision(execution.model.name, targetKey, revision) }
        : {}),
  };
}

function modelStateRevision(model: string, target: string, revision: string): ApplicationStateRevisionRef {
  return { authority: 'model', model, target, revision };
}

function commandParticipantClients(
  transaction: postgres.TransactionSql,
  execution: Pick<PostgresModelCommandExecution<object, object, object, object>, 'bindingId' | 'historyModels' | 'model' | 'models'>,
  scope: string,
): Readonly<Record<string, ApplicationModelCommandParticipantClient>> {
  const clients: Record<string, ApplicationModelCommandParticipantClient> = {};
  for (const model of execution.models ?? []) {
    if (model.name === execution.model.name) continue;
    let operation = 0;
    const nextRevision = (purpose: string) => commandDeterministicId(scope, `participant:${model.name}:${operation++}:${purpose}`);
    const transition = async (before: ApplicationModelObject<object, object>, after: ApplicationModelObject<object, object>, revision: string) => {
      const id = nextRevision('transition');
      await transaction.unsafe(
        'INSERT INTO applik8s_model_transitions (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
        [id, scope, model.name, after.id, postgresJson(transaction, before), postgresJson(transaction, after), revision],
      );
      if (execution.historyModels?.includes(model.name)) {
        await transaction.unsafe(
          'INSERT INTO applik8s_model_history (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
          [nextRevision('history'), scope, model.name, after.id, postgresJson(transaction, before), postgresJson(transaction, after), revision],
        );
      }
    };
    clients[model.name] = {
      get: (ref) => lockedModelObject<object, object>(transaction, model, ref.id, true),
      async create(input) {
        const revision = nextRevision('create');
        const created = { id: input.id ?? nextRevision('id'), spec: input.spec, revision };
        await transaction.unsafe(
          `INSERT INTO ${quoteIdentifier(model.tableName)} (id, spec, status, revision) VALUES ($1, $2::jsonb, NULL, $3)`,
          [created.id, postgresJson(transaction, created.spec), revision],
        );
        await transition({ id: created.id, spec: {}, revision: nextRevision('missing-before-create') }, created, revision);
        return created;
      },
      async patch(ref, patch) {
        const before = await lockedModelObject<object, object>(transaction, model, ref.id, true);
        if (!before) throw new Error(`applik8s-command-participant-missing: Model ${model.name}/${ref.id} does not exist.`);
        const revision = nextRevision('patch');
        const after = {
          id: before.id,
          spec: { ...before.spec, ...(patch.spec ?? {}) },
          ...(before.status || patch.status ? { status: { ...(before.status ?? {}), ...(patch.status ?? {}) } } : {}),
          revision,
        };
        await transaction.unsafe(
          `UPDATE ${quoteIdentifier(model.tableName)} SET spec = $2::jsonb, status = $3::jsonb, revision = $4, updated_at = now() WHERE id = $1`,
          [after.id, postgresJson(transaction, after.spec), postgresJson(transaction, after.status ?? null), revision],
        );
        await transition(before, after, revision);
        return after;
      },
      async delete(ref) {
        const before = await lockedModelObject<object, object>(transaction, model, ref.id, true);
        if (!before) return;
        const revision = nextRevision('delete');
        await transaction.unsafe(`DELETE FROM ${quoteIdentifier(model.tableName)} WHERE id = $1`, [ref.id]);
        await transition(before, { id: before.id, spec: {}, revision }, revision);
      },
    };
  }
  return clients;
}

export function isDurableCommandRejectedError(error: unknown): error is DurableCommandRejectedError {
  return error instanceof DurableCommandRejectedError
    || Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'applik8s-command-rejected');
}

async function recordCommandRejection<TInput extends object>(
  transaction: postgres.TransactionSql,
  execution: Pick<PostgresModelCommandExecution<object, object, TInput, object>, 'bindingId' | 'message' | 'model'>,
  scope: string,
  rejection: { readonly name: string; readonly payload: object },
  revision: string,
  inboxRecorded = false,
): Promise<void> {
  if (!inboxRecorded) {
    await transaction.unsafe(
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
      [scope, execution.bindingId, execution.model.name, execution.message.targetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input)],
    );
  }
  await transaction.unsafe(
    'INSERT INTO applik8s_command_results (scope, output, error, model_revision) VALUES ($1, NULL, $2::jsonb, $3)',
    [scope, postgresJson(transaction, rejection), revision],
  );
}

function durableRejection(value: unknown): { readonly name: string; readonly payload: object } {
  if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'name') !== 'string' || !Reflect.get(value, 'payload') || typeof Reflect.get(value, 'payload') !== 'object') {
    throw new Error('applik8s-command-result-error-invalid: Durable command error is malformed.');
  }
  // typecast: the durable error shape was checked field-by-field at the Postgres boundary.
  return value as { readonly name: string; readonly payload: object };
}

function validateJsonMessageSchema(schema: JsonObject | undefined, value: unknown, name: string): void {
  if (!schema) return;
  // typecast: durable payloads cross a JSON boundary and this schema validator rejects incompatible values before commit.
  const result = normalizeSchema<object>({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: name }, schema }, name).validate(value as JsonValue);
  if (!result.ok) {
    throw new Error(`applik8s-message-schema-invalid: ${name}: ${result.error.message}`);
  }
}

async function retryPostgresCommandTransaction<TResult>(operation: () => Promise<TResult>, policy: ApplicationRetryPolicy | undefined): Promise<TResult> {
  const retry = policy ?? { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 10, maxDelayMs: 250 };
  const maxAttempts = retry.mode === 'never' ? 1 : Math.max(1, retry.maxAttempts ?? 5);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryablePostgresTransactionError(error)) throw error;
      const initial = Math.max(1, retry.initialDelayMs ?? 10);
      const maximum = Math.max(initial, retry.maxDelayMs ?? 250);
      const delay = Math.min(maximum, initial * (2 ** Math.max(0, attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function isRetryablePostgresTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return code === '40P01' || code === '40001' || code === 'APPLIK8S_CONCURRENT_MODIFICATION';
}

function concurrentCommandModification(): Error & { readonly code: string } {
  // typecast: this internal retry signal carries the same code shape inspected by the transaction retry classifier.
  const error = new Error('applik8s-command-concurrent-modification: Model revision changed while a concurrent command was executing; retrying against current state.') as Error & { code: string };
  error.code = 'APPLIK8S_CONCURRENT_MODIFICATION';
  return error;
}

function postgresCommandDatabase(model: ApplicationRuntimeModelContract, databaseUrl: string | undefined): postgres.Sql {
  const url = databaseUrl ?? process.env[model.connectionEnvName] ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`applik8s-modelstore-missing-credentials: Command processor for ${model.name} requires ${model.connectionEnvName} or DATABASE_URL.`);
  }
  const key = `${model.connectionEnvName}:${url}`;
  const current = commandConnections.get(key);
  if (current) {
    return current;
  }
  const client = postgres(url, { max: 5 });
  commandConnections.set(key, client);
  return client;
}

async function lockedModelObject<TSpec extends object, TStatus extends object>(
  transaction: postgres.TransactionSql,
  model: ApplicationRuntimeModelContract,
  targetKey: string,
  lock: boolean,
): Promise<ApplicationModelObject<TSpec, TStatus> | undefined> {
  const rows = await transaction.unsafe(`SELECT id, spec, status, revision FROM ${quoteIdentifier(model.tableName)} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [targetKey]);
  // typecast: this fixed projection reads an Applik8s-owned model table contract.
  const row = rows[0] as ModelRow | undefined;
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    // typecast: the generated model table is schema-bound to TSpec/TStatus at the command binding.
    spec: row.spec as TSpec,
    // typecast: the generated table status column is schema-bound to TStatus at the model binding.
    ...(row.status ? { status: row.status as TStatus } : {}),
    revision: row.revision,
  };
}

function commandTarget<TSpec extends object, TStatus extends object>(
  before: ApplicationModelObject<TSpec, TStatus>,
  patch: (patch: ApplicationModelPatch<TSpec, TStatus>) => void,
  spec: () => TSpec,
  status: () => TStatus | undefined,
): ApplicationModelCommandTarget<TSpec, TStatus> {
  return {
    id: before.id,
    get spec() {
      return spec();
    },
    get status() {
      return status();
    },
    ...(before.revision ? { revision: before.revision } : {}),
    patch,
  };
}

function commandScope(execution: Pick<PostgresModelCommandExecution<object, object, object, object>, 'bindingId' | 'model' | 'message'>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([
    execution.bindingId,
    execution.model.name,
    execution.message.targetKey,
    execution.message.idempotencyKey,
  ])).digest('hex')}`;
}

function commandTargetScope(bindingId: string, model: string, targetKey: string): string {
  return `target:${bindingId}:${model}:${targetKey}`;
}

function commandDeterministicId(scope: string, purpose: string): string {
  return createHash('sha256').update(`${scope}:${purpose}`).digest('hex');
}

function postgresJson(transaction: postgres.TransactionSql, value: unknown): ReturnType<postgres.TransactionSql['json']> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('applik8s-command-json-invalid: Durable command state, results, and outbox payloads must be JSON serializable.');
  }
  const normalized: unknown = JSON.parse(serialized);
  // typecast: JSON.parse of a defined JSON.stringify result satisfies postgres-js's recursive JSONValue contract.
  return transaction.json(normalized as Parameters<postgres.TransactionSql['json']>[0]);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
