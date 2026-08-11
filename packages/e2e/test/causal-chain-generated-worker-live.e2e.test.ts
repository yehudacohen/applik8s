// typecast-file-boundary: the live fixture restores one durable event envelope
// validated by the stream runtime before asserting the causal chain it carries.
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApplicationExecutionPrincipal,
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationPrincipal,
  JsonObject,
} from '@applik8s/core';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationModelMigrationSql,
  type ApplicationRuntimeModelContract,
} from '../../applik8s/src/application-models.js';
import { applicationRequestContextValues } from '../../applik8s/src/command-principal.js';
import { emitGeneratedApplicationReactive } from '../../compiler/src/application-reactive/index.js';

const databaseUrl = process.env.APPLIK8S_V07_CAUSAL_CHAIN_DATABASE_URL;

describe('v0.7 causal chain through the generated function-native processor', () => {
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopWorker(child)));
    children.clear();
  });

  it.skipIf(!databaseUrl)(
    'preserves the initiating human across the workflow execution and the processor hop durably',
    async () => {
      const suffix = `${process.pid}_${Date.now()}`;
      const environment = `APPLIK8S_V07_CAUSAL_CHAIN_${suffix}_DATABASE_URL`;
      const post = runtimeModel(
        `CausalPost${suffix}`,
        `causal_posts_${suffix}`,
        environment,
      );
      const processorId = `streamProcessor.attribute-${suffix}`;
      const processorName = `attribute-${suffix}`;
      const streamName = `posts.attributed.${suffix}`;
      const changedName = `posts.attributed-changed.${suffix}`;
      const outDir = await mkdtemp(
        join(tmpdir(), 'applik8s-causal-chain-live'),
      );

      const human: ApplicationPrincipal = Object.freeze({
        id: 'principal:human:user-1',
        identity: Object.freeze({
          id: 'identity:human:user-1',
          kind: 'human',
          issuer: 'https://identity.example.test',
          subject: 'user-1',
        }),
        kind: 'human',
        authenticationMethod: 'oidc',
        audience: ['research'],
        trustedContextDigest: 'a'.repeat(64),
        catalogRevision: 'catalog-1',
        authorityRevision: 'authority-1',
        admittedAt: '2026-08-07T12:00:00.000Z',
      });
      const workflow: ApplicationExecutionPrincipal = Object.freeze({
        ...human,
        id: 'execution:workflow:run-1',
        identity: Object.freeze({
          id: 'identity:workload:workflow-worker',
          kind: 'workload',
          issuer: 'applik8s://research',
          subject: 'workflow-worker',
        }),
        kind: 'execution',
        executionKind: 'workflow',
        executionId: 'workflow-run-1',
        attempt: 1,
        workloadIdentity: Object.freeze({
          id: 'identity:workload:workflow-worker',
          kind: 'workload',
          issuer: 'applik8s://research',
          subject: 'workflow-worker',
        }),
        causalPrincipalId: human.id,
        causalPrincipal: human.identity,
        causalGrantIds: ['grant:human-to-workflow'],
        deadline: '2026-08-07T12:05:00.000Z',
        cancellationRevision: 'active:1',
        bindings: [],
        effectiveAuthority: [],
      });

      const sql = postgres(databaseUrl!, {
        max: 4,
        idle_timeout: 5,
        connect_timeout: 5,
        prepare: false,
        onnotice: () => undefined,
      });

      try {
        await sql.unsafe(applicationModelMigrationSql(post));
        await sql.unsafe(`CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors (
          contract_name text NOT NULL,
          contract_version text NOT NULL,
          context_digest text NOT NULL,
          deleted_through bigint NOT NULL CHECK (deleted_through >= 0),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (contract_name, contract_version, context_digest)
        )`);
        await sql.unsafe(
          `INSERT INTO ${quoteIdentifier(post.tableName)} (id, spec, revision)
           VALUES ($1, $2::jsonb, $3)`,
          ['post-1', sql.json({ state: 'draft' }), 'post-before'],
        );
        const values = applicationRequestContextValues(
          workflow,
          workflow.authorityRevision,
          {},
        );
        const digest = createHash('sha256')
          .update(JSON.stringify(values))
          .digest('hex');
        const sourceEventId = `source-${suffix}`;
        const sourceRecordedAt = new Date().toISOString();
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
              trustedContext: { values, digest },
            }),
            sql.json({ postId: 'post-1' }),
            digest,
            sourceRecordedAt,
          ],
        );
        const sourceSequence = Number(sourceRows[0]?.sequence);
        expect(Number.isSafeInteger(sourceSequence)).toBe(true);

        const [artifact] = await emitGeneratedApplicationReactive({
          graph: causalChainWorkerGraph({
            changedName,
            environment,
            post,
            processorId,
            processorName,
            streamName,
          }),
          outDir,
          entrypoint: import.meta.filename,
        });
        expect(artifact?.kind).toBe('streamProcessorWorker');

        const port = await availablePort();
        const worker = startWorker(
          artifact?.sourcePath ?? '',
          environment,
          databaseUrl!,
          port,
        );
        children.add(worker.child);
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
              return Reflect.get(row?.spec ?? {}, 'state') === human.id
                && Number(checkpoint?.sequence ?? 0) >= sourceSequence;
            } catch (error) {
              return isMissingRelation(error) ? false : Promise.reject(error);
            }
          },
          worker,
        );
        await stopWorker(worker.child);
        children.delete(worker.child);

        await expect(effectCounts(sql, processorId, changedName)).resolves.toEqual({
          inbox: 1,
          outbox: 1,
          transitions: 1,
        });

        const [emitted] = await sql.unsafe(
          `SELECT envelope, context_digest FROM applik8s_public_stream_events
           WHERE contract_name = $1 AND contract_version = 'v1'`,
          [changedName],
        );
        const rawEnvelope = typeof emitted?.envelope === 'string'
          ? JSON.parse(emitted.envelope)
          : emitted?.envelope;
        const envelope = rawEnvelope as {
          readonly trustedContext?: {
            readonly values?: {
              readonly [key: string]: unknown;
            };
          };
        };
        const durablePrincipal = envelope.trustedContext?.values?.['applik8s.dev/principal'];
        expect(durablePrincipal).toMatchObject({
          id: workflow.id,
          kind: 'execution',
          executionKind: 'workflow',
          causalPrincipalId: human.id,
        });
        expect(emitted?.context_digest).toBe(digest);
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
        await sql.end({ timeout: 5 });
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
    database: 'causal_chain',
    clusterName: 'causal-chain-worker',
    secretName: 'causal-chain-worker-app',
    secretKey: 'uri',
    secretNamespace: 'causal-chain-worker',
    connectionEnvName,
    constraints: [],
    indexes: [],
    retention: { mode: 'retain' },
  };
}

function causalChainWorkerGraph(options: {
  readonly changedName: string;
  readonly environment: string;
  readonly post: ApplicationRuntimeModelContract;
  readonly processorId: string;
  readonly processorName: string;
  readonly streamName: string;
}): ApplicationGraph {
  const database = {
    name: 'causal-chain-worker',
    connectionEnvName: options.environment,
    secretName: 'causal-chain-worker-app',
    secretKey: 'uri',
    secretNamespace: 'causal-chain-worker',
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
        'async (event, context) => Post.edit(event.postId, async post => { const causal = context.principal?.causalPrincipalId ?? "unattributed"; await post.update({ state: causal }); PostChanged.emit({ postId: event.postId, state: causal }); })',
      functionNativeTransaction: {
        primaryModel: { nodeId: 'model.generated-post' },
        models: [{ nodeId: 'model.generated-post' }],
        modelBindings: [
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
  ] as unknown as ApplicationGraphNode[];
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: {
      name: `causal-chain-worker-${process.pid}`,
      namespace: 'causal-chain-worker',
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
    const server = createServer();
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
