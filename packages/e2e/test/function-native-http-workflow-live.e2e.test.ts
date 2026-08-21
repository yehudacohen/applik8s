// typecast-file-boundary: the live test inspects compiler artifacts and HTTP
// payloads only after checking their graph and protocol discriminants.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';
import { compileTypeKroComposition } from '../../compiler/src/pipeline/index.js';

const databaseUrl =
  process.env.APPLIK8S_V08_HTTP_WORKFLOW_DATABASE_URL;

describe('v0.8 exact generated HTTP-to-workflow retry', () => {
  const children = new Set<ChildProcess>();
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopWorker(child)));
    children.clear();
    await Promise.all([...directories].map((directory) =>
      rm(directory, { recursive: true, force: true })));
    directories.clear();
  });

  it.skipIf(!databaseUrl)(
    'reattaches after a lost admission response with one run and one effect',
    async () => {
      if (!databaseUrl) {
        throw new Error(
          'APPLIK8S_V08_HTTP_WORKFLOW_DATABASE_URL disappeared after test selection.',
        );
      }
      const suffix = `${process.pid}-${Date.now()}`;
      const applicationName = `http-workflow-${suffix}`.toLowerCase();
      const tableName = `http_workflow_authority_${suffix.replaceAll('-', '_')}`
        .toLowerCase();
      const directory = await mkdtemp(
        join(process.cwd(), '.tmp-applik8s-http-workflow-live-'),
      );
      directories.add(directory);
      await mkdir(join(directory, 'migrations'));
      await writeFile(
        join(directory, 'migrations', '0000_authority.sql'),
        `create table ${tableName} (id text primary key);\n`,
      );
      const entrypoint = join(directory, 'application.ts');
      await writeFile(entrypoint, `
import { IdentityProvider, WorkflowEngine, app, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const authorityRows = pgTable(${JSON.stringify(tableName)}, {
  id: text('id').primaryKey(),
});
const application = app(${JSON.stringify(applicationName)}, {
  namespace: ${JSON.stringify(applicationName)},
});
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter',
  application: ${JSON.stringify(applicationName)},
  subject: 'http-workflow-user',
  audience: [${JSON.stringify(applicationName)}],
  catalogRevision: 'http-workflow-catalog-v1',
  authorityRevision: 'http-workflow-authority-v1',
}));
application.provide(WorkflowEngine, WorkflowEngine.hatchet({
  provision: false,
  namespace: ${JSON.stringify(applicationName)},
  hostPort: 'hatchet.invalid:7070',
  apiUrl: 'http://hatchet.invalid:8080',
  workerTokenSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'http-workflow-token',
    namespace: ${JSON.stringify(applicationName)},
  },
}));
const Database = application.database.postgres('main', {
  schema: { authorityRows },
  migrations: { path: './migrations' },
});
application.model(authorityRows, { name: 'AuthorityRow', database: Database });
const Provision = workflow('tenant.provision.v1', {
  input: type({ tenantId: 'string' }),
  output: type({ accepted: 'boolean' }),
});
const provision = application.workflow(
  Provision,
  { retries: 1 },
  async () => ({ accepted: true }),
);
const api = application.http('public-api');
const provisionTenant = api.post('provision-tenant', '/tenants/provision', {
  input: type({ tenantId: 'string' }),
  output: type({ accepted: 'boolean' }),
}, async ({ input }) => provision(input, {
  idempotencyKey: input.tenantId,
}));
provisionTenant.public();
export const httpWorkflowStack = application.composition;
`);

      const compiled = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'httpWorkflowStack',
        outDir: join(directory, 'dist'),
        runtimeVersionRange: '^0.8.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: false,
          allowedHostImports: [],
          sourceMaps: {
            emit: true,
            includeSourceContent: false,
            redactPaths: false,
          },
        },
      });
      expect(
        compiled.ok,
        compiled.ok ? undefined : compiled.error.message,
      ).toBe(true);
      if (!compiled.ok) return;

      const graph = JSON.parse(
        await readFile(
          compiled.value.artifacts.applicationGraphJsonPath ?? '',
          'utf8',
        ),
      ) as ApplicationGraph;
      const model = graph.nodes.find(
        (node) => node.kind === 'model' && node.name === 'AuthorityRow',
      );
      if (model?.kind !== 'model' || !model.runtime) {
        throw new Error('Compiled workflow HTTP fixture has no authority store.');
      }
      const artifact = compiled.value.artifacts.httpArtifacts[0];
      if (!artifact) throw new Error('Compiler emitted no typed HTTP artifact.');

      const admitted = new Map<string, string>();
      const attempts: string[] = [];
      let effects = 0;
      let loseFirstResponse = true;
      const serviceToken = 'http-workflow-test-service-account-token';
      const gateway = createHttpServer(async (request, response) => {
        if (request.headers.authorization !== `Bearer ${serviceToken}`) {
          response.writeHead(401).end();
          return;
        }
        const url = new URL(request.url ?? '/', 'http://gateway.invalid');
        if (request.method === 'GET' && url.pathname === '/readyz') {
          json(response, 200, { ready: true });
          return;
        }
        if (
          request.method === 'POST'
          && url.pathname === '/v1/workflows/tenant.provision.v1/runs'
        ) {
          const idempotencyKey = request.headers['idempotency-key'];
          if (typeof idempotencyKey !== 'string') {
            json(response, 400, { error: 'idempotency-required' });
            return;
          }
          attempts.push(idempotencyKey);
          const body = await requestJson(request);
          expect(body).toMatchObject({
            input: { tenantId: 'tenant-1' },
            metadata: { idempotencyKey },
          });
          expect(typeof Reflect.get(body, 'admission')).toBe('string');
          let reference = admitted.get(idempotencyKey);
          if (!reference) {
            effects += 1;
            reference = `run-reference-${effects}`;
            admitted.set(idempotencyKey, reference);
          }
          if (loseFirstResponse) {
            loseFirstResponse = false;
            request.socket.destroy();
            return;
          }
          json(response, 202, {
            id: reference,
            admittedAt: '2026-08-21T12:00:00.000Z',
          });
          return;
        }
        if (
          request.method === 'GET'
          && url.pathname === '/v1/workflows/tenant.provision.v1/runs/run-reference-1'
        ) {
          json(response, 200, {
            phase: 'Succeeded',
            result: { accepted: true },
            admittedAt: '2026-08-21T12:00:00.000Z',
            finishedAt: '2026-08-21T12:00:01.000Z',
          });
          return;
        }
        json(response, 404, { error: 'not-found' });
      });
      const gatewayPort = await listen(gateway);
      const tokenFile = join(directory, 'service-account-token');
      await writeFile(tokenFile, serviceToken, { mode: 0o600 });
      const preload = join(directory, 'rewrite-workflow-gateway.mjs');
      await writeFile(preload, `
const originalFetch = globalThis.fetch;
const gateway = new URL(process.env.APPLIK8S_TEST_WORKFLOW_GATEWAY_URL);
globalThis.fetch = (input, init) => {
  const request = input instanceof Request ? input : undefined;
  const original = new URL(request ? request.url : String(input));
  if (original.hostname === '127.0.0.1' || original.hostname === 'localhost') {
    return originalFetch(input, init);
  }
  const target = new URL(original.pathname + original.search, gateway);
  return originalFetch(request ? new Request(target, request) : target, init);
};
`);
      const workerPort = await availablePort();
      const worker = startWorker({
        sourcePath: artifact.sourcePath,
        preload,
        port: workerPort,
        connectionEnvName: model.runtime.connectionEnvName,
        connection: databaseUrl,
        tokenFile,
        gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
      });
      children.add(worker.child);
      try {
        await waitUntilReady(workerPort, worker);
        const response = await fetch(
          `http://127.0.0.1:${workerPort}/tenants/provision`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': 'request-1',
            },
            body: JSON.stringify({ tenantId: 'tenant-1' }),
          },
        );
        const value = await response.json();
        expect(
          response.ok,
          `Generated HTTP request failed: ${JSON.stringify(value)}; ${worker.stderr.join('')}`,
        ).toBe(true);
        expect(value).toEqual({ accepted: true });
        expect(attempts).toHaveLength(2);
        expect(new Set(attempts).size).toBe(1);
        expect(effects).toBe(1);
        expect(admitted.size).toBe(1);
      } finally {
        gateway.close();
      }
    },
    180_000,
  );
});

