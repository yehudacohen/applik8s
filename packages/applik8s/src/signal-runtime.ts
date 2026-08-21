// typecast-file-boundary: persisted signal rows, provider receipts, and schema-validated action payloads cross erased storage records before typed hydration.
import { createHash, randomUUID } from 'node:crypto';
import type { JsonValue } from '@applik8s/core';
import type {
  ApplicationMatchedSignalOutcome,
  ApplicationSignal,
  ApplicationSignalActionName,
  ApplicationSignalActionOptions,
  ApplicationSignalActionResult,
  ApplicationSignalActor,
  ApplicationSignalAuthorizationReceiptReference,
  ApplicationSignalDecision,
  ApplicationSignalDefinition,
  ApplicationSignalEmitOptions,
  ApplicationSignalIssuance,
  ApplicationSignalOutcome,
  ApplicationSignalReference,
  ApplicationWorkflowSignalRuntime,
} from './application-signals.js';
import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import { validateRuntimeMessage } from './runtime-schema-validation.js';
import type { ApplicationStreamPayloadDecoder } from './stream-processor-runtime.js';

export interface ApplicationSignalIssueRequest<
  TDefinition extends ApplicationSignalDefinition = ApplicationSignalDefinition,
> {
  readonly occurrenceKey: string;
  readonly definition: TDefinition;
  readonly input: object;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly target: Readonly<Record<string, JsonValue>>;
  readonly access:
    | { readonly mode: 'authorize'; readonly selectors: readonly unknown[] }
    | { readonly mode: 'grant'; readonly subject: unknown };
  readonly issueReceipt: ApplicationSignalAuthorizationReceiptReference;
}

export interface ApplicationSignalStoredInstance {
  readonly id: string;
  readonly occurrenceKey: string;
  readonly contract: { readonly id: string; readonly name: string; readonly version: string };
  readonly input: object;
  readonly actions: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly target: Readonly<Record<string, JsonValue>>;
  readonly access:
    | { readonly mode: 'authorize'; readonly selectors: readonly unknown[] }
    | { readonly mode: 'grant'; readonly subject: unknown };
  readonly issueReceipt: ApplicationSignalAuthorizationReceiptReference;
  readonly terminal?:
    | {
        readonly status: 'resolved';
        readonly action: string;
        readonly input: object;
        readonly actor: ApplicationSignalActor;
        readonly receipt: ApplicationSignalAuthorizationReceiptReference;
        readonly decidedAt: string;
      }
    | { readonly status: 'expired'; readonly expiredAt: string };
}

/**
 * Enforces the issuance's subject-narrowing contract before canonical
 * operation authority is consulted. Runtime grants remain authoritative for
 * `grantAccessTo`; `authorize` selectors can only narrow existing authority.
 */
export function applicationSignalAccessAllows(
  signal: ApplicationSignalStoredInstance,
  actor: ApplicationSignalActor,
): boolean {
  if (signal.access.mode === 'grant') return true;
  return signal.access.selectors.some((selector) =>
    applicationSignalSelectorAllows(selector, actor));
}

/** Returns whether an issued one-shot signal may still accept an action. */
export function applicationSignalIsActionable(
  signal: ApplicationSignalStoredInstance,
  now: Date = new Date(),
): boolean {
  const expiresAt = Date.parse(signal.expiresAt);
  return signal.terminal === undefined
    && Number.isFinite(expiresAt)
    && expiresAt > now.getTime();
}

export interface ApplicationSignalResolutionRequest {
  readonly id: string;
  readonly action: string;
  readonly input: object;
  readonly actor: ApplicationSignalActor;
  readonly receipt?: ApplicationSignalAuthorizationReceiptReference;
  readonly decidedAt: string;
  readonly idempotencyKey: string;
}

export interface ApplicationSignalOutboxFact {
  readonly id: string;
  readonly kind: 'issued' | 'resolved' | 'expired';
  readonly signalId: string;
  readonly contractId: string;
  readonly payload: object;
  readonly recordedAt: string;
}

export interface ApplicationSignalStore {
  issue(
    request: ApplicationSignalIssueRequest,
    authorize?: ApplicationSignalIssueAuthorizer,
  ): Promise<{
    readonly instance: ApplicationSignalStoredInstance;
    readonly replayed: boolean;
  }>;
  read(id: string): Promise<ApplicationSignalStoredInstance | undefined>;
  resolve(
    request: ApplicationSignalResolutionRequest,
    authorize?: ApplicationSignalResolutionAuthorizer,
    finalize?: ApplicationSignalTerminalFinalizer,
  ): Promise<{
    readonly instance: ApplicationSignalStoredInstance;
    /**
     * `idempotent` means the same action won previously under the supplied
     * idempotency key and its complete action-correlated result may be
     * returned. `terminal` is a different or uncorrelated terminal attempt
     * and must remain redacted.
     */
    readonly replay: 'none' | 'idempotent' | 'terminal';
  }>;
  expire(
    id: string,
    expiredAt: string,
    finalize?: ApplicationSignalTerminalFinalizer,
  ): Promise<{
    readonly instance: ApplicationSignalStoredInstance;
    readonly replayed: boolean;
  }>;
  expireDue(
    now: string,
    limit: number,
    finalize?: ApplicationSignalTerminalFinalizer,
  ): Promise<readonly string[]>;
  pendingOutbox(limit: number): Promise<readonly ApplicationSignalOutboxFact[]>;
  acknowledgeOutbox(ids: readonly string[]): Promise<void>;
}

export type ApplicationSignalResolutionAuthorizer = (
  request: Omit<ApplicationSignalResolutionRequest, 'receipt'> & {
    readonly signal: ApplicationSignalStoredInstance;
  },
  context: {
    readonly transaction?: ApplicationPostgresTransactionSql;
  },
) =>
  | ApplicationSignalAuthorizationReceiptReference
  | Promise<ApplicationSignalAuthorizationReceiptReference>;

export type ApplicationSignalTerminalFinalizer = (
  request: {
    readonly signal: ApplicationSignalStoredInstance;
    readonly terminal:
      | {
          readonly status: 'resolved';
          readonly action: string;
          readonly actor: ApplicationSignalActor;
          readonly receipt: ApplicationSignalAuthorizationReceiptReference;
          readonly decidedAt: string;
        }
      | {
          readonly status: 'expired';
          readonly expiredAt: string;
        };
  },
  context: {
    readonly transaction?: ApplicationPostgresTransactionSql;
  },
) => void | Promise<void>;

