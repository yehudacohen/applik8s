// typecast-file-boundary: Celld actor requests and persisted records cross a provider wire boundary and are validated before dispatch.
import { randomUUID } from 'node:crypto';
import {
  type ApplicationActorAdmissionReceipt,
  type ApplicationActorAlarmReceipt,
  type ApplicationActorBroadcastReceipt,
  type ApplicationActorOutboxEvent,
  type ApplicationActorRuntime,
  type ApplicationActorRuntimeInvocation,
  type ApplicationActorTurn,
  type ApplicationActorTurnAuthority,
  normalizeApplicationActorTurnAuthority,
  resolveApplicationActorInvocationAuthority,
  withApplicationActorTurnAuthority,
} from '@applik8s/applik8s/actor-runtime';
import { withApplicationManagedEffects } from '@applik8s/applik8s/internal/managed-effects';
import {
  captureApplicationTelemetryContext,
  runApplicationTelemetryBoundary,
} from '@applik8s/applik8s/telemetry-runtime';
import { sha256Hex } from '@applik8s/deployment-contract';
import { normalizeSchema } from '@applik8s/sdk';

export interface CelldApplicationActorRuntimeOptions {
  /** Private celld Worker ingress. It must not be the celld peer listener. */
  readonly endpoint: string;
  /** Bearer credential shared only by generated application workloads and the Worker. */
  readonly authorization: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly leaseDuration?: string;
  readonly admissionTimeout?: string;
  readonly heartbeatInterval?: string;
  readonly retryDelay?: string;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  /** Publishes a committed ordinary application event using its stable effect identity. */
  readonly deliverEvent?: (event: ApplicationActorOutboxEvent) => void | Promise<void>;
}

interface CelldActorBeginAcquired {
  readonly status: 'acquired';
  readonly lease: string;
  readonly revision: number;
  readonly stateVersion: number;
  readonly state?: object;
}

interface CelldActorBeginPrior {
  readonly status: 'prior';
  readonly result?: object;
  readonly receipt: ApplicationActorAdmissionReceipt;
  readonly effects?: readonly ApplicationActorOutboxEvent[];
}

type CelldActorBegin = CelldActorBeginAcquired | CelldActorBeginPrior;
interface CelldActorRejected { readonly error: string }

/**
 * Runs application callbacks in the generated workload while celld remains the
 * canonical state, lease, receipt, alarm, and fencing authority. A renewable
 * durable lease covers the complete awaited callback, closing celld's native
 * request-interleaving seam without weakening Applik8s actor semantics.
 */
