// typecast-file-boundary: Test fixtures intentionally exercise untyped Celld storage and worker request boundaries.
import { createHash } from 'node:crypto';
import { actor, actorState, app, event, executeApplicationActorRealtime, installApplicationActorInvocationAuthorityResolver, installApplicationActorRuntimeResolver, type, withApplicationActorTurnAuthority, type ApplicationActorTurnAuthority, type ApplicationAuthorizationReceipt } from '@applik8s/applik8s';
import { afterEach, describe, expect, it } from 'vitest';
import { createCelldApplicationActorRuntime, signCelldActorConnectionTicket, verifyCelldActorConnectionTicket } from '../src/index.js';
import worker, { Applik8sActorCell, type CelldActorWorkerEnvironment } from '../src/worker.js';

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarmTime: number | null = null;
  transactionTail: Promise<void> = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<boolean> { return this.values.delete(key); }
  async transaction<T>(closure: (transaction: MemoryStorage) => Promise<T>): Promise<T> {
    const prior = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await closure(this); } finally { release(); }
  }
  async getAlarm(): Promise<number | null> { return this.alarmTime; }
  async setAlarm(value: number | Date): Promise<void> { this.alarmTime = value instanceof Date ? value.getTime() : value; }
  async deleteAlarm(): Promise<void> { this.alarmTime = null; }
}

class MemoryWebSocket {
  attachment: unknown;
  readonly sent: string[] = [];
  readonly closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
  bufferedAmount = 0;
  send(value: string | ArrayBuffer): void { this.sent.push(typeof value === 'string' ? value : new TextDecoder().decode(value)); }
  close(code?: number, reason?: string): void { this.closes.push({ ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) }); }
  serializeAttachment(value: unknown): void { this.attachment = structuredClone(value); }
  deserializeAttachment(): unknown { return structuredClone(this.attachment); }
}

class MemoryWebSocketPair {
  readonly 0 = new MemoryWebSocket();
  readonly 1 = new MemoryWebSocket();
}

function authority() {
  const authorization = 'test-actor-authority-token-which-is-long-enough';
  const connectionSigningKey = 'test-actor-connection-signing-key-which-is-long-enough';
  const applicationAuthorization = 'test-application-callback-token-long-enough';
  let applicationFetch: typeof fetch = async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 });
  const cells = new Map<string, { cell: Applik8sActorCell; storage: MemoryStorage; sockets: Array<{ readonly socket: MemoryWebSocket; readonly tags: readonly string[] }> }>();
  let environment: CelldActorWorkerEnvironment;
  const namespace = {
    idFromName(name: string) { return { toString: () => name }; },
    get(id: { toString(): string }) {
      const name = id.toString();
      let found = cells.get(name);
      if (!found) {
        const storage = new MemoryStorage();
        const sockets: Array<{ readonly socket: MemoryWebSocket; readonly tags: readonly string[] }> = [];
        const state = {
          id, storage,
          acceptWebSocket(socket: MemoryWebSocket, tags: readonly string[] = []) { sockets.push({ socket, tags }); },
          getWebSockets(tag?: string) { return sockets.filter((entry) => !tag || entry.tags.includes(tag)).map(({ socket }) => socket); },
        };
        found = { storage, sockets, cell: new Applik8sActorCell(state as never, environment, (...args) => applicationFetch(...args)) };
        cells.set(name, found);
      }
      return { fetch: (request: Request) => found!.cell.fetch(request) };
    },
  };
  environment = {
    APPLIK8S_ACTOR_CELLS: namespace,
    APPLIK8S_ACTOR_AUTHORIZATION: authorization,
    APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY: connectionSigningKey,
    APPLIK8S_ACTOR_APPLICATION_ENDPOINT: 'http://application.test/',
    APPLIK8S_ACTOR_APPLICATION_AUTHORIZATION: applicationAuthorization,
  };
  const fetch = (input: string | URL | Request, init?: RequestInit) => worker.fetch(new Request(input, init), environment);
  return {
    authorization, applicationAuthorization, connectionSigningKey, cells, fetch,
    setApplicationFetch(value: typeof fetch) { applicationFetch = value; },
  };
}

