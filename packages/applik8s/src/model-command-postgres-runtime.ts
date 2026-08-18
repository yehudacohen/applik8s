// typecast-file-boundary: PostgreSQL rows and schema-normalized command payloads are validated before restoring declaration-time model generics.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { ApplicationMutationOperation } from '@applik8s/client';
import type { ApplicationAuthorizationReceipt, ApplicationRetryPolicy, JsonObject, JsonValue } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import { withApplicationManagedEffects } from './application-managed-effects.js';
import {
  isApplicationModelPolicyRejectedError,
} from './application-model-policy.js';
import type { ApplicationModelCommandContext, ApplicationModelCommandHandler, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelObject, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationPublicStreamCommitScope } from './application-stream-commit.js';
import {
  applicationCommandCausalPrincipalId,
  applicationCommandPrincipal,
  applicationCommandTrustedContext,
} from './command-principal.js';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import type { ApplicationCommandObservation, ApplicationMessageEnvelope, ApplicationStateRevisionRef, CommandDefinition, EventDefinition } from './dsl.js';
import type {
  ApplicationNativeModelEditTarget,
  ApplicationNativeModelTransactionRequest,
} from './native-model-execution.js';
import { withApplicationNativeModelClients } from './native-model-execution.js';
import type { ApplicationPostgresSql, ApplicationPostgresTransactionSql } from './postgres-runtime-contract.js';
import type { ApplicationDatabaseClient } from './relational-runtime.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import { applicationRelationalChangeScopeDigest } from './relational-runtime.js';
import { applicationModelChangeCommitScope } from './relational-runtime-contract.js';

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
  /** Canonical admission receipt persisted with the durable inbox record. */
  readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
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
  /**
   * Framework-owned conventional mutation semantics. Custom commands and
   * function-native edits remain `custom`; generated model create operations
   * use this discriminator to reject an already-existing identity rather than
   * silently running their create policy against the retained row.
   */
  readonly operation?: 'create' | 'update' | 'delete' | 'custom';
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
  readonly outbox?: readonly PostgresModelCommandEventDefinition[];
  /**
   * Framework-owned committed event for one custom model mutation. Unlike
   * ordinary outbox events, this is emitted by the transaction kernel only
   * after the handler and pre-commit authorization have succeeded.
   */
  readonly completionEvent?: PostgresModelCommandEventDefinition;
  readonly commands?: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[];
  /** Compiler-proven same-authority operations callable by the handler. */
  readonly atomicOperations?: readonly FunctionNativePostgresNestedOperation[];
  readonly ordering?: 'serial' | 'concurrent';
  readonly missingRoute?: string;
  readonly initialize?: (input: TInput, targetKey: string) => TSpec;
  readonly handler: ApplicationModelCommandHandler<TSpec, TStatus, TInput, TOutput>;
  /**
   * Canonical durable-authority check performed inside the model transaction
   * after the handler has produced its staged result and immediately before
   * model, outbox, and result writes are committed.
   */
  readonly revalidateAuthorization?: (
    receipt: ApplicationAuthorizationReceipt,
    boundary: 'pre-commit',
    context: {
      readonly transaction: ApplicationPostgresTransactionSql;
      readonly trustedContextDigest: string;
    },
  ) => Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly code: string; readonly message: string }
  >;
  readonly databaseUrl?: string;
  /** Compiler-owned shared transaction for awaited operation composition. */
  readonly transaction?: ApplicationPostgresTransactionSql;
}

/**
 * Compiler-owned event delivery metadata. Domain handlers still receive the
 * ordinary EventDefinition; the generated processor attaches the partition
 * function declared by app.stream(...) before executing the transaction.
 */
export interface PostgresModelCommandEventDefinition
  extends EventDefinition<object> {
  readonly partition?: (payload: object) => string;
}

export interface PostgresModelCommandResult<TSpec extends object, TStatus extends object, TOutput extends object> {
  readonly replayed: boolean;
  readonly observation: ApplicationCommandObservation;
  readonly output: TOutput;
  readonly model: ApplicationModelObject<TSpec, TStatus>;
  readonly deleted?: boolean;
  readonly events: readonly ApplicationMessageEnvelope<object>[];
}

export interface FunctionNativePostgresModelEditExecution {
  readonly bindingId: string;
  readonly model: ApplicationRuntimeModelContract;
  readonly models: readonly ApplicationRuntimeModelContract[];
  readonly outbox: readonly PostgresModelCommandEventDefinition[];
  readonly commands?: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[];
  readonly atomicOperations?: readonly FunctionNativePostgresNestedOperation[];
  readonly databaseUrl: string;
  readonly delivery: {
    readonly id: string;
    readonly idempotencyKey: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly recordedAt?: string;
    readonly attempt?: number;
    readonly context?: PostgresModelCommandMessage<object>['context'];
    readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
  };
  readonly revalidateAuthorization?: NonNullable<
    PostgresModelCommandExecution<object, object, object, object>[
      'revalidateAuthorization'
    ]
  >;
}