function startWorker(options: {
  readonly sourcePath: string;
  readonly preload: string;
  readonly port: number;
  readonly connectionEnvName: string;
  readonly connection: string;
  readonly tokenFile: string;
  readonly gatewayUrl: string;
}): { readonly child: ChildProcess; readonly stderr: string[] } {
  const stderr: string[] = [];
  const child = spawn(
    process.execPath,
    ['--import', options.preload, options.sourcePath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [options.connectionEnvName]: options.connection,
        APPLIK8S_HTTP_CONTEXT_SECRET:
          'v08-http-workflow-context-secret-0000000000000001',
        APPLIK8S_HTTP_PORT: String(options.port),
        APPLIK8S_INTERNAL_OPERATION_SECRET:
          'v08-http-workflow-operation-secret-00000000000001',
        APPLIK8S_WORKFLOW_GATEWAY_TOKEN_FILE: options.tokenFile,
        APPLIK8S_TEST_WORKFLOW_GATEWAY_URL: options.gatewayUrl,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  child.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
  return { child, stderr };
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000)),
  ]);
}

async function waitUntilReady(
  port: number,
  worker: { readonly child: ChildProcess; readonly stderr: readonly string[] },
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null) {
      throw new Error(
        `Generated HTTP worker exited ${worker.child.exitCode}: ${worker.stderr.join('')}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return;
    } catch {
      // Bounded readiness polling is the live test's observation boundary.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Generated HTTP worker did not become ready: ${worker.stderr.join('')}`,
  );
}

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  const port = await availablePort();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return port;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a TCP port.'));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolve(address.port));
    });
  });
}

async function requestJson(request: import('node:http').IncomingMessage): Promise<object> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object request.');
  }
  return value;
}

function json(
  response: import('node:http').ServerResponse,
  status: number,
  value: object,
): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
