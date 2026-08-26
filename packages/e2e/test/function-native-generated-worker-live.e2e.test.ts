// typecast-file-boundary: this live compiler fixture intentionally assembles the normalized graph contract exercised by the generated worker.

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationPrincipal,
  JsonObject,
} from '@applik8s/core';
import { createApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApplicationRuntimeModelContract,
  applicationModelMigrationSql,
} from '../../applik8s/src/application-models.js';
import { applicationRequestContextValues } from '../../applik8s/src/command-principal.js';
import { emitGeneratedApplicationReactive } from '../../compiler/src/application-reactive/index.js';

const v08DatabaseUrl = process.env.APPLIK8S_V08_PROCESSOR_DATABASE_URL;
const databaseUrl = v08DatabaseUrl
  ?? process.env.APPLIK8S_V07_FUNCTION_NATIVE_WORKER_DATABASE_URL;
const observabilityLive = Boolean(v08DatabaseUrl);

describe('v0.7 exact generated function-native worker', () => {
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopWorker(child)));
    children.clear();
  });

  it.skipIf(!databaseUrl)(
    'executes compiler-emitted runtime.mjs atomically and recovers duplicate delivery without repeating effects',
    async () => {
      const selectedDatabaseUrl = databaseUrl;
      if (!selectedDatabaseUrl) {
        throw new Error('Generated processor live evidence requires PostgreSQL.');
      }
      const suffix = `${process.pid}_${Date.now()}`;
      const environment = `APPLIK8S_V07_WORKER_${suffix}_DATABASE_URL`;
      const post = runtimeModel(
        `GeneratedPost${suffix}`,
        `generated_posts_${suffix}`,
        environment,
      );
      const account = runtimeModel(
        `GeneratedAccount${suffix}`,
        `generated_accounts_${suffix}`,
        environment,
      );
      const processorId = `streamProcessor.publish-post-${suffix}`;
      const processorName = `publish-post-${suffix}`;
      const streamName = `posts.requested.${suffix}`;
      const changedName = `posts.changed.${suffix}`;
      const outDir = await mkdtemp(
        join(tmpdir(), 'applik8s-generated-function-native-live-'),
      );
      const collector = observabilityLive ? await startOtlpReceiver() : undefined;
      const sensitiveFailure = `processor-private-failure-${suffix}`;
      const outputs: Array<() => string> = [];
      let completed = false;
      const sql = postgres(selectedDatabaseUrl, {
        max: 4,
        idle_timeout: 5,
        connect_timeout: 5,
        prepare: false,
        onnotice: () => undefined,
      });

      try {
        await sql.unsafe(applicationModelMigrationSql(post));
        await sql.unsafe(applicationModelMigrationSql(account));
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors (
          contract_name text NOT NULL,
          contract_version text NOT NULL,
          context_digest text NOT NULL,
          deleted_through bigint NOT NULL CHECK (deleted_through >= 0),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (contract_name, contract_version, context_digest)
        )`);
        await sql.unsafe(
          `INSERT INTO ${quoteIdentifier(account.tableName)} (id, spec, revision)
           VALUES ($1, $2::jsonb, $3)`,
          ['account-1', sql.json({ state: 'active' }), 'account-before'],
        );
        await sql.unsafe(
          `INSERT INTO ${quoteIdentifier(post.tableName)} (id, spec, revision)
           VALUES ($1, $2::jsonb, $3)`,
          ['post-1', sql.json({ accountId: 'account-1', state: 'draft' }), 'post-before'],
        );
        const sourceEventId = `source-${suffix}`;
        const sourceRecordedAt = new Date().toISOString();
        const principal: ApplicationPrincipal = Object.freeze({
          id: 'principal:human:function-native-worker',
          identity: Object.freeze({
            id: 'identity:human:function-native-worker',
            kind: 'human',
            issuer: 'https://identity.example.test',
            subject: 'function-native-worker',
          }),
          kind: 'human',
          authenticationMethod: 'oidc',
          audience: ['function-native-worker'],
          trustedContextDigest: 'a'.repeat(64),
          catalogRevision: 'catalog-1',
          authorityRevision: 'authority-1',
          admittedAt: sourceRecordedAt,
        });
        const contextValues = applicationRequestContextValues(
          principal,
          principal.authorityRevision,
          {},
        );
        const contextDigest = createHash('sha256')
          .update(JSON.stringify(contextValues))
          .digest('hex');
        const sourceRows = await sql.unsafe(
          `INSERT INTO applik8s_public_stream_events
             (id, contract_name, contract_version, partition_key, envelope, payload, context_digest, recorded_at)
           VALUES ($1, $2, 'v1', $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)
           RETURNING sequence`,
          [
            sourceEventId,
            streamName,
            'post-1',
            sql.json({
              id: sourceEventId,
              contract: { name: streamName, version: 'v1' },
              payload: { postId: 'post-1' },
              partitionKey: 'post-1',
              recordedAt: sourceRecordedAt,
              ...(observabilityLive
                ? {
                    telemetry: createApplicationTelemetryEnvelopeV1({
                      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
                      identity: {
                        application: 'function-native-worker',
                        environment: 'generated-processor-live',
                        target: 'local',
                        operation: 'posts.requested',
                        execution: `event:${sourceEventId}`,
                        attempt: 1,
                        instance: sourceEventId,
                      },
                    }) as unknown as JsonObject,
                  }
                : {}),
              trustedContext: {
                values: contextValues,
                digest: contextDigest,
              },
            }),
            sql.json({ postId: 'post-1' }),
            contextDigest,
            sourceRecordedAt,
          ],
        );
        const sourceSequence = Number(sourceRows[0]?.sequence);
        expect(Number.isSafeInteger(sourceSequence)).toBe(true);

        const [artifact] = await emitGeneratedApplicationReactive({
          graph: functionNativeWorkerGraph({
            account,
            changedName,
            environment,
            post,
            processorId,
            processorName,
            sensitiveFailure,
            streamName,
            observability: observabilityLive,
          }),
          outDir,
          entrypoint: import.meta.filename,
        });
        expect(artifact?.kind).toBe('streamProcessorWorker');

        const firstPort = await availablePort();
        const first = startWorker(
          artifact?.sourcePath ?? '',
          environment,
          selectedDatabaseUrl,
          firstPort,
          collector?.endpoint,
        );
        children.add(first.child);
        outputs.push(first.output);
        await waitFor(
          async () => {
            try {
              const [row] = await sql.unsafe(
                `SELECT spec FROM ${quoteIdentifier(post.tableName)} WHERE id = 'post-1'`,
              );
              const [checkpoint] = await sql.unsafe(
                'SELECT sequence FROM applik8s_stream_processor_checkpoints WHERE processor = $1 AND stream = $2',
                [processorName, `${streamName}.v1`],
              );
              return Reflect.get(row?.spec ?? {}, 'state') === 'active'
                && Number(checkpoint?.sequence ?? 0) >= sourceSequence;
            } catch (error) {
              return isMissingRelation(error) ? false : Promise.reject(error);
            }
          },
          first,
        );
        await stopWorker(first.child);
        children.delete(first.child);

        await expect(effectCounts(sql, processorId, changedName)).resolves.toEqual({
          inbox: 1,
          outbox: 1,
          transitions: 1,
        });

        await sql.unsafe(
          'UPDATE applik8s_stream_processor_checkpoints SET sequence = 0 WHERE processor = $1 AND stream = $2',
          [processorName, `${streamName}.v1`],
        );
        const secondPort = await availablePort();
        const second = startWorker(
          artifact?.sourcePath ?? '',
          environment,
          selectedDatabaseUrl,
          secondPort,
          collector?.endpoint,
        );
        children.add(second.child);
        outputs.push(second.output);
        await waitFor(
          async () => {
            const [checkpoint] = await sql.unsafe(
              'SELECT sequence FROM applik8s_stream_processor_checkpoints WHERE processor = $1 AND stream = $2',
              [processorName, `${streamName}.v1`],
            );
            return Number(checkpoint?.sequence ?? 0) >= sourceSequence;
          },
          second,
        );
        await stopWorker(second.child);
        children.delete(second.child);

        await expect(effectCounts(sql, processorId, changedName)).resolves.toEqual({
          inbox: 1,
          outbox: 1,
          transitions: 1,
        });
        if (collector) {
          await collector.waitForTraces();
          const processorSpans = collector.spans().filter(
            (span) => attribute(span, 'applik8s.boundary.kind') === 'processor'
              && attribute(span, 'applik8s.operation') === processorName,
          );
          expect(processorSpans).toHaveLength(4);
          expect(processorSpans.map((span) => attribute(span, 'applik8s.invocation.kind'))).toEqual([
            'live',
            'retry',
            'live',
            'retry',
          ]);
          expect(processorSpans.filter((span) => span.status?.code === 2)).toHaveLength(2);
          expect(processorSpans.filter((span) => span.status?.code === 1)).toHaveLength(2);
          expect(processorSpans.every((span) => Number(attribute(span, 'applik8s.delivery.lag')) >= 0)).toBe(true);
          expect(processorSpans.every((span) => span.links?.some((link) => link.traceId === '0123456789abcdef0123456789abcdef'))).toBe(true);
          expect(JSON.stringify(collector.payloads())).not.toContain(sensitiveFailure);
          expect(outputs.map((output) => output()).join('\n')).not.toContain(sensitiveFailure);
        }
        completed = true;
      } finally {
        await sql.unsafe(
          'DELETE FROM applik8s_command_inbox WHERE binding_id = $1',
          [processorId],
        ).catch(() => undefined);
        await sql.unsafe(
          'DELETE FROM applik8s_stream_processor_checkpoints WHERE processor = $1',
          [processorName],
        ).catch(() => undefined);
        await sql.unsafe(
          'DELETE FROM applik8s_public_stream_events WHERE contract_name IN ($1, $2)',
          [streamName, changedName],
        ).catch(() => undefined);
        await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(post.tableName)}`).catch(() => undefined);
        await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(account.tableName)}`).catch(() => undefined);
        if (completed) {
          const [cleanup] = await sql.unsafe(
            `SELECT
               (SELECT count(*)::int FROM applik8s_stream_processor_checkpoints WHERE processor = $1) AS checkpoints,
               (SELECT count(*)::int FROM applik8s_public_stream_events WHERE contract_name IN ($2, $3)) AS events,
               to_regclass($4) AS post_table,
               to_regclass($5) AS account_table`,
            [
              processorName,
              streamName,
              changedName,
              post.tableName,
              account.tableName,
            ],
          );
          expect(cleanup).toMatchObject({
            checkpoints: 0,
            events: 0,
            post_table: null,
            account_table: null,
          });
        }
        await sql.end({ timeout: 5 });
        await collector?.close();
        await rm(outDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

function runtimeModel(
  name: string,
  tableName: string,
  connectionEnvName: string,
): ApplicationRuntimeModelContract {
  return {
    name,
    tableName,
    provider: 'postgres',
    database: 'function_native_worker',
    clusterName: 'function-native-worker',
    secretName: 'function-native-worker-app',
    secretKey: 'uri',
    secretNamespace: 'function-native-worker',
    connectionEnvName,
    constraints: [],
    indexes: [],
    retention: { mode: 'retain' },
  };
}

function functionNativeWorkerGraph(options: {
  readonly account: ApplicationRuntimeModelContract;
  readonly changedName: string;
  readonly environment: string;
  readonly post: ApplicationRuntimeModelContract;
  readonly processorId: string;
  readonly processorName: string;
  readonly sensitiveFailure: string;
  readonly streamName: string;
  readonly observability: boolean;
}): ApplicationGraph {
  const database = {
    name: 'function-native-worker',
    connectionEnvName: options.environment,
    secretName: 'function-native-worker-app',
    secretKey: 'uri',
    secretNamespace: 'function-native-worker',
  } as const;
  const nodes = [
    {
      id: 'model.generated-post',
      kind: 'model',
      name: options.post.name,
      stability: 'stable',
      runtime: options.post,
    },
    {
      id: 'model.generated-account',
      kind: 'model',
      name: options.account.name,
      stability: 'stable',
      runtime: options.account,
    },
    {
      id: 'event.generated-post-changed.v1',
      kind: 'event',
      name: `${options.changedName}.v1`,
      stability: 'stable',
      contract: {
        name: options.changedName,
        version: 'v1',
        payload: schema({
          type: 'object',
          properties: {
            postId: { type: 'string' },
            state: { type: 'string' },
          },
          required: ['postId', 'state'],
        }),
      },
    },
    {
      id: 'stream.generated-post-requested.v1',
      kind: 'stream',
      name: options.streamName,
      version: 'v1',
      stability: 'stable',
      payload: schema({
        type: 'object',
        properties: { postId: { type: 'string' } },
        required: ['postId'],
      }),
      authority: 'postgres-outbox',
      delivery: 'at-least-once',
      replay: 'supported',
      retention: { maxAgeSeconds: 3_600 },
      partitioning: 'declared',
      compatibility: 'versioned-schema',
      authorization: 'application-defined',
      database,
      partitionSource: 'event => event.postId',
      authorizationSource: '() => false',
    },
    {
      id: options.processorId,
      kind: 'streamProcessor',
      name: options.processorName,
      stability: 'stable',
      source: { nodeId: 'stream.generated-post-requested.v1' },
      database,
      handlerSource:
        `async (event, context) => { if (context.attempt === 1) throw new Error(${JSON.stringify(options.sensitiveFailure)}); return Post.edit(event.postId, async post => { const account = await Account.require(post.accountId); await post.update({ state: account.value.state }); PostChanged.emit({ postId: event.postId, state: account.value.state }); }); }`,
      functionNativeTransaction: {
        primaryModel: { nodeId: 'model.generated-post' },
        models: [
          { nodeId: 'model.generated-account' },
          { nodeId: 'model.generated-post' },
        ],
        modelBindings: [
          {
            identifier: 'Account.require',
            model: { nodeId: 'model.generated-account' },
            access: 'read',
          },
          {
            identifier: 'Post.edit',
            model: { nodeId: 'model.generated-post' },
            access: 'write',
          },
        ],
        eventBindings: [
          {
            identifier: 'PostChanged.emit',
            event: { nodeId: 'event.generated-post-changed.v1' },
          },
        ],
        outbox: [{ nodeId: 'event.generated-post-changed.v1' }],
        idempotency: 'source-event-id',
      },
      delivery: 'at-least-once',
      invocation: 'event',
      idempotency: 'source-event-id',
      checkpoint: 'postgres',
      failure: 'pause',
      retry: {
        mode: 'boundedExponentialBackoff',
        maxAttempts: 2,
        initialDelayMs: 25,
        maxDelayMs: 100,
        factor: 2,
      },
      deployment: {
        image: 'node:22-alpine',
        replicas: 1,
        concurrency: 1,
        maxAckPending: 16,
        healthPort: 8_080,
        gracefulShutdownSeconds: 10,
        resources: {},
        scaling: { mode: 'fixed' },
      },
      budgets: { timeoutMs: 10_000, maxInputBytes: 64_000 },
    },
    ...(options.observability
      ? [{
          id: 'provider.observability.v1alpha1.primary',
          kind: 'provider',
          name: 'Observability',
          stability: 'stable',
          interface: 'Observability',
          implementation: 'local-otel',
          config: {},
        }]
      : []),
  ] as unknown as ApplicationGraphNode[];
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: {
      name: `function-native-worker-${process.pid}`,
      namespace: 'function-native-worker',
    },
    nodes,
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function schema(jsonSchema: JsonObject) {
  return {
    kind: 'declared' as const,
    runtime: 'arktype' as const,
    jsonSchema,
  };
}

function startWorker(
  sourcePath: string,
  databaseEnvironment: string,
  url: string,
  port: number,
  telemetryEndpoint?: string,
): {
  readonly child: ChildProcess;
  readonly output: () => string;
} {
  let output = '';
  const child = spawn(process.execPath, [sourcePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [databaseEnvironment]: url,
      APPLIK8S_HEALTH_PORT: String(port),
      APPLIK8S_PROCESSOR_CONCURRENCY: '1',
      APPLIK8S_PROCESSOR_MAX_ACK_PENDING: '16',
      ...(telemetryEndpoint
        ? {
            APPLIK8S_APPLICATION_NAME: 'function-native-worker',
            APPLIK8S_ENVIRONMENT_ID: 'generated-processor-live',
            APPLIK8S_DEPLOYMENT_TARGET: 'local',
            OTEL_EXPORTER_OTLP_ENDPOINT: telemetryEndpoint,
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  return { child, output: () => output };
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  worker: { readonly child: ChildProcess; readonly output: () => string },
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      throw new Error(
        `Generated worker exited before satisfying the live assertion.\n${worker.output()}`,
      );
    }
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Generated worker did not satisfy the live assertion within 45 seconds.\n${worker.output()}`,
  );
}

