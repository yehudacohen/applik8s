import type { ApplicationCommandProgress, ApplicationCommandSubmission } from '@applik8s/client';
import { type ApplicationAuthorizationReceipt, type ApplicationOperationTransport, type ApplicationPrincipal, type ApplicationRequestAdmission, canonicalJsonV1String, canonicalJsonV1Value, type JsonObject, type JsonValue, validateApplicationAuthorizationReceipt } from '@applik8s/core';
import type { ApplicationInternalOperationInvocation } from '@applik8s/operations';
import { nodeKeyedDigestBase64Url } from '@applik8s/runtime/node-integrity';
import { createRollingSignedEnvelopeCodec, type RollingSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import type { ApplicationQueryPrincipal } from './application-queries.js';
import type { ApplicationGatewayAdmission } from './application-reactive.js';
import { applicationRequestContextValues } from './command-principal.js';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import type { ApplicationEventLogPublisher } from './event-log-runtime.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import { applicationAdmittedContextDigest, applicationRelationalChangeScopes } from './relational-runtime.js';

export interface ApplicationGatewayCommandRuntimeContract {
  readonly id: string;
  readonly application?: string;
  readonly bindingId: string;
  readonly model: string;
  /** Canonical operation-catalog identity emitted by the v0.7 compiler. */
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly inputSchema: JsonObject;
  readonly databaseUrl: string;
  readonly sql?: ApplicationPostgresSql;
  readonly key: (input: object, context: {
    readonly principal: ApplicationQueryPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
  }, messageId?: string) => unknown;
  readonly idempotencyKey?: (input: object) => string;
}

export interface ApplicationCommandGatewayOptions<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly commands: readonly ApplicationGatewayCommandRuntimeContract[];
  readonly authenticate: (request: Request) => ApplicationGatewayAdmission | Promise<ApplicationGatewayAdmission>;
  /** Narrows an authenticated canonical principal to this audience and trusted context. */
  readonly admitPrincipal?: (request: {
    readonly admission: ApplicationGatewayAdmission;
    readonly command: ApplicationGatewayCommandRuntimeContract;
    readonly trustedContextDigest: string;
  }) => ApplicationPrincipal | Promise<ApplicationPrincipal>;
  /** @deprecated Compatibility callback. Prefer authorizeOperation so the durable envelope receives a canonical receipt. */
  readonly authorize?: (request: {
    readonly principal: TPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly command: string;
    readonly input: unknown;
  }) => boolean | Promise<boolean>;
  readonly authorizeOperation?: (request: {
    readonly principal: ApplicationPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly command: ApplicationGatewayCommandRuntimeContract;
    readonly input: object;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly targetKey: string;
    readonly targetDigest: string;
    readonly trustedContextDigest: string;
    readonly inputDigest: string;
  }) => Promise<
    | { readonly allowed: true; readonly receipt: ApplicationAuthorizationReceipt }
    | { readonly allowed: false; readonly code: string; readonly message: string }
  >;
  readonly revalidateOperation?: (request: {
    readonly receipt: ApplicationAuthorizationReceipt;
    readonly boundary: 'result-read';
    readonly principal: ApplicationPrincipal;
    readonly command: ApplicationGatewayCommandRuntimeContract;
    readonly trustedContextDigest: string;
  }) => Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly code: string; readonly message: string }
  >;
  /** Compensates a catalog pin when the admitted envelope was never published. */
  readonly releaseOperation?: (request: {
    readonly receipt: ApplicationAuthorizationReceipt;
    readonly commandId: string;
  }) => Promise<void>;
  readonly cursorSecret: string;
  /**
   * Application-wide key used only to derive admitted-context and relational
   * change-scope digests. It must be shared by every reader and writer for the
   * same database authority; cursorSecret remains gateway-local.
   */
  readonly contextSecret?: string;
  readonly eventLogPublisher: Pick<ApplicationEventLogPublisher, 'publish' | 'drain'> & Partial<Pick<ApplicationEventLogPublisher, 'verify'>>;
  readonly cursorTtlSeconds?: number;
  readonly maxRequestBytes?: number;
  readonly now?: () => Date;
}

