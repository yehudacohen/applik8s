// typecast-file-boundary: Worker fetch payloads are decoded from untyped JSON and checked by the actor runtime protocol.
/** celld/Cloudflare-compatible authority for the Applik8s actor protocol. */
import { type CelldActorConnectionTicketClaims, verifyCelldActorConnectionTicket } from './connection-ticket.js';
import {
  type ApplicationActorTurnAuthority,
  normalizeApplicationActorTurnAuthority,
} from '@applik8s/applik8s/actor-authority-runtime';
import { validateApplicationAuthorizationReceipt, type ApplicationAuthorizationReceipt } from '@applik8s/core';

interface DurableObjectIdLike { toString(): string }
interface DurableObjectStubLike { fetch(request: Request): Promise<Response> }
interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}
interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  transaction<T>(closure: (transaction: DurableObjectStorageLike) => Promise<T>): Promise<T>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}
interface DurableObjectStateLike {
  readonly id: DurableObjectIdLike;
  readonly storage: DurableObjectStorageLike;
  acceptWebSocket(socket: ActorWebSocketLike, tags?: readonly string[]): void;
  getWebSockets(tag?: string): readonly ActorWebSocketLike[];
}

interface ActorWebSocketLike {
  readonly bufferedAmount?: number;
  send(value: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface ActorWebSocketPairLike { readonly 0: ActorWebSocketLike; readonly 1: ActorWebSocketLike }
interface ActorWebSocketPairConstructor { new(): ActorWebSocketPairLike }
type ActorFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CelldActorWorkerEnvironment {
  readonly APPLIK8S_ACTOR_CELLS: DurableObjectNamespaceLike;
  readonly APPLIK8S_ACTOR_AUTHORIZATION: string;
  readonly APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY?: string;
  readonly APPLIK8S_ACTOR_APPLICATION_ENDPOINT?: string;
  readonly APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION?: string;
}

interface ActorCellState { readonly revision: number; readonly stateVersion?: number; readonly value: object }
interface ActorLease {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly member: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly revision: number;
  readonly stateVersion: number;
}
interface ActorReceipt {
  readonly fingerprint: string;
  readonly result?: object;
  readonly effects?: readonly ActorOutboxEvent[];
  readonly receipt: {
    readonly operationId: string;
    readonly actor: string;
    readonly key: string;
    readonly member: string;
    readonly state: 'committed';
    readonly revision: number;
    readonly replayed: boolean;
  };
}
interface ActorOutboxEvent {
  readonly effectId: string;
  readonly operationId: string;
  readonly contract: { readonly id: string; readonly name: string; readonly version: string };
  readonly payload: object;
  readonly recordedAt: string;
  readonly partitionKey: string;
}
interface ActorBroadcastRecord {
  readonly member: string;
  readonly value: object;
  readonly receipt: {
    readonly broadcastId: string;
    readonly actor: string;
    readonly key: string;
    readonly member: string;
    readonly revision: number;
  };
}
interface ActorAlarm {
  readonly alarmId: string;
  readonly actor: string;
  readonly key: string;
  readonly member: string;
  readonly input: object;
  readonly scheduledAt: string;
  readonly idempotencyKey?: string;
  readonly authority: ApplicationActorTurnAuthority;
  readonly cancelled: boolean;
  readonly attempts: number;
}
interface ActorIdentity { readonly actor: string; readonly key: string }
interface ActorConnectionAttachment {
  readonly schemaVersion: 'applik8s.actorConnection/v1alpha1';
  readonly identity: ActorIdentity;
  readonly connection: {
    readonly id: string;
    readonly principal: { readonly id: string };
    readonly causalPrincipal: { readonly id: string };
    readonly authorizationReceipt: ApplicationActorTurnAuthority['authorizationReceipt'];
    readonly trustedContextDigest: string;
    readonly connectedAt: string;
    readonly leaseExpiresAt: string;
    readonly disconnectionReason?: 'closed' | 'transport-error' | 'lease-expired' | 'connection-admission-failed';
  };
  readonly connectMember: string;
  readonly disconnectMember: string;
  readonly disconnectInput: object;
  readonly protocolRevision: string;
}
interface ActorConnectionRecord extends ActorConnectionAttachment { readonly state: 'connected' | 'disconnecting' | 'disconnected' }
type ActorAlarmOperation =
  | { readonly kind: 'schedule'; readonly alarm: ActorAlarm }
  | { readonly kind: 'cancel'; readonly alarmId: string };

const stateKey = 'applik8s:state';
const leaseKey = 'applik8s:lease';
const identityKey = 'applik8s:identity';
const receiptPrefix = 'applik8s:receipt:';
const alarmPrefix = 'applik8s:alarm:';
const connectionPrefix = 'applik8s:connection:';
const connectionIndexKey = 'applik8s:connection-index';
const connectionTicketPrefix = 'applik8s:connection-ticket:';
const maximumRealtimeMessageBytes = 64 * 1024;
const maximumRealtimeBufferedBytes = 256 * 1024;

export default {
  async fetch(request: Request, environment: CelldActorWorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ready: true });
    const authorization = validateAuthorization(environment.APPLIK8S_ACTOR_AUTHORIZATION);
    const match = /^\/__applik8s\/v1\/actors\/([^/]+)\/([^/]+)(\/.*)$/u.exec(url.pathname);
    if (!match) return json({ error: 'not_found' }, 404);
    const actor = decodePath(match[1] ?? '');
    const key = decodePath(match[2] ?? '');
    if (!actor || !key) return json({ error: 'invalid_actor_identity' }, 400);
    let ticketClaims: CelldActorConnectionTicketClaims | undefined;
    const publicConnection = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      && url.pathname.endsWith('/connections')
      && url.searchParams.has('ticket');
    if (publicConnection) {
      const signingKey = environment.APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY;
      if (!signingKey) return json({ error: 'actor_connection_admission_unavailable' }, 503);
      try {
        ticketClaims = await verifyCelldActorConnectionTicket(url.searchParams.get('ticket') ?? '', signingKey);
      } catch {
        return json({ error: 'invalid_actor_connection_ticket' }, 403);
      }
      if (ticketClaims.actor !== actor || ticketClaims.key !== key) return json({ error: 'actor_connection_ticket_identity_mismatch' }, 403);
    } else if (!authorized(request, authorization)) {
      return json({ error: 'forbidden' }, 403);
    }
    const id = environment.APPLIK8S_ACTOR_CELLS.idFromName(`applik8s.actor.v1:${actor}:${key}`);
    const headers = new Headers(request.headers);
    headers.set('x-applik8s-actor', actor);
    headers.set('x-applik8s-actor-key', key);
    if (ticketClaims) {
      headers.set('authorization', `Bearer ${authorization}`);
      headers.set('x-applik8s-connection-ticket-claims', encodeJsonHeader(ticketClaims));
    }
    return environment.APPLIK8S_ACTOR_CELLS.get(id).fetch(new Request(request, { headers }));
  },
};