export type ApplicationSignalIssueAuthorizer = (
  request: ApplicationSignalIssueRequest,
  context: {
    readonly signalId: string;
    /**
     * Present for transactional stores. Authority implementations may bind
     * their own repository to this transaction; callers must not issue raw
     * application writes through it.
     */
    readonly transaction?: ApplicationPostgresTransactionSql;
  },
) =>
  | ApplicationSignalAuthorizationReceiptReference
  | undefined
  | Promise<ApplicationSignalAuthorizationReceiptReference | undefined>;

export interface ApplicationSignalOutboxRelayOptions {
  readonly store: ApplicationSignalStore;
  readonly publish: (fact: ApplicationSignalOutboxFact) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly batchSize?: number;
  readonly idleMs?: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onError?: (error: unknown) => void;
  readonly finalizeTerminal?: ApplicationSignalTerminalFinalizer;
}

export interface ApplicationWorkflowSignalRuntimeOptions {
  readonly store: ApplicationSignalStore;
  readonly invocation: {
    readonly id: string;
    readonly revision: string;
  };
  /** Cancellation for the admitted workflow execution that owns this signal. */
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly wait: (
    reference: ApplicationSignalReference,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  /**
   * Durable providers pass a history-backed occurrence. Tests and non-durable
   * adapters may omit it and use the runtime-local monotonic fallback.
   */
  readonly occurrence?: (contractId: string) => string;
  readonly authorizeIssue: (
    request: ApplicationSignalIssueRequest,
    context: {
      readonly signalId: string;
      readonly transaction?: ApplicationPostgresTransactionSql;
    },
  ) =>
    | ApplicationSignalAuthorizationReceiptReference
    | undefined
    | Promise<ApplicationSignalAuthorizationReceiptReference | undefined>;
}

export interface ApplicationSignalHydrationOptions<
  TDefinition extends ApplicationSignalDefinition = ApplicationSignalDefinition,
> {
  readonly store: ApplicationSignalStore;
  readonly definition: TDefinition;
  readonly reference: ApplicationSignalReference<TDefinition>;
  readonly actor: ApplicationSignalActor;
  readonly authorizeAction: (request: {
    readonly signal: ApplicationSignalStoredInstance;
    readonly action: string;
    readonly actor: ApplicationSignalActor;
    readonly input: object;
    readonly transaction?: ApplicationPostgresTransactionSql;
  }) => Promise<ApplicationSignalAuthorizationReceiptReference>;
  readonly finalizeAction?: ApplicationSignalTerminalFinalizer;
  readonly now?: () => Date;
}

export interface ApplicationSignalIssuanceDecoderOptions<
  TDefinition extends ApplicationSignalDefinition = ApplicationSignalDefinition,
> {
  readonly store: ApplicationSignalStore;
  readonly definition: TDefinition;
  /**
   * Admits the current server execution. Implementations derive the actor from
   * authenticated workload or causal-principal metadata; it is never read
   * from the signal action payload.
   */
  readonly admit: (
    issuance: ApplicationSignalIssuance<
      TDefinition,
      ApplicationSignalReference<TDefinition>
    >,
    context: Parameters<
      ApplicationStreamPayloadDecoder<
        ApplicationSignalIssuance<
          TDefinition,
          ApplicationSignalReference<TDefinition>
        >,
        ApplicationSignalIssuance<TDefinition>
      >
    >[1],
  ) => Promise<{
    readonly actor: ApplicationSignalActor;
    readonly authorizeAction: ApplicationSignalHydrationOptions<TDefinition>['authorizeAction'];
    readonly finalizeAction?: ApplicationSignalTerminalFinalizer;
  }>;
  readonly now?: () => Date;
}

export interface PostgresApplicationSignalStoreOptions {
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
}

export function createApplicationWorkflowSignalRuntime(
  options: ApplicationWorkflowSignalRuntimeOptions,
): ApplicationWorkflowSignalRuntime {
  let occurrence = 0;
  return {
    async emit(definition, emitOptions) {
      throwIfApplicationSignalAborted(options.signal);
      assertApplicationSignalAccessMode(definition.id, emitOptions);
      const now = (options.now ?? (() => new Date()))();
      const expiresAt = new Date(
        now.getTime() + applicationSignalDurationMs(emitOptions.expiresIn),
      ).toISOString();
      const input = validateRuntimeMessage(
        definition.input,
        emitOptions.input,
        `${definition.id}.input`,
      );
      const callOccurrence =
        options.occurrence?.(definition.id) ?? String(++occurrence);
      const occurrenceKey = stableSignalId([
        options.invocation.id,
        options.invocation.revision,
        definition.id,
        callOccurrence,
      ]);
      const issueReceipt = {
        id: `signal-issue:${occurrenceKey}`,
      };
      const request: ApplicationSignalIssueRequest = {
        occurrenceKey,
        definition,
        input,
        issuedAt: now.toISOString(),
        expiresAt,
        target: emitOptions.target,
        access: emitOptions.grantAccessTo !== undefined
          ? { mode: 'grant', subject: emitOptions.grantAccessTo }
          : {
              mode: 'authorize',
              selectors: emitOptions.authorize ?? [],
            },
        issueReceipt,
      };
      const issued = await options.store.issue(
        request,
        options.authorizeIssue,
      );
      throwIfApplicationSignalAborted(options.signal);
      return signalDecision(
        definition,
        issued.instance,
        options.store,
        options.wait,
        options.signal,
      );
    },
  };
}

export function hydrateApplicationSignal<
  TDefinition extends ApplicationSignalDefinition,
>(
  options: ApplicationSignalHydrationOptions<TDefinition>,
): ApplicationSignal<TDefinition> {
  const actions = Object.fromEntries(
    Object.keys(options.definition.actions).map((action) => [
      action,
      async (input: object, actionOptions?: ApplicationSignalActionOptions) => {
        if (actionOptions?.signal?.aborted) {
          throw actionOptions.signal.reason ?? new Error('Signal action aborted.');
        }
        const instance = await options.store.read(options.reference.issuance.id);
        if (!instance) {
          throw new Error(
            `Signal ${options.reference.issuance.id} no longer exists.`,
          );
        }
        const actionSchema = options.definition.actions[action];
        if (!actionSchema) {
          throw new Error(
            `Signal ${options.definition.id} no longer declares action ${action}.`,
          );
        }
        let validated: object;
        try {
          validated = validateRuntimeMessage(
            actionSchema,
            input,
            `${options.definition.id}.actions.${action}`,
          );
        } catch (cause) {
          throw new ApplicationSignalInputValidationError(
            cause instanceof Error ? cause.message : String(cause),
            { cause },
          );
        }
        const resolved = await options.store.resolve({
          id: instance.id,
          action,
          input: validated,
          actor: options.actor,
          decidedAt: (options.now ?? (() => new Date()))().toISOString(),
          idempotencyKey:
            actionOptions?.idempotencyKey ??
            stableSignalId([
              instance.id,
              action,
              options.actor.id,
              JSON.stringify(validated),
            ]),
        }, async (request, context) =>
          options.authorizeAction({
            signal: request.signal,
            action: request.action,
            actor: request.actor,
            input: request.input,
            ...(context.transaction
              ? { transaction: context.transaction }
              : {}),
          }), options.finalizeAction);
        return signalActionResult(
          options.definition,
          options.reference,
          action,
          resolved.instance,
          resolved.replay,
        );
      },
    ]),
  );
  return Object.freeze({
    ...options.reference,
    ...actions,
  }) as ApplicationSignal<TDefinition>;
}

/** Distinguishes caller-authored action payload failures from store/authority/runtime failures. */
export class ApplicationSignalInputValidationError extends Error {
  readonly code = 'SIGNAL_ACTION_INPUT_INVALID';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApplicationSignalInputValidationError';
  }
}