export function createCelldApplicationActorRuntime(
  options: CelldApplicationActorRuntimeOptions,
): ApplicationActorRuntime {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('celld actor endpoint must use HTTP(S).');
  }
  if (options.authorization.length < 32) {
    throw new Error('celld actor authorization must contain at least 32 characters.');
  }
  const request = options.fetch ?? globalThis.fetch;
  const leaseMilliseconds = durationMilliseconds(options.leaseDuration ?? '30s', 'leaseDuration');
  const admissionMilliseconds = durationMilliseconds(options.admissionTimeout ?? '30s', 'admissionTimeout');
  const heartbeatMilliseconds = durationMilliseconds(
    options.heartbeatInterval ?? `${Math.max(1_000, Math.floor(leaseMilliseconds / 3))}ms`,
    'heartbeatInterval',
  );
  if (heartbeatMilliseconds >= leaseMilliseconds) {
    throw new Error('celld actor heartbeatInterval must be shorter than leaseDuration.');
  }
  const retryMilliseconds = durationMilliseconds(options.retryDelay ?? '50ms', 'retryDelay');
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;

  return {
    async invoke(call) {
      const identity = actorPath(call.definition.id, call.key);
      const operationId = call.idempotencyKey?.trim() || `actor_${randomId()}`;
      const fingerprint = sha256Hex(stableJson({
        actor: call.definition.id,
        key: call.key,
        member: call.member,
        kind: call.memberKind,
        input: call.input,
      }));
      const deadline = now().getTime() + admissionMilliseconds;
      let begin: CelldActorBegin;
      while (true) {
        const response = await actorRequest<CelldActorBegin | CelldActorRejected>(request, endpoint, options.authorization, `${identity}/turns:begin`, {
          operationId,
          fingerprint,
          member: call.member,
          leaseMilliseconds,
        }, [200, 409]);
        if (response.statusCode === 200) {
          begin = response.value as CelldActorBegin;
          break;
        }
        if (!('error' in response.value) || response.value.error !== 'actor_turn_busy') {
          throw new Error(`celld actor authority rejected ${call.definition.id}.${call.member}: ${'error' in response.value ? response.value.error : 'unknown_admission_error'}.`);
        }
        if (now().getTime() >= deadline) {
          throw new CelldActorAdmissionTimeoutError(call.definition.id, call.key, call.member);
        }
        await delay(retryMilliseconds);
      }
      if (begin.status === 'prior') {
        await deliverCommittedEffects(begin.effects ?? [], identity, operationId);
        return {
          ...(begin.result ? { result: begin.result } : {}),
          receipt: { ...begin.receipt, replayed: true },
        };
      }

      let heartbeatFailure: unknown;
      const heartbeat = setInterval(() => {
        void actorRequest(request, endpoint, options.authorization, `${identity}/turns:renew`, {
          operationId,
          lease: begin.lease,
          leaseMilliseconds,
        }, [200]).catch((cause) => { heartbeatFailure = cause; });
      }, heartbeatMilliseconds);
      try {
        let staged = begin.state === undefined
          ? validate(call.definition.state, await requiredInitializer(call.definition, call.key), `${call.definition.id}.state`)
          : await migrateCelldActorState(call.definition, begin.state, begin.stateVersion, call.key);
        const ephemeral = call.memberKind === 'actorConnectionMessage';
        const frameworkStateChanged = begin.state === undefined || begin.stateVersion !== call.definition.stateVersion;
        const committedRevision = ephemeral && !frameworkStateChanged ? begin.revision : begin.revision + 1;
        const handler = call.definition.handlers.get(call.member)
          ?? (call.memberKind === 'actorConnection' || call.memberKind === 'actorDisconnection'
            ? (async () => undefined) as (...args: never[]) => unknown
            : undefined);
        if (!handler) throw new Error(`Actor ${call.definition.id}.${call.member} has no registered handler.`);
        const broadcasts: Array<{
          readonly member: string;
          readonly value: object;
          readonly receipt: ApplicationActorBroadcastReceipt;
        }> = [];
        const effects: ApplicationActorOutboxEvent[] = [];
        const alarms: Array<
          | { readonly kind: 'schedule'; readonly alarmId: string; readonly member: string; readonly input: object; readonly scheduledAt: string; readonly idempotencyKey?: string; readonly authority: ApplicationActorTurnAuthority; readonly telemetry?: import('@applik8s/core').ApplicationTelemetryEnvelopeV1 }
          | { readonly kind: 'cancel'; readonly alarmId: string; readonly member: string }
        > = [];
        const broadcast = Object.fromEntries(Object.entries(call.definition.protocol).flatMap(([name, member]) =>
          member.kind === 'actorBroadcast'
            ? [[name, async (input: object) => {
                const value = validate(member.input, input, `${call.definition.id}.${name}.input`);
                const receipt: ApplicationActorBroadcastReceipt = {
                  broadcastId: `broadcast_${sha256Hex(stableJson({ operationId, name, index: broadcasts.length }))}`,
                  actor: call.definition.id,
                  key: call.key,
                  member: name,
                  revision: committedRevision,
                };
                broadcasts.push({ member: name, value, receipt });
                return receipt;
              }]]
            : [],
        ));
        const authority = celldActorTurnAuthority(call, operationId);
        const boundAlarms = Object.fromEntries(Object.entries(call.definition.protocol).flatMap(([name, member]) =>
          member.kind === 'actorAlarm'
            ? [[name, {
                schedule: async (at: string | Date, input: object, invocation: { readonly idempotencyKey?: string } = {}) => {
                  if (ephemeral) throw new Error('Ephemeral actor connection messages cannot schedule durable alarms.');
                  const scheduledAt = celldActorAlarmTimestamp(at, call.definition.id, name);
                  const alarmId = celldActorAlarmId(call.definition.id, name, call.key);
                  const admittedInput = validate(member.input, input, `${call.definition.id}.${name}.input`);
                  const alarmAuthority = await resolveApplicationActorInvocationAuthority({ actor: call.definition.id, member: name, memberKind: member.kind, key: call.key, input: admittedInput, transport: 'control-plane', phase: 'enqueue', scheduledAt, ...(invocation.idempotencyKey ? { idempotencyKey: invocation.idempotencyKey } : {}), current: authority });
                  const telemetry = captureApplicationTelemetryContext();
                  alarms.push({ kind: 'schedule', alarmId, member: name, input: admittedInput, scheduledAt, authority: alarmAuthority, ...(invocation.idempotencyKey ? { idempotencyKey: invocation.idempotencyKey } : {}), ...(telemetry ? { telemetry } : {}) });
                  return { alarmId, actor: call.definition.id, key: call.key, member: name, scheduledAt, state: 'scheduled' as const };
                },
                cancel: async () => {
                  if (ephemeral) throw new Error('Ephemeral actor connection messages cannot cancel durable alarms.');
                  const alarmId = celldActorAlarmId(call.definition.id, name, call.key);
                  alarms.push({ kind: 'cancel', alarmId, member: name });
                  return { alarmId, actor: call.definition.id, key: call.key, member: name, scheduledAt: new Date(0).toISOString(), state: 'cancelled' as const };
                },
              }]]
            : [],
        ));
        const turn: ApplicationActorTurn<object> = {
          key: call.key,
          operationId,
          ...authority,
          async state() { return Object.freeze(structuredClone(staged)); },
          async setState(next) {
            if (ephemeral) throw new Error('Ephemeral actor connection messages cannot mutate durable state.');
            staged = validate(call.definition.state, next, `${call.definition.id}.state`);
          },
          broadcast,
          alarms: boundAlarms,
        };
        const attempt = call.attempt ?? 1;
        const result = await runApplicationTelemetryBoundary(
          {
            kind: 'actor',
            identity: `${call.definition.id}.${call.member}`,
            actor: call.definition.id,
            instance: operationId,
            execution: operationId,
            attempt,
            invocation: attempt > 1 ? 'retry' : 'live',
            relationship: call.telemetry ? 'asynchronous' : 'synchronous',
            ...(call.telemetry ? { links: [call.telemetry] } : {}),
            attributes: {
              'applik8s.actor.provider': 'celld',
              'applik8s.actor.key_digest': sha256Hex(call.key).slice(0, 16),
            },
          },
          async () => withApplicationManagedEffects({
            commandId: operationId,
            routingContext: {},
            emit(contract, payload) {
              if (ephemeral) throw new Error('Ephemeral actor connection messages cannot emit durable application events.');
              const name = typeof Reflect.get(contract, 'name') === 'string' ? String(Reflect.get(contract, 'name')) : contract.id;
              const version = typeof Reflect.get(contract, 'version') === 'string' ? String(Reflect.get(contract, 'version')) : 'v1';
              const schema = Reflect.get(contract, 'payload');
              const value = schema ? validate(schema, payload, `${contract.id}.payload`) : structuredClone(payload);
              const sequence = effects.length;
              effects.push({
                effectId: `actor_effect_${sha256Hex(stableJson({ actor: call.definition.id, key: call.key, operationId, sequence, contract: contract.id }))}`,
                operationId,
                contract: { id: contract.id, name, version },
                payload: value,
                recordedAt: now().toISOString(),
                partitionKey: call.key,
              });
              return { kind: 'applicationStagedEffect', effect: 'event', contract: contract.id, sequence };
            },
            invoke() {
              throw new Error('Actor turns cannot synchronously stage command results; use a typed actor call or durable workflow.');
            },
          }, async () => withApplicationActorTurnAuthority({
            principal: authority.principal,
            causalPrincipal: authority.causalPrincipal,
            authorizationReceipt: authority.authorizationReceipt,
            trustedContextDigest: authority.trustedContextDigest,
            ...(authority.admission ? { admission: authority.admission } : {}),
          }, () => Reflect.apply(handler, undefined, call.connection
            ? [turn, call.connection, call.input]
            : [turn, call.input]))),
        );
        if (heartbeatFailure) throw new CelldActorLeaseLostError(call.definition.id, call.key, call.member, { cause: heartbeatFailure });
        const committed = await actorRequest<{
          readonly result?: object;
          readonly receipt: ApplicationActorAdmissionReceipt;
          readonly effects?: readonly ApplicationActorOutboxEvent[];
        }>(request, endpoint, options.authorization, `${identity}/turns:commit`, {
          operationId,
          fingerprint,
          lease: begin.lease,
          expectedRevision: begin.revision,
          expectedStateVersion: begin.stateVersion,
          stateVersion: call.definition.stateVersion,
          state: staged,
          ...(result && typeof result === 'object' ? { result } : {}),
          broadcasts,
          alarms,
          effects,
          ephemeral,
        }, [200]);
        await deliverCommittedEffects(committed.value.effects ?? [], identity, operationId);
        return committed.value;
      } catch (cause) {
        await actorRequest(request, endpoint, options.authorization, `${identity}/turns:abort`, {
          operationId,
          lease: begin.lease,
        }, [200, 409]).catch(() => undefined);
        throw cause;
      } finally {
        clearInterval(heartbeat);
      }
    },
    async scheduleAlarm(call) {
      const response = await actorRequest<ApplicationActorAlarmReceipt>(
        request,
        endpoint,
        options.authorization,
        `${actorPath(call.definition.id, call.key)}/alarms/${encodeURIComponent(call.member)}`,
        {
          actor: call.definition.id,
          key: call.key,
          member: call.member,
          input: call.input,
          scheduledAt: call.scheduledAt,
          idempotencyKey: call.idempotencyKey,
          authority: call.authority,
          telemetry: call.telemetry,
        },
        [200],
      );
      return response.value;
    },
    async cancelAlarm(actor, member, key) {
      const response = await actorRequest<ApplicationActorAlarmReceipt>(
        request,
        endpoint,
        options.authorization,
        `${actorPath(actor, key)}/alarms/${encodeURIComponent(member)}:cancel`,
        { actor, key, member },
        [200],
      );
      return response.value;
    },
  };

  async function deliverCommittedEffects(
    effects: readonly ApplicationActorOutboxEvent[],
    identity: string,
    operationId: string,
  ): Promise<void> {
    if (effects.length === 0) return;
    if (!options.deliverEvent) {
      throw new Error('celld actor committed event effects but no EventLog delivery boundary is installed.');
    }
    for (const effect of effects) await options.deliverEvent(effect);
    await actorRequest(request, endpoint, options.authorization, `${identity}/effects:ack`, {
      operationId,
      effectIds: effects.map(({ effectId }) => effectId),
    }, [200]);
  }
}