export interface ApplicationCommandGateway {
  handle(request: Request): Promise<Response | undefined>;
  /**
   * Executes an already admitted and signed internal transport invocation.
   * The command is still published to its existing durable processor; this
   * method waits only until the signed invocation deadline for its typed result.
   */
  invoke(input: {
    readonly operationId: string;
    readonly input: JsonValue;
    readonly invocation: ApplicationInternalOperationInvocation;
    readonly signal?: AbortSignal;
  }): Promise<JsonValue>;
  /** Verifies the EventLog and every durable-result database before readiness is advertised. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

interface ProgressCursor {
  readonly version: 2 | 3;
  readonly command: string;
  readonly commandId: string;
  readonly correlationId: string;
  /** Opaque lookup key; it is already a one-way digest of command and admitted-context scope. */
  readonly durableScope: string;
  readonly principalBinding: string;
  readonly authorizationBinding: string;
  readonly contextBinding: string;
  readonly receiptBinding?: string;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly catalogRevision?: string;
  readonly authorityRevision?: string;
  readonly expiresAt: number;
}

/** Authenticated HTTP command admission plus durable PostgreSQL result observation. */
// typecast-boundary: authenticated JSON is validated before generic command callbacks and PostgreSQL rows cross typed protocol boundaries.
export function createApplicationCommandGateway<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: ApplicationCommandGatewayOptions<TPrincipal>): ApplicationCommandGateway {
  if (options.cursorSecret.length < 32) throw new Error('Application command gateway cursorSecret must contain at least 32 characters.');
  const contextSecret = options.contextSecret ?? options.cursorSecret;
  if (contextSecret.length < 32) throw new Error('Application command gateway contextSecret must contain at least 32 characters.');
  if (!options.authorize && !options.authorizeOperation) {
    throw new Error('Application command gateway requires authorizeOperation or the deprecated authorize callback.');
  }
  if (options.authorizeOperation && !options.revalidateOperation) {
    throw new Error('Application command gateway canonical operation authority requires revalidateOperation for durable result reads.');
  }
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  if (commands.size !== options.commands.length) throw new Error('Application command gateway command registrations must be unique.');
  const publisher = options.eventLogPublisher;
  const databases = new Map<string, Promise<ApplicationPostgresSql>>();
  const now = options.now ?? (() => new Date());
  const cursorTtlSeconds = options.cursorTtlSeconds ?? 15 * 60;
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  if (cursorTtlSeconds < 30 || cursorTtlSeconds > 24 * 60 * 60) {
    throw new Error('Application command gateway cursor lifetime must be between 30 seconds and 24 hours.');
  }
  const cursorKey = signedEnvelopeUtf8Key(options.cursorSecret);
  const cursorCodec = createRollingSignedEnvelopeCodec<ProgressCursor, ProgressCursor>({
    purpose: 'applik8s.command-cursor/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'command-cursor-current', key: cursorKey },
    }),
    now: () => now().getTime(),
    maximumLifetimeMs: cursorTtlSeconds * 1_000,
    maximumEncodedBytes: 64 * 1_024,
    validatePayload: validateProgressCursor,
    writer: 'legacy',
    legacy: {
      key: cursorKey,
      validatePayload: validateProgressCursor,
      toCurrent: (payload) => payload,
      fromCurrent: (payload) => canonicalJsonV1Value(payload),
    },
  });
  return {
    async handle(request) {
      const route = commandRoute(request);
      if (!route) return undefined;
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const body = await boundedJson(request, maxRequestBytes);
      if (!body.ok) return body.response;
      const command = commands.get(route.command);
      if (!command) return json({ error: 'not_found' }, 404);
      try {
        const admission = await admitted(options, request);
        if (route.operation === 'submit') {
          const input = validateCommandInput(command, body.value.input);
          if (options.authorize && !await options.authorize({
            principal: admission.principal as TPrincipal,
            authorizationVersion: admission.principal.authorityRevision,
            trustedContext: admission.trustedContext,
            command: command.id,
            input,
          })) return json({ error: 'forbidden' }, 403);
          const commandId = requiredString(body.value.commandId, 'commandId');
          const idempotencyKey = requiredString(body.value.idempotencyKey, 'idempotencyKey');
          // typecast: command key callbacks are registered only from the public scalar/composite command-key contract.
          const targetKey = canonicalApplicationCommandKey(command.key(input, {
            principal: admission.principal,
            authorizationVersion: admission.principal.authorityRevision,
            trustedContext: admission.trustedContext,
          }, commandId) as string | number | boolean | Readonly<Record<string, string | number | boolean>>);
          const correlationId = commandId;
          const contextDigest = applicationAdmittedContextDigest({ values: admission.trustedContext, digestSecret: contextSecret });
          const principal = await options.admitPrincipal?.({
            admission,
            command,
            trustedContextDigest: contextDigest,
          }) ?? admission.principal;
          const durableContext = applicationRequestContextValues(principal, principal.authorityRevision, admission.trustedContext);
          const routedIdempotencyKey = command.idempotencyKey?.(input) ?? idempotencyKey;
          const durableScope = applicationCommandScope(command.bindingId, command.model, targetKey, routedIdempotencyKey, contextDigest);
          const inputDigest = applicationOperationInputDigest(input);
          let authorizationReceipt: ApplicationAuthorizationReceipt | undefined;
          if (options.authorizeOperation) {
            const authorization = await options.authorizeOperation({
              principal,
              // Identity-provider admission revision and canonical operation
              // authority revision are separate trust domains. Domain
              // authorization callbacks use the former to validate
              // identity-scoped capabilities (for example an object upload
              // completion receipt); the returned authorization receipt
              // remains pinned to the latter through `principal`.
              authorizationVersion: admission.principal.authorityRevision,
              trustedContext: admission.trustedContext,
              command,
              input,
              commandId,
              idempotencyKey: routedIdempotencyKey,
              targetKey,
              targetDigest: durableScope,
              trustedContextDigest: contextDigest,
              inputDigest,
            });
            if (!authorization.allowed) return json({ error: 'forbidden', code: authorization.code }, 403);
            assertCommandAuthorizationReceipt(
              authorization.receipt,
              command,
              principal,
              contextDigest,
              inputDigest,
            );
            authorizationReceipt = authorization.receipt;
            const sql = command.sql ?? await database(databases, command.databaseUrl);
            await persistCommandAdmission(sql, {
              scope: durableScope,
              command: command.id,
              bindingId: command.bindingId,
              commandId,
              receipt: authorizationReceipt,
            });
          }
          const envelope = {
            id: commandId,
            contract: commandContract(command.id),
            payload: input,
            recordedAt: now().toISOString(),
            correlationId,
            partitionKey: targetKey,
            routing: { binding: command.bindingId, targetKey, idempotencyKey: routedIdempotencyKey },
            ...(typeof body.value.expectedRevision === 'string' ? { expectedRevision: body.value.expectedRevision } : {}),
            trustedContext: {
              values: durableContext,
              digest: contextDigest,
              changeScopes: applicationRelationalChangeScopes({ values: durableContext, digestSecret: contextSecret }),
            },
            ...(authorizationReceipt ? { authorizationReceipt } : {}),
          };
          try {
            await publisher.publish(envelope, 'commands');
          } catch (error) {
            if (authorizationReceipt) {
              if (!options.releaseOperation) {
                throw new Error(
                  'Application command gateway cannot release a protected catalog reference after publication failed.',
                  { cause: error },
                );
              }
              await options.releaseOperation({
                receipt: authorizationReceipt,
                commandId,
              });
            }
            throw error;
          }
          const cursorPayload: ProgressCursor = {
            version: authorizationReceipt ? 3 : 2,
            command: command.id,
            commandId,
            correlationId,
            durableScope,
            principalBinding: cursorBinding(options.cursorSecret, 'principal', principal.id),
            authorizationBinding: cursorBinding(options.cursorSecret, 'authorization', principal.authorityRevision),
            contextBinding: cursorBinding(options.cursorSecret, 'context', contextDigest),
            ...(authorizationReceipt ? commandReceiptCursorFields(options.cursorSecret, authorizationReceipt) : {}),
            expiresAt: now().getTime() + cursorTtlSeconds * 1000,
          };
          const cursor = await encodeCursor(cursorCodec, cursorPayload);
          const submission: ApplicationCommandSubmission = { protocol: 'applik8s.command/v1alpha1', command: command.id, commandId, correlationId, transport: 'acknowledged', durableResult: 'pending', progressCursor: cursor, workflow: 'notStarted', reconciliation: 'notObserved' };
          return json(submission, 202);
        }
        const encoded = requiredString(body.value.cursor, 'cursor');
        const cursor = await decodeCursor(cursorCodec, encoded, now().getTime());
        const contextDigest = applicationAdmittedContextDigest({ values: admission.trustedContext, digestSecret: contextSecret });
        const principal = await options.admitPrincipal?.({
          admission,
          command,
          trustedContextDigest: contextDigest,
        }) ?? admission.principal;
        if (cursor.command !== command.id
          || cursor.principalBinding !== cursorBinding(options.cursorSecret, 'principal', principal.id)
          // Receipt-backed commands are revalidated against current authority
          // below. Their issuing authority revision is intentionally historic:
          // even a successful authorization audit may advance the current
          // revision between submission and the first result read. Legacy
          // receipt-less cursors retain revision-bound invalidation.
          || (cursor.version === 2
            && cursor.authorizationBinding !== cursorBinding(options.cursorSecret, 'authorization', principal.authorityRevision))) return json({ error: 'cursor_invalid' }, 400);
        const sql = command.sql ?? await database(databases, command.databaseUrl);
        if (cursor.version === 3) {
          if (!options.revalidateOperation) {
            throw new Error('Application command gateway cannot revalidate a protected result without canonical operation authority.');
          }
          const receipt = await readCommandAdmission(sql, cursor.durableScope);
          // Receipt-backed progress is an observation of an already admitted
          // operation. Its original trusted context may have been consumed by
          // the operation itself (for example, deleting a workspace removes
          // the caller's membership). Bind the signed cursor and result-read
          // revalidation to the persisted issuance receipt while still
          // authenticating the current principal above.
          const issuanceContextDigest = receipt.trustedContextDigest;
          if (cursor.contextBinding !== cursorBinding(options.cursorSecret, 'context', issuanceContextDigest)) return json({ error: 'cursor_invalid' }, 400);
          assertCommandAuthorizationReceipt(
            receipt,
            command,
            principal,
            issuanceContextDigest,
            receipt.inputDigest,
            'http',
            { allowHistoricalAuthorityRevision: true },
          );
          assertCommandReceiptCursor(options.cursorSecret, cursor, receipt);
          const authorization = await options.revalidateOperation({
            receipt,
            boundary: 'result-read',
            principal,
            command,
            trustedContextDigest: issuanceContextDigest,
          });
          if (!authorization.allowed) return json({ error: 'forbidden', code: authorization.code }, 403);
        } else if (cursor.contextBinding !== cursorBinding(options.cursorSecret, 'context', contextDigest)) {
          return json({ error: 'cursor_invalid' }, 400);
        }
        const rows = await sql.unsafe('SELECT output, error, model_revision FROM applik8s_command_results WHERE scope = $1 LIMIT 1', [cursor.durableScope]);
        const row = rows[0] as { readonly output?: unknown; readonly error?: unknown; readonly model_revision?: unknown } | undefined;
        if (!row) return json(progress(cursor, encoded, 'pending'), 200);
        if (row.error) {
          const error = durableRejection(row.error);
          const failure = durableTerminalFailure(error);
          if (failure) return json({ ...progress(cursor, encoded, 'failed'), failure, ...(typeof row.model_revision === 'string' ? { modelRevision: row.model_revision } : {}) }, 200);
          return json({ ...progress(cursor, encoded, 'rejected'), rejection: error, ...(typeof row.model_revision === 'string' ? { modelRevision: row.model_revision } : {}) }, 200);
        }
        const modelRevision =
          typeof row.model_revision === 'string'
            ? row.model_revision
            : undefined;
        return json({
          ...progress(cursor, encoded, 'succeeded'),
          output: row.output,
          ...(modelRevision
            ? {
                modelRevision,
                // The PostgreSQL command kernel records the result and the
                // authoritative model revision in the same transaction. No
                // later observation is required to prove this model commit.
                reconciliation: 'ready' as const,
              }
            : {}),
        }, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({
          event: 'applik8s-command-gateway-error',
          command: route.command,
          operation: route.operation,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message,
          },
        }));
        return /required|validation|identity|cursor/i.test(message) ? json({ error: 'invalid_request' }, 400) : json({ error: 'internal_error' }, 500);
      }
    },
    async invoke(request) {
      const command = [...commands.values()].find(
        (candidate) => candidate.operationId === request.operationId,
      );
      if (!command) {
        throw new Error(
          `Application operation ${request.operationId} is unavailable at this command gateway.`,
        );
      }
      const input = validateCommandInput(command, request.input);
      const admission: ApplicationRequestAdmission = request.invocation.admission;
      const principal = admission.principal;
      const trustedContext = admission.trustedContext;
      const trustedContextDigest = principal.trustedContextDigest;
      const receipt = request.invocation.authorizationReceipt;
      const inputDigest = applicationOperationInputDigest(input);
      assertCommandAuthorizationReceipt(
        receipt,
        command,
        principal,
        trustedContextDigest,
        inputDigest,
        request.invocation.source.transport,
      );
      const idempotencyKey = requiredString(
        request.invocation.idempotencyKey,
        'idempotencyKey',
      );
      const targetKey = canonicalApplicationCommandKey(
        command.key(input, {
          principal,
          authorizationVersion: principal.authorityRevision,
          trustedContext,
        }, request.invocation.id) as
          | string
          | number
          | boolean
          | Readonly<Record<string, string | number | boolean>>,
      );
      const routedIdempotencyKey =
        command.idempotencyKey?.(input) ?? idempotencyKey;
      const durableScope = applicationCommandScope(
        command.bindingId,
        command.model,
        targetKey,
        routedIdempotencyKey,
        trustedContextDigest,
      );
      const commandId = `internal-${durableScope.slice('sha256:'.length)}`;
      const sql =
        command.sql
        ?? await database(databases, command.databaseUrl);
      await persistCommandAdmission(sql, {
        scope: durableScope,
        command: command.id,
        bindingId: command.bindingId,
        commandId,
        receipt,
      });
      const durableContext = applicationRequestContextValues(
        principal,
        principal.authorityRevision,
        trustedContext,
      );
      await publisher.publish({
        id: commandId,
        contract: commandContract(command.id),
        payload: input,
        recordedAt: now().toISOString(),
        correlationId: commandId,
        partitionKey: targetKey,
        routing: {
          binding: command.bindingId,
          targetKey,
          idempotencyKey: routedIdempotencyKey,
        },
        trustedContext: {
          values: durableContext,
          digest: trustedContextDigest,
          changeScopes: applicationRelationalChangeScopes({
            values: durableContext,
            digestSecret: contextSecret,
          }),
        },
        authorizationReceipt: receipt,
      }, 'commands');
      const expiresAt = Date.parse(request.invocation.expiresAt);
      while (!request.signal?.aborted && now().getTime() <= expiresAt) {
        const rows = await sql.unsafe(
          'SELECT output, error FROM applik8s_command_results WHERE scope = $1 LIMIT 1',
          [durableScope],
        );
        const row = rows[0] as {
          readonly output?: unknown;
          readonly error?: unknown;
        } | undefined;
        if (row) {
          if (row.error) {
            const rejection = durableRejection(row.error);
            const failure = durableTerminalFailure(rejection);
            if (failure) {
              throw new Error(
                `Application command ${command.id} failed with ${failure.code}.`,
              );
            }
            throw new Error(
              `Application command ${command.id} was rejected with ${rejection.name}.`,
            );
          }
          return jsonValue(row.output);
        }
        await abortableSleep(100, request.signal);
      }
      if (request.signal?.aborted) {
        throw new Error(`Application command ${command.id} was cancelled.`);
      }
      throw new Error(
        `Application command ${command.id} did not complete before the internal invocation deadline.`,
      );
    },
    async ready() {
      await publisher.verify?.();
      await Promise.all(options.commands.map(async (command) => {
        const sql = command.sql ?? await database(databases, command.databaseUrl);
        await sql.unsafe('SELECT 1 AS applik8s_ready');
      }));
    },
    async close() { await Promise.all([publisher.drain(), ...[...databases.values()].map(async (sql) => (await sql).end({ timeout: 5 }))]); },
  };
}