export class Applik8sActorCell {
  readonly #state: DurableObjectStateLike;
  readonly #environment: CelldActorWorkerEnvironment;
  readonly #fetch: ActorFetch;

  constructor(state: DurableObjectStateLike, environment: CelldActorWorkerEnvironment, request: ActorFetch = globalThis.fetch) {
    this.#state = state;
    this.#environment = environment;
    this.#fetch = request;
  }

  async fetch(request: Request): Promise<Response> {
    const authorization = validateAuthorization(this.#environment.APPLIK8S_ACTOR_AUTHORIZATION);
    if (!authorized(request, authorization)) return json({ error: 'forbidden' }, 403);
    const identity = requestIdentity(request);
    if (!identity) return json({ error: 'invalid_actor_identity' }, 400);
    await this.#ensureIdentity(identity);
    const pathname = new URL(request.url).pathname;
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && pathname.endsWith('/connections')) {
      try { return await this.#connect(identity, request); }
      catch (cause) { return json({ error: 'invalid_connection_request', message: cause instanceof Error ? cause.message : String(cause) }, 400); }
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await requestObject(request);
    if (!body) return json({ error: 'invalid_json_object' }, 400);
    try {
      if (pathname.endsWith('/turns:begin')) return this.#begin(identity, body);
      if (pathname.endsWith('/turns:renew')) return this.#renew(body);
      if (pathname.endsWith('/turns:commit')) return this.#commit(identity, body);
      if (pathname.endsWith('/turns:abort')) return this.#abort(body);
      if (pathname.endsWith('/effects:ack')) return this.#ackEffects(body);
      const cancel = /\/alarms\/([^/]+):cancel$/u.exec(pathname);
      if (cancel) return this.#cancelAlarm(identity, decodePath(cancel[1] ?? ''));
      const schedule = /\/alarms\/([^/]+)$/u.exec(pathname);
      if (schedule) return this.#scheduleAlarm(identity, decodePath(schedule[1] ?? ''), body);
      return json({ error: 'not_found' }, 404);
    } catch (cause) {
      return json({ error: 'invalid_request', message: cause instanceof Error ? cause.message : String(cause) }, 400);
    }
  }

  async alarm(): Promise<void> {
    const identity = await this.#state.storage.get<ActorIdentity>(identityKey);
    if (!identity) throw new Error('Actor alarm fired before actor identity was persisted.');
    const now = Date.now();
    let earliest = await this.#expireConnections(now);
    for (const id of await this.#alarmIndex()) {
      const key = `${alarmPrefix}${id}`;
      const alarm = await this.#state.storage.get<ActorAlarm>(key);
      if (!alarm || alarm.cancelled) {
        await this.#removeAlarm(id);
        continue;
      }
      const scheduled = Date.parse(alarm.scheduledAt);
      if (scheduled > now) {
        earliest = earliest === undefined ? scheduled : Math.min(earliest, scheduled);
        continue;
      }
      try {
        await this.#deliverAlarm(alarm);
        await this.#state.storage.transaction(async (transaction) => {
          await transaction.delete(key);
          const current = await transaction.get<string[]>('applik8s:alarm-index') ?? [];
          await transaction.put('applik8s:alarm-index', current.filter((entry) => entry !== id));
        });
      } catch (cause) {
        const attempts = alarm.attempts + 1;
        await this.#state.storage.put(key, { ...alarm, attempts });
        const retryAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
        earliest = earliest === undefined ? retryAt : Math.min(earliest, retryAt);
        console.error('Actor alarm delivery failed; retained for retry.', {
          actor: identity.actor,
          member: alarm.member,
          attempts,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    if (earliest === undefined) await this.#state.storage.deleteAlarm();
    else await this.#state.storage.setAlarm(earliest);
  }

  async #begin(identity: ActorIdentity, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const operationId = requiredString(body.operationId, 'operationId');
    const fingerprint = requiredString(body.fingerprint, 'fingerprint');
    const member = requiredString(body.member, 'member');
    const leaseMilliseconds = requiredPositiveInteger(body.leaseMilliseconds, 'leaseMilliseconds');
    if (leaseMilliseconds > 3_600_000) return json({ error: 'lease_too_long' }, 400);
    const admission = await this.#state.storage.transaction(async (transaction) => {
      const prior = await transaction.get<ActorReceipt>(`${receiptPrefix}${operationId}`);
      if (prior) return prior.fingerprint === fingerprint ? { prior } as const : { error: 'idempotency_fingerprint_conflict' } as const;
      const now = Date.now();
      const current = await transaction.get<ActorLease>(leaseKey);
      if (current && current.expiresAt > now) return { error: 'actor_turn_busy' } as const;
      const state = await transaction.get<ActorCellState>(stateKey);
      const lease: ActorLease = {
        operationId, fingerprint, member, token: crypto.randomUUID(), expiresAt: now + leaseMilliseconds,
        revision: state?.revision ?? 0,
        stateVersion: state ? state.stateVersion ?? 1 : 0,
      };
      await transaction.put(leaseKey, lease);
      return { lease, state } as const;
    });
    if ('error' in admission) return json({ error: admission.error }, 409);
    if ('prior' in admission) return json({ status: 'prior', ...(admission.prior.result ? { result: admission.prior.result } : {}), ...(admission.prior.effects?.length ? { effects: admission.prior.effects } : {}), receipt: admission.prior.receipt });
    return json({ status: 'acquired', lease: admission.lease.token, revision: admission.lease.revision, stateVersion: admission.lease.stateVersion, ...(admission.state ? { state: admission.state.value } : {}) });
  }

  async #renew(body: Readonly<Record<string, unknown>>): Promise<Response> {
    const operationId = requiredString(body.operationId, 'operationId');
    const token = requiredString(body.lease, 'lease');
    const leaseMilliseconds = requiredPositiveInteger(body.leaseMilliseconds, 'leaseMilliseconds');
    const current = await this.#state.storage.get<ActorLease>(leaseKey);
    if (!current || current.operationId !== operationId || current.token !== token || current.expiresAt <= Date.now()) {
      return json({ error: 'actor_lease_lost' }, 409);
    }
    await this.#state.storage.put(leaseKey, { ...current, expiresAt: Date.now() + leaseMilliseconds });
    return json({ renewed: true });
  }

