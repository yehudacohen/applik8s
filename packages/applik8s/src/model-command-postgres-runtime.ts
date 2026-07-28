// typecast-file-boundary: PostgreSQL rows and schema-normalized command payloads are validated before restoring declaration-time model generics.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { ApplicationRetryPolicy, JsonObject, JsonValue } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { ApplicationModelCommandContext, ApplicationModelCommandHandler, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelObject, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationCommandPrincipal, applicationCommandTrustedContext } from './command-principal.js';
import { applicationPublicStreamCommitScope } from './application-stream-commit.js';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import type { ApplicationCommandObservation, ApplicationMessageEnvelope, ApplicationStateRevisionRef, CommandDefinition, EventDefinition } from './dsl.js';
import { applicationRelationalChangeScopeDigest } from './relational-runtime.js';
import { applicationModelChangeCommitScope } from './relational-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import type { ApplicationPostgresSql, ApplicationPostgresTransactionSql } from './postgres-runtime-contract.js';

export { canonicalApplicationCommandKey } from './command-runtime-contract.js';

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
  /** Trusted values admitted by the server boundary; never populated from public input fields. */
  readonly context?: {
    readonly values: Readonly<Record<string, JsonValue>>;
    readonly digest: string;
    readonly changeScopes?: Readonly<Record<string, string>>;
  };
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
  /** Expose a read-only participant client for related rows of the owning model. */
  readonly selfRead?: boolean;
  readonly historyModels?: readonly string[];
  readonly retry?: ApplicationRetryPolicy;
  readonly message: PostgresModelCommandMessage<TInput>;
  readonly history?: boolean;
  readonly outbox?: readonly EventDefinition<object>[];
  readonly commands?: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[];
  readonly ordering?: 'serial' | 'concurrent';
  readonly missingRoute?: string;
  readonly initialize?: (input: TInput, targetKey: string) => TSpec;
  readonly handler: ApplicationModelCommandHandler<TSpec, TStatus, TInput, TOutput>;
  readonly databaseUrl?: string;
}

export interface PostgresModelCommandResult<TSpec extends object, TStatus extends object, TOutput extends object> {
  readonly replayed: boolean;
  readonly observation: ApplicationCommandObservation;
  readonly output: TOutput;
  readonly model: ApplicationModelObject<TSpec, TStatus>;
  readonly deleted?: boolean;
  readonly events: readonly ApplicationMessageEnvelope<object>[];
}

export interface PostgresModelCommandTerminalFailureExecution<TInput extends object = object> {
  readonly bindingId: string;
  readonly model: ApplicationRuntimeModelContract;
  readonly message: PostgresModelCommandMessage<TInput>;
  readonly databaseUrl?: string;
  /** Focused runtime/test injection; generated workers use databaseUrl. */
  readonly sql?: ApplicationPostgresSql;
}

export interface ApplicationCommandTerminalFailure {
  readonly code: 'processing_failed';
  readonly attempts: number;
}

interface CommandResultRow {
  readonly output: unknown;
  readonly error: unknown;
  readonly model_revision: string;
  readonly target_key: string;
  readonly model_snapshot: unknown;
  readonly model_deleted: boolean;
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

type NativeModelRow = Readonly<Record<string, unknown>>;

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

const commandConnections = new Map<string, Promise<ApplicationPostgresSql>>();
const commandEffectBoundary = new AsyncLocalStorage<boolean>();
let commandEffectGuardsInstalled = false;

export async function closePostgresModelCommandRuntime(): Promise<void> {
  const clients = [...commandConnections.values()];
  commandConnections.clear();
  await Promise.all(clients.map(async (client) => (await client).end({ timeout: 1 })));
}

/**
 * Records the redacted terminal result of an exhausted command delivery. The
 * handler transaction has already rolled back, so this deliberately writes
 * only the inbox/result pair required to end durable progress polling.
 */
export async function recordPostgresModelCommandTerminalFailure<TInput extends object>(
  execution: PostgresModelCommandTerminalFailureExecution<TInput>,
  failure: ApplicationCommandTerminalFailure,
): Promise<void> {
  if (!Number.isSafeInteger(failure.attempts) || failure.attempts < 1) {
    throw new Error('applik8s-command-terminal-failure-attempts-invalid: attempts must be a positive safe integer.');
  }
  const sql = execution.sql ?? await postgresCommandDatabase(execution.model, execution.databaseUrl);
  const scope = commandScope(execution);
  const revision = commandDeterministicId(scope, 'terminal-failure');
  await sql.begin(async (transaction) => {
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
    const existing = await transaction.unsafe('SELECT scope FROM applik8s_command_results WHERE scope = $1 LIMIT 1', [scope]);
    if (existing.length > 0) return;
    await transaction.unsafe(
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (scope) DO NOTHING',
      [scope, execution.bindingId, execution.model.name, execution.message.targetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input)],
    );
    await transaction.unsafe(
      'INSERT INTO applik8s_command_results (scope, output, error, model_revision) VALUES ($1, NULL, $2::jsonb, $3) ON CONFLICT (scope) DO NOTHING',
      [scope, postgresJson(transaction, { name: 'internalFailure', payload: failure }), revision],
    );
  });
}