function commandRoute(request: Request): { readonly command: string; readonly operation: 'submit' | 'progress' } | undefined {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'commands' || (parts[2] !== 'submit' && parts[2] !== 'progress')) return undefined;
  return { command: decodeURIComponent(parts[1] ?? ''), operation: parts[2] };
}

async function admitted<TPrincipal extends ApplicationQueryPrincipal>(options: ApplicationCommandGatewayOptions<TPrincipal>, request: Request): Promise<ApplicationGatewayAdmission> {
  const admission = await options.authenticate(request);
  if (!admission.principal.id || !admission.principal.authorityRevision || !admission.trustedContext || typeof admission.trustedContext !== 'object') throw new Error('Application command gateway identity provider returned an incomplete admission.');
  return admission;
}

function validateCommandInput(command: ApplicationGatewayCommandRuntimeContract, value: unknown): object {
  // typecast: normalizeSchema is the runtime authority for the command input boundary.
  const result = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.id}.input` }, schema: command.inputSchema }, `${command.id}.input`).validate(value as never);
  if (!result.ok) {
    throw new Error(
      `Application command ${command.id} input validation failed: ${result.error.message}`,
    );
  }
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error(
      `Application command ${command.id} input validation failed: the validated input was not an object.`,
    );
  }
  return result.value;
}

function commandContract(id: string): { readonly name: string; readonly version: string } { const match = /^(.*)\.(v[1-9][0-9]*)$/.exec(id); if (!match?.[1] || !match[2]) throw new Error(`Application command ${id} is not versioned.`); return { name: match[1], version: match[2] }; }
function database(databases: Map<string, Promise<ApplicationPostgresSql>>, url: string): Promise<ApplicationPostgresSql> {
  const existing = databases.get(url);
  if (existing) return existing;
  const sql = createApplicationPostgresSql(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
  databases.set(url, sql);
  return sql;
}
function requiredString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`Application command ${field} is required.`); return value; }
function progress(cursor: ProgressCursor, encoded: string, durableResult: 'pending' | 'succeeded' | 'rejected' | 'failed'): ApplicationCommandProgress { return { protocol: 'applik8s.command/v1alpha1', command: cursor.command, commandId: cursor.commandId, correlationId: cursor.correlationId, transport: 'acknowledged', durableResult, progressCursor: encoded, workflow: 'notStarted', reconciliation: durableResult === 'succeeded' ? 'progressing' : durableResult === 'failed' ? 'failed' : 'notObserved' }; }
function durableRejection(value: unknown): { readonly name: string; readonly payload: unknown } { if (!value || typeof value !== 'object') return { name: 'unknown', payload: null }; const name = Reflect.get(value, 'name'); return { name: typeof name === 'string' ? name : 'unknown', payload: Reflect.get(value, 'payload') ?? null }; }
function durableTerminalFailure(value: { readonly name: string; readonly payload: unknown }): { readonly code: 'processing_failed' | 'authorization_denied'; readonly attempts?: number } | undefined { if (value.name !== 'internalFailure' || !value.payload || typeof value.payload !== 'object') return undefined; const code = Reflect.get(value.payload, 'code'); if (code !== 'processing_failed' && code !== 'authorization_denied') return undefined; const attempts = Reflect.get(value.payload, 'attempts'); return { code, ...(Number.isSafeInteger(attempts) && Number(attempts) > 0 ? { attempts: Number(attempts) } : {}) }; }

async function persistCommandAdmission(
  sql: ApplicationPostgresSql,
  admission: {
    readonly scope: string;
    readonly command: string;
    readonly bindingId: string;
    readonly commandId: string;
    readonly receipt: ApplicationAuthorizationReceipt;
  },
): Promise<void> {
  const persisted = await sql.begin(async (transaction) => {
    const receipt = transaction.json(admission.receipt);
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
      admission.scope,
      admission.command,
      admission.bindingId,
      admission.commandId,
      receipt,
    ],
    );
    if (rows.length > 0) return true;
    const existingRows = await transaction.unsafe(
      `SELECT command, binding_id, command_id, authorization_receipt