export interface FunctionNativePostgresNestedOperation {
  readonly operationId: string;
  readonly bindingId: string;
  readonly operation: 'create' | 'update' | 'delete' | 'custom';
  readonly command: { readonly name: string; readonly version: string };
  readonly errors: readonly string[];
  readonly schemas: NonNullable<PostgresModelCommandExecution<object, object, object, object>['schemas']>;
  readonly model: ApplicationRuntimeModelContract;
  readonly models: readonly ApplicationRuntimeModelContract[];
  readonly selfRead: boolean;
  readonly historyModels: readonly string[];
  readonly retry: ApplicationRetryPolicy;
  readonly history: boolean;
  readonly outbox: readonly PostgresModelCommandEventDefinition[];
  readonly completionEvent?: PostgresModelCommandEventDefinition;
  readonly commands: readonly CommandDefinition<object, object, Readonly<Record<string, object>>>[];
  readonly ordering: 'serial' | 'concurrent';
  readonly missingRoute?: string;
  readonly initialize?: (input: object, targetKey: string) => object;
  readonly handler: ApplicationModelCommandHandler<object, object, object, object>;
  readonly revalidateAuthorization?: PostgresModelCommandExecution<object, object, object, object>['revalidateAuthorization'];
}

export interface FunctionNativePostgresTransactionExecution {
  readonly bindingId: string;
  readonly databaseUrl: string;
  readonly connectionModel: ApplicationRuntimeModelContract;
  readonly operations: readonly FunctionNativePostgresNestedOperation[];
  readonly delivery: FunctionNativePostgresModelEditExecution['delivery'];
  readonly retry?: ApplicationRetryPolicy;
}

interface FunctionNativeModelEditResult {
  readonly returned: boolean;
  readonly value?: JsonValue;
}

export interface PostgresModelCommandTerminalFailureExecution<TInput extends object = object> {
  readonly bindingId: string;
  readonly command: { readonly name: string; readonly version: string };
  readonly model: ApplicationRuntimeModelContract;
  readonly message: PostgresModelCommandMessage<TInput>;
  readonly databaseUrl?: string;
  /** Focused runtime/test injection; generated workers use databaseUrl. */
  readonly sql?: ApplicationPostgresSql;
}