export async function executePostgresModelCommand<
  TSpec extends object,
  TStatus extends object,
  TInput extends object,
  TOutput extends object,
>(execution: PostgresModelCommandExecution<TSpec, TStatus, TInput, TOutput>): Promise<PostgresModelCommandResult<TSpec, TStatus, TOutput>> {
  installCommandEffectGuards();
  validateJsonMessageSchema(execution.schemas?.input, execution.message.input, `${execution.command.name}.${execution.command.version}.input`);
  const sql = await postgresCommandDatabase(execution.model, execution.databaseUrl);
  const scope = commandScope(execution);
  const recordedAt = execution.message.recordedAt ?? new Date().toISOString();
  const outcome: PostgresModelCommandResult<TSpec, TStatus, TOutput> | RejectedCommandOutcome = await retryPostgresCommandTransaction(() => sql.begin(async (transaction) => {
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
    if (execution.message.context?.digest) {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [applicationModelChangeCommitScope(execution.message.context.digest)]);
    }
    await installCommandTrustedContext(transaction, execution.model, execution.message.context);
    const completedRows = await transaction.unsafe('SELECT result.output, result.error, result.model_revision, result.model_snapshot, result.model_deleted, inbox.target_key FROM applik8s_command_results result JOIN applik8s_command_inbox inbox ON inbox.scope = result.scope WHERE result.scope = $1 LIMIT 1', [scope]);
    // typecast: the fixed projection comes from an Applik8s-owned command-results migration.
    const completed = completedRows[0] as CommandResultRow | undefined;
    if (completed) {
      if (completed.error) {
        return { rejected: true, rejection: durableRejection(completed.error), replayed: true, revision: completed.model_revision, targetKey: completed.target_key };
      }
      const current = completed.model_deleted
        ? durableModelSnapshot<TSpec, TStatus>(completed.model_snapshot, completed.target_key, completed.model_revision)
        : await lockedModelObject<TSpec, TStatus>(transaction, execution.model, completed.target_key, false);
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
        ...(completed.model_deleted ? { deleted: true } : {}),
        events: [],
      };
    }

    await transaction.unsafe('SAVEPOINT applik8s_command_handler');
    const serial = (execution.ordering ?? 'serial') === 'serial';
    let effectiveTargetKey = execution.message.targetKey;
    let initializedTarget = false;
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
        spec: execution.initialize(execution.message.input, effectiveTargetKey),
        revision: commandDeterministicId(scope, 'initial-revision'),
      };
      initializedTarget = true;
      const initialized = await insertModelObject(transaction, execution.model, before, !serial);
      if (!serial && initialized.length === 0) throw concurrentCommandModification();
      if (execution.model.storageShape === 'native-relational' && initialized[0] && typeof initialized[0] === 'object') {
        before = { ...before, spec: nativeRowToProperties(execution.model, initialized[0] as NativeModelRow) as TSpec };
      }
    }
    if (!before) throw new Error(`applik8s-command-target-unresolved: Model ${execution.model.name}/${effectiveTargetKey} was not loaded or initialized.`);

    let stagedSpec = before.spec;
    let stagedStatus = before.status;
    let deleteTarget = false;
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
    }, () => stagedSpec, () => stagedStatus, () => { deleteTarget = true; });
    const updateTarget: ApplicationModelCommandContext<Readonly<Record<string, object>>>['update'] = async <TValue extends object>(model: ApplicationModelCommandTarget<TValue, object>, patch: Partial<TValue>, options?: { readonly ifRevision?: string }) => {
      if (model.id !== target.id) throw new Error('applik8s-command-update-target-invalid: context.update() may only mutate the locked command target; declare other models as transaction participants.');
      if (options?.ifRevision && options.ifRevision !== before.revision) {
        throw new CommandRejectionSignal({ name: 'revisionConflict', payload: { expectedRevision: options.ifRevision, actualRevision: before.revision ?? null } });
      }
      const changed = Object.keys(patch).some((field) => !Object.is(Reflect.get(stagedSpec, field), Reflect.get(patch, field)));
      if (changed) stagedSpec = { ...stagedSpec, ...patch };
      // typecast: model identity was checked against the single locked target and the patch's TValue shape is the same handler-bound model value.
      return { value: { identity: model.identity, value: stagedSpec as unknown as TValue, ...(model.revision ? { revision: model.revision } : {}) }, changed };
    };
    const principal = applicationCommandPrincipal(execution.message.context);
    const context: ApplicationModelCommandContext<Readonly<Record<string, object>>> = {
      commandId: execution.message.id,
      ...(execution.message.correlationId ? { correlationId: execution.message.correlationId } : {}),
      ...(execution.message.causationId ? { causationId: execution.message.causationId } : {}),
      attempt: execution.message.attempt ?? 1,
      now: recordedAt,
      ...(principal ? { principal } : {}),
      trustedContext: applicationCommandTrustedContext(execution.message.context),
      models: commandParticipantClients(transaction, execution, scope),
      update: updateTarget,
      id: (idScope = 'default') => commandDeterministicId(scope, `handler:${idScope}`),
      emit(event, payload) {
        if (!allowedEvents.has(event.id)) {
          throw new Error(`applik8s-command-undeclared-outbox: Handler ${execution.bindingId} emitted ${event.id}, but it is not declared in transaction.outbox.`);
        }
        validateJsonMessageSchema(execution.schemas?.events?.[event.id], payload, `${event.name}.${event.version}.payload`);
        // typecast: the event and payload retain their generic relationship at the public emit call and are erased only for durable outbox storage.
        emitted.push({ definition: event as EventDefinition<object>, payload });
      },
      send(command: unknown, payload: object, options: { readonly targetKey: import('./application-models.js').ApplicationCommandKey; readonly idempotencyKey?: string }) {
        const commandId = applicationOutboxCommandId(command);
        const declared = allowedCommands.get(commandId);
        if (!declared) throw new Error(`applik8s-command-undeclared-command-outbox: Handler ${execution.bindingId} sent ${commandId}, but it is not declared in transaction.commands.`);
        validateJsonMessageSchema(execution.schemas?.commands?.[commandId], payload, `${declared.name}.${declared.version}.input`);
        const targetKey = canonicalApplicationCommandKey(options.targetKey);
        emittedCommands.push({ definition: declared, payload, targetKey, idempotencyKey: options.idempotencyKey ?? commandDeterministicId(scope, `command-idempotency:${emittedCommands.length}:${commandId}`) });
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
    const committedSpec = modelSpecAtRevision(execution.model, stagedSpec, revision);
    const completedOutput = modelLifecycleOutput(execution.model, execution.command.name, output, committedSpec, revision);
    const after: ApplicationModelObject<TSpec, TStatus> = {
      id: before.id,
      spec: committedSpec,
      ...(stagedStatus ? { status: stagedStatus } : {}),
      revision,
    };

    const updated = deleteTarget
      ? await deleteModelObject(transaction, execution.model, before, serial)
      : await updateModelObject(transaction, execution.model, before, after, serial);
    if (!serial && updated.length === 0) throw concurrentCommandModification();
    await transaction.unsafe(
      'INSERT INTO applik8s_model_transitions (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
      [commandDeterministicId(scope, 'transition'), scope, execution.model.name, effectiveTargetKey, postgresJson(transaction, before), postgresJson(transaction, deleteTarget ? { id: after.id, deleted: true, revision } : after), revision],
    );
    if (execution.history) {
      await transaction.unsafe(
        'INSERT INTO applik8s_model_history (id, scope, model, target_key, before_state, after_state, model_revision) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)',
        [commandDeterministicId(scope, 'history'), scope, execution.model.name, effectiveTargetKey, postgresJson(transaction, before), postgresJson(transaction, deleteTarget ? { id: after.id, deleted: true, revision } : after), revision],
      );
    }
    await recordGenericModelChange(transaction, execution.model, effectiveTargetKey, revision, execution.message.context, initializedTarget ? {} : before.spec, deleteTarget ? {} : after.spec, deleteTarget ? 'delete' : initializedTarget ? 'insert' : 'update');

    const envelopes: ApplicationMessageEnvelope<object>[] = [];
    // Identity values are allocated by INSERT, not commit. Serialize every
    // transaction that can allocate a sequence for the same public contract so
    // a reader can safely use sequence as its durable committed frontier.
    const publicStreamCommitScopes = [...new Set(emitted.map((item) => applicationPublicStreamCommitScope(item.definition.name, item.definition.version)))].sort();
    for (const publicStreamCommitScope of publicStreamCommitScopes) {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [publicStreamCommitScope]);
    }
    for (const [index, item] of emitted.entries()) {
      const payload = modelLifecyclePayload(execution.model, item.definition, item.payload, committedSpec, revision);
      const envelope: ApplicationMessageEnvelope<object> = {
        id: commandDeterministicId(scope, `event:${index}:${item.definition.id}`),
        contract: { name: item.definition.name, version: item.definition.version },
        payload,
        recordedAt,
        ...(execution.message.tenant ? { tenant: execution.message.tenant } : {}),
        correlationId: execution.message.correlationId ?? execution.message.id,
        causationId: execution.message.id,
        ...(execution.message.traceparent ? { traceparent: execution.message.traceparent } : {}),
        ...(execution.message.context ? { trustedContext: execution.message.context } : {}),
        attempt: execution.message.attempt ?? 1,
        partitionKey: effectiveTargetKey,
        ...(deleteTarget ? {} : { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, revision) }),
      };
      envelopes.push(envelope);
      await transaction.unsafe(
        'INSERT INTO applik8s_event_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [envelope.id, scope, item.definition.name, item.definition.version, effectiveTargetKey, postgresJson(transaction, envelope), postgresJson(transaction, payload)],
      );
      await transaction.unsafe(
        'INSERT INTO applik8s_public_stream_events (id, contract_name, contract_version, partition_key, envelope, payload, context_digest, recorded_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::timestamptz)',
        [envelope.id, item.definition.name, item.definition.version, effectiveTargetKey, postgresJson(transaction, envelope), postgresJson(transaction, payload), execution.message.context?.digest ?? null, recordedAt],
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
        ...(execution.message.context ? { trustedContext: execution.message.context } : {}),
        partitionKey: item.targetKey,
        routing: { targetKey: item.targetKey, idempotencyKey: item.idempotencyKey },
      };
      await transaction.unsafe(
        'INSERT INTO applik8s_command_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [envelope.id, scope, item.definition.name, item.definition.version, item.targetKey, postgresJson(transaction, envelope), postgresJson(transaction, item.payload)],
      );
    }
    await transaction.unsafe(
      'INSERT INTO applik8s_command_results (scope, output, error, model_revision, model_snapshot, model_deleted) VALUES ($1, $2::jsonb, NULL, $3, $4::jsonb, $5)',
      [scope, postgresJson(transaction, completedOutput), revision, postgresJson(transaction, after), deleteTarget],
    );
    return {
      replayed: false,
      observation: commandObservation(execution, 'completed', false, revision, !deleteTarget, undefined, effectiveTargetKey),
      output: completedOutput as TOutput,
      model: after,
      ...(deleteTarget ? { deleted: true } : {}),
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

function applicationOutboxCommandId(command: unknown): string {
  const id = command && typeof command === 'object' ? Reflect.get(command, 'id') : undefined;
  if (typeof id === 'string') return id;
  const operation = (typeof command === 'object' || typeof command === 'function') && command !== null
    ? Reflect.get(command, 'operation')
    : undefined;
  if (!operation || typeof operation !== 'object') throw new Error('applik8s-command-outbox-operation-invalid: Outbox commands must be declared command contracts or registered model operations.');
  const operationId = Reflect.get(operation, 'id');
  const model = Reflect.get(operation, 'model');
  const name = Reflect.get(operation, 'name');
  const kind = Reflect.get(operation, 'operation');
  if (typeof model === 'string' && typeof name === 'string' && (kind === 'create' || kind === 'update' || kind === 'delete')) {
    return `models.${model}.${name}.v1`;
  }
  if (typeof operationId === 'string') return operationId;
  throw new Error('applik8s-command-outbox-operation-invalid: Registered model operation has no durable command identity.');
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

function modelLifecyclePayload(model: ApplicationRuntimeModelContract, definition: EventDefinition<object>, payload: object, committedSpec: object, revision: string): object {
  const modelName = model.name;
  const expectedPrefix = `models.${modelName}.`;
  if (!definition.name.startsWith(expectedPrefix)) return payload;
  const operation = Reflect.get(payload, 'operation');
  if (operation !== 'create' && operation !== 'update' && operation !== 'delete') {
    return typeof operation === 'string' && Reflect.has(payload, 'result')
      ? { ...payload, current: committedSpec, revision }
      : payload;
  }
  if (operation === 'create') return { ...payload, value: committedSpec, revision };
  if (operation === 'update') return { ...payload, current: committedSpec, revision };
  return { ...payload, revision };
}

function modelLifecycleOutput(model: ApplicationRuntimeModelContract, commandName: string, output: object, committedSpec: object, revision: string): object {
  if (commandName !== `models.${model.name}.create` && commandName !== `models.${model.name}.update`) return output;
  return { ...output, value: committedSpec, revision };
}

function modelSpecAtRevision<TSpec extends object>(model: ApplicationRuntimeModelContract, spec: TSpec, revision: string): TSpec {
  const revisionProperty = model.storageShape === 'native-relational' ? model.nativeRelational?.revision?.property : undefined;
  if (!revisionProperty) return spec;
  return { ...spec, [revisionProperty]: revision };
}

function commandParticipantClients(
  transaction: ApplicationPostgresTransactionSql,
  execution: Pick<PostgresModelCommandExecution<object, object, object, object>, 'bindingId' | 'historyModels' | 'message' | 'model' | 'models' | 'selfRead'>,
  scope: string,
): Readonly<Record<string, ApplicationModelCommandParticipantClient>> {
  const clients: Record<string, ApplicationModelCommandParticipantClient> = {};
  for (const model of execution.models ?? []) {
    if (model.name === execution.model.name) {
      if (!execution.selfRead) continue;
      const mutationError = () => {
        throw new Error(`applik8s-command-self-participant-read-only: Model ${model.name} is available through context.models only for related-row reads; mutate the locked target through the handler model.`);
      };
      clients[model.name] = {
        get: (ref) => lockedModelObject<object, object>(transaction, model, ref.id, true),
        query: (options) => lockedModelObjects<object, object>(transaction, model, options),
        create: mutationError,
        patch: mutationError,
        delete: mutationError,
      };
      continue;
    }
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
      query: (options) => lockedModelObjects<object, object>(transaction, model, options),
      async create(input) {
        const revision = nextRevision('create');
        const created = { id: input.id ?? nextRevision('id'), spec: input.spec, revision };
        await insertModelObject(transaction, model, created, false);
        await transition({ id: created.id, spec: {}, revision: nextRevision('missing-before-create') }, created, revision);
        await recordGenericModelChange(transaction, model, created.id, revision, execution.message.context, {}, created.spec, 'insert');
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
        await updateModelObject(transaction, model, before, after, true);
        await transition(before, after, revision);
        await recordGenericModelChange(transaction, model, after.id, revision, execution.message.context, before.spec, after.spec);
        return after;
      },
      async delete(ref) {
        const before = await lockedModelObject<object, object>(transaction, model, ref.id, true);
        if (!before) return;
        const revision = nextRevision('delete');
        const identityColumn = model.nativeRelational?.identity.column ?? 'id';
        await transaction.unsafe(`DELETE FROM ${qualifiedModelTable(model)} WHERE ${quoteIdentifier(identityColumn)} = $1`, [ref.id]);
        await transition(before, { id: before.id, spec: {}, revision }, revision);
        await recordGenericModelChange(transaction, model, before.id, revision, execution.message.context, before.spec, {}, 'delete');
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
  transaction: ApplicationPostgresTransactionSql,
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

function postgresCommandDatabase(model: ApplicationRuntimeModelContract, databaseUrl: string | undefined): Promise<ApplicationPostgresSql> {
  const url = databaseUrl ?? process.env[model.connectionEnvName] ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`applik8s-modelstore-missing-credentials: Command processor for ${model.name} requires ${model.connectionEnvName} or DATABASE_URL.`);
  }
  const key = `${model.connectionEnvName}:${url}`;
  const current = commandConnections.get(key);
  if (current) {
    return current;
  }
  const client = createApplicationPostgresSql(url, { max: 5 });
  commandConnections.set(key, client);
  return client;
}

// typecast-boundary: PostgreSQL's untyped row is converted through the registered native column contract before returning generic model data.
async function lockedModelObject<TSpec extends object, TStatus extends object>(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  targetKey: string,
  lock: boolean,
): Promise<ApplicationModelObject<TSpec, TStatus> | undefined> {
  if (model.storageShape === 'native-relational') {
    const native = requiredNativeRelationalContract(model);
    const rows = await transaction.unsafe(`SELECT * FROM ${qualifiedModelTable(model)} WHERE ${quoteIdentifier(native.identity.column)} = $1${lock ? ' FOR UPDATE' : ''}`, [targetKey]);
    const row = rows[0] as NativeModelRow | undefined;
    if (!row) return undefined;
    const value = nativeRowToProperties(model, row) as TSpec;
    const identity = Reflect.get(value, native.identity.property);
    const revision = native.revision ? Reflect.get(value, native.revision.property) : undefined;
    return {
      id: String(identity),
      spec: value,
      ...(typeof revision === 'string' ? { revision } : {}),
    };
  }
  const rows = await transaction.unsafe(`SELECT id, spec, status, revision FROM ${qualifiedModelTable(model)} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [targetKey]);
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

async function lockedModelObjects<TSpec extends object, TStatus extends object>(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  query: ApplicationModelQueryOptions<TSpec> & { readonly limit: number },
): Promise<ApplicationModelQueryPage<TSpec, TStatus>> {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error(`applik8s-command-participant-query-limit-invalid: Model ${model.name} requires a limit between 1 and 100.`);
  if (query.cursor || (query.orderBy?.length ?? 0) > 0) throw new Error(`applik8s-command-participant-query-unsupported: Model ${model.name} transaction queries currently support only bounded equality filters.`);
  if (model.storageShape === 'native-relational') {
    const native = requiredNativeRelationalContract(model);
    const parameters: unknown[] = [];
    const predicates = Object.entries(query.where ?? {}).map(([property, value]) => {
      const column = native.columns.find((candidate) => candidate.property === property)?.column;
      if (!column) throw new Error(`applik8s-command-participant-query-field-invalid: Model ${model.name} has no declared property ${property}.`);
      if (value === undefined) throw new Error(`applik8s-command-participant-query-value-invalid: Model ${model.name}.${property} cannot compare undefined.`);
      if (value === null) return `${quoteIdentifier(column)} IS NULL`;
      parameters.push(value);
      return `${quoteIdentifier(column)} = $${parameters.length}`;
    });
    const where = predicates.length > 0 ? ` WHERE ${predicates.join(' AND ')}` : '';
    const rows = await transaction.unsafe(`SELECT * FROM ${qualifiedModelTable(model)}${where} ORDER BY ${quoteIdentifier(native.identity.column)} ASC LIMIT ${query.limit} FOR UPDATE`, parameters as never[]);
    return {
      items: rows.map((row) => {
        const value = nativeRowToProperties(model, row as NativeModelRow) as TSpec;
        const identity = Reflect.get(value, native.identity.property);
        const revision = native.revision ? Reflect.get(value, native.revision.property) : undefined;
        return { id: String(identity), spec: value, ...(typeof revision === 'string' ? { revision } : {}) };
      }),
    };
  }
  const where = query.where && Object.keys(query.where).length > 0 ? ' WHERE spec @> $1::jsonb' : '';
  const parameters = where ? [JSON.stringify(query.where)] : [];
  const rows = await transaction.unsafe(`SELECT id, spec, status, revision FROM ${qualifiedModelTable(model)}${where} ORDER BY id ASC LIMIT ${query.limit} FOR UPDATE`, parameters);
  return {
    items: rows.map((row) => {
      // postgres.js deliberately exposes a broad Row & Iterable<Row> result
      // shape; this query selects the complete durable model-row contract.
      const modelRow = row as unknown as ModelRow;
      return { id: modelRow.id, spec: modelRow.spec as TSpec, ...(modelRow.status ? { status: modelRow.status as TStatus } : {}), revision: modelRow.revision };
    }),
  };
}

function commandTarget<TSpec extends object, TStatus extends object>(
  before: ApplicationModelObject<TSpec, TStatus>,
  patch: (patch: ApplicationModelPatch<TSpec, TStatus>) => void,
  spec: () => TSpec,
  status: () => TStatus | undefined,
  remove: () => void,
): ApplicationModelCommandTarget<TSpec, TStatus> {
  return {
    id: before.id,
    identity: before.id,
    get value() {
      return spec();
    },
    get spec() {
      return spec();
    },
    get status() {
      return status();
    },
    ...(before.revision ? { revision: before.revision } : {}),
    patch,
    delete: remove,
  };
}

async function insertModelObject<TSpec extends object, TStatus extends object>(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  value: ApplicationModelObject<TSpec, TStatus>,
  ignoreConflict: boolean,
): Promise<readonly unknown[]> {
  if (model.storageShape !== 'native-relational') {
    return transaction.unsafe(
      `INSERT INTO ${qualifiedModelTable(model)} (id, spec, status, revision) VALUES ($1, $2::jsonb, NULL, $3)${ignoreConflict ? ' ON CONFLICT (id) DO NOTHING' : ''} RETURNING id`,
      [value.id, postgresJson(transaction, value.spec), value.revision ?? ''],
    );
  }
  const native = requiredNativeRelationalContract(model);
  const properties = { ...value.spec, [native.identity.property]: Reflect.get(value.spec, native.identity.property) ?? value.id, ...(native.revision && value.revision ? { [native.revision.property]: value.revision } : {}) };
  const entries = native.columns.filter(({ property }) => Reflect.get(properties, property) !== undefined);
  if (entries.length === 0) throw new Error(`Native model ${model.name} initialization produced no insertable fields.`);
  const columns = entries.map(({ column }) => quoteIdentifier(column)).join(', ');
  const placeholders = entries.map((_entry, index) => `$${index + 1}`).join(', ');
  const parameters = entries.map(({ property }) => Reflect.get(properties, property));
  return transaction.unsafe(`INSERT INTO ${qualifiedModelTable(model)} (${columns}) VALUES (${placeholders})${ignoreConflict ? ` ON CONFLICT (${quoteIdentifier(native.identity.column)}) DO NOTHING` : ''} RETURNING *`, parameters);
}

async function updateModelObject<TSpec extends object, TStatus extends object>(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  before: ApplicationModelObject<TSpec, TStatus>,
  after: ApplicationModelObject<TSpec, TStatus>,
  locked: boolean,
): Promise<readonly unknown[]> {
  if (model.storageShape !== 'native-relational') {
    return transaction.unsafe(
      `UPDATE ${qualifiedModelTable(model)} SET spec = $2::jsonb, status = $3::jsonb, revision = $4, updated_at = now() WHERE id = $1${locked ? '' : ' AND revision = $5'} RETURNING id`,
      locked
        ? [after.id, postgresJson(transaction, after.spec), postgresJson(transaction, after.status ?? null), after.revision ?? '']
        : [after.id, postgresJson(transaction, after.spec), postgresJson(transaction, after.status ?? null), after.revision ?? '', before.revision ?? ''],
    );
  }
  const native = requiredNativeRelationalContract(model);
  if (!native.revision) throw new Error(`Native model ${model.name} cannot execute durable commands without a revision column.`);
  const mutable = native.columns.filter(({ property }) => property !== native.identity.property);
  const parameters = mutable.map(({ property }) => property === native.revision?.property ? after.revision : Reflect.get(after.spec, property));
  const assignments = mutable.map(({ column }, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(', ');
  parameters.push(after.id);
  let predicate = `${quoteIdentifier(native.identity.column)} = $${parameters.length}`;
  if (!locked) {
    parameters.push(before.revision ?? '');
    predicate += ` AND ${quoteIdentifier(native.revision.column)} = $${parameters.length}`;
  }
  // typecast: all values come from a schema-validated native row; postgres-js binds them as parameters rather than interpolating SQL.
  return transaction.unsafe(`UPDATE ${qualifiedModelTable(model)} SET ${assignments} WHERE ${predicate} RETURNING ${quoteIdentifier(native.identity.column)}`, parameters as never[]);
}

async function deleteModelObject<TSpec extends object, TStatus extends object>(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  before: ApplicationModelObject<TSpec, TStatus>,
  locked: boolean,
): Promise<readonly unknown[]> {
  if (model.storageShape !== 'native-relational') {
    const parameters: unknown[] = [before.id];
    let predicate = 'id = $1';
    if (!locked) {
      parameters.push(before.revision ?? '');
      predicate += ` AND revision = $${parameters.length}`;
    }
    return transaction.unsafe(`DELETE FROM ${qualifiedModelTable(model)} WHERE ${predicate} RETURNING id`, parameters as never[]);
  }
  const native = requiredNativeRelationalContract(model);
  const parameters: unknown[] = [before.id];
  let predicate = `${quoteIdentifier(native.identity.column)} = $1`;
  if (!locked) {
    if (!native.revision) throw new Error(`Native model ${model.name} cannot execute concurrent durable deletion without a revision column.`);
    parameters.push(before.revision ?? '');
    predicate += ` AND ${quoteIdentifier(native.revision.column)} = $${parameters.length}`;
  }
  return transaction.unsafe(`DELETE FROM ${qualifiedModelTable(model)} WHERE ${predicate} RETURNING ${quoteIdentifier(native.identity.column)}`, parameters as never[]);
}

function durableModelSnapshot<TSpec extends object, TStatus extends object>(value: unknown, id: string, revision: string): ApplicationModelObject<TSpec, TStatus> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const spec = Reflect.get(value, 'spec');
  if (!spec || typeof spec !== 'object') return undefined;
  const status = Reflect.get(value, 'status');
  return {
    id,
    spec: spec as TSpec,
    ...(status && typeof status === 'object' ? { status: status as TStatus } : {}),
    revision,
  };
}

async function installCommandTrustedContext(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  context: PostgresModelCommandMessage<object>['context'],
): Promise<void> {
  const principal = applicationCommandPrincipal(context);
  // Install the actor setting on every transaction. An explicit empty value
  // prevents a pooled connection from retaining an earlier actor if this
  // command has no admitted principal; model defaults use NULLIF to fail
  // actor-owned NOT NULL columns closed in that case.
  await transaction.unsafe('SELECT set_config($1, $2, true)', ['applik8s.principal.id', principal?.id ?? '']);
  const access = model.nativeRelational?.access;
  if (!access) return;
  const value = context?.values[access.context];
  if (value === undefined) throw new Error(`applik8s-command-trusted-context-missing: Native model ${model.name} requires trusted context ${access.context}.`);
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await transaction.unsafe('SELECT set_config($1, $2, true)', [access.setting, serialized]);
}

async function recordGenericModelChange(
  transaction: ApplicationPostgresTransactionSql,
  model: ApplicationRuntimeModelContract,
  identity: string,
  revision: string,
  context: PostgresModelCommandMessage<object>['context'],
  before: object,
  after: object,
  operation: 'insert' | 'update' | 'delete' = 'update',
): Promise<void> {
  if (model.storageShape !== 'native-relational') return;
  if (!context?.digest) throw new Error(`applik8s-command-context-digest-missing: Native model ${model.name} changes require a server-admitted context digest.`);
  if (!context.changeScopes) throw new Error(`applik8s-command-change-scopes-missing: Native model ${model.name} changes require server-admitted relational change scopes.`);
  const changeScope = applicationRelationalChangeScopeDigest(context.changeScopes, model.nativeRelational?.access?.context);
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)].filter((field) => !Object.is(Reflect.get(before, field), Reflect.get(after, field))))].sort();
  await transaction.unsafe(
    'INSERT INTO applik8s_model_changes (model, operation, identity, revision, context_digest, changed_fields, recorded_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, now())',
    [model.name, operation, JSON.stringify(identity), revision, changeScope, JSON.stringify(changedFields)],
  );
}

function requiredNativeRelationalContract(model: ApplicationRuntimeModelContract): NonNullable<ApplicationRuntimeModelContract['nativeRelational']> {
  if (!model.nativeRelational) throw new Error(`Native model ${model.name} is missing its relational storage contract.`);
  return model.nativeRelational;
}

function qualifiedModelTable(model: ApplicationRuntimeModelContract): string {
  const schema = model.nativeRelational?.schema;
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(model.tableName)}` : quoteIdentifier(model.tableName);
}

function nativeRowToProperties(model: ApplicationRuntimeModelContract, row: NativeModelRow): object {
  const native = requiredNativeRelationalContract(model);
  return Object.fromEntries(native.columns.map(({ property, column }) => [property, Reflect.get(row, column)]));
}

function commandScope(execution: Pick<PostgresModelCommandExecution<object, object, object, object>, 'bindingId' | 'model' | 'message'>): string {
  return applicationCommandScope(
    execution.bindingId,
    execution.model.name,
    execution.message.targetKey,
    execution.message.idempotencyKey,
    execution.message.context?.digest ?? 'unscoped',
  );
}

function commandTargetScope(bindingId: string, model: string, targetKey: string): string {
  return `target:${bindingId}:${model}:${targetKey}`;
}

function commandDeterministicId(scope: string, purpose: string): string {
  return createHash('sha256').update(`${scope}:${purpose}`).digest('hex');
}

function postgresJson(transaction: ApplicationPostgresTransactionSql, value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('applik8s-command-json-invalid: Durable command state, results, and outbox payloads must be JSON serializable.');
  }
  const normalized: unknown = JSON.parse(serialized);
  // typecast: JSON.parse of a defined JSON.stringify result satisfies postgres-js's recursive JSONValue contract.
  return transaction.json(normalized);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