FROM applik8s_command_admissions
WHERE scope = $1
FOR UPDATE`,
      [admission.scope],
    );
    const existing = existingRows[0];
    if (!existing
      || existing.command !== admission.command
      || existing.binding_id !== admission.bindingId
      || existing.command_id !== admission.commandId
      || !sameCommandAdmissionReceipt(existing.authorization_receipt, admission.receipt)) {
      return false;
    }
    await transaction.unsafe(
      'UPDATE applik8s_command_admissions SET authorization_receipt = $2::jsonb WHERE scope = $1',
      [admission.scope, receipt],
    );
    return true;
  });
  if (!persisted) {
    throw new Error(`Application command admission ${admission.scope} conflicts with an existing durable authorization receipt.`);
  }
}

async function readCommandAdmission(
  sql: ApplicationPostgresSql,
  scope: string,
): Promise<ApplicationAuthorizationReceipt> {
  const rows = await sql.unsafe(
    'SELECT authorization_receipt FROM applik8s_command_admissions WHERE scope = $1 LIMIT 1',
    [scope],
  );
  const stored = rows[0] && typeof rows[0] === 'object'
    ? Reflect.get(rows[0], 'authorization_receipt')
    : undefined;
  // v0.7 development builds briefly encoded JSONB through JSON.stringify
  // before handing it to postgres-js, producing a JSON string scalar. Read it
  // compatibly so in-flight receipts survive the correction; all new writes
  // use the provider's native JSON parameter.
  const value = typeof stored === 'string'
    ? parseCommandAdmissionReceipt(stored)
    : stored;
  if (!value || typeof value !== 'object') {
    throw new Error(`Application command admission ${scope} has no durable authorization receipt.`);
  }
  // typecast: the complete receipt is validated before it crosses the durable boundary.
  return value as ApplicationAuthorizationReceipt;
}

function parseCommandAdmissionReceipt(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function sameCommandAdmissionReceipt(left: unknown, right: unknown): boolean {
  const normalizedLeft = typeof left === 'string'
    ? parseCommandAdmissionReceipt(left)
    : left;
  return stableCommandAdmissionJson(normalizedLeft)
    === stableCommandAdmissionJson(right);
}

function stableCommandAdmissionJson(value: unknown): string {
  return canonicalJsonV1String(value);
}

function assertCommandAuthorizationReceipt(
  receipt: ApplicationAuthorizationReceipt,
  command: ApplicationGatewayCommandRuntimeContract,
  principal: ApplicationPrincipal,
  trustedContextDigest: string,
  inputDigest: string,
  transport: ApplicationOperationTransport = 'http',
  options: { readonly allowHistoricalAuthorityRevision?: boolean } = {},
): void {
  const diagnostics = validateApplicationAuthorizationReceipt(receipt);
  const expectedVersion = command.operationVersion ?? commandContract(command.id).version;
  if (diagnostics.length > 0
    || receipt.principal.id !== principal.id
    || (command.application !== undefined && receipt.application !== command.application)
    || receipt.catalogRevision !== principal.catalogRevision
    || (!options.allowHistoricalAuthorityRevision
      && receipt.authorityRevision !== principal.authorityRevision)
    || receipt.trustedContextDigest !== trustedContextDigest
    || receipt.inputDigest !== inputDigest
    || receipt.operationVersion !== expectedVersion
    || (command.operationId !== undefined && receipt.operationId !== command.operationId)
    || receipt.transport !== transport) {
    throw new Error(
      `Application command ${command.id} authority returned an invalid receipt: ${
        diagnostics.map((diagnostic) => diagnostic.message).join(' ') || 'operation, principal, context, input, or transport binding mismatch.'
      }`,
    );
  }
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new Error('Application command result is not JSON serializable.');
}

function abortableSleep(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
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

function commandReceiptCursorFields(
  secret: string,
  receipt: ApplicationAuthorizationReceipt,
): Pick<ProgressCursor, 'receiptBinding' | 'operationId' | 'operationVersion' | 'catalogRevision' | 'authorityRevision'> {
  return {
    receiptBinding: cursorBinding(secret, 'receipt', receipt.id),
    operationId: receipt.operationId,
    operationVersion: receipt.operationVersion,
    catalogRevision: receipt.catalogRevision,
    authorityRevision: receipt.authorityRevision,
  };
}

function assertCommandReceiptCursor(
  secret: string,
  cursor: ProgressCursor,
  receipt: ApplicationAuthorizationReceipt,
): void {
  const expected = commandReceiptCursorFields(secret, receipt);
  if (cursor.version !== 3
    || cursor.receiptBinding !== expected.receiptBinding
    || cursor.operationId !== expected.operationId
    || cursor.operationVersion !== expected.operationVersion
    || cursor.catalogRevision !== expected.catalogRevision
    || cursor.authorityRevision !== expected.authorityRevision) {
    throw new Error('Application command cursor authorization changed.');
  }
}

function encodeCursor(codec: RollingSignedEnvelopeCodec<ProgressCursor>, payload: ProgressCursor): Promise<string> {
  return codec.sign(payload, { expiresAt: payload.expiresAt });
}

function cursorBinding(secret: string, domain: 'principal' | 'authorization' | 'context' | 'receipt', value: string): string {
  return nodeKeyedDigestBase64Url({
    key: secret,
    purpose: `applik8s.command-cursor.${domain}`,
    value,
  });
}

async function decodeCursor(codec: RollingSignedEnvelopeCodec<ProgressCursor>, value: string, now: number): Promise<ProgressCursor> {
  let cursor: ProgressCursor;
  try {
    cursor = await codec.verify(value);
  } catch {
    throw new Error('Application command cursor is invalid.');
  }
  if (cursor.expiresAt < now) throw new Error('Application command cursor is invalid or expired.');
  return cursor;
}

function validateProgressCursor(value: JsonValue): ProgressCursor {
  if (!isJsonObject(value)
    || (value.version !== 2 && value.version !== 3)
    || typeof value.command !== 'string'
    || typeof value.commandId !== 'string'
    || typeof value.correlationId !== 'string'
    || typeof value.durableScope !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(value.durableScope)
    || !opaqueCursorField(value.principalBinding)
    || !opaqueCursorField(value.authorizationBinding)
    || !opaqueCursorField(value.contextBinding)
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) < 0
    || (value.version === 3 && (
      !opaqueCursorField(value.receiptBinding)
      || typeof value.operationId !== 'string'
      || typeof value.operationVersion !== 'string'
      || typeof value.catalogRevision !== 'string'
      || typeof value.authorityRevision !== 'string'
    ))) {
    throw new TypeError('Application command cursor contract is invalid.');
  }
  return value as unknown as ProgressCursor;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function opaqueCursorField(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }

// typecast-boundary: parsed JSON is proven to be a non-array object before the record-shaped body is returned.
async function boundedJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly response: Response }> { const contentLength = Number(request.headers.get('content-length') ?? 0); if (contentLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; const text = await request.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; try { const value = JSON.parse(text) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, response: json({ error: 'invalid_json' }, 400) }; } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; } }
function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }); }