function turnAuthority(
  application: string,
  actorId: string,
  member: string,
  options: { readonly key?: string; readonly input?: object } = {},
): ApplicationActorTurnAuthority & { readonly authorizationReceipt: ApplicationAuthorizationReceipt } {
  const operationId = `applik8s://actors/${actorId}/operations/${member}` as const;
  const key = options.key ?? 'one';
  const input = options.input ?? { agent: 'browser' };
  return {
    principal: { id: 'principal:test' },
    causalPrincipal: { id: 'principal:test' },
    trustedContextDigest: 'sha256:test-context',
    authorizationReceipt: {
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
      id: `receipt:${actorId}:${member}`,
      application,
      operationId,
      operationVersion: 'v1',
      catalogRevision: 'sha256:test-catalog',
      authorityRevision: 'sha256:test-authority',
      principal: {
        id: 'principal:test',
        identity: { id: 'identity:test', kind: 'human', issuer: 'test', subject: 'test' },
        kind: 'human',
        authenticationMethod: 'test',
        audience: ['test'],
        trustedContextDigest: 'sha256:test-context',
        catalogRevision: 'sha256:test-catalog',
        authorityRevision: 'sha256:test-authority',
        admittedAt: new Date(0).toISOString(),
      },
      trustedContextDigest: 'sha256:test-context',
      matchedPermissionIds: [],
      matchedGrantIds: [],
      inputDigest: testInputDigest(input),
      target: { kind: 'target', model: actorId, identity: { key } },
      scopeEvidence: [],
      audience: 'test',
      transport: member === 'wake' ? 'control-plane' : 'direct',
      admittedAt: new Date(0).toISOString(),
    },
  };
}

function realtimeAdmission(
  application: string,
  actorId: string,
  admission: Parameters<typeof executeApplicationActorRealtime>[1],
): Parameters<typeof executeApplicationActorRealtime>[1] {
  const authority = turnAuthority(application, actorId, admission.member, { key: admission.key, input: admission.input });
  return {
    ...admission,
    connection: {
      ...admission.connection,
      principal: authority.principal,
      authorizationReceipt: authority.authorizationReceipt,
      trustedContextDigest: authority.trustedContextDigest,
    },
  };
}

function testInputDigest(value: unknown): string {
  const canonical = (candidate: unknown): string => {
    if (candidate === undefined) return 'null';
    if (candidate === null || typeof candidate !== 'object') return JSON.stringify(candidate);
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(',')}]`;
    return `{${Object.entries(candidate)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  };
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

const disposers: Array<() => void> = [];
const originalWebSocketPair = Reflect.get(globalThis, 'WebSocketPair');
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  if (originalWebSocketPair === undefined) Reflect.deleteProperty(globalThis, 'WebSocketPair');
  else Reflect.set(globalThis, 'WebSocketPair', originalWebSocketPair);
});

