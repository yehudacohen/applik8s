// typecast-file-boundary: Durable task payloads are decoded from validated JSON protocol envelopes into their declared generic schemas.
import { createHash } from 'node:crypto';
import type { JsonObject } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import postgres, { type Sql } from 'postgres';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import { applicationRequestContextValues } from './command-principal.js';
import { createJetStreamEventLog, type ApplicationEventLogPublisher, type JetStreamEventLogOptions } from './event-log-jetstream-runtime.js';
import { applicationAdmittedContextDigest, applicationRelationalChangeScopes } from './relational-runtime.js';

export interface ApplicationTaskOperationRuntimeContract {
  readonly id: string;
  readonly bindingId: string;
  readonly model: string;
  readonly inputSchema: JsonObject;
  readonly databaseUrl: string;
  readonly sql?: Sql;
  readonly key: (input: object) => unknown;
  readonly idempotencyKey?: (input: object) => string;
}

export interface ApplicationTaskOperationPrincipal {
  readonly id: string;
  readonly claims?: JsonObject;
  readonly authorizationVersion: string;
  readonly trustedContext?: JsonObject;
}

export interface ApplicationTaskOperationInvocation {
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly signal: AbortSignal;
}

export interface ApplicationTaskOperationRuntimeOptions {
  readonly commands: readonly ApplicationTaskOperationRuntimeContract[];
  readonly cursorSecret: string;
  readonly eventLog?: JetStreamEventLogOptions;
  readonly eventLogPublisher?: Pick<ApplicationEventLogPublisher, 'publish' | 'drain'> & Partial<Pick<ApplicationEventLogPublisher, 'verify'>>;
  readonly resultTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface ApplicationTaskOperationRuntime {
  bind(
    aliases: Readonly<Record<string, string>>,
    principal: ApplicationTaskOperationPrincipal,
    invocation: ApplicationTaskOperationInvocation,
  ): Readonly<Record<string, (input: object, options?: { readonly idempotencyKey?: string; readonly expectedRevision?: string }) => Promise<unknown>>>;
  close(): Promise<void>;
}

/**
 * Internal task effect adapter. It deliberately publishes the same command
 * envelope consumed by generated command processors and observes the same
 * durable PostgreSQL result. No handler receives EventLog/database credentials
 * or a way to manufacture a different principal.
 */
export function createApplicationTaskOperationRuntime(options: ApplicationTaskOperationRuntimeOptions): ApplicationTaskOperationRuntime {
  if (options.cursorSecret.length < 32) throw new Error('Application task operation cursorSecret must contain at least 32 characters.');
  if (!options.eventLog && !options.eventLogPublisher) throw new Error('Application task operations require an EventLog provider.');
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  if (commands.size !== options.commands.length) throw new Error('Application task operation contracts must be unique.');
  const publisher = options.eventLogPublisher ?? createJetStreamEventLog(requiredEventLog(options.eventLog));
  const databases = new Map<string, Sql>();
  const now = options.now ?? (() => new Date());
  const resultTimeoutMs = options.resultTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(resultTimeoutMs) || resultTimeoutMs < 1_000 || resultTimeoutMs > 15 * 60_000) {
    throw new Error('Application task operation resultTimeoutMs must be between 1 second and 15 minutes.');
  }
  let verified: Promise<void> | undefined;

  return {
    bind(aliases, principal, invocation) {
      if (Object.keys(aliases).length === 0) return Object.freeze({});
      validatePrincipal(principal);
      if (!invocation.invocationId.trim() || !invocation.idempotencyKey.trim()) throw new Error('Application task operation invocation identity is incomplete.');
      const bound = Object.fromEntries(Object.entries(aliases).map(([alias, commandId]) => {
        const command = commands.get(commandId);
        if (!command) throw new Error(`Application task operation alias ${alias} references undeclared command ${commandId}.`);
        return [alias, async (input: object, commandOptions: { readonly idempotencyKey?: string; readonly expectedRevision?: string } = {}) => {
          if (invocation.signal.aborted) throw abortError();
          const validInput = validateInput(command, input);
          const targetKey = canonicalApplicationCommandKey(command.key(validInput) as string | number | boolean | Readonly<Record<string, string | number | boolean>>);
          const idempotencyKey = command.idempotencyKey?.(validInput)
            ?? commandOptions.idempotencyKey
            ?? `${invocation.idempotencyKey}:${alias}`;
          if (!idempotencyKey.trim()) throw new Error(`Application task operation ${alias} produced an empty idempotency key.`);
          const commandId = stableCommandId(invocation.invocationId, alias, idempotencyKey);
          const durableContext = applicationRequestContextValues(
            { id: principal.id, ...(principal.claims ? { claims: principal.claims } : {}) },
            principal.authorizationVersion,
            principal.trustedContext ?? {},
          );
          const contextDigest = applicationAdmittedContextDigest({ values: durableContext, digestSecret: options.cursorSecret });
          verified ??= Promise.resolve(publisher.verify?.()).catch((error) => {
            verified = undefined;
            throw error;
          });
          await verified;
          await publisher.publish({
            id: commandId,
            contract: commandContract(command.id),
            payload: validInput,
            recordedAt: now().toISOString(),
            correlationId: invocation.correlationId ?? invocation.invocationId,
            ...(invocation.causationId ? { causationId: invocation.causationId } : {}),
            ...(invocation.traceparent ? { traceparent: invocation.traceparent } : {}),
            partitionKey: targetKey,
            routing: { binding: command.bindingId, targetKey, idempotencyKey },
            ...(commandOptions.expectedRevision ? { expectedRevision: commandOptions.expectedRevision } : {}),
            trustedContext: { values: durableContext, digest: contextDigest, changeScopes: applicationRelationalChangeScopes({ values: durableContext, digestSecret: options.cursorSecret }) },
          }, 'commands');
          return waitForResult({ command, targetKey, idempotencyKey, contextDigest, signal: invocation.signal });
        }];
      }));
      return Object.freeze(bound);
    },
    async close() {
      await Promise.all([publisher.drain(), ...[...databases.values()].map((database) => database.end({ timeout: 5 }))]);
      databases.clear();
    },
  };