  async #commit(identity: ActorIdentity, body: Readonly<Record<string, unknown>>): Promise<Response> {
    const operationId = requiredString(body.operationId, 'operationId');
    const fingerprint = requiredString(body.fingerprint, 'fingerprint');
    const token = requiredString(body.lease, 'lease');
    const expectedRevision = requiredNonnegativeInteger(body.expectedRevision, 'expectedRevision');
    const expectedStateVersion = requiredNonnegativeInteger(body.expectedStateVersion, 'expectedStateVersion');
    const stateVersion = requiredPositiveInteger(body.stateVersion, 'stateVersion');
    const state = requiredObject(body.state, 'state');
    const ephemeral = body.ephemeral === true;
    const result = body.result === undefined ? undefined : requiredObject(body.result, 'result');
    const broadcasts = parseActorBroadcasts(body.broadcasts, identity);
    const effects = parseActorOutboxEvents(body.effects, operationId);
    const alarmOperations = await parseActorAlarmOperations(body.alarms, identity);
    if (ephemeral && (effects.length > 0 || alarmOperations.length > 0)) {
      return json({ error: 'actor_ephemeral_durable_effect' }, 409);
    }
    const committed = await this.#state.storage.transaction(async (transaction) => {
      const prior = await transaction.get<ActorReceipt>(`${receiptPrefix}${operationId}`);
      if (prior) return prior.fingerprint === fingerprint ? { prior } as const : { error: 'idempotency_fingerprint_conflict' } as const;
      const lease = await transaction.get<ActorLease>(leaseKey);
      if (!lease || lease.operationId !== operationId || lease.token !== token || lease.fingerprint !== fingerprint || lease.expiresAt <= Date.now()) {
        return { error: 'actor_lease_lost' } as const;
      }
      const current = await transaction.get<ActorCellState>(stateKey);
      if ((current?.revision ?? 0) !== expectedRevision || lease.revision !== expectedRevision) return { error: 'actor_revision_conflict' } as const;
      if ((current ? current.stateVersion ?? 1 : 0) !== expectedStateVersion || lease.stateVersion !== expectedStateVersion) return { error: 'actor_state_version_conflict' } as const;
      const frameworkStateChanged = !current || (current.stateVersion ?? 1) !== stateVersion;
      if (ephemeral && !frameworkStateChanged && stableJson(current.value) !== stableJson(state)) {
        return { error: 'actor_ephemeral_state_mutation' } as const;
      }
      const revision = ephemeral && !frameworkStateChanged ? expectedRevision : expectedRevision + 1;
      const receipt: ActorReceipt = {
        fingerprint,
        ...(result ? { result } : {}),
        ...(effects.length > 0 ? { effects } : {}),
        receipt: { operationId, ...identity, member: lease.member, state: 'committed', revision, replayed: false },
      };
      if (!ephemeral || frameworkStateChanged) {
        await transaction.put(stateKey, { revision, stateVersion, value: state } satisfies ActorCellState);
      }
      await transaction.put(`${receiptPrefix}${operationId}`, receipt);
      if (broadcasts.length > 0) await transaction.put(`applik8s:broadcasts:${revision}:${operationId}`, broadcasts);
      if (alarmOperations.length > 0) {
        let index = await transaction.get<string[]>('applik8s:alarm-index') ?? [];
        for (const operation of alarmOperations) {
          if (operation.kind === 'schedule') {
            await transaction.put(`${alarmPrefix}${operation.alarm.alarmId}`, operation.alarm);
            if (!index.includes(operation.alarm.alarmId)) index = [...index, operation.alarm.alarmId];
          } else {
            await transaction.delete(`${alarmPrefix}${operation.alarmId}`);
            index = index.filter((entry) => entry !== operation.alarmId);
          }
        }
        await transaction.put('applik8s:alarm-index', index);
      }
      await transaction.delete(leaseKey);
      return { receipt } as const;
    });
    if ('error' in committed) return json({ error: committed.error }, 409);
    if (alarmOperations.length > 0) await this.#resetAlarmClock();
    const value = 'prior' in committed ? committed.prior : committed.receipt;
    if (!('prior' in committed) && broadcasts.length > 0) await this.#publishBroadcasts(broadcasts);
    return json({ ...(value.result ? { result: value.result } : {}), ...(value.effects?.length ? { effects: value.effects } : {}), receipt: value.receipt });
  }

  async #ackEffects(body: Readonly<Record<string, unknown>>): Promise<Response> {
    const operationId = requiredString(body.operationId, 'operationId');
    if (!Array.isArray(body.effectIds) || !body.effectIds.every((value) => typeof value === 'string' && value.length > 0)) {
      throw new TypeError('effectIds must be an array of non-empty strings.');
    }
    const acknowledged = new Set(body.effectIds as string[]);
    await this.#state.storage.transaction(async (transaction) => {
      const key = `${receiptPrefix}${operationId}`;
      const receipt = await transaction.get<ActorReceipt>(key);
      if (!receipt) throw new TypeError('Actor effect receipt does not exist.');
      const remaining = (receipt.effects ?? []).filter(({ effectId }) => !acknowledged.has(effectId));
      const { effects: _effects, ...stableReceipt } = receipt;
      await transaction.put(key, remaining.length > 0
        ? { ...stableReceipt, effects: remaining }
        : stableReceipt);
    });
    return json({ acknowledged: [...acknowledged].sort() });
  }

  async #abort(body: Readonly<Record<string, unknown>>): Promise<Response> {
    const operationId = requiredString(body.operationId, 'operationId');
    const token = requiredString(body.lease, 'lease');
    const current = await this.#state.storage.get<ActorLease>(leaseKey);
    if (!current) return json({ aborted: true });
    if (current.operationId !== operationId || current.token !== token) return json({ error: 'actor_lease_lost' }, 409);
    await this.#state.storage.delete(leaseKey);
    return json({ aborted: true });
  }

  async #scheduleAlarm(identity: ActorIdentity, member: string, body: Readonly<Record<string, unknown>>): Promise<Response> {
    if (!member) return json({ error: 'invalid_alarm_member' }, 400);
    const input = requiredObject(body.input, 'input');
    const scheduledAt = requiredString(body.scheduledAt, 'scheduledAt');
    const scheduled = Date.parse(scheduledAt);
    if (!Number.isFinite(scheduled)) return json({ error: 'invalid_scheduled_at' }, 400);
    const idempotencyKey = optionalString(body.idempotencyKey, 'idempotencyKey');
    const authority = requiredActorTurnAuthority(body.authority, 'authority');
    const alarmId = await semanticActorAlarmId(identity, member);
    const alarm: ActorAlarm = { alarmId, ...identity, member, input, scheduledAt: new Date(scheduled).toISOString(), ...(idempotencyKey ? { idempotencyKey } : {}), authority, cancelled: false, attempts: 0 };
    await this.#state.storage.transaction(async (transaction) => {
      await transaction.put(`${alarmPrefix}${alarmId}`, alarm);
      const index = await transaction.get<string[]>('applik8s:alarm-index') ?? [];
      if (!index.includes(alarmId)) await transaction.put('applik8s:alarm-index', [...index, alarmId]);
    });
    const existing = await this.#state.storage.getAlarm();
    if (existing === null || scheduled < existing) await this.#state.storage.setAlarm(scheduled);
    return json({ alarmId, ...identity, member, scheduledAt: alarm.scheduledAt, state: 'scheduled' });
  }

  async #cancelAlarm(identity: ActorIdentity, member: string): Promise<Response> {
    let cancelled: ActorAlarm | undefined;
    for (const id of await this.#alarmIndex()) {
      const key = `${alarmPrefix}${id}`;
      const alarm = await this.#state.storage.get<ActorAlarm>(key);
      if (!alarm || alarm.member !== member || alarm.cancelled) continue;
      cancelled = { ...alarm, cancelled: true };
      await this.#state.storage.put(key, cancelled);
    }
    await this.#resetAlarmClock();
    return json(cancelled
      ? { alarmId: cancelled.alarmId, ...identity, member, scheduledAt: cancelled.scheduledAt, state: 'cancelled' }
      : { alarmId: `absent_${await digest(`${identity.actor}\0${identity.key}\0${member}`)}`, ...identity, member, scheduledAt: new Date(0).toISOString(), state: 'cancelled' });
  }

  async #connect(identity: ActorIdentity, request: Request): Promise<Response> {
    const endpoint = this.#environment.APPLIK8S_ACTOR_APPLICATION_ENDPOINT;
    const authorization = this.#environment.APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION;
    if (!endpoint || !authorization) return json({ error: 'actor_realtime_callback_unavailable' }, 503);
    const url = new URL(request.url);
    const claims = optionalConnectionTicketClaims(request);
    if (claims) {
      if (claims.actor !== identity.actor || claims.key !== identity.key || Date.parse(claims.expiresAt) <= Date.now()) {
        throw new Error('Actor connection ticket is expired or belongs to another actor identity.');
      }
      const consumed = await this.#state.storage.transaction(async (transaction) => {
        const key = `${connectionTicketPrefix}${claims.nonce}`;
        if (await transaction.get(key)) return false;
        await transaction.put(key, { connectionId: claims.connectionId, consumedAt: new Date().toISOString() });
        return true;
      });
      if (!consumed) return json({ error: 'actor_connection_ticket_replayed' }, 409);
    }
    const connectMember = claims?.connect.member ?? requiredQuery(url, 'connect');
    const disconnectMember = claims?.disconnect.member ?? requiredQuery(url, 'disconnect');
    const protocolRevision = claims?.protocolRevision ?? requiredQuery(url, 'protocolRevision');
    const connectionId = claims?.connectionId ?? requiredHeader(request, 'x-applik8s-connection-id');
    const causalPrincipalId = claims?.causalPrincipalId ?? requiredHeader(request, 'x-applik8s-causal-principal-id');
    const authorizationReceipt = claims?.authorizationReceipt ?? requiredActorAuthorizationReceipt(
      decodeJsonHeader(request, 'x-applik8s-authorization-receipt'),
      'actor connection authorization receipt',
    );
    const trustedContextDigest = claims?.trustedContextDigest ?? requiredHeader(request, 'x-applik8s-trusted-context-digest');
    const leaseMilliseconds = claims?.leaseMilliseconds ?? boundedConnectionLease(url.searchParams.get('lease'));
    const connectedAt = new Date().toISOString();
    const attachment: ActorConnectionAttachment = {
      schemaVersion: 'applik8s.actorConnection/v1alpha1',
      identity,
      connection: {
        id: connectionId,
        principal: { id: authorizationReceipt.principal.id },
        causalPrincipal: { id: causalPrincipalId },
        authorizationReceipt,
        trustedContextDigest,
        connectedAt,
        leaseExpiresAt: new Date(Date.parse(connectedAt) + leaseMilliseconds).toISOString(),
      },
      connectMember,
      disconnectMember,
      disconnectInput: claims?.disconnect.input ?? decodeJsonHeader(request, 'x-applik8s-disconnect-input'),
      protocolRevision,
    };
    const connectInput = claims?.connect.input ?? decodeJsonHeader(request, 'x-applik8s-connect-input');
    const existing = await this.#state.storage.get<ActorConnectionRecord>(`${connectionPrefix}${connectionId}`);
    if (existing?.state === 'connected') return json({ error: 'connection_identity_active' }, 409);
    await this.#recordConnected(attachment);
    try {
      await this.#deliverRealtime({ kind: 'connection', member: connectMember, input: connectInput, attachment, idempotencyKey: `connect:${connectionId}` });
      const Pair = Reflect.get(globalThis, 'WebSocketPair') as ActorWebSocketPairConstructor | undefined;
      if (!Pair) throw new Error('celld runtime does not expose WebSocketPair.');
      const pair = new Pair();
      pair[0].serializeAttachment(attachment);
      this.#state.acceptWebSocket(pair[0], [`connection:${connectionId}`]);
      await this.#resetAlarmClock();
      return webSocketUpgradeResponse(pair[1]);
    } catch (cause) {
      await this.#disconnect(attachment, 'connection-admission-failed').catch(() => undefined);
      await this.#resetAlarmClock().catch(() => undefined);
      return json({ error: 'actor_connection_admission_failed', message: cause instanceof Error ? cause.message : String(cause) }, 503);
    }
  }

  async webSocketMessage(socket: ActorWebSocketLike, message: string | ArrayBuffer): Promise<void> {
    const attachment = actorConnectionAttachment(socket.deserializeAttachment());
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (new TextEncoder().encode(text).byteLength > maximumRealtimeMessageBytes) {
      socket.close(1009, 'actor message exceeds the configured payload limit');
      return;
    }
    let envelope: Readonly<Record<string, unknown>>;
    try {
      const parsed: unknown = JSON.parse(text);
      envelope = requiredObject(parsed, 'connection message') as Readonly<Record<string, unknown>>;
    } catch {
      socket.close(1007, 'actor message must be one JSON object');
      return;
    }
    const member = requiredString(envelope.member, 'connection message member');
    if (envelope.type === 'close') {
      if (member !== attachment.disconnectMember) {
        socket.close(1008, 'actor disconnection member does not match admission');
        return;
      }
      const closing: ActorConnectionAttachment = {
        ...attachment,
        disconnectInput: requiredObject(envelope.input, 'disconnection input'),
      };
      socket.serializeAttachment(closing);
      try {
        await this.#disconnect(closing, 'closed');
        socket.close(1000, 'actor connection closed');
      } catch (cause) {
        socket.send(JSON.stringify({ type: 'error', code: 'actor_disconnection_failed', message: cause instanceof Error ? cause.message : String(cause) }));
      }
      return;
    }
    const messageId = requiredString(envelope.messageId, 'connection message messageId');
    const input = requiredObject(envelope.input, 'connection message input');
    const leaseMilliseconds = Math.max(1, Date.parse(attachment.connection.leaseExpiresAt) - Date.parse(attachment.connection.connectedAt));
    const refreshed: ActorConnectionAttachment = {
      ...attachment,
      connection: { ...attachment.connection, leaseExpiresAt: new Date(Date.now() + leaseMilliseconds).toISOString() },
    };
    socket.serializeAttachment(refreshed);
    await this.#recordConnected(refreshed);
    await this.#resetAlarmClock();
    try {
      const receipt = await this.#deliverRealtime({
        kind: 'connectionMessage', member, input, attachment: refreshed,
        idempotencyKey: `connection-message:${attachment.connection.id}:${messageId}`,
      });
      socket.send(JSON.stringify({ type: 'delivery', messageId, receipt }));
    } catch (cause) {
      socket.send(JSON.stringify({ type: 'error', messageId, code: 'actor_connection_message_failed', message: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  async webSocketClose(socket: ActorWebSocketLike): Promise<void> {
    await this.#disconnect(actorConnectionAttachment(socket.deserializeAttachment()), 'closed');
  }

  async webSocketError(socket: ActorWebSocketLike): Promise<void> {
    await this.#disconnect(actorConnectionAttachment(socket.deserializeAttachment()), 'transport-error');
  }

  async #recordConnected(attachment: ActorConnectionAttachment): Promise<void> {
    await this.#state.storage.transaction(async (transaction) => {
      await transaction.put(`${connectionPrefix}${attachment.connection.id}`, { ...attachment, state: 'connected' } satisfies ActorConnectionRecord);
      const index = await transaction.get<string[]>(connectionIndexKey) ?? [];
      if (!index.includes(attachment.connection.id)) await transaction.put(connectionIndexKey, [...index, attachment.connection.id].sort());
    });
  }

  async #disconnect(
    attachment: ActorConnectionAttachment,
    disconnectionReason: 'closed' | 'transport-error' | 'lease-expired' | 'connection-admission-failed',
  ): Promise<void> {
    const disconnectedAttachment: ActorConnectionAttachment = {
      ...attachment,
      connection: { ...attachment.connection, disconnectionReason },
    };
    const shouldDeliver = await this.#state.storage.transaction(async (transaction) => {
      const key = `${connectionPrefix}${attachment.connection.id}`;
      const current = await transaction.get<ActorConnectionRecord>(key);
      if (!current || current.state === 'disconnected') return false;
      await transaction.put(key, { ...disconnectedAttachment, state: 'disconnecting' } satisfies ActorConnectionRecord);
      return true;
    });
    if (!shouldDeliver) return;
    await this.#deliverRealtime({
      kind: 'disconnection', member: attachment.disconnectMember,
      input: attachment.disconnectInput, attachment: disconnectedAttachment,
      idempotencyKey: `disconnect:${attachment.connection.id}`,
    });
    await this.#state.storage.transaction(async (transaction) => {
      await transaction.put(`${connectionPrefix}${attachment.connection.id}`, { ...disconnectedAttachment, state: 'disconnected' } satisfies ActorConnectionRecord);
      const index = await transaction.get<string[]>(connectionIndexKey) ?? [];
      await transaction.put(connectionIndexKey, index.filter((id) => id !== attachment.connection.id));
    });
    await this.#resetAlarmClock();
  }

  async #deliverRealtime(options: {
    readonly kind: 'connection' | 'connectionMessage' | 'disconnection';
    readonly member: string;
    readonly input: object;
    readonly attachment: ActorConnectionAttachment;
    readonly idempotencyKey: string;
  }): Promise<object> {
    const endpoint = this.#environment.APPLIK8S_ACTOR_APPLICATION_ENDPOINT;
    const authorization = this.#environment.APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION;
    if (!endpoint || !authorization) throw new Error('Actor application realtime callback endpoint is not configured.');
    const response = await this.#fetch(new URL('/__applik8s/v1/internal/actors/realtime', endpoint), {
      method: 'POST',
      headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: options.kind,
        actor: options.attachment.identity.actor,
        key: options.attachment.identity.key,
        member: options.member,
        input: options.input,
        connection: options.attachment.connection,
        idempotencyKey: options.idempotencyKey,
      }),
    });
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !value || typeof value !== 'object') throw new Error(`Actor realtime callback failed with HTTP ${response.status}.`);
    return requiredObject(Reflect.get(value, 'receipt'), 'actor realtime callback receipt');
  }

  async #publishBroadcasts(records: readonly ActorBroadcastRecord[]): Promise<void> {
    for (const record of records) {
      const encoded = JSON.stringify({ type: 'broadcast', member: record.member, value: record.value, receipt: record.receipt });
      if (new TextEncoder().encode(encoded).byteLength > maximumRealtimeMessageBytes) throw new Error(`Actor broadcast ${record.member} exceeds the configured payload limit.`);
      for (const socket of this.#state.getWebSockets()) {
        if ((socket.bufferedAmount ?? 0) > maximumRealtimeBufferedBytes) {
          socket.close(1013, 'actor realtime consumer is not keeping up');
          continue;
        }
        try { socket.send(encoded); } catch { socket.close(1011, 'actor broadcast delivery failed'); }
      }
    }
  }

  async #expireConnections(now: number): Promise<number | undefined> {
    let earliest: number | undefined;
    const index = await this.#state.storage.get<string[]>(connectionIndexKey) ?? [];
    for (const connectionId of index) {
      const record = await this.#state.storage.get<ActorConnectionRecord>(`${connectionPrefix}${connectionId}`);
      if (!record || record.state === 'disconnected') continue;
      const expiresAt = Date.parse(record.connection.leaseExpiresAt);
      if (expiresAt > now) {
        earliest = earliest === undefined ? expiresAt : Math.min(earliest, expiresAt);
        continue;
      }
      const socket = this.#state.getWebSockets(`connection:${connectionId}`)[0];
      socket?.close(1001, 'actor connection lease expired');
      await this.#disconnect(record, 'lease-expired');
    }
    return earliest;
  }

  async #ensureIdentity(identity: ActorIdentity): Promise<void> {
    const existing = await this.#state.storage.get<ActorIdentity>(identityKey);
    if (existing && (existing.actor !== identity.actor || existing.key !== identity.key)) throw new Error('celld Durable Object identity collision detected.');
    if (!existing) await this.#state.storage.put(identityKey, identity);
  }
  async #alarmIndex(): Promise<string[]> { return await this.#state.storage.get<string[]>('applik8s:alarm-index') ?? []; }
  async #removeAlarm(id: string): Promise<void> {
    const current = await this.#alarmIndex();
    await this.#state.storage.put('applik8s:alarm-index', current.filter((entry) => entry !== id));
  }
  async #resetAlarmClock(): Promise<void> {
    let earliest: number | undefined;
    for (const connectionId of await this.#state.storage.get<string[]>(connectionIndexKey) ?? []) {
      const connection = await this.#state.storage.get<ActorConnectionRecord>(`${connectionPrefix}${connectionId}`);
      if (!connection || connection.state === 'disconnected') continue;
      if (connection.state === 'disconnecting') {
        const retryAt = Date.now() + 1_000;
        earliest = earliest === undefined ? retryAt : Math.min(earliest, retryAt);
        continue;
      }
      const expiresAt = Date.parse(connection.connection.leaseExpiresAt);
      if (Number.isFinite(expiresAt)) earliest = earliest === undefined ? expiresAt : Math.min(earliest, expiresAt);
    }
    for (const id of await this.#alarmIndex()) {
      const alarm = await this.#state.storage.get<ActorAlarm>(`${alarmPrefix}${id}`);
      if (!alarm || alarm.cancelled) continue;
      const scheduled = Date.parse(alarm.scheduledAt);
      earliest = earliest === undefined ? scheduled : Math.min(earliest, scheduled);
    }
    if (earliest === undefined) await this.#state.storage.deleteAlarm();
    else await this.#state.storage.setAlarm(earliest);
  }
  async #deliverAlarm(alarm: ActorAlarm): Promise<void> {
    const endpoint = this.#environment.APPLIK8S_ACTOR_APPLICATION_ENDPOINT;
    const authorization = this.#environment.APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION;
    if (!endpoint || !authorization) throw new Error('Actor application alarm callback endpoint is not configured.');
    const response = await fetch(new URL('/__applik8s/v1/internal/actors/alarms', endpoint), {
      method: 'POST', headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' }, body: JSON.stringify(alarm),
    });
    if (!response.ok) throw new Error(`Actor alarm callback failed with HTTP ${response.status}.`);
  }
}