async function effectCounts(
  sql: postgres.Sql,
  processorId: string,
  changedName: string,
): Promise<{
  readonly inbox: number;
  readonly outbox: number;
  readonly transitions: number;
}> {
  const [row] = await sql.unsafe(
    `SELECT
       (SELECT count(*)::int FROM applik8s_command_inbox WHERE binding_id = $1) AS inbox,
       (SELECT count(*)::int FROM applik8s_event_outbox WHERE contract_name = $2 AND contract_version = 'v1') AS outbox,
       (SELECT count(*)::int FROM applik8s_model_transitions transition
        JOIN applik8s_command_inbox inbox ON inbox.scope = transition.scope
        WHERE inbox.binding_id = $1) AS transitions`,
    [processorId, changedName],
  );
  return {
    inbox: Number(row?.inbox),
    outbox: Number(row?.outbox),
    transitions: Number(row?.transitions),
  };
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        address && typeof address === 'object' ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Unable to allocate a worker health port.'));
        else resolve(port);
      });
    });
  });
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly status?: { readonly code?: number };
  readonly attributes?: readonly OtlpAttribute[];
  readonly links?: readonly { readonly traceId?: string; readonly spanId?: string }[];
}

interface OtlpAttribute {
  readonly key?: string;
  readonly value?: Readonly<Record<string, unknown>>;
}

interface OtlpReceiver {
  readonly endpoint: string;
  payloads(): readonly unknown[];
  spans(): readonly OtlpSpan[];
  waitForTraces(): Promise<void>;
  close(): Promise<void>;
}

async function startOtlpReceiver(): Promise<OtlpReceiver> {
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
    spans: () => payloads.flatMap(otlpSpans),
    async waitForTraces() {
      const started = Date.now();
      while (Date.now() - started < 30_000) {
        if (payloads.flatMap(otlpSpans).length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Local OTLP receiver did not observe exported processor traces.');
    },
    close: () => closeServer(server),
  };
}

function otlpSpans(payload: unknown): OtlpSpan[] {
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
        ? spans.filter((span): span is OtlpSpan => Boolean(span && typeof span === 'object'))
        : [];
    });
  });
}

function attribute(span: OtlpSpan, key: string): string | number | boolean | undefined {
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isMissingRelation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && Reflect.get(error, 'code') === '42P01',
  );
}
