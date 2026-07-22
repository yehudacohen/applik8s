import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApplicationCommandProgress, ApplicationCommandSubmission } from '@applik8s/client';
import type { JsonObject, JsonValue } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import postgres, { type Sql } from 'postgres';
import type { ApplicationGatewayAdmission } from './application-reactive.js';
import type { ApplicationQueryPrincipal } from './application-queries.js';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import { applicationRequestContextValues } from './command-principal.js';
import { createJetStreamEventLog, type ApplicationEventLogPublisher, type JetStreamEventLogOptions } from './event-log-jetstream-runtime.js';
import { applicationAdmittedContextDigest, applicationRelationalChangeScopes } from './relational-runtime.js';

export interface ApplicationGatewayCommandRuntimeContract {
  readonly id: string;
  readonly bindingId: string;
  readonly model: string;
  readonly inputSchema: JsonObject;
  readonly databaseUrl: string;
  readonly sql?: Sql;
  readonly key: (input: object, context: {
    readonly principal: ApplicationQueryPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
  }) => unknown;
  readonly idempotencyKey?: (input: object) => string;
}

export interface ApplicationCommandGatewayOptions<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly commands: readonly ApplicationGatewayCommandRuntimeContract[];
  readonly authenticate: (request: Request) => ApplicationGatewayAdmission | Promise<ApplicationGatewayAdmission>;
  readonly authorize: (request: {
    readonly principal: TPrincipal;
    readonly authorizationVersion: string;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly command: string;
    readonly input: unknown;
  }) => boolean | Promise<boolean>;
  readonly cursorSecret: string;
  readonly eventLog?: JetStreamEventLogOptions;
  readonly eventLogPublisher?: Pick<ApplicationEventLogPublisher, 'publish' | 'drain'> & Partial<Pick<ApplicationEventLogPublisher, 'verify'>>;
  readonly cursorTtlSeconds?: number;
  readonly maxRequestBytes?: number;
  readonly now?: () => Date;
}

export interface ApplicationCommandGateway {
  handle(request: Request): Promise<Response | undefined>;
  /** Verifies the EventLog and every durable-result database before readiness is advertised. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

interface ProgressCursor {
  readonly version: 2;
  readonly command: string;
  readonly commandId: string;
  readonly correlationId: string;
  /** Opaque lookup key; it is already a one-way digest of command and admitted-context scope. */
  readonly durableScope: string;
  readonly principalBinding: string;
  readonly authorizationBinding: string;
  readonly contextBinding: string;
  readonly expiresAt: number;
}