function requestIdentity(request: Request): ActorIdentity | undefined {
  const actor = request.headers.get('x-applik8s-actor')?.trim();
  const key = request.headers.get('x-applik8s-actor-key')?.trim();
  return actor && key ? { actor, key } : undefined;
}
function validateAuthorization(value: string): string {
  if (typeof value !== 'string' || value.length < 32) throw new Error('APPLIK8S_ACTOR_AUTHORIZATION must contain at least 32 characters.');
  return value;
}
function authorized(request: Request, expected: string): boolean { return request.headers.get('authorization') === `Bearer ${expected}`; }
async function requestObject(request: Request): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
  } catch { return undefined; }
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined { return value === undefined ? undefined : requiredString(value, label); }
function requiredObject(value: unknown, label: string): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}
function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return Number(value);
}
function requiredNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} must be a nonnegative safe integer.`);
  return Number(value);
}

function parseActorOutboxEvents(value: unknown, operationId: string): readonly ActorOutboxEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('effects must be an array.');
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    const event = requiredObject(candidate, `effects[${index}]`) as Readonly<Record<string, unknown>>;
    const effectId = requiredString(event.effectId, `effects[${index}].effectId`);
    if (seen.has(effectId)) throw new TypeError(`effects[${index}].effectId is duplicated.`);
    seen.add(effectId);
    if (requiredString(event.operationId, `effects[${index}].operationId`) !== operationId) {
      throw new TypeError(`effects[${index}].operationId does not match the committed turn.`);
    }
    const contract = requiredObject(event.contract, `effects[${index}].contract`) as Readonly<Record<string, unknown>>;
    const recordedAt = requiredString(event.recordedAt, `effects[${index}].recordedAt`);
    if (!Number.isFinite(Date.parse(recordedAt))) throw new TypeError(`effects[${index}].recordedAt is invalid.`);
    return {
      effectId,
      operationId,
      contract: {
        id: requiredString(contract.id, `effects[${index}].contract.id`),
        name: requiredString(contract.name, `effects[${index}].contract.name`),
        version: requiredString(contract.version, `effects[${index}].contract.version`),
      },
      payload: requiredObject(event.payload, `effects[${index}].payload`),
      recordedAt,
      partitionKey: requiredString(event.partitionKey, `effects[${index}].partitionKey`),
    };
  });
}
function parseActorBroadcasts(value: unknown, identity: ActorIdentity): readonly ActorBroadcastRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('broadcasts must be an array.');
  return value.map((candidate, index) => {
    const record = requiredObject(candidate, `broadcasts[${index}]`) as Readonly<Record<string, unknown>>;
    const member = requiredString(record.member, `broadcasts[${index}].member`);
    const receipt = requiredObject(record.receipt, `broadcasts[${index}].receipt`) as Readonly<Record<string, unknown>>;
    if (requiredString(receipt.actor, `broadcasts[${index}].receipt.actor`) !== identity.actor
      || requiredString(receipt.key, `broadcasts[${index}].receipt.key`) !== identity.key
      || requiredString(receipt.member, `broadcasts[${index}].receipt.member`) !== member) {
      throw new TypeError(`broadcasts[${index}] receipt does not match the actor identity.`);
    }
    return {
      member,
      value: requiredObject(record.value, `broadcasts[${index}].value`),
      receipt: {
        broadcastId: requiredString(receipt.broadcastId, `broadcasts[${index}].receipt.broadcastId`),
        actor: identity.actor,
        key: identity.key,
        member,
        revision: requiredNonnegativeInteger(receipt.revision, `broadcasts[${index}].receipt.revision`),
      },
    };
  });
}
function requiredQuery(url: URL, name: string): string { return requiredString(url.searchParams.get(name), name); }
function requiredHeader(request: Request, name: string): string { return requiredString(request.headers.get(name), name); }
function optionalConnectionTicketClaims(request: Request): CelldActorConnectionTicketClaims | undefined {
  const encoded = request.headers.get('x-applik8s-connection-ticket-claims');
  if (!encoded) return undefined;
  return decodeJsonValue(encoded, 'x-applik8s-connection-ticket-claims') as unknown as CelldActorConnectionTicketClaims;
}
function decodeJsonHeader(request: Request, name: string): object {
  const encoded = requiredHeader(request, name);
  return decodeJsonValue(encoded, name);
}
function decodeJsonValue(encoded: string, name: string): object {
  if (encoded.length > 32 * 1024) throw new TypeError(`${name} exceeds the configured size limit.`);
  try {
    const standard = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = standard.padEnd(standard.length + ((4 - standard.length % 4) % 4), '=');
    return requiredObject(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0)))), name);
  } catch (cause) {
    throw new TypeError(`${name} must contain one base64url-encoded JSON object.`, { cause });
  }
}
function encodeJsonHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function boundedConnectionLease(value: string | null): number {
  const match = /^(\d+)(ms|s|m)$/u.exec(value ?? '60s');
  if (!match) throw new TypeError('Actor connection lease must use ms, s, or m.');
  const quantity = Number(match[1]);
  const milliseconds = quantity * (match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 5_000 || milliseconds > 300_000) throw new TypeError('Actor connection lease must be from 5s through 5m.');
  return milliseconds;
}
function actorConnectionAttachment(value: unknown): ActorConnectionAttachment {
  const attachment = requiredObject(value, 'actor WebSocket attachment') as unknown as ActorConnectionAttachment;
  if (attachment.schemaVersion !== 'applik8s.actorConnection/v1alpha1' || !attachment.identity?.actor || !attachment.identity.key
    || !attachment.connection?.id || !attachment.connectMember || !attachment.disconnectMember || !attachment.protocolRevision) {
    throw new TypeError('Actor WebSocket attachment is incomplete or incompatible.');
  }
  return attachment;
}
function webSocketUpgradeResponse(socket: ActorWebSocketLike): Response {
  try {
    return new Response(null, { status: 101, webSocket: socket } as ResponseInit);
  } catch {
    // Bun/Node test implementations reject status 101 even though workerd and
    // celld accept the Cloudflare response extension.
    const response = new Response(null, { status: 200 });
    Object.defineProperties(response, { status: { value: 101 }, webSocket: { value: socket } });
    return response;
  }
}
function decodePath(value: string): string { try { return decodeURIComponent(value); } catch { return ''; } }
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((entry) => entry.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function semanticActorAlarmId(identity: ActorIdentity, member: string): Promise<string> {
  return `alarm_${await digest(`${identity.actor}\u0000${identity.key}\u0000${member}`)}`;
}

async function parseActorAlarmOperations(value: unknown, identity: ActorIdentity): Promise<readonly ActorAlarmOperation[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('alarms must be an array.');
  const operations: ActorAlarmOperation[] = [];
  for (const [index, candidate] of value.entries()) {
    const operation = requiredObject(candidate, `alarms[${index}]`) as Readonly<Record<string, unknown>>;
    const kind = requiredString(operation.kind, `alarms[${index}].kind`);
    const member = requiredString(operation.member, `alarms[${index}].member`);
    const alarmId = requiredString(operation.alarmId, `alarms[${index}].alarmId`);
    if (alarmId !== await semanticActorAlarmId(identity, member)) throw new TypeError(`alarms[${index}] has an invalid semantic identity.`);
    if (kind === 'cancel') {
      operations.push({ kind, alarmId });
      continue;
    }
    if (kind !== 'schedule') throw new TypeError(`alarms[${index}].kind must be schedule or cancel.`);
    const scheduledAt = requiredString(operation.scheduledAt, `alarms[${index}].scheduledAt`);
    const scheduled = Date.parse(scheduledAt);
    if (!Number.isFinite(scheduled)) throw new TypeError(`alarms[${index}].scheduledAt is invalid.`);
    const input = requiredObject(operation.input, `alarms[${index}].input`);
    const idempotencyKey = optionalString(operation.idempotencyKey, `alarms[${index}].idempotencyKey`);
    const authority = requiredActorTurnAuthority(operation.authority, `alarms[${index}].authority`);
    operations.push({
      kind,
      alarm: {
        alarmId,
        ...identity,
        member,
        input,
        scheduledAt: new Date(scheduled).toISOString(),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        authority,
        cancelled: false,
        attempts: 0,
      },
    });
  }
  return operations;
}

function requiredActorTurnAuthority(value: unknown, label: string): ApplicationActorTurnAuthority {
  const authority = requiredObject(value, label) as Readonly<Record<string, unknown>>;
  const principal = requiredObject(authority.principal, `${label}.principal`) as Readonly<Record<string, unknown>>;
  const causalPrincipal = requiredObject(authority.causalPrincipal, `${label}.causalPrincipal`) as Readonly<Record<string, unknown>>;
  const receipt = requiredObject(authority.authorizationReceipt, `${label}.authorizationReceipt`) as Readonly<Record<string, unknown>>;
  requiredString(principal.id, `${label}.principal.id`);
  requiredString(causalPrincipal.id, `${label}.causalPrincipal.id`);
  requiredString(receipt.id, `${label}.authorizationReceipt.id`);
  requiredString(receipt.authorityRevision, `${label}.authorizationReceipt.authorityRevision`);
  requiredString(receipt.operationId, `${label}.authorizationReceipt.operationId`);
  requiredString(authority.trustedContextDigest, `${label}.trustedContextDigest`);
  return normalizeApplicationActorTurnAuthority(
    structuredClone(authority) as unknown as ApplicationActorTurnAuthority,
  );
}

function requiredActorAuthorizationReceipt(value: unknown, label: string): ApplicationAuthorizationReceipt {
  const receipt = requiredObject(value, label) as unknown as ApplicationAuthorizationReceipt;
  const diagnostics = validateApplicationAuthorizationReceipt(receipt);
  if (diagnostics.length > 0) {
    throw new TypeError(`${label} is invalid: ${diagnostics.map(({ message }) => message).join('; ')}`);
  }
  return structuredClone(receipt);
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
