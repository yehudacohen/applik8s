import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const requests: Array<{ path: string; token?: string }> = [];
let certificateDirectory = '';
let certificatePath = '';
let server: ReturnType<typeof createServer> | undefined;
let endpoint = '';

beforeAll(async () => {
  certificateDirectory = mkdtempSync(join(tmpdir(), 'applik8s-custom-ca-'));
  const keyPath = join(certificateDirectory, 'server-key.pem');
  certificatePath = join(certificateDirectory, 'server-cert.pem');
  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-days',
      '1',
      '-subj',
      '/CN=collector.applik8s.test',
      '-addext',
      'subjectAltName=DNS:collector.applik8s.test',
    ], { stdio: 'ignore' });
    server = createServer({
      key: readFileSync(keyPath),
      cert: readFileSync(certificatePath),
    }, (request, response) => {
      request.resume();
      request.on('end', () => {
        requests.push({
          path: request.url ?? '',
          ...(typeof request.headers['x-collector-token'] === 'string'
            ? { token: request.headers['x-collector-token'] }
            : {}),
        });
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  } catch (error) {
    rmSync(certificateDirectory, { recursive: true, force: true });
    throw error;
  }
  endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}/tenant/custom-ca`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  }
  rmSync(certificateDirectory, { recursive: true, force: true });
});

describe('OpenTelemetry custom trust transport (live loopback)', () => {
  it('accepts the selected CA and server name while system trust and a wrong identity fail closed', async () => {
    const runClient = async (
      trust: 'system' | 'custom-ca',
      serverName?: string,
      expected: 'success' | 'tls-failure' = 'success',
    ) => {
      const args = [
        new URL('./fixtures/custom-ca-client.mjs', import.meta.url).pathname,
        endpoint,
        trust,
        ...(serverName ? [serverName] : []),
        certificatePath,
      ];
      try {
        const result = await execFileAsync(process.execPath, args, {
          cwd: new URL('../../..', import.meta.url).pathname,
          timeout: 15_000,
          env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' },
        });
        expect(expected).toBe('success');
        expect(result.stdout).not.toContain('custom-ca-header-canary');
        expect(result.stderr).not.toContain('custom-ca-header-canary');
        return '';
      } catch (error) {
        if (expected !== 'tls-failure') throw error;
        const failure = String(error);
        expect(failure).not.toContain('custom-ca-header-canary');
        return failure;
      }
    };

    await runClient('custom-ca', 'collector.applik8s.test');
    expect(requests).toEqual([{
      path: '/tenant/custom-ca/v1/traces',
      token: 'custom-ca-header-canary',
    }]);

    const accepted = requests.length;
    const untrustedFailure = await runClient('system', undefined, 'tls-failure');
    expect(requests).toHaveLength(accepted);
    expect(untrustedFailure).toMatch(/certificate|issuer|self-signed|trust/iu);

    const identityFailure = await runClient(
      'custom-ca',
      'wrong.applik8s.test',
      'tls-failure',
    );
    expect(requests).toHaveLength(accepted);
    expect(identityFailure).toMatch(/hostname|identity|altname|certificate/iu);
  }, 45_000);
});