/** Authenticated HTTP command admission plus durable PostgreSQL result observation. */
// typecast-boundary: authenticated JSON is validated before generic command callbacks and PostgreSQL rows cross typed protocol boundaries.
export function createApplicationCommandGateway<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: ApplicationCommandGatewayOptions<TPrincipal>): ApplicationCommandGateway {
  if (options.cursorSecret.length < 32) throw new Error('Application command gateway cursorSecret must contain at least 32 characters.');
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  if (commands.size !== options.commands.length) throw new Error('Application command gateway command registrations must be unique.');
  if (!options.eventLog && !options.eventLogPublisher) throw new Error('Application command gateway requires an EventLog provider.');
  const publisher = options.eventLogPublisher ?? createJetStreamEventLog(requiredEventLog(options.eventLog));
  const databases = new Map<string, Sql>();
  const now = options.now ?? (() => new Date());
  const cursorTtlSeconds = options.cursorTtlSeconds ?? 15 * 60;
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
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
          if (!await options.authorize({
            principal: admission.principal as TPrincipal,
            authorizationVersion: admission.authorizationVersion,
            trustedContext: admission.trustedContext,
            command: command.id,
            input,
          })) return json({ error: 'forbidden' }, 403);
          const commandId = requiredString(body.value.commandId, 'commandId');
          const idempotencyKey = requiredString(body.value.idempotencyKey, 'idempotencyKey');
          // typecast: command key callbacks are registered only from the public scalar/composite command-key contract.
          const targetKey = canonicalApplicationCommandKey(command.key(input, {
            principal: admission.principal,
            authorizationVersion: admission.authorizationVersion,
            trustedContext: admission.trustedContext,
          }) as string | number | boolean | Readonly<Record<string, string | number | boolean>>);
          const correlationId = commandId;
          const durableContext = applicationRequestContextValues(admission.principal, admission.authorizationVersion, admission.trustedContext);
          const contextDigest = applicationAdmittedContextDigest({ values: durableContext, digestSecret: options.cursorSecret });
          const envelope = { id: commandId, contract: commandContract(command.id), payload: input, recordedAt: now().toISOString(), correlationId, partitionKey: targetKey, routing: { binding: command.bindingId, targetKey, idempotencyKey: command.idempotencyKey?.(input) ?? idempotencyKey }, ...(typeof body.value.expectedRevision === 'string' ? { expectedRevision: body.value.expectedRevision } : {}), trustedContext: { values: durableContext, digest: contextDigest, changeScopes: applicationRelationalChangeScopes({ values: durableContext, digestSecret: options.cursorSecret }) } };
          await publisher.publish(envelope, 'commands');
          const durableScope = applicationCommandScope(command.bindingId, command.model, targetKey, envelope.routing.idempotencyKey, contextDigest);
          const cursor = encodeCursor(options.cursorSecret, {
            version: 2,
            command: command.id,
            commandId,
            correlationId,
            durableScope,
            principalBinding: cursorBinding(options.cursorSecret, 'principal', admission.principal.id),
            authorizationBinding: cursorBinding(options.cursorSecret, 'authorization', admission.authorizationVersion),
            contextBinding: cursorBinding(options.cursorSecret, 'context', contextDigest),
            expiresAt: now().getTime() + cursorTtlSeconds * 1000,
          });
          const submission: ApplicationCommandSubmission = { protocol: 'applik8s.command/v1alpha1', command: command.id, commandId, correlationId, transport: 'acknowledged', durableResult: 'pending', progressCursor: cursor, workflow: 'notStarted', reconciliation: 'notObserved' };
          return json(submission, 202);
        }
        const encoded = requiredString(body.value.cursor, 'cursor');
        const cursor = decodeCursor(options.cursorSecret, encoded, now().getTime());
        if (cursor.command !== command.id
          || cursor.principalBinding !== cursorBinding(options.cursorSecret, 'principal', admission.principal.id)
          || cursor.authorizationBinding !== cursorBinding(options.cursorSecret, 'authorization', admission.authorizationVersion)) return json({ error: 'cursor_invalid' }, 400);
        const durableContext = applicationRequestContextValues(admission.principal, admission.authorizationVersion, admission.trustedContext);
        const contextDigest = applicationAdmittedContextDigest({ values: durableContext, digestSecret: options.cursorSecret });
        if (cursor.contextBinding !== cursorBinding(options.cursorSecret, 'context', contextDigest)) return json({ error: 'cursor_invalid' }, 400);
        const sql = command.sql ?? database(databases, command.databaseUrl);
        const rows = await sql.unsafe('SELECT output, error, model_revision FROM applik8s_command_results WHERE scope = $1 LIMIT 1', [cursor.durableScope]);
        const row = rows[0] as { readonly output?: unknown; readonly error?: unknown; readonly model_revision?: unknown } | undefined;
        if (!row) return json(progress(cursor, encoded, 'pending'), 200);
        if (row.error) {
          const error = durableRejection(row.error);
          const failure = durableProcessingFailure(error);
          if (failure) return json({ ...progress(cursor, encoded, 'failed'), failure, ...(typeof row.model_revision === 'string' ? { modelRevision: row.model_revision } : {}) }, 200);
          return json({ ...progress(cursor, encoded, 'rejected'), rejection: error, ...(typeof row.model_revision === 'string' ? { modelRevision: row.model_revision } : {}) }, 200);
        }
        return json({ ...progress(cursor, encoded, 'succeeded'), output: row.output, ...(typeof row.model_revision === 'string' ? { modelRevision: row.model_revision } : {}) }, 200);
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
    async ready() {
      await publisher.verify?.();
      await Promise.all(options.commands.map(async (command) => {
        const sql = command.sql ?? database(databases, command.databaseUrl);
        await sql.unsafe('SELECT 1 AS applik8s_ready');
      }));
    },
    async close() { await Promise.all([publisher.drain(), ...[...databases.values()].map((sql) => sql.end({ timeout: 5 }))]); },
  };
}

function commandRoute(request: Request): { readonly command: string; readonly operation: 'submit' | 'progress' } | undefined {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'commands' || (parts[2] !== 'submit' && parts[2] !== 'progress')) return undefined;
  return { command: decodeURIComponent(parts[1] ?? ''), operation: parts[2] };
}

function requiredEventLog(eventLog: JetStreamEventLogOptions | undefined): JetStreamEventLogOptions {
  if (!eventLog) throw new Error('Application command gateway requires an EventLog provider.');
  return eventLog;
}