describe('celld actor runtime', () => {
  it('admits one short-lived signed public connection without disclosing the provider bearer', async () => {
    Reflect.set(globalThis, 'WebSocketPair', MemoryWebSocketPair);
    const service = authority();
    const Workspace = app('celld-ticket-fixture').actor('celld-ticket.v1', {
      key: type('string'),
      state: type({ title: 'string' }),
      protocol: {
        connect: actor.connection(type({ agent: 'string' })),
        disconnect: actor.disconnection(type({ agent: 'string' })),
      },
    });
    Workspace.on.initialize(() => ({ title: 'Untitled' }));
    Workspace.on.connect(() => undefined);
    Workspace.on.disconnect(() => undefined);
    const connectionAuthority = turnAuthority('celld-ticket-fixture', 'celld-ticket.v1', 'connect');
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    service.setApplicationFetch(async (input, init) => {
      const admission = await new Request(input, init).json() as Parameters<typeof executeApplicationActorRealtime>[1];
      const receipt = await executeApplicationActorRealtime(Workspace as never, admission);
      return new Response(JSON.stringify({ accepted: true, receipt }), { status: 202, headers: { 'content-type': 'application/json' } });
    });
    const issuedAt = new Date();
    const claims = {
      schemaVersion: 'applik8s.actorConnectionTicket/v1alpha1' as const,
      actor: 'celld-ticket.v1', key: 'one', connectionId: 'ticket-connection-1',
      connect: { member: 'connect', input: { agent: 'browser' } },
      disconnect: { member: 'disconnect', input: { agent: 'browser' } },
      protocolRevision: 'sha256:protocol', causalPrincipalId: 'human-1',
      authorizationReceipt: connectionAuthority.authorizationReceipt,
      trustedContextDigest: connectionAuthority.trustedContextDigest,
      leaseMilliseconds: 60_000, nonce: 'nonce-1', issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
    };
    const ticket = await signCelldActorConnectionTicket(claims, service.connectionSigningKey);
    await expect(verifyCelldActorConnectionTicket(ticket, service.connectionSigningKey)).resolves.toEqual(claims);
    await expect(signCelldActorConnectionTicket({
      ...claims,
      authorizationReceipt: {
        ...claims.authorizationReceipt,
        operationId: 'applik8s://actors/celld-ticket.v1/operations/disconnect',
      },
    }, service.connectionSigningKey)).rejects.toThrow(/does not match its actor, key, and member/u);
    const request = () => new Request(`http://celld.test/__applik8s/v1/actors/celld-ticket.v1/one/connections?ticket=${encodeURIComponent(ticket)}`, {
      headers: { upgrade: 'websocket' },
    });
    await expect(service.fetch(request())).resolves.toMatchObject({ status: 101 });
    await expect(service.fetch(request())).resolves.toMatchObject({ status: 409 });
    expect(ticket).not.toContain(service.authorization);
  });

  it('executes realtime callbacks against celld while preventing ephemeral durable mutation', async () => {
    const service = authority();
    const Workspace = app('celld-realtime-fixture').actor('celld-realtime.v1', {
      key: type('string'), state: type({ title: 'string' }),
      protocol: {
        connect: actor.connection(type({ agent: 'string' })),
        cursor: actor.connectionMessage(type({ position: 'number.integer >= 0', mutate: 'boolean' })),
        cursorPublished: actor.broadcast(type({ principalId: 'string', position: 'number.integer >= 0' })),
      },
    });
    Workspace.on.initialize(() => ({ title: 'Untitled' }));
    const principals: string[] = [];
    Workspace.on.connect(async (_turn, connection) => { principals.push(connection.principal.id); });
    Workspace.on.cursor(async (turn, connection, input) => {
      if (input.mutate) await turn.setState({ title: 'forbidden' });
      await turn.broadcast.cursorPublished({ principalId: connection.principal.id, position: input.position });
    });
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    const connection = (member: string, input: object) => {
      const authority = turnAuthority('celld-realtime-fixture', 'celld-realtime.v1', member, { key: 'one', input });
      return {
      id: 'connection-1', principal: { id: authority.authorizationReceipt.principal.id }, causalPrincipal: { id: 'user-1' },
      authorizationReceipt: authority.authorizationReceipt,
      trustedContextDigest: authority.trustedContextDigest,
      connectedAt: '2026-08-20T00:00:00.000Z', leaseExpiresAt: '2026-08-20T00:01:00.000Z',
    } as const;
    };
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connection', member: 'connect', key: 'one', input: { agent: 'browser' }, connection: connection('connect', { agent: 'browser' }), idempotencyKey: 'connect-1',
    })).resolves.toMatchObject({ revision: 1 });
    expect(principals).toEqual(['principal:test']);
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connectionMessage', member: 'cursor', key: 'one', input: { position: 3, mutate: false }, connection: connection('cursor', { position: 3, mutate: false }), idempotencyKey: 'cursor-1',
    })).resolves.toMatchObject({ revision: 1 });
    await expect(executeApplicationActorRealtime(Workspace as never, {
      kind: 'connectionMessage', member: 'cursor', key: 'one', input: { position: 4, mutate: true }, connection: connection('cursor', { position: 4, mutate: true }), idempotencyKey: 'cursor-2',
    })).rejects.toThrow(/cannot mutate durable state/u);
    const [entry] = service.cells.values();
    expect(entry?.storage.values.get('applik8s:state')).toMatchObject({ revision: 1, value: { title: 'Untitled' } });
    expect([...entry?.storage.values.keys() ?? []].filter(key => key.startsWith('applik8s:broadcasts:'))).toHaveLength(1);
  });

  it('adapts hibernatable celld WebSockets into typed callbacks, broadcasts, delivery receipts, and one disconnect', async () => {
    Reflect.set(globalThis, 'WebSocketPair', MemoryWebSocketPair);
    const service = authority();
    const Workspace = app('celld-websocket-fixture').actor('celld-websocket.v1', {
      key: type('string'), state: type({ title: 'string' }),
      protocol: {
        connect: actor.connection(type({ agent: 'string' })),
        cursor: actor.connectionMessage(type({ position: 'number.integer >= 0' })),
        disconnect: actor.disconnection(type({ agent: 'string' })),
        cursorPublished: actor.broadcast(type({ principalId: 'string', position: 'number.integer >= 0' })),
      },
    });
    Workspace.on.initialize(() => ({ title: 'Untitled' }));
    let disconnected = 0;
    Workspace.on.cursor(async (turn, connection, input) => {
      await turn.broadcast.cursorPublished({ principalId: connection.principal.id, position: input.position });
    });
    Workspace.on.disconnect(async (_turn, connection) => {
      disconnected += 1;
      expect(connection.disconnectionReason).toBe('closed');
    });
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    service.setApplicationFetch(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get('authorization')).toBe(`Bearer ${service.applicationAuthorization}`);
      const admission = await request.json() as Parameters<typeof executeApplicationActorRealtime>[1] & { readonly actor: string };
      const receipt = await executeApplicationActorRealtime(Workspace as never, realtimeAdmission('celld-websocket-fixture', 'celld-websocket.v1', admission));
      return new Response(JSON.stringify({ accepted: true, receipt }), { status: 202, headers: { 'content-type': 'application/json' } });
    });
    const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const response = await service.fetch(new Request(
      'http://celld.test/__applik8s/v1/actors/celld-websocket.v1/one/connections?connect=connect&disconnect=disconnect&protocolRevision=v1&lease=60s',
      { headers: {
        authorization: `Bearer ${service.authorization}`,
        upgrade: 'websocket',
        'x-applik8s-connection-id': 'connection-1',
        'x-applik8s-causal-principal-id': 'human-1',
        'x-applik8s-authorization-receipt': encoded(turnAuthority('celld-websocket-fixture', 'celld-websocket.v1', 'connect').authorizationReceipt),
        'x-applik8s-trusted-context-digest': 'sha256:test-context',
        'x-applik8s-connect-input': encoded({ agent: 'browser' }),
        'x-applik8s-disconnect-input': encoded({ agent: 'browser' }),
      } },
    ));
    expect(response.status).toBe(101);
    const [entry] = service.cells.values();
    const socket = entry?.sockets[0]?.socket;
    expect(socket).toBeDefined();
    await entry!.cell.webSocketMessage(socket!, JSON.stringify({ member: 'cursor', messageId: 'message-1', input: { position: 9 } }));
    const delivered = socket!.sent.map(value => JSON.parse(value)) as Array<Record<string, unknown>>;
    expect(delivered).toHaveLength(2);
    expect(delivered[0]).toMatchObject({ type: 'broadcast', member: 'cursorPublished', value: { principalId: 'principal:test', position: 9 } });
    expect(delivered[1]).toMatchObject({ type: 'delivery', messageId: 'message-1', receipt: { revision: 1 } });
    await entry!.cell.webSocketClose(socket!);
    await entry!.cell.webSocketError(socket!);
    expect(disconnected).toBe(1);
    expect(entry?.storage.values.get('applik8s:connection:connection-1')).toMatchObject({ state: 'disconnected' });
  });

  it('retains a failed disconnect for bounded lease-alarm retry and admits one logical disconnection', async () => {
    Reflect.set(globalThis, 'WebSocketPair', MemoryWebSocketPair);
    const service = authority();
    const Workspace = app('celld-disconnect-retry-fixture').actor('celld-disconnect-retry.v1', {
      key: type('string'), state: type({ title: 'string' }),
      protocol: {
        connect: actor.connection(type({ agent: 'string' })),
        disconnect: actor.disconnection(type({ agent: 'string' })),
      },
    });
    Workspace.on.initialize(() => ({ title: 'Untitled' }));
    let attempts = 0;
    Workspace.on.disconnect(async (_turn, connection) => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient callback failure');
      expect(connection.disconnectionReason).toBe('lease-expired');
    });
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    service.setApplicationFetch(async (input, init) => {
      const admission = await new Request(input, init).json() as Parameters<typeof executeApplicationActorRealtime>[1];
      const receipt = await executeApplicationActorRealtime(Workspace as never, realtimeAdmission('celld-disconnect-retry-fixture', 'celld-disconnect-retry.v1', admission));
      return new Response(JSON.stringify({ accepted: true, receipt }), { status: 202, headers: { 'content-type': 'application/json' } });
    });
    const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const response = await service.fetch(new Request(
      'http://celld.test/__applik8s/v1/actors/celld-disconnect-retry.v1/one/connections?connect=connect&disconnect=disconnect&protocolRevision=v1&lease=5s',
      { headers: {
        authorization: `Bearer ${service.authorization}`,
        upgrade: 'websocket',
        'x-applik8s-connection-id': 'connection-retry',
        'x-applik8s-causal-principal-id': 'human-1',
        'x-applik8s-authorization-receipt': encoded(turnAuthority('celld-disconnect-retry-fixture', 'celld-disconnect-retry.v1', 'connect').authorizationReceipt),
        'x-applik8s-trusted-context-digest': 'sha256:test-context',
        'x-applik8s-connect-input': encoded({ agent: 'browser' }),
        'x-applik8s-disconnect-input': encoded({ agent: 'browser' }),
      } },
    ));
    expect(response.status).toBe(101);
    const [entry] = service.cells.values();
    const socket = entry?.sockets[0]?.socket;
    await expect(entry!.cell.webSocketClose(socket!)).rejects.toThrow('transient callback failure');
    expect(entry?.storage.values.get('applik8s:connection:connection-retry')).toMatchObject({ state: 'disconnecting' });
    const record = entry?.storage.values.get('applik8s:connection:connection-retry') as { connection: { leaseExpiresAt: string } };
    entry?.storage.values.set('applik8s:connection:connection-retry', {
      ...(entry.storage.values.get('applik8s:connection:connection-retry') as object),
      connection: {
        ...record.connection,
        connectedAt: new Date(Date.now() - 10_000).toISOString(),
        leaseExpiresAt: new Date(Date.now() - 1).toISOString(),
      },
    });
    await entry!.cell.alarm();
    expect(attempts).toBe(2);
    expect(entry?.storage.values.get('applik8s:connection:connection-retry')).toMatchObject({ state: 'disconnected' });
    await entry!.cell.webSocketError(socket!);
    expect(attempts).toBe(2);
  });

  it('serializes complete awaited turns and replays committed results', async () => {
    const service = authority();
    const application = app('celld-runtime-fixture');
    const Counter = application.actor('counter.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        add: actor.command({ input: type({ by: 'number.integer > 0' }), output: type({ count: 'number.integer >= 0' }) }),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    const observed: number[] = [];
    Counter.on.add(async (counter, input) => {
      const state = await counter.state();
      observed.push(state.count);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const count = state.count + input.by;
      await counter.setState({ count });
      return { count };
    });
    const runtime = createCelldApplicationActorRuntime({
      endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch,
      retryDelay: '1ms', leaseDuration: '2s', heartbeatInterval: '100ms', admissionTimeout: '2s',
    });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));

    const [first, second] = await Promise.all([
      withApplicationActorTurnAuthority(turnAuthority('celld-runtime-fixture', 'counter.v1', 'add', { input: { by: 1 } }), () => Counter.add('one', { by: 1 }, { idempotencyKey: 'add-1' })),
      withApplicationActorTurnAuthority(turnAuthority('celld-runtime-fixture', 'counter.v1', 'add', { input: { by: 2 } }), () => Counter.add('one', { by: 2 }, { idempotencyKey: 'add-2' })),
    ]);
    expect([first.count, second.count]).toEqual([1, 3]);
    expect(observed).toEqual([0, 1]);
    await expect(withApplicationActorTurnAuthority(turnAuthority('celld-runtime-fixture', 'counter.v1', 'add', { input: { by: 1 } }), () => Counter.add('one', { by: 1 }, { idempotencyKey: 'add-1' }))).resolves.toEqual({ count: 1 });
    await expect(withApplicationActorTurnAuthority(turnAuthority('celld-runtime-fixture', 'counter.v1', 'add', { input: { by: 9 } }), () => Counter.add('one', { by: 9 }, { idempotencyKey: 'add-1' }))).rejects.toThrow('idempotency_fingerprint_conflict');
  });

  it('persists durable alarm authority without executing application code in celld', async () => {
    const service = authority();
    const application = app('celld-alarm-fixture');
    const Counter = application.actor('counter-alarm.v1', {
      key: type('string'), state: type({ count: 'number.integer >= 0' }),
      protocol: { wake: actor.alarm(type({ by: 'number.integer > 0' })) },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    Counter.on.wake(async () => {});
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    const alarmAuthority = turnAuthority('celld-alarm-fixture', 'counter-alarm.v1', 'wake');
    await expect(withApplicationActorTurnAuthority(alarmAuthority, () => Counter.alarms.wake.schedule('one', '2026-09-01T00:00:00.000Z', { by: 1 }, { idempotencyKey: 'wake-1' }))).resolves.toMatchObject({
      actor: 'counter-alarm.v1', member: 'wake', state: 'scheduled',
    });
    const [entry] = service.cells.values();
    expect(entry?.storage.alarmTime).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    expect([...entry?.storage.values.values() ?? []]).toContainEqual(expect.objectContaining({ authority: alarmAuthority }));
    await expect(Counter.alarms.wake.cancel('one')).resolves.toMatchObject({ state: 'cancelled' });
    expect(entry?.storage.alarmTime).toBeNull();
  });

  it('commits bound alarms atomically and discards them when the turn rolls back', async () => {
    const service = authority();
    const application = app('celld-bound-alarm-fixture');
    const Counter = application.actor('bound-alarm.v1', {
      key: type('string'), state: type({ count: 'number.integer >= 0' }),
      protocol: {
        change: actor.command({ input: type({ fail: 'boolean' }), output: type({ count: 'number.integer >= 0' }) }),
        wake: actor.alarm(type({ by: 'number.integer > 0' })),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    Counter.on.change(async (turn, input) => {
      const state = await turn.state();
      await turn.alarms.wake.schedule('2026-09-02T00:00:00.000Z', { by: 1 });
      await turn.setState({ count: state.count + 1 });
      if (input.fail) throw new Error('roll back');
      return { count: state.count + 1 };
    });
    Counter.on.wake(async () => {});
    const runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    const commandAuthority = turnAuthority('celld-bound-alarm-fixture', 'bound-alarm.v1', 'change');
    const alarmAuthority = turnAuthority('celld-bound-alarm-fixture', 'bound-alarm.v1', 'wake');
    disposers.push(installApplicationActorInvocationAuthorityResolver(async (request) => {
      expect(request.member).toBe('wake');
      return alarmAuthority;
    }));

    await expect(withApplicationActorTurnAuthority(commandAuthority, () => Counter.change('failed', { fail: true }, { idempotencyKey: 'failed' }))).rejects.toThrow('roll back');
    const failed = [...service.cells].find(([name]) => name.includes(':failed'))?.[1];
    expect(failed?.storage.alarmTime).toBeNull();
    expect([...failed?.storage.values.keys() ?? []].some(key => key.startsWith('applik8s:alarm:'))).toBe(false);

    await expect(withApplicationActorTurnAuthority(commandAuthority, () => Counter.change('committed', { fail: false }, { idempotencyKey: 'committed' }))).resolves.toEqual({ count: 1 });
    const committed = [...service.cells].find(([name]) => name.includes(':committed'))?.[1];
    expect(committed?.storage.alarmTime).toBe(Date.parse('2026-09-02T00:00:00.000Z'));
    expect([...committed?.storage.values.keys() ?? []].some(key => key.startsWith('applik8s:alarm:'))).toBe(true);
  });

  it('replays committed event effects without rerunning the actor turn after delivery interruption', async () => {
    const service = authority();
    const Changed = event('celld-counter.changed.v1', {
      payload: type({ counterId: 'string', count: 'number.integer >= 0' }),
    });
    const Counter = app('celld-outbox-fixture').actor('celld-outbox.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        increment: actor.command({
          input: type({ by: 'number.integer > 0' }),
          output: type({ count: 'number.integer >= 0' }),
        }),
      },
    });
    Counter.on.initialize(() => ({ count: 0 }));
    let turns = 0;
    Counter.on.increment(async (turn, input) => {
      turns += 1;
      const state = await turn.state();
      const count = state.count + input.by;
      await turn.setState({ count });
      Changed.emit({ counterId: turn.key, count });
      return { count };
    });
    let deliveryAttempts = 0;
    const delivered: string[] = [];
    const runtime = createCelldApplicationActorRuntime({
      endpoint: 'http://celld.test/',
      authorization: service.authorization,
      fetch: service.fetch as typeof fetch,
      deliverEvent(effect) {
        deliveryAttempts += 1;
        if (deliveryAttempts === 1) throw new Error('broker unavailable after commit');
        delivered.push(effect.effectId);
      },
    });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));

    const incrementAuthority = turnAuthority('celld-outbox-fixture', 'celld-outbox.v1', 'increment', { input: { by: 3 } });
    await expect(withApplicationActorTurnAuthority(incrementAuthority, () => Counter.increment('one', { by: 3 }, { idempotencyKey: 'increment-one' }))).rejects.toThrow('broker unavailable after commit');
    expect(turns).toBe(1);
    await expect(withApplicationActorTurnAuthority(incrementAuthority, () => Counter.increment('one', { by: 3 }, { idempotencyKey: 'increment-one' }))).resolves.toEqual({ count: 3 });
    expect(turns).toBe(1);
    expect(delivered).toHaveLength(1);
    await expect(withApplicationActorTurnAuthority(incrementAuthority, () => Counter.increment('one', { by: 3 }, { idempotencyKey: 'increment-one' }))).resolves.toEqual({ count: 3 });
    expect(turns).toBe(1);
    expect(delivered).toHaveLength(1);
  });

  it('resumes interrupted forward state migration and rejects rollback to older code', async () => {
    const service = authority();
    const v1 = app('celld-migration-v1').actor('celld-migrating.v1', {
      key: type('string'), state: type({ count: 'number.integer >= 0' }),
      protocol: { read: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0' }) }) },
    });
    v1.on.initialize(() => ({ count: 7 }));
    v1.on.read(async turn => turn.state());
    let runtime = createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: service.authorization, fetch: service.fetch as typeof fetch });
    disposers.push(installApplicationActorRuntimeResolver(() => runtime));
    await withApplicationActorTurnAuthority(turnAuthority('celld-migration-v1', 'celld-migrating.v1', 'read', { input: {} }), () => v1.read('one', {}, { idempotencyKey: 'v1' }));

    let attempts = 0;
    const v2 = app('celld-migration-v2').actor('celld-migrating.v1', {
      key: type('string'),
      state: actorState({
        version: 2,
        schema: type({ count: 'number.integer >= 0', label: 'string' }),
        migrate: { 1: previous => {
          attempts += 1;
          if (attempts === 1) throw new Error('migration interrupted');
          return { ...(previous as { count: number }), label: 'ready' };
        } },
      }),
      protocol: { read: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0', label: 'string' }) }) },
    });
    v2.on.initialize(() => ({ count: 0, label: 'new' }));
    v2.on.read(async turn => turn.state());
    const v2Authority = turnAuthority('celld-migration-v2', 'celld-migrating.v1', 'read', { input: {} });
    await expect(withApplicationActorTurnAuthority(v2Authority, () => v2.read('one', {}, { idempotencyKey: 'v2' }))).rejects.toThrow('migration interrupted');
    await expect(withApplicationActorTurnAuthority(v2Authority, () => v2.read('one', {}, { idempotencyKey: 'v2' }))).resolves.toEqual({ count: 7, label: 'ready' });
    await expect(withApplicationActorTurnAuthority(turnAuthority('celld-migration-v1', 'celld-migrating.v1', 'read', { input: {} }), () => v1.read('one', {}, { idempotencyKey: 'rollback' }))).rejects.toThrow(/newer than runtime/u);
  });

  it('fails closed at the public boundary for missing or weak authority', async () => {
    const service = authority();
    await expect(worker.fetch(new Request('http://celld.test/__applik8s/v1/actors/a/b/turns:begin', { method: 'POST' }), {
      APPLIK8S_ACTOR_CELLS: { idFromName() { return { toString: () => 'x' }; }, get() { throw new Error('must not route'); } },
      APPLIK8S_ACTOR_AUTHORIZATION: service.authorization,
    })).resolves.toMatchObject({ status: 403 });
    expect(() => createCelldApplicationActorRuntime({ endpoint: 'http://celld.test/', authorization: 'short' })).toThrow('at least 32');
  });
});