function celldActorTurnAuthority(
  call: ApplicationActorRuntimeInvocation<object>,
  operationId: string,
): ApplicationActorTurnAuthority {
  if (call.authority) {
    return normalizeApplicationActorTurnAuthority(call.authority);
  }
  if (call.connection) {
    return normalizeApplicationActorTurnAuthority({
      principal: call.connection.principal,
      causalPrincipal: call.connection.causalPrincipal,
      authorizationReceipt: call.connection.authorizationReceipt,
      trustedContextDigest: call.connection.trustedContextDigest,
    });
  }
  throw new Error(`celld actor operation ${operationId} requires framework-admitted turn authority.`);
}

export class CelldActorAdmissionTimeoutError extends Error {
  readonly code = 'APPLIK8S_CELLD_ACTOR_ADMISSION_TIMEOUT';
  constructor(readonly actor: string, readonly key: string, readonly member: string) {
    super(`Timed out waiting to admit serialized actor turn ${actor}.${member}.`);
    this.name = 'CelldActorAdmissionTimeoutError';
  }
}

export class CelldActorLeaseLostError extends Error {
  readonly code = 'APPLIK8S_CELLD_ACTOR_LEASE_LOST';
  constructor(readonly actor: string, readonly key: string, readonly member: string, options?: ErrorOptions) {
    super(`Lost the durable celld lease for actor turn ${actor}.${member}; no state was reported committed.`, options);
    this.name = 'CelldActorLeaseLostError';
  }
}