export interface ApplicationCommandTerminalFailure {
  readonly code: 'processing_failed' | 'authorization_denied';
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
  readonly definition: PostgresModelCommandEventDefinition;
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
interface FunctionNativePostgresTransactionContext {
  readonly transaction: ApplicationPostgresTransactionSql;
  readonly database?: ApplicationDatabaseClient<Readonly<Record<string, unknown>>>;
}

const functionNativePostgresTransaction =
  new AsyncLocalStorage<FunctionNativePostgresTransactionContext>();
let commandEffectGuardsInstalled = false;

/**
 * Returns the transaction currently executing a compiler-inferred callback.
 * Generated application views use this to read their own staged model
 * operations instead of opening an inconsistent sibling connection.
 */
export function currentFunctionNativePostgresTransaction():
  | ApplicationPostgresTransactionSql
  | undefined {
  return functionNativePostgresTransaction.getStore()?.transaction;
}

/** Returns the Drizzle transaction paired with the current inferred callback. */
export function currentFunctionNativePostgresDatabase():
  | ApplicationDatabaseClient<Readonly<Record<string, unknown>>>
  | undefined {
  return functionNativePostgresTransaction.getStore()?.database;
}

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
    await persistCommandAuthorizationAdmission(transaction, execution.bindingId, execution.command, execution.message, scope);
    await transaction.unsafe(
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input, authorization_receipt) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) ON CONFLICT (scope) DO NOTHING',
      [scope, execution.bindingId, execution.model.name, execution.message.targetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input), execution.message.authorizationReceipt ? postgresJson(transaction, execution.message.authorizationReceipt) : null],
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
  const sql = execution.transaction
    ? undefined
    : await postgresCommandDatabase(execution.model, execution.databaseUrl);
  const scope = commandScope(execution);
  const recordedAt = execution.message.recordedAt ?? new Date().toISOString();
  const execute = () => {
    const run = async (
      transaction: ApplicationPostgresTransactionSql,
    ): Promise<
      | PostgresModelCommandResult<TSpec, TStatus, TOutput>
      | RejectedCommandOutcome
    > => {
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
    if (execution.message.context?.digest) {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [applicationModelChangeCommitScope(execution.message.context.digest)]);
    }
    await installCommandTrustedContexts(
      transaction,
      [execution.model, ...(execution.models ?? [])],
      execution.message.context,
    );
    await persistCommandAuthorizationAdmission(transaction, execution.bindingId, execution.command, execution.message, scope);
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
    if (before && execution.operation === 'create') {
      const rejection = {
        name: 'targetExists',
        payload: {
          model: execution.model.name,
          targetKey: effectiveTargetKey,
        },
      };
      const revision =
        before.revision ??
        commandDeterministicId(scope, 'rejected-existing-target');
      await recordCommandRejection(
        transaction,
        effectiveExecution,
        scope,
        rejection,
        revision,
      );
      await transaction.unsafe(
        'RELEASE SAVEPOINT applik8s_command_handler',
      );
      return {
        rejected: true,
        rejection,
        replayed: false,
        revision,
        targetKey: effectiveTargetKey,
        ...(before.revision
          ? {
              stateRevision: modelStateRevision(
                execution.model.name,
                effectiveTargetKey,
                before.revision,
              ),
            }
          : {}),
      };
    }
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
        // The relational access column is framework-owned. Hydrate it from the
        // server-admitted context before the initial INSERT so PostgreSQL RLS
        // can validate the row that the policy callback is about to refine.
        // Waiting for beforeCommit to patch this field is too late: the
        // initializer itself must cross WITH CHECK first.
        spec: modelSpecAtTrustedAccess(
          execution.model,
          execution.initialize(execution.message.input, effectiveTargetKey),
          execution.message.context,
        ),
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
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input, authorization_receipt) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)',
      [scope, execution.bindingId, execution.model.name, effectiveTargetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input), execution.message.authorizationReceipt ? postgresJson(transaction, execution.message.authorizationReceipt) : null],
    );
    const emitted: EmittedEvent[] = [];
    const allowedEvents = new Set((execution.outbox ?? []).map((definition) => definition.id));
    const allowedCommands = new Map((execution.commands ?? []).map((definition) => [definition.id, definition]));
    const atomicOperations = new Map(
      (execution.atomicOperations ?? []).map((operation) => [
        operation.operationId,
        operation,
      ]),
    );
    let atomicOperationSequence = 0;
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
    const participantClients = commandParticipantClients(transaction, execution, scope);
    const context: ApplicationModelCommandContext<Readonly<Record<string, object>>> = {
      commandId: execution.message.id,
      ...(execution.message.correlationId ? { correlationId: execution.message.correlationId } : {}),
      ...(execution.message.causationId ? { causationId: execution.message.causationId } : {}),
      attempt: execution.message.attempt ?? 1,
      now: recordedAt,
      ...(principal ? { principal } : {}),
      trustedContext: applicationCommandTrustedContext(execution.message.context),
      models: participantClients,
      update: updateTarget,
      id: (idScope = 'default') => commandDeterministicId(scope, `handler:${idScope}`),
      emit(event, payload) {
        if (!allowedEvents.has(event.id)) {
          throw new Error(`applik8s-command-undeclared-outbox: Handler ${execution.bindingId} emitted ${event.id}, but it is not declared in transaction.outbox.`);
        }
        validateJsonMessageSchema(execution.schemas?.events?.[event.id], payload, `${event.name}.${event.version}.payload`);
        // typecast: the event and payload retain their generic relationship at the public emit call and are erased only for durable outbox storage.
        emitted.push({
          definition: event as PostgresModelCommandEventDefinition,
          payload,
        });
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
      output = await commandEffectBoundary.run(
        true,
        () => withApplicationNativeModelClients(
          participantClients,
          () => withApplicationManagedEffects(
            {
              commandId: execution.message.id,
              routingContext: {
                ...(principal ? { principal } : {}),
                trustedContext: applicationCommandTrustedContext(
                  execution.message.context,
                ),
              },
              emit(contract, payload) {
                const event = contract as EventDefinition<object>;
                const sequence = emitted.length;
                context.emit(event, payload);
                return {
                  kind: 'applicationStagedEffect',
                  effect: 'event',
                  contract: event.id,
                  sequence,
                };
              },
              invoke(operation, input, route) {
                const sequence = emittedCommands.length;
                const messageId = commandDeterministicId(
                  scope,
                  `staged-command:${sequence}:${operation.id}`,
                );
                const delivery = route(messageId);
                context.send(
                  // typecast: the ambient runtime carries the already-validated
                  // operation contract; context.send only inspects that contract.
                  { operation } as unknown as ApplicationMutationOperation<
                    object,
                    unknown
                  >,
                  input,
                  {
                    targetKey: delivery.targetKey,
                    ...(delivery.idempotencyKey
                      ? { idempotencyKey: delivery.idempotencyKey }
                      : {}),
                  },
                );
                return {
                  kind: 'applicationStagedEffect',
                  effect: 'command',
                  contract: operation.id,
                  sequence,
                };
              },
              ...(atomicOperations.size > 0
                ? {
                    async invokeAtomic(operation, input, route) {
                      const nested = atomicOperations.get(operation.id);
                      if (!nested) {
                        throw new Error(
                          `applik8s-function-native-operation-undeclared: Transaction ${execution.bindingId} attempted ${operation.id}, but the compiler did not prove that dependency.`,
                        );
                      }
                      if (
                        nested.model.connectionEnvName
                        !== execution.model.connectionEnvName
                      ) {
                        throw new Error(
                          `applik8s-function-native-cross-authority: Operation ${operation.id} uses ${nested.model.connectionEnvName}, while transaction ${execution.bindingId} uses ${execution.model.connectionEnvName}. Use a workflow or a post-commit event handler across database authorities.`,
                        );
                      }
                      const sequence = atomicOperationSequence;
                      atomicOperationSequence += 1;
                      const messageId = commandDeterministicId(
                        scope,
                        `atomic-command:${sequence}:${operation.id}`,
                      );
                      const delivery = route(messageId);
                      const nestedTargetKey = canonicalApplicationCommandKey(
                        delivery.targetKey,
                      );
                      if (
                        nested.model.name === execution.model.name
                        && nestedTargetKey === effectiveTargetKey
                      ) {
                        throw new Error(
                          `applik8s-function-native-reentrant-target: Transaction ${execution.bindingId} cannot invoke ${operation.id} against its own locked target ${execution.model.name}/${effectiveTargetKey}. Mutate the current edit target directly.`,
                        );
                      }
                      const {
                        revalidateAuthorization,
                        ...nestedExecution
                      } = nested;
                      const nestedResult = await executePostgresModelCommand({
                        ...nestedExecution,
                        ...(revalidateAuthorization
                          ? { revalidateAuthorization }
                          : {}),
                        message: {
                          id: messageId,
                          input,
                          targetKey: nestedTargetKey,
                          idempotencyKey:
                            delivery.idempotencyKey
                            ?? commandDeterministicId(
                              scope,
                              `atomic-idempotency:${sequence}:${operation.id}`,
                            ),
                          correlationId:
                            execution.message.correlationId
                            ?? execution.message.id,
                          causationId: execution.message.id,
                          recordedAt,
                          ...(execution.message.context
                            ? { context: execution.message.context }
                            : {}),
                        },
                        transaction,
                      });
                      return nestedResult.output;
                    },
                  }
                : {}),
            },
            () => execution.handler(target, execution.message.input, context),
          ),
        ),
      );
      validateJsonMessageSchema(execution.schemas?.output, output, `${execution.command.name}.${execution.command.version}.output`);
    } catch (error) {
      if (
        isApplicationModelPolicyRejectedError(error)
        && isRetryablePostgresTransactionError(error.policyCause)
      ) {
        throw error.policyCause;
      }
      const rejection = error instanceof CommandRejectionSignal
        ? error.rejection
        : isApplicationModelPolicyRejectedError(error)
          ? error.rejection
          : undefined;
      if (!rejection) throw error;
      if (!execution.errors?.includes(rejection.name)) {
        throw new Error(
          `applik8s-command-undeclared-error: Handler ${execution.bindingId} rejected with ${rejection.name}, but the command does not declare that durable error.`,
        );
      }
      validateJsonMessageSchema(
        execution.schemas?.errors[rejection.name],
        rejection.payload,
        `${execution.command.name}.${execution.command.version}.errors.${rejection.name}`,
      );
      // A declared rejection is a durable result, but it must not commit any model,
      // transition, history, or outbox side effects attempted by the handler.
      await transaction.unsafe('ROLLBACK TO SAVEPOINT applik8s_command_handler');
      await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
      // The inbox insert happened after this savepoint and was rolled back with the
      // handler's model/participant/outbox effects. Recreate it before recording the
      // FK-backed durable rejection result.
      await recordCommandRejection(transaction, effectiveExecution, scope, rejection, before.revision ?? commandDeterministicId(scope, 'rejected'));
      return {
        rejected: true,
        rejection,
        replayed: false,
        revision: before.revision ?? commandDeterministicId(scope, 'rejected'),
        targetKey: effectiveTargetKey,
        ...(before.revision ? { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, before.revision) } : {}),
      };
    }
    if (execution.message.authorizationReceipt) {
      if (!execution.revalidateAuthorization) {
        throw new Error(`applik8s-authorization-revalidator-missing: Binding ${execution.bindingId} received a protected durable command without a pre-commit revalidator.`);
      }
      const authorization = await execution.revalidateAuthorization(
        execution.message.authorizationReceipt,
        'pre-commit',
        {
          transaction,
          trustedContextDigest: execution.message.context?.digest
            ?? execution.message.authorizationReceipt.trustedContextDigest,
        },
      );
      if (!authorization.allowed) {
        await transaction.unsafe('ROLLBACK TO SAVEPOINT applik8s_command_handler');
        await transaction.unsafe('RELEASE SAVEPOINT applik8s_command_handler');
        const revision = before.revision ?? commandDeterministicId(scope, 'authorization-denied');
        const rejection = {
          name: 'internalFailure',
          payload: {
            code: 'authorization_denied',
            attempts: execution.message.attempt ?? 1,
            authorizationCode: authorization.code,
          },
        };
        await recordCommandRejection(transaction, effectiveExecution, scope, rejection, revision);
        return {
          rejected: true,
          rejection,
          replayed: false,
          revision,
          targetKey: effectiveTargetKey,
          ...(before.revision ? { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, before.revision) } : {}),
        };
      }
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
    if (execution.completionEvent) {
      emitted.push({
        definition: execution.completionEvent,
        payload: {
          operation: modelCompletionOperation(
            execution.model,
            execution.completionEvent,
          ),
          identity: effectiveTargetKey,
          previous: before.spec,
          current: committedSpec,
          result: output,
          revision,
        },
      });
    }

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
      const partitionKey = applicationEventPartitionKey(
        item.definition,
        payload,
        effectiveTargetKey,
      );
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
        partitionKey,
        ...(deleteTarget ? {} : { stateRevision: modelStateRevision(execution.model.name, effectiveTargetKey, revision) }),
      };
      envelopes.push(envelope);
      await transaction.unsafe(
        'INSERT INTO applik8s_event_outbox (id, scope, contract_name, contract_version, partition_key, envelope, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
        [envelope.id, scope, item.definition.name, item.definition.version, partitionKey, postgresJson(transaction, envelope), postgresJson(transaction, payload)],
      );
      await transaction.unsafe(
        'INSERT INTO applik8s_public_stream_events (id, contract_name, contract_version, partition_key, envelope, payload, context_digest, recorded_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::timestamptz)',
        [envelope.id, item.definition.name, item.definition.version, partitionKey, postgresJson(transaction, envelope), postgresJson(transaction, payload), execution.message.context?.digest ?? null, recordedAt],
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
    };
    if (execution.transaction) return run(execution.transaction);
    if (!sql) {
      throw new Error(
        `applik8s-command-database-unavailable: Command ${execution.bindingId} has neither a compiler-owned transaction nor a database connection.`,
      );
    }
    return sql.begin(run);
  };
  const outcome: PostgresModelCommandResult<TSpec, TStatus, TOutput> | RejectedCommandOutcome = execution.transaction
    ? await execute()
    : await retryPostgresCommandTransaction(execute, execution.retry);
  if ('rejected' in outcome) {
    throw new DurableCommandRejectedError(
      outcome.rejection,
      outcome.replayed,
      commandObservation(execution, 'rejected', outcome.replayed, outcome.revision, false, outcome.stateRevision, outcome.targetKey),
    );
  }
  return outcome;
}

