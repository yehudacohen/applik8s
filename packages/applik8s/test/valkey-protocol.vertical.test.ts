import { createServer, type Server, type Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import { createApplicationValkeyCommand, encodeResp, parseResp, ValkeyServerError } from '../src/valkey-protocol.js';

describe('Valkey RESP2 protocol boundary', () => {
  test('uses UTF-8 byte lengths and parses nested, nullable responses', () => {
    expect(encodeResp(['SET', 'greeting', 'שלום']).toString('utf8')).toContain('$8\r\nשלום\r\n');
    expect(parseResp(Buffer.from('*3\r\n+OK\r\n$3\r\nhey\r\n$-1\r\n'))).toEqual({ value: ['OK', 'hey', null], offset: 23 });
    expect(() => parseResp(Buffer.from('-NOAUTH authentication required\r\n'))).toThrow(ValkeyServerError);
    expect(() => parseResp(Buffer.from('$5\r\npar'))).toThrow(/Incomplete/);
  });

  test('validates connection bounds before opening a socket', () => {
    expect(() => createApplicationValkeyCommand({ host: '   ' })).toThrow(/host/);
    expect(() => createApplicationValkeyCommand({ host: 'valkey', port: 0 })).toThrow(/port/);
    expect(() => createApplicationValkeyCommand({ host: 'valkey', timeoutMs: 0 })).toThrow(/timeout/);
    expect(() => createApplicationValkeyCommand({ host: 'valkey', maxRedirects: 17 })).toThrow(/maxRedirects/);
    expect(() => createApplicationValkeyCommand({ host: 'valkey', poolSize: 33 })).toThrow(/poolSize/);
  });

  test('reuses a bounded connection pool under sustained concurrent commands', async () => {
    let connections = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('data', () => socket.write('+OK\r\n'));
    });
    await listen(server);
    try {
      const command = createApplicationValkeyCommand({
        host: '127.0.0.1',
        port: serverPort(server),
        poolSize: 3,
      });
      await expect(Promise.all(
        Array.from({ length: 120 }, (_, index) => command(['GET', `key-${index}`])),
      )).resolves.toEqual(Array.from({ length: 120 }, () => 'OK'));
      expect(connections).toBe(3);
    } finally {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    }
  });

  test('follows a bounded Redis Cluster MOVED response to the owning node', async () => {
    const target = await responseServer('$5\r\nvalue\r\n');
    const targetPort = serverPort(target);
    const redirect = await responseServer(`-MOVED 1234 127.0.0.1:${targetPort}\r\n`);
    try {
      const command = createApplicationValkeyCommand({ host: '127.0.0.1', port: serverPort(redirect), maxRedirects: 2 });
      await expect(command(['GET', 'projection-key'])).resolves.toBe('value');
    } finally {
      await Promise.all([closeServer(redirect), closeServer(target)]);
    }
  });
});

async function responseServer(response: string): Promise<Server> {
  const server = createServer((socket) => {
    socket.once('data', () => socket.end(response));
  });
  await listen(server);
  return server;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function serverPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Valkey test server has no TCP address.');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