/**
 * Framework denial marker shared by signal transports. Adapters translate it
 * into their native forbidden result without confusing a denial with a
 * provider or transaction failure.
 */
export class ApplicationSignalAuthorizationDeniedError extends Error {
  constructor() {
    super('Application signal action is not authorized.');
    this.name = 'ApplicationSignalAuthorizationDeniedError';
  }
}

/**
 * Creates the server-only decoding facet for a signal issuance stream.
 *
 * Persisted event bytes remain an inert reference. The admitted event or
 * batch runtime calls this decoder on every attempt and receives a callable
 * signal whose methods still pass through current exact-instance authority.
 */
export function createApplicationSignalIssuanceDecoder<
  TDefinition extends ApplicationSignalDefinition,
>(
  options: ApplicationSignalIssuanceDecoderOptions<TDefinition>,
): ApplicationStreamPayloadDecoder<
  ApplicationSignalIssuance<
    TDefinition,
    ApplicationSignalReference<TDefinition>
  >,
  ApplicationSignalIssuance<TDefinition>
> {
  return async (issuance, context) => {
    const reference = issuance.signal;
    if (
      reference?.$type !== 'applik8s.signal/v1'
      || reference.contract.id !== options.definition.id
      || reference.contract.name !== options.definition.name
      || reference.contract.version !== options.definition.version
      || reference.issuance.id !== issuance.id
      || reference.expiresAt !== issuance.expiresAt
    ) {
      throw new Error(
        `Signal issuance ${issuance.id} does not match contract ${options.definition.id}.`,
      );
    }
    const execution = await options.admit(
      issuance as ApplicationSignalIssuance<
        TDefinition,
        ApplicationSignalReference<TDefinition>
      >,
      context,
    );
    return Object.freeze({
      ...issuance,
      signal: hydrateApplicationSignal({
        store: options.store,
        definition: options.definition,
        reference,
        actor: execution.actor,
        authorizeAction: execution.authorizeAction,
        ...(execution.finalizeAction
          ? { finalizeAction: execution.finalizeAction }
          : {}),
        ...(options.now ? { now: options.now } : {}),
      }),
    });
  };
}