/**
 * Runs an ordinary callback in one PostgreSQL transaction and exposes only
 * compiler-proven nested operations. Nested results are observable by the
 * callback, but remain provisional until the outer callback succeeds.
 */
export async function executeFunctionNativePostgresTransaction<TResult>(
  execution: FunctionNativePostgresTransactionExecution,
  handler: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const duplicateIds = execution.operations
    .map(({ operationId }) => operationId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(
      `applik8s-function-native-operation-ambiguous: Transaction ${execution.bindingId} contains duplicate operation bindings ${[...new Set(duplicateIds)].join(', ')}.`,
    );
  }
  const operations = new Map(
    execution.operations.map((operation) => [operation.operationId, operation]),
  );
  const sql = await postgresCommandDatabase(
    execution.connectionModel,
    execution.databaseUrl,
  );
  const outerScope = `function-native:${execution.bindingId}:${execution.delivery.id}:${execution.delivery.idempotencyKey}:${execution.delivery.context?.digest ?? 'unscoped'}`;
  return retryPostgresCommandTransaction(
    () => sql.begin(async (transaction) => {
      let sequence = 0;
      const principal = applicationCommandPrincipal(execution.delivery.context);
      const transactionDatabase = transaction.database as
        | ApplicationDatabaseClient<Readonly<Record<string, unknown>>>
        | undefined;
      return functionNativePostgresTransaction.run(
        {
          transaction,
          // typecast: the runtime-postgres adapter supplies a Drizzle
          // transaction implementing the framework's narrowed client surface.
          ...(transactionDatabase ? { database: transactionDatabase } : {}),
        },
        () => withApplicationManagedEffects({
          commandId: execution.delivery.id,
          routingContext: {
            ...(principal ? { principal } : {}),
            trustedContext: applicationCommandTrustedContext(
              execution.delivery.context,
            ),
          },
          emit(contract) {
            throw new Error(
              `applik8s-function-native-event-without-model-edit: Event ${contract.id} needs an explicit Model.edit(...) transaction boundary.`,
            );
          },
          invoke(operation) {
            throw new Error(
              `applik8s-function-native-staged-command-invalid: Operation ${operation.id} must be awaited so it can compose into the active transaction.`,
            );
          },
          async invokeAtomic(operation, input, route) {
            const nested = operations.get(operation.id);
            if (!nested) {
              throw new Error(
                `applik8s-function-native-operation-undeclared: Transaction ${execution.bindingId} attempted ${operation.id}, but the compiler did not prove that dependency.`,
              );
            }
            if (
              nested.model.connectionEnvName
              !== execution.connectionModel.connectionEnvName
            ) {
              throw new Error(
                `applik8s-function-native-cross-authority: Operation ${operation.id} uses ${nested.model.connectionEnvName}, while transaction ${execution.bindingId} uses ${execution.connectionModel.connectionEnvName}. Use a workflow or a post-commit event handler across database authorities.`,
              );
            }
            const invocation = sequence;
            sequence += 1;
            const messageId = commandDeterministicId(
              outerScope,
              `atomic-command:${invocation}:${operation.id}`,
            );
            const delivery = route(messageId);
            const {
              revalidateAuthorization,
              ...nestedExecution
            } = nested;
            const result = await executePostgresModelCommand({
              ...nestedExecution,
              ...(revalidateAuthorization
                ? { revalidateAuthorization }
                : {}),
              message: {
                id: messageId,
                input,
                targetKey: canonicalApplicationCommandKey(delivery.targetKey),
                idempotencyKey:
                  delivery.idempotencyKey
                  ?? commandDeterministicId(
                    outerScope,
                    `atomic-idempotency:${invocation}:${operation.id}`,
                  ),
                correlationId:
                  execution.delivery.correlationId ?? execution.delivery.id,
                causationId: execution.delivery.id,
                ...(execution.delivery.recordedAt
                  ? { recordedAt: execution.delivery.recordedAt }
                  : {}),
                ...(execution.delivery.attempt
                  ? { attempt: execution.delivery.attempt }
                  : {}),
                ...(execution.delivery.context
                  ? { context: execution.delivery.context }
                  : {}),
              },
              transaction,
            });
            return result.output;
          },
        }, handler),
      );
    }),
    execution.retry,
  );
}

