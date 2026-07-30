// typecast-file-boundary: Durable task payloads are decoded from validated JSON protocol envelopes into their declared generic schemas.
import { createHash } from 'node:crypto';
import type {
  ApplicationAuthorizationReceipt,
  ApplicationExecutionPrincipal,
  ApplicationPrincipal,
  ApplicationScopeExpression,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import { applicationRequestContextValues } from './command-principal.js';
import { applicationCommandScope, canonicalApplicationCommandKey } from './command-runtime-contract.js';
import type { ApplicationEventLogPublisher } from './event-log-runtime.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import { applicationAdmittedContextDigest, applicationRelationalChangeScopes } from './relational-runtime.js';

export interface ApplicationTaskOperationRuntimeContract {
  readonly id: string;
  readonly bindingId: string;
  readonly model: string;
  readonly inputSchema: JsonObject;
  readonly databaseUrl: string;
  readonly sql?: ApplicationPostgresSql;
  readonly key: (input: object) => unknown;
  readonly idempotencyKey?: (input: object) => string;
}

export interface ApplicationTaskOperationPrincipal extends ApplicationPrincipal {
  readonly trustedContext?: JsonObject;
}

export interface ApplicationTaskOperationInvocation {
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly signal: AbortSignal;
  readonly deadline?: string;
  readonly cancellationRevision?: string;
}

export interface ApplicationTaskOperationRuntimeOptions {
  readonly commands: readonly ApplicationTaskOperationRuntimeContract[];
  readonly cursorSecret: string;
  readonly eventLogPublisher: Pick<ApplicationEventLogPublisher, 'publish' | 'drain'> & Partial<Pick<ApplicationEventLogPublisher, 'verify'>>;
  readonly resultTimeoutMs?: number;
  readonly now?: () => Date;
  readonly admitExecution?: (request: {
    readonly principal: ApplicationTaskOperationPrincipal;
    readonly invocation: ApplicationTaskOperationInvocation;
    readonly envelopes: readonly ApplicationWorkloadAuthorityEnvelope[];
    readonly trustedContextDigest: string;
  }) => Promise<ApplicationExecutionPrincipal>;
  readonly authorizeExecution?: (request: {
    readonly principal: ApplicationExecutionPrincipal;
    readonly envelope: ApplicationWorkloadAuthorityEnvelope;
    readonly target: ApplicationScopeExpression;
    readonly inputDigest: string;
    readonly trustedContextDigest: string;
    readonly idempotencyKey: string;
    readonly commandId: string;
    readonly targetDigest: string;
    readonly cancellationRevision: string;
  }) => Promise<
    | { readonly allowed: true; readonly receipt: ApplicationAuthorizationReceipt }
    | { readonly allowed: false; readonly code: string; readonly message: string }
  >;
}

export interface ApplicationTaskOperationRuntime {
  bind(
    aliases: Readonly<Record<string, ApplicationTaskOperationAliasBinding>>,
    principal: ApplicationTaskOperationPrincipal,
    invocation: ApplicationTaskOperationInvocation,
    executionSource?: object,
  ): Readonly<Record<string, (input: object, options?: { readonly idempotencyKey?: string; readonly expectedRevision?: string }) => Promise<unknown>>>;
  close(): Promise<void>;
}

export type ApplicationTaskOperationAliasBinding =
  | string
  | {
    readonly commandId: string;
    readonly operationId: string;
    readonly boundKeys: readonly string[];
    readonly project?: (source: object) => Readonly<Record<string, unknown>>;
    readonly envelope?: ApplicationWorkloadAuthorityEnvelope;
  };

/**
 * Internal task effect adapter. It deliberately publishes the same command
 * envelope consumed by generated command processors and observes the same
 * durable PostgreSQL result. No handler receives EventLog/database credentials
 * or a way to manufacture a different principal.
 */
export function createApplicationTaskOperationRuntime(options: ApplicationTaskOperationRuntimeOptions): ApplicationTaskOperationRuntime {
  if (options.cursorSecret.length < 32) throw new Error('Application task operation cursorSecret must contain at least 32 characters.');
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  if (commands.size !== options.commands.length) throw new Error('Application task operation contracts must be unique.');
  const publisher = options.eventLogPublisher;
  const databases = new Map<string, Promise<ApplicationPostgresSql>>();
  const now = options.now ?? (() => new Date());
  const resultTimeoutMs = options.resultTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(resultTimeoutMs) || resultTimeoutMs < 1_000 || resultTimeoutMs > 15 * 60_000) {
    throw new Error('Application task operation resultTimeoutMs must be between 1 second and 15 minutes.');
  }
  let verified: Promise<void> | undefined;

  return {
    bind(aliases, principal, invocation, executionSource = {}) {
      if (Object.keys(aliases).length === 0) return Object.freeze({});
      validatePrincipal(principal);
      if (!invocation.invocationId.trim() || !invocation.idempotencyKey.trim()) throw new Error('Application task operation invocation identity is incomplete.');
      const durableContext = applicationRequestContextValues(
        principal,
        principal.authorityRevision,
        principal.trustedContext ?? {},
      );
      const contextDigest = applicationAdmittedContextDigest({ values: durableContext, digestSecret: options.cursorSecret });
      const envelopes = Object.values(aliases).flatMap((binding) =>
        typeof binding === 'string' || !binding.envelope ? [] : [binding.envelope]);
      const requiresAuthority = envelopes.length > 0;
      if (requiresAuthority && (!options.admitExecution || !options.authorizeExecution)) {
        throw new Error('Application task operation runtime received workload envelopes without execution authority callbacks.');
      }
      const executionPrincipal = requiresAuthority
        ? options.admitExecution?.({ principal, invocation, envelopes, trustedContextDigest: contextDigest })
        : undefined;
      const bound = Object.fromEntries(Object.entries(aliases).map(([alias, aliasBinding]) => {
        const commandId = typeof aliasBinding === 'string' ? aliasBinding : aliasBinding.commandId;
        const command = commands.get(commandId);
        if (!command) throw new Error(`Application task operation alias ${alias} references undeclared command ${commandId}.`);
        return [alias, async (input: object, commandOptions: { readonly idempotencyKey?: string; readonly expectedRevision?: string } = {}) => {
          if (invocation.signal.aborted) throw abortError();
          const completeInput = typeof aliasBinding === 'string'
            ? input
            : completeBoundInput(alias, aliasBinding, executionSource, input);
          const validInput = validateInput(command, completeInput);
          const targetKey = canonicalApplicationCommandKey(command.key(validInput) as string | number | boolean | Readonly<Record<string, string | number | boolean>>);
          const idempotencyKey = command.idempotencyKey?.(validInput)
            ?? commandOptions.idempotencyKey
            ?? `${invocation.idempotencyKey}:${alias}`;
          if (!idempotencyKey.trim()) throw new Error(`Application task operation ${alias} produced an empty idempotency key.`);
          const commandId = stableCommandId(invocation.invocationId, alias, idempotencyKey);
          const target = { kind: 'target' as const, model: command.model, identity: { key: targetKey } };
          const inputDigest = digestJson(validInput);
          const targetDigest = digestJson(target);
          let authorizationReceipt: ApplicationAuthorizationReceipt | undefined;
          if (typeof aliasBinding !== 'string' && aliasBinding.envelope) {
            const admitted = await executionPrincipal;
            if (!admitted || !options.authorizeExecution) {
              throw new Error(`Application task operation ${alias} has no admitted execution principal.`);
            }
            const decision = await options.authorizeExecution({
              principal: admitted,
              envelope: aliasBinding.envelope,
              target,
              inputDigest,
              trustedContextDigest: contextDigest,
              idempotencyKey,
              commandId,
              targetDigest,
              cancellationRevision: invocation.cancellationRevision ?? `active:${invocation.invocationId}`,
            });
            if (!decision.allowed) {
              throw new ApplicationTaskOperationAuthorityError(
                decision.code,
                aliasBinding.operationId,
                decision.message,
              );
            }
            authorizationReceipt = decision.receipt;
          }
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
            ...(authorizationReceipt ? { authorizationReceipt } : {}),
            trustedContext: { values: durableContext, digest: contextDigest, changeScopes: applicationRelationalChangeScopes({ values: durableContext, digestSecret: options.cursorSecret }) },
          }, 'commands');
          return waitForResult({ command, targetKey, idempotencyKey, contextDigest, signal: invocation.signal });
        }];
      }));
      return Object.freeze(bound);
    },
    async close() {
      await Promise.all([publisher.drain(), ...[...databases.values()].map(async (database) => (await database).end({ timeout: 5 }))]);
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
    const database = input.command.sql ?? await commandDatabase(databases, input.command.databaseUrl);
    const deadline = Date.now() + resultTimeoutMs;
    let delayMs = 50;
    while (true) {
      if (input.signal.aborted) throw abortError();
      const rows = await database.unsafe('SELECT output, error, model_revision FROM applik8s_command_results WHERE scope = $1 LIMIT 1', [scope]);
      const result = rows[0] as { readonly output?: unknown; readonly error?: unknown; readonly model_revision?: unknown } | undefined;
      if (result) {
        if (result.error) {
          const error = durableRejection(result.error);
          const failureCode = error.name === 'internalFailure' && error.payload && typeof error.payload === 'object'
            ? Reflect.get(error.payload, 'code')
            : undefined;
          if (failureCode === 'processing_failed' || failureCode === 'authorization_denied') {
            throw new ApplicationTaskOperationFailedError(input.command.id, failureCode);
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

function completeBoundInput(
  alias: string,
  binding: Exclude<ApplicationTaskOperationAliasBinding, string>,
  executionSource: object,
  supplied: object,
): object {
  if (binding.boundKeys.length === 0) return supplied;
  const overridden = binding.boundKeys.filter((key) => Object.hasOwn(supplied, key));
  if (overridden.length > 0) {
    throw new ApplicationTaskOperationAuthorityError(
      'AUTHORITY_BOUND_FIELD_OVERRIDE',
      binding.operationId,
      `Task operation ${alias} caller attempted to override execution-bound field(s): ${overridden.join(', ')}.`,
    );
  }
  if (!binding.project) {
    throw new ApplicationTaskOperationAuthorityError(
      'AUTHORITY_EXECUTION_BINDING_MISSING',
      binding.operationId,
      `Task operation ${alias} declares bound keys without a generated projection.`,
    );
  }
  const projected = binding.project(executionSource);
  if (!projected || typeof projected !== 'object' || Array.isArray(projected)) {
    throw new ApplicationTaskOperationAuthorityError(
      'AUTHORITY_EXECUTION_BINDING_INVALID',
      binding.operationId,
      `Task operation ${alias} execution projection did not return an object.`,
    );
  }
  const expected = [...binding.boundKeys].sort();
  const actual = Object.keys(projected).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new ApplicationTaskOperationAuthorityError(
      'AUTHORITY_EXECUTION_BINDING_INVALID',
      binding.operationId,
      `Task operation ${alias} execution projection changed its key set; expected ${expected.join(', ')}, received ${actual.join(', ')}.`,
    );
  }
  return { ...supplied, ...projected };
}

export class ApplicationTaskOperationAuthorityError extends Error {
  constructor(
    readonly code:
      | 'AUTHORITY_BOUND_FIELD_OVERRIDE'
      | 'AUTHORITY_EXECUTION_BINDING_MISSING'
      | 'AUTHORITY_EXECUTION_BINDING_INVALID'
      | string,
    readonly operationId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationTaskOperationAuthorityError';
  }
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
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
  constructor(
    readonly command: string,
    readonly failure: 'processing_failed' | 'authorization_denied' = 'processing_failed',
  ) {
    super(failure === 'authorization_denied'
      ? `Application task operation ${command} was denied when its durable authorization was revalidated.`
      : `Application task operation ${command} failed after exhausting bounded command processing attempts.`);
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
  if (!principal || typeof principal !== 'object' || !principal.id?.trim() || !principal.catalogRevision?.trim() || !principal.authorityRevision?.trim()) {
    throw new Error('Application task operation principal requires one canonical admitted principal.');
  }
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

function commandDatabase(databases: Map<string, Promise<ApplicationPostgresSql>>, url: string): Promise<ApplicationPostgresSql> {
  const existing = databases.get(url);
  if (existing) return existing;
  const database = createApplicationPostgresSql(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
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