export function createMemoryApplicationSignalStore(): ApplicationSignalStore {
  const byId = new Map<string, ApplicationSignalStoredInstance>();
  const byOccurrence = new Map<string, string>();
  const resolutionKeys = new Map<string, string>();
  const outbox = new Map<string, ApplicationSignalOutboxFact>();
  let mutationQueue = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const expire = async (
    id: string,
    expiredAt: string,
    finalize?: ApplicationSignalTerminalFinalizer,
  ): Promise<{
    readonly instance: ApplicationSignalStoredInstance;
    readonly replayed: boolean;
  }> => {
    const current = byId.get(id);
    if (!current) throw new Error(`Signal ${id} does not exist.`);
    if (current.terminal) return { instance: current, replayed: true };
    await finalize?.({
      signal: current,
      terminal: { status: 'expired', expiredAt },
    }, {});
    const next: ApplicationSignalStoredInstance = Object.freeze({
      ...current,
      terminal: Object.freeze({
        status: 'expired' as const,
        expiredAt,
      }),
    });
    byId.set(id, next);
    const fact: ApplicationSignalOutboxFact = Object.freeze({
      id: stableSignalId([id, 'expired']),
      kind: 'expired',
      signalId: id,
      contractId: current.contract.id,
      payload: { signalId: id, expiredAt },
      recordedAt: expiredAt,
    });
    outbox.set(fact.id, fact);
    return { instance: next, replayed: false };
  };
  return {
    async issue(request, authorize) {
      return mutate(async () => {
        const previousId = byOccurrence.get(request.occurrenceKey);
        if (previousId) {
          const previous = byId.get(previousId);
          if (!previous) throw new Error(`Signal occurrence ${request.occurrenceKey} is corrupt.`);
          return { instance: previous, replayed: true };
        }
        const id = stableSignalId(['signal', request.occurrenceKey]);
        const authorizedReceipt = await authorize?.(request, { signalId: id });
        const instance: ApplicationSignalStoredInstance = Object.freeze({
          id,
          occurrenceKey: request.occurrenceKey,
          contract: {
            id: request.definition.id,
            name: request.definition.name,
            version: request.definition.version,
          },
          input: structuredClone(request.input),
          actions: Object.keys(request.definition.actions).sort(),
          issuedAt: request.issuedAt,
          expiresAt: request.expiresAt,
          target: structuredClone(request.target),
          access: structuredClone(request.access),
          issueReceipt: authorizedReceipt ?? request.issueReceipt,
        });
        byOccurrence.set(request.occurrenceKey, id);
        byId.set(id, instance);
        const fact: ApplicationSignalOutboxFact = Object.freeze({
          id: stableSignalId([id, 'issued']),
          kind: 'issued',
          signalId: id,
          contractId: request.definition.id,
          payload: signalIssuancePayload(instance),
          recordedAt: request.issuedAt,
        });
        outbox.set(fact.id, fact);
        return { instance, replayed: false };
      });
    },
    async read(id) {
      return byId.get(id);
    },
    async resolve(request, authorize, finalize) {
      return mutate(async () => {
        const previousResolution = resolutionKeys.get(
          `${request.id}\0${request.idempotencyKey}`,
        );
        const current = byId.get(request.id);
        if (!current) throw new Error(`Signal ${request.id} does not exist.`);
        if (previousResolution) {
          return {
            instance: current,
            replay: previousResolution === request.action
              ? 'idempotent' as const
              : 'terminal' as const,
          };
        }
        if (current.terminal) {
          return { instance: current, replay: 'terminal' as const };
        }
        if (!current.actions.includes(request.action)) {
          throw new Error(
            `Signal ${request.id} does not declare action ${request.action}.`,
          );
        }
        const receipt = authorize
          ? await authorize({ ...request, signal: current }, {})
          : request.receipt;
        if (!receipt) {
          throw new Error(
            `Signal ${request.id} resolution requires an authorization receipt.`,
          );
        }
        await finalize?.({
          signal: current,
          terminal: {
            status: 'resolved',
            action: request.action,
            actor: request.actor,
            receipt,
            decidedAt: request.decidedAt,
          },
        }, {});
        const next: ApplicationSignalStoredInstance = Object.freeze({
          ...current,
          terminal: Object.freeze({
            status: 'resolved' as const,
            action: request.action,
            input: structuredClone(request.input),
            actor: structuredClone(request.actor),
            receipt,
            decidedAt: request.decidedAt,
          }),
        });
        byId.set(request.id, next);
        resolutionKeys.set(
          `${request.id}\0${request.idempotencyKey}`,
          request.action,
        );
        const fact: ApplicationSignalOutboxFact = Object.freeze({
          id: stableSignalId([request.id, 'resolved']),
          kind: 'resolved',
          signalId: request.id,
          contractId: current.contract.id,
          payload: {
            signalId: request.id,
            action: request.action,
            decidedAt: request.decidedAt,
          },
          recordedAt: request.decidedAt,
        });
        outbox.set(fact.id, fact);
        return { instance: next, replay: 'none' as const };
      });
    },
    async expire(id, expiredAt, finalize) {
      return mutate(() => expire(id, expiredAt, finalize));
    },
    async expireDue(now, limit, finalize) {
      assertSignalBatchSize(limit);
      return mutate(async () => {
        const due = [...byId.values()]
          .filter(
            (instance) =>
              !instance.terminal
              && instance.expiresAt <= now,
          )
          .sort((left, right) =>
            left.expiresAt.localeCompare(right.expiresAt)
            || left.id.localeCompare(right.id),
          )
          .slice(0, limit);
        for (const instance of due) {
          await expire(instance.id, now, finalize);
        }
        return due.map((instance) => instance.id);
      });
    },
    async pendingOutbox(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Signal outbox limit must be a positive safe integer.');
      }
      return [...outbox.values()].slice(0, limit);
    },
    async acknowledgeOutbox(ids) {
      for (const id of ids) outbox.delete(id);
    },
  };
}