async function actorRequest<T>(
  request: typeof globalThis.fetch,
  endpoint: URL,
  authorization: string,
  path: string,
  body: object,
  expected: readonly number[],
): Promise<{ readonly statusCode: number; readonly value: T }> {
  const response = await request(new URL(path, endpoint), {
    method: 'POST',
    headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch (cause) {
    throw new Error(`celld actor authority returned invalid JSON with HTTP ${response.status}.`, { cause });
  }
  if (!expected.includes(response.status)) {
    const message = value && typeof value === 'object' && typeof Reflect.get(value, 'error') === 'string'
      ? String(Reflect.get(value, 'error'))
      : `HTTP ${response.status}`;
    throw new Error(`celld actor authority rejected ${path}: ${message}.`);
  }
  return { statusCode: response.status, value: value as T };
}

async function requiredInitializer(
  definition: {
    readonly id: string;
    readonly initialize?: (actor: { readonly key: string }) => object | Promise<object>;
  },
  key: string,
): Promise<object> {
  if (!definition.initialize) throw new Error(`Actor ${definition.id} has no initialize handler for absent key ${key}.`);
  return definition.initialize({ key });
}

async function migrateCelldActorState(
  definition: {
    readonly id: string;
    readonly state: unknown;
    readonly stateVersion: number;
    readonly migrations: Readonly<Record<number, (previous: object) => object | Promise<object>>>;
  },
  persisted: object,
  persistedVersion: number,
  key: string,
): Promise<object> {
  if (!Number.isSafeInteger(persistedVersion) || persistedVersion < 1) throw new Error(`Actor ${definition.id} has an invalid persisted state revision.`);
  if (persistedVersion > definition.stateVersion) throw new Error(`Actor ${definition.id}[${sha256Hex(key).slice(0, 16)}] state revision ${persistedVersion} is newer than runtime revision ${definition.stateVersion}; rollback is unsupported.`);
  let value = structuredClone(persisted);
  for (let from = persistedVersion; from < definition.stateVersion; from += 1) {
    const migration = definition.migrations[from];
    if (!migration) throw new Error(`Actor ${definition.id} state revision ${from} has no declared migration to revision ${from + 1}.`);
    value = await migration(Object.freeze(structuredClone(value)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Actor ${definition.id} migration ${from} returned a non-object state.`);
  }
  return validate(definition.state, value, `${definition.id}.state`);
}

function validate(schema: unknown, value: unknown, label: string): object {
  const result = normalizeSchema(schema as never, label).validate(value as never);
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error(`${label} failed schema validation${result.ok ? '' : `: ${result.error.message}`}.`);
  }
  return result.value;
}

function actorPath(actor: string, key: string): string {
  return `./__applik8s/v1/actors/${encodeURIComponent(actor)}/${encodeURIComponent(key)}`;
}

function celldActorAlarmId(actor: string, member: string, key: string): string {
  return `alarm_${sha256Hex(`${actor}\u0000${key}\u0000${member}`).slice(0, 32)}`;
}

function celldActorAlarmTimestamp(at: string | Date, actor: string, member: string): string {
  const parsed = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Actor alarm ${actor}.${member} requires a valid timestamp.`);
  return parsed.toISOString();
}

function durationMilliseconds(value: string, label: string): number {
  const match = /^(\d+)(ms|s|m)$/u.exec(value.trim());
  if (!match) throw new Error(`celld actor ${label} must use ms, s, or m.`);
  const amount = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < 1 || result > 3_600_000) throw new Error(`celld actor ${label} must be between 1ms and 1h.`);
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  throw new Error(`celld actor values must be JSON-serializable; received ${typeof value}.`);
}

export type { CelldActorConnectionTicketClaims } from './connection-ticket.js';
export { CelldActorConnectionTicketError, signCelldActorConnectionTicket, verifyCelldActorConnectionTicket } from './connection-ticket.js';
