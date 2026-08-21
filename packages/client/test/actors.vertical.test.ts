// typecast-file-boundary: The test intentionally supplies minimal browser transport doubles at the client boundary.
import { describe, expect, it } from 'vitest';
import { createApplicationActorClient, type ApplicationActorClientWebSocket } from '../src/actors.js';

class TestSocket implements ApplicationActorClientWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  send(value: string): void { this.sent.push(value); }
  close(): void { this.emit('close', {}); }
  emit(type: string, event: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const contract = {
  id: 'workspace.v1',
  members: [
    { name: 'rename', kind: 'command' },
    { name: 'observe', kind: 'message' },
    { name: 'connect', kind: 'connection' },
    { name: 'cursor', kind: 'connectionMessage' },
    { name: 'disconnect', kind: 'disconnection' },
    { name: 'updated', kind: 'broadcast' },
  ],
} as const;

describe('application actor browser facade', () => {
  it('uses only authenticated same-origin framework routes for commands and messages', async () => {
    const requests: Request[] = [];
    const client = createApplicationActorClient(contract, {
      baseUrl: 'https://app.example.test',
      fetch: (async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const member = new URL(request.url).pathname.split('/').at(-1);
        return Response.json(member === 'rename'
          ? { result: { title: 'Renamed' }, authorizationReceiptId: 'auth-1' }
          : { receipt: { operationId: 'operation-1', actor: 'workspace.v1', key: 'space/one', member: 'observe', state: 'committed', revision: 2, replayed: false } },
        );
      }) as typeof fetch,
    }) as {
      rename(key: string, input: object, options?: { readonly idempotencyKey?: string }): Promise<object>;
      observe: { send(key: string, input: object): Promise<object> };
    };
    await expect(client.rename('space/one', { title: 'Renamed' }, { idempotencyKey: 'rename-1' })).resolves.toEqual({ title: 'Renamed' });
    await expect(client.observe.send('space/one', { at: 'now' })).resolves.toMatchObject({ operationId: 'operation-1' });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/__applik8s/v1/actors/workspace.v1/space%2Fone/operations/rename',
      '/__applik8s/v1/actors/workspace.v1/space%2Fone/operations/observe',
    ]);
    expect(await requests[0]?.json()).toEqual({ input: { title: 'Renamed' }, idempotencyKey: 'rename-1' });
    expect(requests.every((request) => request.credentials === 'include')).toBe(true);
  });

  it('hydrates signed connection admission into typed messages, broadcasts, receipts, and explicit close', async () => {
    const socket = new TestSocket();
    let openedUrl = '';
    const client = createApplicationActorClient(contract, {
      baseUrl: 'https://app.example.test',
      id: () => 'message-1',
      fetch: (async (_input, _init) => Response.json({ connectionId: 'connection-1', url: 'wss://app.example.test/__applik8s/v1/actors/workspace.v1/one/connections?ticket=signed' }, { status: 201 })) as typeof fetch,
      createWebSocket(url) { openedUrl = url; queueMicrotask(() => { socket.readyState = 1; socket.emit('open', {}); }); return socket; },
    }) as { connect(key: string, input: object, options: object): Promise<Record<string, unknown>> };
    const connection = await client.connect('one', { agent: 'browser' }, { disconnect: { member: 'disconnect', input: { agent: 'browser' } }, lease: '60s' }) as {
      readonly id: string;
      cursor(input: object): Promise<object>;
      readonly on: { readonly updated: (listener: (value: unknown) => void) => () => void };
      close(): Promise<void>;
    };
    expect(openedUrl).toContain('ticket=signed');
    const delivery = connection.cursor({ position: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({ type: 'message', member: 'cursor', messageId: 'message-1', input: { position: 3 } });
    socket.emit('message', { data: JSON.stringify({ type: 'delivery', messageId: 'message-1', receipt: { operationId: 'cursor-1', actor: 'workspace.v1', key: 'one', member: 'cursor', state: 'committed', revision: 1, replayed: false } }) });
    await expect(delivery).resolves.toMatchObject({ operationId: 'cursor-1' });
    const broadcasts: unknown[] = [];
    connection.on.updated((value) => broadcasts.push(value));
    socket.emit('message', { data: JSON.stringify({ type: 'broadcast', member: 'updated', value: { title: 'Now' }, receipt: { revision: 1 } }) });
    expect(broadcasts).toEqual([{ title: 'Now' }]);
    const closing = connection.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(socket.sent.at(-1) ?? '{}')).toEqual({ type: 'close', member: 'disconnect', input: { agent: 'browser' } });
    socket.emit('close', {});
    await closing;
  });
});
// typecast-file-boundary: The test intentionally supplies minimal browser transport doubles at the client boundary.