/**
 * Enters the existing durable command kernel for one compiler-inferred
 * Model.edit(...) call. The trigger supplies identity/idempotency/authority;
 * application code supplies only the ordinary transaction closure.
 */
export async function executeFunctionNativePostgresModelEdit<
  TValue extends object,
  TIdentity,
  TResult,
>(
  execution: FunctionNativePostgresModelEditExecution,
  request: ApplicationNativeModelTransactionRequest<
    TValue,
    TIdentity,
    TResult
  >,
): Promise<TResult> {
  if (request.model !== execution.model.name) {
    throw new Error(
      `applik8s-function-native-model-mismatch: Trigger ${execution.bindingId} inferred ${execution.model.name}, but runtime code attempted ${request.model}.edit(...).`,
    );
  }
  const targetKey = canonicalApplicationCommandKey(
    request.identity as import('./application-models.js').ApplicationCommandKey,
  );
  const result = await executePostgresModelCommand<
    TValue,
    object,
    Record<string, never>,
    FunctionNativeModelEditResult
  >({
    bindingId: execution.bindingId,
    command: {
      name: `function-native.${execution.bindingId}`,
      version: 'v1',
    },
    model: execution.model,
    models: execution.models,
    selfRead: true,
    message: {
      id: execution.delivery.id,
      input: {},
      targetKey,
      idempotencyKey: execution.delivery.idempotencyKey,
      ...(execution.delivery.correlationId
        ? { correlationId: execution.delivery.correlationId }
        : {}),
      ...(execution.delivery.causationId
        ? { causationId: execution.delivery.causationId }
        : {}),
      ...(execution.delivery.recordedAt
        ? { recordedAt: execution.delivery.recordedAt }
        : {}),
      ...(execution.delivery.attempt
        ? { attempt: execution.delivery.attempt }
        : {}),
      ...(execution.delivery.context
        ? { context: execution.delivery.context }
        : {}),
      ...(execution.delivery.authorizationReceipt
        ? {
            authorizationReceipt:
              execution.delivery.authorizationReceipt,
          }
        : {}),
    },
    outbox: execution.outbox,
    ...(execution.commands ? { commands: execution.commands } : {}),
    ...(execution.atomicOperations
      ? { atomicOperations: execution.atomicOperations }
      : {}),
    ordering: 'serial',
    ...(execution.revalidateAuthorization
      ? {
          revalidateAuthorization:
            execution.revalidateAuthorization,
        }
      : {}),
    databaseUrl: execution.databaseUrl,
    async handler(target, _input, context) {
      let value = target.value;
      const editTarget = {
        ...value,
      } as TValue & ApplicationNativeModelEditTarget<TValue, TIdentity>;
      Object.defineProperties(editTarget, {
        identity: { value: request.identity, enumerable: false },
        revision: { get: () => target.revision, enumerable: false },
        value: { get: () => value, enumerable: false },
        update: {
          enumerable: false,
          value: async (patch: Partial<TValue>) => {
            const updated = await context.update(target, patch);
            value = updated.value.value;
            for (const [key, next] of Object.entries(value)) {
              Reflect.set(editTarget, key, next);
            }
          },
        },
        delete: {
          enumerable: false,
          value: async () => {
            target.delete();
          },
        },
      });
      const output = await request.handler(editTarget);
      return durableFunctionNativeModelEditResult(output);
    },
  });
  const output = result.output;
  // typecast: the transaction stores only JSON and restores the same generic
  // result contract; undefined is represented by returned:false.
  return (output.returned ? output.value : undefined) as TResult;
}