  async function waitForResult(input: {
    readonly command: ApplicationTaskOperationRuntimeContract;
    readonly targetKey: string;
    readonly idempotencyKey: string;
    readonly contextDigest: string;
    readonly signal: AbortSignal;
  }): Promise<unknown> {
    const scope = applicationCommandScope(input.command.bindingId, input.command.model, input.targetKey, input.idempotencyKey, input.contextDigest);
    const database = input.command.sql ?? commandDatabase(databases, input.command.databaseUrl);
    const deadline = Date.now() + resultTimeoutMs;
    let delayMs = 50;
    while (true) {
      if (input.signal.aborted) throw abortError();
      const rows = await database.unsafe('SELECT output, error, model_revision FROM applik8s_command_results WHERE scope = $1 LIMIT 1', [scope]);
      const result = rows[0] as { readonly output?: unknown; readonly error?: unknown; readonly model_revision?: unknown } | undefined;
      if (result) {
        if (result.error) {
          const error = durableRejection(result.error);
          if (error.name === 'internalFailure' && error.payload && typeof error.payload === 'object' && Reflect.get(error.payload, 'code') === 'processing_failed') {
            throw new ApplicationTaskOperationFailedError(input.command.id);
          }
          throw new ApplicationTaskOperationRejectedError(input.command.id, error);
        }
        return result.output;
      }
      if (Date.now() >= deadline) throw new ApplicationTaskOperationResultTimeoutError(input.command.id, resultTimeoutMs);
      await abortableSleep(delayMs, input.signal);
      delayMs = Math.min(1_000, Math.ceil(delayMs * 1.75));
    }
  }
}

export class ApplicationTaskOperationRejectedError extends Error {
  readonly code = 'APPLIK8S_TASK_OPERATION_REJECTED';
  constructor(readonly command: string, readonly rejection: { readonly name: string; readonly payload: unknown }) {
    super(`Application task operation ${command} was rejected with ${rejection.name}.`);
    this.name = 'ApplicationTaskOperationRejectedError';
  }
}

export class ApplicationTaskOperationFailedError extends Error {
  readonly code = 'APPLIK8S_TASK_OPERATION_FAILED';
  constructor(readonly command: string) {
    super(`Application task operation ${command} failed after exhausting bounded command processing attempts.`);
    this.name = 'ApplicationTaskOperationFailedError';
  }
}

export class ApplicationTaskOperationResultTimeoutError extends Error {
  readonly code = 'APPLIK8S_TASK_OPERATION_RESULT_TIMEOUT';
  constructor(readonly command: string, readonly timeoutMs: number) {
    super(`Application task operation ${command} did not produce a durable result within ${timeoutMs}ms.`);
    this.name = 'ApplicationTaskOperationResultTimeoutError';
  }
}

function validateInput(command: ApplicationTaskOperationRuntimeContract, input: unknown): object {
  const result = normalizeSchema({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: `${command.id}.input` }, schema: command.inputSchema }, `${command.id}.input`).validate(input as never);
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw new Error(`Application task operation ${command.id} input validation failed.`);
  return result.value;
}

function validatePrincipal(principal: ApplicationTaskOperationPrincipal): void {
  if (!principal || typeof principal !== 'object' || !principal.id?.trim() || !principal.authorizationVersion?.trim()) {
    throw new Error('Application task operation principal requires non-empty id and authorizationVersion values.');
  }
  JSON.stringify(principal.claims ?? {});
  JSON.stringify(principal.trustedContext ?? {});
}

function stableCommandId(invocationId: string, alias: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(`${invocationId}\0${alias}\0${idempotencyKey}`).digest('hex').slice(0, 32);
  return `task:${digest}`;
}

function commandContract(id: string): { readonly name: string; readonly version: string } {
  const match = /^(.*)\.(v[1-9][0-9]*)$/.exec(id);
  if (!match?.[1] || !match[2]) throw new Error(`Application task operation ${id} is not versioned.`);
  return { name: match[1], version: match[2] };
}

function requiredEventLog(eventLog: JetStreamEventLogOptions | undefined): JetStreamEventLogOptions {
  if (!eventLog) throw new Error('Application task operations require an EventLog provider.');
  return eventLog;
}

function commandDatabase(databases: Map<string, Sql>, url: string): Sql {
  const existing = databases.get(url);
  if (existing) return existing;
  const database = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
  databases.set(url, database);
  return database;
}

function durableRejection(value: unknown): { readonly name: string; readonly payload: unknown } {
  if (!value || typeof value !== 'object') return { name: 'unknown', payload: null };
  const name = Reflect.get(value, 'name');
  return { name: typeof name === 'string' ? name : 'unknown', payload: Reflect.get(value, 'payload') ?? null };
}

function abortError(): Error {
  const error = new Error('Application task operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