export function createPostgresApplicationSignalStore(
  options: PostgresApplicationSignalStoreOptions,
): ApplicationSignalStore & { close(): Promise<void> } {
  let ownedSql: ApplicationPostgresSql | undefined;
  const sqlPromise = options.sql
    ? Promise.resolve(options.sql)
    : options.databaseUrl
      ? createApplicationPostgresSql(options.databaseUrl, {
          max: 6,
          idle_timeout: 20,
          connect_timeout: 10,
          prepare: false,
        }).then((sql) => {
          ownedSql = sql;
          return sql;
        })
      : Promise.reject(
          new Error(
            'PostgreSQL SignalStore requires databaseUrl or an injected SQL client.',
          ),
        );
  let prepared: Promise<ApplicationPostgresSql> | undefined;
  const prepare = (): Promise<ApplicationPostgresSql> => {
    if (!prepared) {
      const attempt = sqlPromise.then(async (sql) => {
        for (const statement of applicationSignalPostgresMigrationSql) {
          await sql.unsafe(statement);
        }
        return sql;
      });
      prepared = attempt;
      void attempt.catch(() => {
        if (prepared === attempt) prepared = undefined;
      });
    }
    return prepared;
  };
  return {
    async issue(request, authorize) {
      const sql = await prepare();
      return sql.begin(async (transaction) => {
        const id = stableSignalId(['signal', request.occurrenceKey]);
        const rows = await transaction.unsafe(
          `INSERT INTO applik8s_signals (
  id, occurrence_key, contract_id, contract_name, contract_version,
  input, actions, target, access, issue_receipt, issued_at, expires_at
) VALUES (
  $1, $2, $3, $4, $5, $6::text::jsonb, $7::text::jsonb,
  $8::text::jsonb, $9::text::jsonb, $10::text::jsonb,
  $11::timestamptz, $12::timestamptz
)
ON CONFLICT (occurrence_key) DO NOTHING
RETURNING *`,
          [
            id,
            request.occurrenceKey,
            request.definition.id,
            request.definition.name,
            request.definition.version,
            postgresSignalJson(transaction, request.input),
            postgresSignalJson(
              transaction,
              Object.keys(request.definition.actions).sort(),
            ),
            postgresSignalJson(transaction, request.target),
            postgresSignalJson(transaction, request.access),
            postgresSignalJson(transaction, request.issueReceipt),
            request.issuedAt,
            request.expiresAt,
          ],
        );
        const inserted = rows[0];
        const row = inserted ?? (
          await transaction.unsafe(
            'SELECT * FROM applik8s_signals WHERE occurrence_key = $1',
            [request.occurrenceKey],
          )
        )[0];
        if (!row) {
          throw new Error(
            `Signal occurrence ${request.occurrenceKey} could not be inserted or replayed.`,
          );
        }
        if (inserted) {
          const initial = postgresSignalInstance(row);
          const authorizedReceipt = await authorize?.(request, {
            signalId: initial.id,
            transaction,
          });
          const authorized = authorizedReceipt
            ? (
                await transaction.unsafe(
                  `UPDATE applik8s_signals
SET issue_receipt = $2::text::jsonb, updated_at = now()
WHERE id = $1
RETURNING *`,
                  [
                    initial.id,
                    postgresSignalJson(transaction, authorizedReceipt),
                  ],
                )
              )[0]
            : row;
          if (!authorized) {
            throw new Error(
              `Signal ${initial.id} authorization receipt could not be persisted.`,
            );
          }
          const instance = postgresSignalInstance(authorized);
          await insertPostgresSignalIssuanceEvent(transaction, instance);
          const fact: ApplicationSignalOutboxFact = {
            id: stableSignalId([instance.id, 'issued']),
            kind: 'issued',
            signalId: instance.id,
            contractId: instance.contract.id,
            payload: signalIssuancePayload(instance),
            recordedAt: instance.issuedAt,
          };
          await insertPostgresSignalOutbox(transaction, fact);
          return { instance, replayed: false };
        }
        return { instance: postgresSignalInstance(row), replayed: true };
      });
    },
    async read(id) {
      const sql = await prepare();
      const row = (
        await sql.unsafe('SELECT * FROM applik8s_signals WHERE id = $1', [id])
      )[0];
      return row ? postgresSignalInstance(row) : undefined;
    },
    async resolve(request, authorize, finalize) {
      const sql = await prepare();
      return sql.begin(async (transaction) => {
        const row = (
          await transaction.unsafe(
            'SELECT * FROM applik8s_signals WHERE id = $1 FOR UPDATE',
            [request.id],
          )
        )[0];
        if (!row) throw new Error(`Signal ${request.id} does not exist.`);
        const current = postgresSignalInstance(row);
        const replay = (
          await transaction.unsafe(
            'SELECT action FROM applik8s_signal_resolutions WHERE signal_id = $1 AND idempotency_key = $2',
            [request.id, request.idempotencyKey],
          )
        )[0];
        if (replay) {
          return {
            instance: current,
            replay: requiredPostgresSignalString(replay.action, 'action')
              === request.action
              ? 'idempotent'
              : 'terminal',
          };
        }
        if (current.terminal) {
          return { instance: current, replay: 'terminal' };
        }
        if (!current.actions.includes(request.action)) {
          throw new Error(
            `Signal ${request.id} does not declare action ${request.action}.`,
          );
        }
        let receipt = request.receipt;
        if (authorize) {
          try {
            receipt = await authorize(
              { ...request, signal: current },
              { transaction },
            );
          } catch (cause) {
            if (cause instanceof ApplicationSignalAuthorizationDeniedError) {
              throw cause;
            }
            throw new Error(
              `Signal ${request.id} ${request.action} authorization failed.`,
              { cause },
            );
          }
        }
        if (!receipt) {
          throw new Error(
            `Signal ${request.id} resolution requires an authorization receipt.`,
          );
        }
        const terminal = {
          status: 'resolved' as const,
          action: request.action,
          input: request.input,
          actor: request.actor,
          receipt,
          decidedAt: request.decidedAt,
        };
        try {
          await finalize?.({
            signal: current,
            terminal: {
              status: 'resolved',
              action: request.action,
              actor: request.actor,
              receipt,
              decidedAt: request.decidedAt,
            },
          }, { transaction });
        } catch (cause) {
          throw new Error(
            `Signal ${request.id} ${request.action} finalization failed.`,
            { cause },
          );
        }
        await transaction.unsafe(
          `INSERT INTO applik8s_signal_resolutions (
  signal_id, idempotency_key, action, receipt
) VALUES ($1, $2, $3, $4::text::jsonb)`,
          [
            request.id,
            request.idempotencyKey,
            request.action,
            postgresSignalJson(transaction, receipt),
          ],
        );
        const updated = (
          await transaction.unsafe(
            `UPDATE applik8s_signals
SET terminal = $2::text::jsonb, updated_at = $3::timestamptz
WHERE id = $1
RETURNING *`,
            [
              request.id,
              postgresSignalJson(transaction, terminal),
              request.decidedAt,
            ],
          )
        )[0];
        if (!updated) throw new Error(`Signal ${request.id} resolution was lost.`);
        const instance = postgresSignalInstance(updated);
        await insertPostgresSignalOutbox(transaction, {
          id: stableSignalId([request.id, 'resolved']),
          kind: 'resolved',
          signalId: request.id,
          contractId: current.contract.id,
          payload: {
            signalId: request.id,
            action: request.action,
            decidedAt: request.decidedAt,
          },
          recordedAt: request.decidedAt,
        });
        return { instance, replay: 'none' };
      });
    },
    async expire(id, expiredAt, finalize) {
      const sql = await prepare();
      return sql.begin(async (transaction) => {
        const row = (
          await transaction.unsafe(
            'SELECT * FROM applik8s_signals WHERE id = $1 FOR UPDATE',
            [id],
          )
        )[0];
        if (!row) throw new Error(`Signal ${id} does not exist.`);
        const current = postgresSignalInstance(row);
        if (current.terminal) return { instance: current, replayed: true };
        await finalize?.({
          signal: current,
          terminal: { status: 'expired', expiredAt },
        }, { transaction });
        const terminal = { status: 'expired' as const, expiredAt };
        const updated = (
          await transaction.unsafe(
            `UPDATE applik8s_signals
SET terminal = $2::text::jsonb, updated_at = $3::timestamptz
WHERE id = $1
RETURNING *`,
            [id, postgresSignalJson(transaction, terminal), expiredAt],
          )
        )[0];
        if (!updated) throw new Error(`Signal ${id} expiry was lost.`);
        const instance = postgresSignalInstance(updated);
        await insertPostgresSignalOutbox(transaction, {
          id: stableSignalId([id, 'expired']),
          kind: 'expired',
          signalId: id,
          contractId: current.contract.id,
          payload: { signalId: id, expiredAt },
          recordedAt: expiredAt,
        });
        return { instance, replayed: false };
      });
    },
    async expireDue(now, limit, finalize) {
      assertSignalBatchSize(limit);
      const sql = await prepare();
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe(
          `SELECT id
FROM applik8s_signals
WHERE terminal IS NULL AND expires_at <= $1::timestamptz
ORDER BY expires_at ASC, id ASC
FOR UPDATE SKIP LOCKED
LIMIT $2`,
          [now, limit],
        );
        const expired: string[] = [];
        for (const row of rows) {
          const id = requiredPostgresSignalString(row.id, 'id');
          const signalRow = (
            await transaction.unsafe(
              'SELECT * FROM applik8s_signals WHERE id = $1 FOR UPDATE',
              [id],
            )
          )[0];
          if (!signalRow) continue;
          const current = postgresSignalInstance(signalRow);
          if (current.terminal) continue;
          const terminal = { status: 'expired' as const, expiredAt: now };
          await finalize?.({
            signal: current,
            terminal,
          }, { transaction });
          const updated = (
            await transaction.unsafe(
              `UPDATE applik8s_signals
SET terminal = $2::text::jsonb, updated_at = $3::timestamptz
WHERE id = $1 AND terminal IS NULL
RETURNING contract_id`,
              [id, postgresSignalJson(transaction, terminal), now],
            )
          )[0];
          if (!updated) continue;
          await insertPostgresSignalOutbox(transaction, {
            id: stableSignalId([id, 'expired']),
            kind: 'expired',
            signalId: id,
            contractId: requiredPostgresSignalString(
              updated.contract_id,
              'contract_id',
            ),
            payload: { signalId: id, expiredAt: now },
            recordedAt: now,
          });
          expired.push(id);
        }
        return expired;
      });
    },
    async pendingOutbox(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Signal outbox limit must be between 1 and 1000.');
      }
      const sql = await prepare();
      const rows = await sql.unsafe(
        `SELECT id, signal_id, contract_id, kind, payload, recorded_at
FROM applik8s_signal_outbox
WHERE published_at IS NULL
ORDER BY recorded_at ASC, id ASC
LIMIT $1`,
        [limit],
      );
      return rows.map(postgresSignalOutboxFact);
    },
    async acknowledgeOutbox(ids) {
      if (ids.length === 0) return;
      const sql = await prepare();
      await sql.unsafe(
        'UPDATE applik8s_signal_outbox SET published_at = now() WHERE id = ANY($1::text[])',
        [ids],
      );
    },
    async close() {
      if (ownedSql) await ownedSql.end({ timeout: 5 });
    },
  };
}