/**
 * Creates the lock-free model readers installed around a managed callback.
 * Mutations remain available only through the durable command/edit kernels.
 */
export async function applicationPostgresModelReadClients(
  database:
    | ApplicationPostgresSql
    | ApplicationPostgresTransactionSql
    | string,
  models: readonly ApplicationRuntimeModelContract[],
  context?: PostgresModelCommandMessage<object>['context'],
): Promise<Readonly<Record<string, ApplicationModelCommandParticipantClient>>> {
  const firstModel = models[0];
  if (!firstModel) return Object.freeze({});
  const sql = typeof database === 'string'
    ? await postgresCommandDatabase(firstModel, database)
    : database;
  const read = async <TResult>(
    model: ApplicationRuntimeModelContract,
    operation: (
      transaction: ApplicationPostgresTransactionSql,
    ) => Promise<TResult>,
  ): Promise<TResult> => {
    if (!context) {
      return operation(sql as ApplicationPostgresTransactionSql);
    }
    if ('begin' in sql && typeof sql.begin === 'function') {
      return sql.begin(async (transaction) => {
        await installCommandTrustedContext(transaction, model, context);
        return operation(transaction);
      });
    }
    const transaction = sql as ApplicationPostgresTransactionSql;
    await installCommandTrustedContext(transaction, model, context);
    return operation(transaction);
  };
  const clients: Record<string, ApplicationModelCommandParticipantClient> = {};
  const mutationError = () => {
    throw new Error(
      'applik8s-function-native-read-client-mutation: Direct model reads cannot mutate outside a durable Model.edit or model operation boundary.',
    );
  };
  for (const model of models) {
    const client: ApplicationModelCommandParticipantClient = Object.freeze({
      get: (reference: ApplicationModelRef) => read(
        model,
        (transaction) => lockedModelObject<object, object>(
          transaction,
          model,
          reference.id,
          false,
        ),
      ),
      query: (
        options: ApplicationModelQueryOptions<object> & {
          readonly limit: number;
        },
      ) => read(
        model,
        (transaction) => lockedModelObjects<object, object>(
          transaction,
          model,
          options,
          false,
        ),
      ),
      create: mutationError,
      patch: mutationError,
      delete: mutationError,
    });
    clients[model.name] = client;
  }
  return Object.freeze(clients);
}

