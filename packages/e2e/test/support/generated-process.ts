import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { build } from 'esbuild';
import { generatedApplicationFetchGatewayModules } from '../../../compiler/src/application-fetch-gateway/index.js';
import { applik8sWorkspaceSourcePlugin } from '../../../compiler/src/bundling/index.js';

export interface GeneratedProcessHandle {
  readonly child: ChildProcess;
  readonly output: () => string;
}

export interface TestOtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly name?: string;
  readonly attributes?: readonly TestOtlpAttribute[];
  readonly links?: readonly { readonly traceId?: string; readonly spanId?: string }[];
}

interface TestOtlpAttribute {
  readonly key?: string;
  readonly value?: Readonly<Record<string, unknown>>;
}

export interface TestOtlpReceiver {
  readonly endpoint: string;
  payloads(): readonly unknown[];
  spans(): readonly TestOtlpSpan[];
  waitForTraces(): Promise<void>;
  close(): Promise<void>;
}

export async function emitGeneratedFetchGatewayProcess(
  graph: ApplicationGraph,
  directory: string,
  options: {
    /** Node kinds owned by separately launched processes in the same receipt. */
    readonly omitNodeKinds?: readonly string[];
  } = {},
): Promise<string> {
  const omitted = new Set(options.omitNodeKinds ?? []);
  const gatewayGraph = omitted.size === 0
    ? graph
    : {
        ...graph,
        nodes: graph.nodes.filter((node) => !omitted.has(node.kind)),
      };
  const generated = generatedApplicationFetchGatewayModules(gatewayGraph);
  if (!generated) {
    throw new Error('Application graph emitted no application-host Fetch gateway.');
  }
  await Promise.all(Object.entries(generated.files).map(async ([path, source]) => {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }));
  const entrypoint = join(directory, 'process.generated.ts');
  const sourcePath = join(directory, 'runtime.mjs');
  await writeFile(entrypoint, generatedFetchGatewayProcessSource());
  await build({
    entryPoints: [entrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    keepNames: true,
    legalComments: 'none',
    nodePaths: [join(process.cwd(), 'node_modules')],
    external: [
      '@duckdb/node-api',
      '@duckdb/node-bindings',
      '@duckdb/node-bindings-*',
    ],
    plugins: [applik8sWorkspaceSourcePlugin()],
    banner: {
      js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
    },
  });
  return sourcePath;
}

function generatedFetchGatewayProcessSource(): string {
  return `import { createServer } from 'node:http';
import { closeApplik8sGateway, handleApplik8sRequest } from './gateway.generated.js';

const maximumBodyBytes = 1_048_576;
let stopping = false;

const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Application-host request disconnected.'));
  incoming.once('aborted', abort);
  outgoing.once('close', abort);
  try {
    const request = await webRequest(incoming, controller.signal);
    const url = new URL(request.url);
    if (url.pathname === '/live') url.pathname = '/__applik8s/v1/healthz';
    if (url.pathname === '/ready') url.pathname = '/__applik8s/v1/readyz';
    await writeWebResponse(outgoing, await handleApplik8sRequest(new Request(url, request)));
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Applik8s application-host request failed', error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'application_host_failed' }));
    }
  } finally {
    incoming.removeListener('aborted', abort);
    outgoing.removeListener('close', abort);
  }
});

server.listen(Number(process.env.APPLIK8S_HTTP_PORT ?? '8080'), '127.0.0.1');

async function webRequest(incoming, signal) {
  const chunks = [];
  let size = 0;
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > maximumBodyBytes) throw new Error('Application-host request body exceeds 1 MiB.');
      chunks.push(chunk);
    }
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request('http://' + (incoming.headers.host ?? 'localhost') + (incoming.url ?? '/'), {
    method: incoming.method,
    headers: Object.entries(incoming.headers).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => [key, item]) : value === undefined ? [] : [[key, value]]),
    signal,
    ...(body ? { body, duplex: 'half' } : {}),
  });
}

async function writeWebResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!outgoing.write(Buffer.from(value))) {
      await new Promise((resolve) => outgoing.once('drain', resolve));
    }
  }
  outgoing.end();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => server.closeAllConnections?.(), 15_000);
  force.unref?.();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(force);
  await closeApplik8sGateway();
}

process.once('SIGTERM', () => { void shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
process.once('SIGINT', () => { void shutdown().catch((error) => { console.error(error); process.exitCode = 1; }); });
`;
}

export function startGeneratedProcess(
  sourcePath: string,
  environment: Readonly<Record<string, string>>,
): GeneratedProcessHandle {
  let output = '';
  const child = spawn(process.execPath, [sourcePath], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  return { child, output: () => output };
}

export async function stopGeneratedProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill(signal);
  const stopped = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    // Generated roles may consume their declared request grace and then spend
    // up to five seconds each draining PostgreSQL and telemetry transports.
    delay(30_000).then(() => false),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return true;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return false;
}

export async function waitForGeneratedProcess(
  predicate: () => Promise<boolean>,
  processHandle: GeneratedProcessHandle,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
      throw new Error(`Generated process exited before its condition became true:\n${processHandle.output()}`);
    }
    try {
      if (await predicate()) return;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for generated process. ${lastError}\n${processHandle.output()}`);
}

export async function waitForGeneratedHttp(
  url: string,
  processHandle: GeneratedProcessHandle,
): Promise<void> {
  await waitForGeneratedProcess(async () => {
    const response = await fetch(url).catch(() => undefined);
    return response?.ok === true;
  }, processHandle);
}

export async function startTestOtlpReceiver(): Promise<TestOtlpReceiver> {
  const payloads: unknown[] = [];
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        payloads.push(body ? JSON.parse(body) : {});
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"error":"invalid-json"}');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    payloads: () => payloads,
    spans: () => payloads.flatMap(testOtlpSpans),
    async waitForTraces() {
      const started = Date.now();
      while (Date.now() - started < 30_000) {
        if (payloads.flatMap(testOtlpSpans).length > 0) return;
        await delay(50);
      }
      throw new Error('Local OTLP receiver did not observe exported traces.');
    },
    close: () => closeServer(server),
  };
}

function testOtlpSpans(payload: unknown): TestOtlpSpan[] {
  if (!payload || typeof payload !== 'object') return [];
  const resourceSpans = Reflect.get(payload, 'resourceSpans');
  if (!Array.isArray(resourceSpans)) return [];
  return resourceSpans.flatMap((resource) => {
    const scopeSpans = resource && typeof resource === 'object'
      ? Reflect.get(resource, 'scopeSpans')
      : undefined;
    if (!Array.isArray(scopeSpans)) return [];
    return scopeSpans.flatMap((scope) => {
      const spans = scope && typeof scope === 'object' ? Reflect.get(scope, 'spans') : undefined;
      return Array.isArray(spans)
        ? spans.filter((span): span is TestOtlpSpan => Boolean(span && typeof span === 'object'))
        : [];
    });
  });
}

export function testOtlpAttribute(
  span: TestOtlpSpan,
  key: string,
): string | number | boolean | undefined {
  const value = span.attributes?.find((candidate) => candidate.key === key)?.value;
  if (!value) return undefined;
  for (const field of ['stringValue', 'intValue', 'doubleValue', 'boolValue'] as const) {
    const candidate = value[field];
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
      return candidate;
    }
  }
  return undefined;
}

export async function availableGeneratedProcessPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await closeServer(server);
  return port;
}

function closeServer(server: Server | ReturnType<typeof createNetServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