/**
 * Publishes canonical signal facts at least once and advances expiry from the
 * same store. A provider bridge may crash at any point: unpublished rows
 * remain retryable, and duplicate terminal notifications are harmless because
 * workflow resumption always re-reads canonical signal state.
 */
export async function runApplicationSignalOutboxRelay(
  options: ApplicationSignalOutboxRelayOptions,
): Promise<void> {
  const batchSize = options.batchSize ?? 100;
  assertSignalBatchSize(batchSize);
  const idleMs = options.idleMs ?? 250;
  if (!Number.isSafeInteger(idleMs) || idleMs < 1 || idleMs > 60_000) {
    throw new Error('Signal outbox idleMs must be between 1 and 60000.');
  }
  const sleep = options.sleep ?? signalRelaySleep;
  while (!options.signal?.aborted) {
    try {
      const now = (options.now ?? (() => new Date()))().toISOString();
      await options.store.expireDue(
        now,
        batchSize,
        options.finalizeTerminal,
      );
      const facts = await options.store.pendingOutbox(batchSize);
      const acknowledged: string[] = [];
      for (const fact of facts) {
        if (options.signal?.aborted) break;
        await options.publish(fact);
        acknowledged.push(fact.id);
      }
      await options.store.acknowledgeOutbox(acknowledged);
      if (facts.length < batchSize) {
        await sleep(idleMs, options.signal);
      }
    } catch (error) {
      options.onError?.(error);
      await sleep(idleMs, options.signal);
    }
  }
}