function applicationEventPartitionKey(
  definition: PostgresModelCommandEventDefinition,
  payload: object,
  fallback: string,
): string {
  const partitionKey = definition.partition?.(payload) ?? fallback;
  if (
    typeof partitionKey !== 'string'
    || partitionKey.length === 0
    || Buffer.byteLength(partitionKey) > 1_024
  ) {
    throw new Error(
      `applik8s-event-partition-invalid: Event ${definition.name}.${definition.version} produced an empty or oversized partition key.`,
    );
  }
  return partitionKey;
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

function durableFunctionNativeModelEditResult(
  value: unknown,
): FunctionNativeModelEditResult {
  if (value === undefined) return { returned: false };
  assertFunctionNativeJsonValue(value, '$', new Set<object>());
  // typecast: the recursive validator proves the complete JSON value before
  // it crosses the durable result boundary.
  return { returned: true, value: value as JsonValue };
}

function assertFunctionNativeJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error(
      `applik8s-function-native-result-invalid: ${path} must be a finite JSON number.`,
    );
  }
  if (typeof value !== 'object') {
    throw new Error(
      `applik8s-function-native-result-invalid: ${path} contains non-JSON ${typeof value}.`,
    );
  }
  if (ancestors.has(value)) {
    throw new Error(
      `applik8s-function-native-result-invalid: ${path} contains a cycle.`,
    );
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertFunctionNativeJsonValue(item, `${path}[${index}]`, ancestors);
    });
    ancestors.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `applik8s-function-native-result-invalid: ${path} must be a plain JSON object.`,
    );
  }
  for (const [key, item] of Object.entries(value)) {
    assertFunctionNativeJsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
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

function modelCompletionOperation(
  model: ApplicationRuntimeModelContract,
  definition: EventDefinition<object>,
): string {
  const prefix = `models.${model.name}.`;
  const suffix = '.completed';
  if (
    !definition.name.startsWith(prefix)
    || !definition.name.endsWith(suffix)
  ) {
    throw new Error(
      `applik8s-command-completion-event-invalid: ${definition.id} must use ${prefix}<operation>${suffix}.`,
    );
  }
  const operation = definition.name.slice(
    prefix.length,
    -suffix.length,
  );
  if (!/^[$A-Z_a-z][$\w]*$/.test(operation)) {
    throw new Error(
      `applik8s-command-completion-event-invalid: ${definition.id} has invalid operation ${JSON.stringify(operation)}.`,
    );
  }
  return operation;
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
        const created = {
          id: input.id ?? nextRevision('id'),
          spec: modelSpecAtTrustedAccess(model, input.spec, execution.message.context),
          revision,
        };
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
      'INSERT INTO applik8s_command_inbox (scope, binding_id, model, target_key, idempotency_key, message_id, input, authorization_receipt) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)',
      [scope, execution.bindingId, execution.model.name, execution.message.targetKey, execution.message.idempotencyKey, execution.message.id, postgresJson(transaction, execution.message.input), execution.message.authorizationReceipt ? postgresJson(transaction, execution.message.authorizationReceipt) : null],
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

async function persistCommandAuthorizationAdmission<TInput extends object>(
  transaction: ApplicationPostgresTransactionSql,
  bindingId: string,
  command: { readonly name: string; readonly version: string },
  message: PostgresModelCommandMessage<TInput>,
  scope: string,
): Promise<void> {
  if (!message.authorizationReceipt) return;
  const receipt = postgresJson(transaction, message.authorizationReceipt);
  const rows = await transaction.unsafe(
    `INSERT INTO applik8s_command_admissions (scope, command, binding_id, command_id, authorization_receipt)
VALUES ($1, $2, $3, $4, $5::jsonb)
ON CONFLICT (scope) DO UPDATE
SET command = EXCLUDED.command
WHERE applik8s_command_admissions.command = EXCLUDED.command
  AND applik8s_command_admissions.binding_id = EXCLUDED.binding_id
  AND applik8s_command_admissions.command_id = EXCLUDED.command_id
  AND applik8s_command_admissions.authorization_receipt = EXCLUDED.authorization_receipt
RETURNING scope`,
    [
      scope,
      `${command.name}.${command.version}`,
      bindingId,
      message.id,
      receipt,
    ],
  );
  if (rows.length > 0) return;
  const existingRows = await transaction.unsafe(
    `SELECT command, binding_id, command_id, authorization_receipt
FROM applik8s_command_admissions
WHERE scope = $1
FOR UPDATE`,
    [scope],
  );
  const existing = existingRows[0];
  if (!existing
    || existing.command !== `${command.name}.${command.version}`
    || existing.binding_id !== bindingId
    || existing.command_id !== message.id
    || !sameCommandAuthorizationReceipt(
      existing.authorization_receipt,
      message.authorizationReceipt,
    )) {
    throw new Error(`applik8s-command-admission-conflict: Durable command ${scope} has different authorization evidence.`);
  }
  await transaction.unsafe(
    'UPDATE applik8s_command_admissions SET authorization_receipt = $2::jsonb WHERE scope = $1',
    [scope, receipt],
  );
}

function sameCommandAuthorizationReceipt(left: unknown, right: unknown): boolean {
  let normalizedLeft = left;
  if (typeof left === 'string') {
    try {
      normalizedLeft = JSON.parse(left);
    } catch {
      return false;
    }
  }
  return stableCommandAuthorizationJson(
    durableCommandAuthorizationEvidence(normalizedLeft),
  ) === stableCommandAuthorizationJson(
    durableCommandAuthorizationEvidence(right),
  );
}

function durableCommandAuthorizationEvidence(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const {
    // Receipt IDs and admission timestamps identify individual authorization
    // evaluations, not their authority evidence. A retry-stable durable
    // command may legitimately be reauthorized after process or transport
    // recovery and must still adopt its prior result.
    id: _id,
    admittedAt: _admittedAt,
    principal,
    ...evidence
  } = value as Readonly<Record<string, unknown>>;
  if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
    return evidence;
  }
  const {
    admittedAt: _principalAdmittedAt,
    ...principalEvidence
  } = principal as Readonly<Record<string, unknown>>;
  return {
    ...evidence,
    principal: principalEvidence,
  };
}

function stableCommandAuthorizationJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCommandAuthorizationJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableCommandAuthorizationJson(item)}`)
    .join(',')}}`;
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
    throw new Error(`applik8s-transactional-database-missing-credentials: Command processor for ${model.name} requires ${model.connectionEnvName} or DATABASE_URL.`);
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
  transaction: Pick<ApplicationPostgresTransactionSql, 'unsafe'>,
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
  transaction: Pick<ApplicationPostgresTransactionSql, 'unsafe'>,
  model: ApplicationRuntimeModelContract,
  query: ApplicationModelQueryOptions<TSpec> & { readonly limit: number },
  lock = true,
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
    const rows = await transaction.unsafe(`SELECT * FROM ${qualifiedModelTable(model)}${where} ORDER BY ${quoteIdentifier(native.identity.column)} ASC LIMIT ${query.limit}${lock ? ' FOR UPDATE' : ''}`, parameters as never[]);
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
  const rows = await transaction.unsafe(`SELECT id, spec, status, revision FROM ${qualifiedModelTable(model)}${where} ORDER BY id ASC LIMIT ${query.limit}${lock ? ' FOR UPDATE' : ''}`, parameters);
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
  const revision = native.revision;
  if (!revision && !locked) {
    throw new Error(
      `Native model ${model.name} cannot execute concurrent durable commands without a revision column; use serial ordering or declare a revision column.`,
    );
  }
  const mutable = native.columns.filter(({ property }) => property !== native.identity.property);
  const parameters = mutable.map(({ property }) => property === revision?.property ? after.revision : Reflect.get(after.spec, property));
  const assignments = mutable.map(({ column }, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(', ');
  parameters.push(after.id);
  let predicate = `${quoteIdentifier(native.identity.column)} = $${parameters.length}`;
  if (!locked && revision) {
    parameters.push(before.revision ?? '');
    predicate += ` AND ${quoteIdentifier(revision.column)} = $${parameters.length}`;
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
  await installCommandTrustedContexts(transaction, [model], context);
}

async function installCommandTrustedContexts(
  transaction: ApplicationPostgresTransactionSql,
  models: readonly ApplicationRuntimeModelContract[],
  context: PostgresModelCommandMessage<object>['context'],
): Promise<void> {
  const principal = applicationCommandPrincipal(context);
  // Install the actor setting on every transaction. An explicit empty value
  // prevents a pooled connection from retaining an earlier actor if this
  // command has no admitted principal; model defaults use NULLIF to fail
  // actor-owned NOT NULL columns closed in that case.
  await transaction.unsafe('SELECT set_config($1, $2, true)', ['applik8s.principal.id', principal?.id ?? '']);
  const causalPrincipalId = applicationCommandCausalPrincipalId(principal);
  await transaction.unsafe(
    'SELECT set_config($1, $2, true)',
    ['applik8s.principal.causal_id', causalPrincipalId ?? ''],
  );
  const settings = new Map<string, { readonly value: string; readonly model: string; readonly context: string }>();
  for (const model of models) {
    const access = model.nativeRelational?.access;
    if (!access) continue;
    const value = context?.values[access.context];
    if (value === undefined) throw new Error(`applik8s-command-trusted-context-missing: Native model ${model.name} requires trusted context ${access.context}.`);
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const previous = settings.get(access.setting);
    if (previous && previous.value !== serialized) {
      throw new Error(
        `applik8s-command-trusted-context-conflict: Models ${previous.model} and ${model.name} bind PostgreSQL setting ${access.setting} from incompatible trusted contexts ${previous.context} and ${access.context}.`,
      );
    }
    settings.set(access.setting, { value: serialized, model: model.name, context: access.context });
  }
  for (const [setting, binding] of settings) {
    await transaction.unsafe('SELECT set_config($1, $2, true)', [setting, binding.value]);
  }
}

function modelSpecAtTrustedAccess<TSpec extends object>(
  model: ApplicationRuntimeModelContract,
  spec: TSpec,
  context: PostgresModelCommandMessage<object>['context'],
): TSpec {
  const access = model.nativeRelational?.access;
  if (!access) return spec;
  const value = context?.values[access.context];
  if (value === undefined) {
    throw new Error(
      `applik8s-command-trusted-context-missing: Native model ${model.name} requires trusted context ${access.context}.`,
    );
  }
  return { ...spec, [access.property]: value };
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
    `WITH next_commit AS (
      UPDATE applik8s_model_change_commit_frontier
      SET position = position + 1
      WHERE singleton = true
      RETURNING position
    )
    INSERT INTO applik8s_model_changes
      (commit_position, model, operation, identity, revision, context_digest, changed_fields, recorded_at)
    SELECT position, $1, $2, $3::jsonb, $4, $5, $6::jsonb, now()
    FROM next_commit`,
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
  return Object.fromEntries(native.columns.map(({
    property,
    column,
    logicalType,
  }) => [
    property,
    normalizePostgresNativeModelValue(Reflect.get(row, column), logicalType),
  ]));
}

/**
 * Restore provider-native PostgreSQL values to the JSON/logical model
 * representation declared by the application schema. postgres.js returns
 * timestamptz/date columns as Date instances, while model events, durable
 * snapshots, and browser reads cross a JSON boundary and therefore use
 * canonical ISO strings.
 *
 * JSON/JSONB values may themselves contain arrays and objects, so normalize
 * recursively without coercing provider-specific non-plain values that should
 * still fail the model schema closed.
 */
export function normalizePostgresNativeModelValue(
  value: unknown,
  logicalType?: string,
): unknown {
  // postgres.js deliberately returns int8 values as strings so applications
  // cannot lose precision accidentally. Drizzle's `{ mode: "number" }`
  // declaration is the application's explicit request to decode that driver
  // representation as a number. The compiled runtime must preserve the same
  // behavior even though it reads rows through provider-neutral SQL.
  if (logicalType === 'number' && typeof value === 'string') {
    return Number(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => normalizePostgresNativeModelValue(item));
  }
  if (
    value
    && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizePostgresNativeModelValue(item),
      ]),
    );
  }
  return value;
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