async function admitted<TPrincipal extends ApplicationQueryPrincipal>(options: ApplicationCommandGatewayOptions<TPrincipal>, request: Request): Promise<ApplicationGatewayAdmission> {
  const admission = await options.authenticate(request);
  if (!admission.principal.id || !admission.authorizationVersion || !admission.trustedContext || typeof admission.trustedContext !== 'object') throw new Error('Application command gateway identity provider returned an incomplete admission.');
  return admission;
}

function validateCommandInput(command: ApplicationGatewayCommandRuntimeContract, value: unknown): object {
  // typecast: normalizeSchema is the runtime authority for the command input boundary.
  const result = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.id}.input` }, schema: command.inputSchema }, `${command.id}.input`).validate(value as never);
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw new Error(`Application command ${command.id} input validation failed.`);
  return result.value;
}

function commandContract(id: string): { readonly name: string; readonly version: string } { const match = /^(.*)\.(v[1-9][0-9]*)$/.exec(id); if (!match?.[1] || !match[2]) throw new Error(`Application command ${id} is not versioned.`); return { name: match[1], version: match[2] }; }
function database(databases: Map<string, Sql>, url: string): Sql { const existing = databases.get(url); if (existing) return existing; const sql = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false }); databases.set(url, sql); return sql; }
function requiredString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`Application command ${field} is required.`); return value; }
function progress(cursor: ProgressCursor, encoded: string, durableResult: 'pending' | 'succeeded' | 'rejected' | 'failed'): ApplicationCommandProgress { return { protocol: 'applik8s.command/v1alpha1', command: cursor.command, commandId: cursor.commandId, correlationId: cursor.correlationId, transport: 'acknowledged', durableResult, progressCursor: encoded, workflow: 'notStarted', reconciliation: durableResult === 'succeeded' ? 'progressing' : durableResult === 'failed' ? 'failed' : 'notObserved' }; }
function durableRejection(value: unknown): { readonly name: string; readonly payload: unknown } { if (!value || typeof value !== 'object') return { name: 'unknown', payload: null }; const name = Reflect.get(value, 'name'); return { name: typeof name === 'string' ? name : 'unknown', payload: Reflect.get(value, 'payload') ?? null }; }
function durableProcessingFailure(value: { readonly name: string; readonly payload: unknown }): { readonly code: 'processing_failed'; readonly attempts?: number } | undefined { if (value.name !== 'internalFailure' || !value.payload || typeof value.payload !== 'object' || Reflect.get(value.payload, 'code') !== 'processing_failed') return undefined; const attempts = Reflect.get(value.payload, 'attempts'); return { code: 'processing_failed', ...(Number.isSafeInteger(attempts) && Number(attempts) > 0 ? { attempts: Number(attempts) } : {}) }; }

function encodeCursor(secret: string, payload: ProgressCursor): string { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`; }
function cursorBinding(secret: string, domain: 'principal' | 'authorization' | 'context', value: string): string { return createHmac('sha256', secret).update(`applik8s.command-cursor.${domain}\0`).update(value).digest('base64url'); }
// typecast: the signed cursor is decoded only after its HMAC, version, and expiry invariants are checked.
function decodeCursor(secret: string, value: string, now: number): ProgressCursor { const [body, signature, extra] = value.split('.'); if (!body || !signature || extra) throw new Error('Application command cursor is invalid.'); const expected = createHmac('sha256', secret).update(body).digest(); const supplied = Buffer.from(signature, 'base64url'); if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Application command cursor is invalid.'); const cursor = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ProgressCursor; if (cursor.version !== 2 || cursor.expiresAt < now || !cursor.command || !cursor.commandId || !cursor.correlationId || !/^sha256:[a-f0-9]{64}$/.test(cursor.durableScope) || !opaqueCursorField(cursor.principalBinding) || !opaqueCursorField(cursor.authorizationBinding) || !opaqueCursorField(cursor.contextBinding)) throw new Error('Application command cursor is invalid or expired.'); return cursor; }
function opaqueCursorField(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }

// typecast-boundary: parsed JSON is proven to be a non-array object before the record-shaped body is returned.
async function boundedJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly response: Response }> { const contentLength = Number(request.headers.get('content-length') ?? 0); if (contentLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; const text = await request.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; try { const value = JSON.parse(text) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, response: json({ error: 'invalid_json' }, 400) }; } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; } }
function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }); }