export const applicationSignalPostgresMigrationSql = Object.freeze([
  `CREATE TABLE IF NOT EXISTS applik8s_public_stream_events (
  id text PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  contract_name text NOT NULL,
  contract_version text NOT NULL,
  partition_key text NOT NULL,
  envelope jsonb NOT NULL,
  payload jsonb NOT NULL,
  context_digest text,
  recorded_at timestamptz NOT NULL
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS applik8s_public_stream_events_sequence
  ON applik8s_public_stream_events (sequence);`,
  `CREATE INDEX IF NOT EXISTS applik8s_public_stream_events_contract_sequence
  ON applik8s_public_stream_events (contract_name, contract_version, sequence);`,
  `CREATE TABLE IF NOT EXISTS applik8s_signals (
  id text PRIMARY KEY,
  occurrence_key text NOT NULL UNIQUE,
  contract_id text NOT NULL,
  contract_name text NOT NULL,
  contract_version text NOT NULL,
  input jsonb NOT NULL,
  actions jsonb NOT NULL,
  target jsonb NOT NULL,
  access jsonb NOT NULL,
  issue_receipt jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  terminal jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
  `CREATE INDEX IF NOT EXISTS applik8s_signals_pending_expiry_idx
  ON applik8s_signals (expires_at, id) WHERE terminal IS NULL;`,
  `CREATE TABLE IF NOT EXISTS applik8s_signal_resolutions (
  signal_id text NOT NULL REFERENCES applik8s_signals(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, idempotency_key)
);`,
  `CREATE TABLE IF NOT EXISTS applik8s_signal_outbox (
  id text PRIMARY KEY,
  signal_id text NOT NULL REFERENCES applik8s_signals(id) ON DELETE CASCADE,
  contract_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('issued', 'resolved', 'expired')),
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  published_at timestamptz
);`,
]);

async function insertPostgresSignalIssuanceEvent(
  transaction: ApplicationPostgresTransactionSql,
  instance: ApplicationSignalStoredInstance,
): Promise<void> {
  const payload = signalIssuancePayload(instance);
  await transaction.unsafe(
    `INSERT INTO applik8s_public_stream_events (
  id, contract_name, contract_version, partition_key, envelope, payload,
  context_digest, recorded_at
) VALUES (
  $1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb,
  $7, $8::timestamptz
)
ON CONFLICT (id) DO NOTHING`,
    [
      stableSignalId([instance.id, 'issuance-event']),
      instance.contract.name,
      instance.contract.version,
      instance.id,
      postgresSignalJson(transaction, {
        kind: 'applik8s.signal.issued/v1',
        signalId: instance.id,
        contractId: instance.contract.id,
        target: instance.target,
        access: instance.access,
        issueReceipt: instance.issueReceipt,
      }),
      postgresSignalJson(transaction, payload),
      `signal:${instance.id}`,
      instance.issuedAt,
    ],
  );
}

function signalDecision<TDefinition extends ApplicationSignalDefinition>(
  definition: TDefinition,
  instance: ApplicationSignalStoredInstance,
  store: ApplicationSignalStore,
  wait: ApplicationWorkflowSignalRuntimeOptions['wait'],
  signal: AbortSignal | undefined,
): ApplicationSignalDecision<TDefinition> {
  const reference = signalReference(definition, instance);
  const decision = async (): Promise<ApplicationMatchedSignalOutcome<TDefinition>> => {
    // Durable orchestration must replay the same provider calls in the same
    // order. Never skip the workflow-engine wait merely because the
    // authoritative store already contains a terminal decision: doing so
    // shifts the invocation sequence and can make the next durable child call
    // consume the wait event's payload. Provider lookback makes this safe when
    // the signal resolved before the first wait or while the workflow was
    // evicted.
    await wait(reference, signal ? { signal } : undefined);
    throwIfApplicationSignalAborted(signal);
    const current = await store.read(instance.id);
    if (!current) throw new Error(`Signal ${instance.id} no longer exists.`);
    if (!current?.terminal) {
      throw new Error(
        `Signal ${instance.id} resumed without a canonical terminal state.`,
      );
    }
    const value = signalOutcome(definition, reference, current);
    return {
      value,
      async match(matcher) {
        if (value.status === 'expired') return matcher.expired(value);
        const action = value.action as ApplicationSignalActionName<TDefinition>;
        const handler = matcher[action] as (
          outcome: typeof value,
        ) => unknown;
        return await handler(value) as never;
      },
    };
  };
  return Object.assign(decision, reference, {
    issueReceipt: instance.issueReceipt,
  });
}

function throwIfApplicationSignalAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Application workflow signal operation was cancelled.');
}

function signalActionResult<
  TDefinition extends ApplicationSignalDefinition,
  TAction extends ApplicationSignalActionName<TDefinition>,
>(
  definition: TDefinition,
  reference: ApplicationSignalReference<TDefinition>,
  action: TAction,
  instance: ApplicationSignalStoredInstance,
  replay: 'none' | 'idempotent' | 'terminal',
): ApplicationSignalActionResult<TDefinition, TAction> {
  if (
    replay !== 'terminal'
    && instance.terminal?.status === 'resolved'
    && instance.terminal.action === action
  ) {
    return {
      status: 'resolved',
      outcome: signalOutcome(definition, reference, instance),
      receipt: instance.terminal.receipt,
    } as ApplicationSignalActionResult<TDefinition, TAction>;
  }
  const terminal = instance.terminal;
  if (!terminal) throw new Error(`Signal ${instance.id} has no terminal outcome.`);
  return {
    status: 'alreadyResolved',
    outcome: terminal.status === 'expired'
      ? { status: 'expired', decidedAt: terminal.expiredAt }
      : {
          status: 'resolved',
          decidedAt: terminal.decidedAt,
        },
  };
}

function signalOutcome<TDefinition extends ApplicationSignalDefinition>(
  _definition: TDefinition,
  reference: ApplicationSignalReference<TDefinition>,
  instance: ApplicationSignalStoredInstance,
): ApplicationSignalOutcome<TDefinition> {
  const terminal = instance.terminal;
  if (!terminal) throw new Error(`Signal ${instance.id} is not terminal.`);
  if (terminal.status === 'expired') {
    return {
      status: 'expired',
      signal: reference,
      expiredAt: terminal.expiredAt,
    };
  }
  return {
    status: 'resolved',
    action: terminal.action,
    input: terminal.input,
    actor: terminal.actor,
    receipt: terminal.receipt,
    decidedAt: terminal.decidedAt,
    signal: reference,
  } as ApplicationSignalOutcome<TDefinition>;
}

function signalReference<TDefinition extends ApplicationSignalDefinition>(
  definition: TDefinition,
  instance: ApplicationSignalStoredInstance,
): ApplicationSignalReference<TDefinition> {
  return Object.freeze({
    $type: 'applik8s.signal/v1',
    contract: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
    },
    issuance: { id: instance.id },
    expiresAt: instance.expiresAt,
  });
}

function signalIssuancePayload(instance: ApplicationSignalStoredInstance): object {
  return {
    id: instance.id,
    input: instance.input,
    signal: {
      $type: 'applik8s.signal/v1',
      contract: instance.contract,
      issuance: { id: instance.id },
      expiresAt: instance.expiresAt,
    },
    issuedAt: instance.issuedAt,
    expiresAt: instance.expiresAt,
  };
}

async function insertPostgresSignalOutbox(
  transaction: ApplicationPostgresTransactionSql,
  fact: ApplicationSignalOutboxFact,
): Promise<void> {
  await transaction.unsafe(
    `INSERT INTO applik8s_signal_outbox (
  id, signal_id, contract_id, kind, payload, recorded_at
) VALUES ($1, $2, $3, $4, $5::text::jsonb, $6::timestamptz)
ON CONFLICT (id) DO NOTHING`,
    [
      fact.id,
      fact.signalId,
      fact.contractId,
      fact.kind,
      postgresSignalJson(transaction, fact.payload),
      fact.recordedAt,
    ],
  );
}

function postgresSignalInstance(
  row: Readonly<Record<string, unknown>>,
): ApplicationSignalStoredInstance {
  const id = requiredPostgresSignalString(row.id, 'id');
  const terminal = postgresSignalJsonValue(row.terminal, 'terminal');
  if (
    terminal !== null
    && terminal !== undefined
    && (typeof terminal !== 'object' || Array.isArray(terminal))
  ) {
    throw new Error(`Signal ${id} has malformed terminal state.`);
  }
  const instance: ApplicationSignalStoredInstance = {
    id,
    occurrenceKey: requiredPostgresSignalString(
      row.occurrence_key,
      'occurrence_key',
    ),
    contract: {
      id: requiredPostgresSignalString(row.contract_id, 'contract_id'),
      name: requiredPostgresSignalString(row.contract_name, 'contract_name'),
      version: requiredPostgresSignalString(
        row.contract_version,
        'contract_version',
      ),
    },
    input: requiredPostgresSignalObject(row.input, 'input'),
    actions: requiredPostgresSignalStrings(row.actions, 'actions'),
    issuedAt: postgresSignalTimestamp(row.issued_at, 'issued_at'),
    expiresAt: postgresSignalTimestamp(row.expires_at, 'expires_at'),
    target: requiredPostgresSignalObject(row.target, 'target') as Readonly<
      Record<string, JsonValue>
    >,
    access: requiredPostgresSignalObject(
      row.access,
      'access',
    ) as ApplicationSignalStoredInstance['access'],
    issueReceipt: requiredPostgresSignalObject(
      row.issue_receipt,
      'issue_receipt',
    ) as unknown as ApplicationSignalAuthorizationReceiptReference,
  };
  if (terminal) {
    return {
      ...instance,
      terminal: terminal as NonNullable<
        ApplicationSignalStoredInstance['terminal']
      >,
    };
  }
  return instance;
}

function postgresSignalOutboxFact(
  row: Readonly<Record<string, unknown>>,
): ApplicationSignalOutboxFact {
  const kind = requiredPostgresSignalString(row.kind, 'kind');
  if (kind !== 'issued' && kind !== 'resolved' && kind !== 'expired') {
    throw new Error(`Signal outbox has unsupported kind ${kind}.`);
  }
  return {
    id: requiredPostgresSignalString(row.id, 'id'),
    kind,
    signalId: requiredPostgresSignalString(row.signal_id, 'signal_id'),
    contractId: requiredPostgresSignalString(row.contract_id, 'contract_id'),
    payload: requiredPostgresSignalObject(row.payload, 'payload'),
    recordedAt: postgresSignalTimestamp(row.recorded_at, 'recorded_at'),
  };
}

function requiredPostgresSignalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Signal PostgreSQL row has invalid ${field}.`);
  }
  return value;
}

function requiredPostgresSignalObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  const parsed = postgresSignalJsonValue(value, field);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Signal PostgreSQL row has invalid ${field}.`);
  }
  return parsed as Record<string, unknown>;
}

function requiredPostgresSignalStrings(
  value: unknown,
  field: string,
): readonly string[] {
  const parsed = postgresSignalJsonValue(value, field);
  if (
    !Array.isArray(parsed)
    || parsed.some((candidate) => typeof candidate !== 'string')
  ) {
    throw new Error(`Signal PostgreSQL row has invalid ${field}.`);
  }
  return parsed as string[];
}

function postgresSignalJsonValue(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Signal PostgreSQL row has invalid ${field}.`);
  }
}

function postgresSignalTimestamp(value: unknown, field: string): string {
  const date = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Signal PostgreSQL row has invalid ${field}.`);
  }
  return date.toISOString();
}

function postgresSignalJson(
  _transaction: ApplicationPostgresTransactionSql,
  value: unknown,
): string {
  // Signal statements force canonical JSON text through text before jsonb.
  // That prevents drivers which infer the jsonb target type from encoding
  // this already serialized value a second time, while avoiding concrete
  // driver-branded parameter classes across generated bundles.
  return JSON.stringify(value);
}

function assertApplicationSignalAccessMode(
  id: string,
  options: ApplicationSignalEmitOptions<ApplicationSignalDefinition>,
): void {
  const authorize = options.authorize !== undefined;
  const grant = options.grantAccessTo !== undefined;
  if (authorize === grant) {
    throw new Error(
      `Signal ${id} issuance must declare exactly one of authorize or grantAccessTo.`,
    );
  }
}

function applicationSignalDurationMs(value: string): number {
  const match = /^([1-9][0-9]*)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Signal expiresIn ${JSON.stringify(value)} must be a positive bounded duration such as 10m or 24h.`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === 'ms'
      ? 1
      : unit === 's'
        ? 1_000
        : unit === 'm'
          ? 60_000
          : unit === 'h'
            ? 3_600_000
            : 86_400_000;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration > 365 * 86_400_000) {
    throw new Error('Signal expiresIn must not exceed 365 days.');
  }
  return duration;
}

function assertSignalBatchSize(limit: number): void {
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 1_000
  ) {
    throw new Error('Signal batch size must be between 1 and 1000.');
  }
}

function applicationSignalSelectorAllows(
  selector: unknown,
  actor: ApplicationSignalActor,
): boolean {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return false;
  }
  const value = selector as Readonly<Record<string, unknown>>;
  if (typeof value.id === 'string') return value.id === actor.id;
  const identity = value.identity;
  if (
    identity
    && typeof identity === 'object'
    && !Array.isArray(identity)
    && typeof (identity as Readonly<Record<string, unknown>>).id === 'string'
  ) {
    return (identity as Readonly<Record<string, unknown>>).id === actor.id;
  }
  if (typeof value.role === 'string') {
    return actor.roles?.includes(value.role) ?? false;
  }
  // Relationship/provider selectors require an installed authority resolver.
  // Treating an unknown serialized selector as truthy would widen access.
  return false;
}

async function signalRelaySleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    const abort = () => done();
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function stableSignalId(parts: readonly string[]): string {
  return createHash('sha256')
    .update(parts.join('\0'))
    .digest('hex');
}

export function applicationSignalReceipt(): ApplicationSignalAuthorizationReceiptReference {
  return { id: randomUUID() };
}
