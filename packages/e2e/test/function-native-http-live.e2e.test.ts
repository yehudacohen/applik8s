// typecast-file-boundary: live qualification reads the compiler's normalized
// graph artifact to provision the exact generated model runtime contract.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationModelMigrationSql,
  type ApplicationRuntimeModelContract,
} from '../../applik8s/src/application-models.js';
import { compileTypeKroComposition } from '../../compiler/src/pipeline/index.js';

const databaseUrl =
  process.env.APPLIK8S_V07_FUNCTION_NATIVE_HTTP_DATABASE_URL;

describe('v0.7 exact generated function-native HTTP worker', () => {
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...children].map((child) => stopWorker(child)));
    children.clear();
  });

  it.skipIf(!databaseUrl)(
    'authenticates and executes Model.edit through the canonical durable PostgreSQL kernel',
    async () => {
      const suffix = `${process.pid}_${Date.now()}`;
      const applicationName = `http-live-${suffix.replaceAll('_', '-')}`
        .toLowerCase();
      const tableName = `http_live_posts_${suffix}`.toLowerCase();
      const directory = await mkdtemp(
        join(process.cwd(), '.tmp-applik8s-http-live-'),
      );
      const entrypoint = join(directory, 'application.ts');
      await mkdir(join(directory, 'migrations'));
      await writeFile(
        join(directory, 'migrations', '0000_posts.sql'),
        `create table ${tableName} (id text primary key, body text not null, revision text not null default '');\n`,
      );
      await writeFile(entrypoint, `
import { IdentityProvider, app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const posts = pgTable(${JSON.stringify(tableName)}, {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  revision: text('revision').notNull().default(''),
});
const application = app(${JSON.stringify(applicationName)}, {
  namespace: ${JSON.stringify(applicationName)},
});
application.provide(IdentityProvider, IdentityProvider.deterministic({
  mode: 'starter',
  application: ${JSON.stringify(applicationName)},
  subject: 'http-live-user',
  audience: [${JSON.stringify(applicationName)}],
  catalogRevision: 'http-live-catalog-v1',
  authorityRevision: 'http-live-authority-v1',
}));
const Database = application.database.postgres('main', {
  schema: { posts },
  migrations: { path: './migrations' },
});
const Post = application.model(posts, { name: 'Post', database: Database });
const api = application.http('public-api');
const updatePost = api.post('update-post', '/posts/:postId', {
  input: type({ body: 'string' }),
  output: type({ id: 'string', body: 'string' }),
}, async ({ input, params }) =>
  Post.edit(params.postId, async post => {
    await post.update({ body: input.body });
    return { id: params.postId, body: input.body };
  }));
updatePost.public();
export const httpLiveStack = application.composition;
`);

      const sql = postgres(databaseUrl!, {
        max: 4,
        idle_timeout: 5,
        connect_timeout: 5,
        prepare: false,
        onnotice: () => undefined,
      });
      try {
        const compiled = await compileTypeKroComposition({
          entrypoint,
          compositionName: 'httpLiveStack',
          outDir: join(directory, 'dist'),
          runtimeVersionRange: '^0.7.0',
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
        expect(compiled.value.artifacts.httpArtifacts).toHaveLength(1);

        const graph = JSON.parse(
          await readFile(
            compiled.value.artifacts.applicationGraphJsonPath ?? '',
            'utf8',
          ),
        ) as ApplicationGraph;
        const model = graph.nodes.find(
          (node) => node.kind === 'model' && node.name === 'Post',
        );
        if (model?.kind !== 'model' || !model.runtime) {
          throw new Error('Compiled HTTP fixture has no Post runtime.');
        }
        const runtime = model.runtime as ApplicationRuntimeModelContract;
        const infrastructureTable = `${runtime.tableName}_framework`;
        await sql.unsafe(applicationModelMigrationSql({
          ...runtime,
          name: 'HttpLiveFramework',
          tableName: infrastructureTable,
          constraints: [],
          indexes: [],
        }));
        await sql.unsafe(
          `DROP TABLE ${quoteIdentifier(infrastructureTable)}`,
        );
        await sql.unsafe(
          `CREATE TABLE ${quoteIdentifier(runtime.tableName)} (
             id text PRIMARY KEY,
             body text NOT NULL,
             revision text NOT NULL
           )`,
        );
        await sql.unsafe(`
          CREATE TABLE applik8s_model_change_commit_frontier (
            singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
            position bigint NOT NULL CHECK (position >= 0)
          );
          INSERT INTO applik8s_model_change_commit_frontier
            (singleton, position)
          VALUES (true, 0);
          CREATE TABLE applik8s_model_changes (
            sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            commit_position bigint NOT NULL UNIQUE,
            model text NOT NULL,
            operation text NOT NULL,
            identity jsonb,
            revision text,
            context_digest text NOT NULL,
            changed_fields jsonb,
            recorded_at timestamptz NOT NULL
          );
        `);
        await sql.unsafe(
          `INSERT INTO ${quoteIdentifier(runtime.tableName)}
             (id, body, revision)
           VALUES ($1, $2, $3)`,
          ['post-1', 'before', 'before'],
        );

        const artifact = compiled.value.artifacts.httpArtifacts[0]!;
        const port = await availablePort();
        const first = startWorker(
          artifact.sourcePath,
          runtime.connectionEnvName,
          databaseUrl!,
          port,
        );
        children.add(first.child);
        await waitUntilReady(port, first);
        const firstResult = await updatePost(
          port,
          'request-1',
          'after',
          first.stderr,
        );
        expect(firstResult).toEqual({ id: 'post-1', body: 'after' });
        const duplicate = await updatePost(
          port,
          'request-1',
          'after',
          first.stderr,
        );
        expect(duplicate).toEqual(firstResult);
        await stopWorker(first.child);
        children.delete(first.child);

        const second = startWorker(
          artifact.sourcePath,
          runtime.connectionEnvName,
          databaseUrl!,
          port,
        );
        children.add(second.child);
        await waitUntilReady(port, second);
        expect(
          await updatePost(port, 'request-1', 'after', second.stderr),
        ).toEqual(firstResult);

        const [row] = await sql.unsafe(
          `SELECT id, body, revision
           FROM ${quoteIdentifier(runtime.tableName)}
           WHERE id = 'post-1'`,
        );
        expect(row).toMatchObject({ id: 'post-1', body: 'after' });
        const [effects] = await sql.unsafe(
          `SELECT
             (SELECT count(*)::int
                FROM applik8s_command_inbox
               WHERE binding_id = $1) AS inbox,
             (SELECT count(*)::int
                FROM applik8s_model_transitions
               WHERE model = 'Post' AND target_key = 'post-1') AS transitions`,
          ['server.public-api:update-post'],
        );
        expect(effects).toEqual({ inbox: 1, transitions: 1 });
      } finally {
        await Promise.all([...children].map((child) => stopWorker(child)));
        children.clear();
        await sql.unsafe(
          `DELETE FROM applik8s_command_inbox
           WHERE binding_id = 'server.public-api:update-post'`,
        ).catch(() => undefined);
        await sql.unsafe(
          `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`,
        ).catch(() => undefined);
        await sql.end({ timeout: 5 });
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

function startWorker(
  sourcePath: string,
  connectionEnvName: string,
  connection: string,
  port: number,
): {
  readonly child: ChildProcess;
  readonly stderr: string[];
} {
  const stderr: string[] = [];
  const child = spawn(process.execPath, [sourcePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [connectionEnvName]: connection,
      APPLIK8S_HTTP_CONTEXT_SECRET:
        'v07-function-native-http-context-secret-0001',
      APPLIK8S_HTTP_PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
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

async function updatePost(
  port: number,
  idempotencyKey: string,
  body: string,
  stderr: readonly string[],
): Promise<unknown> {
  const response = await fetch(
    `http://127.0.0.1:${port}/posts/post-1`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ body }),
    },
  );
  const value = await response.json();
  if (!response.ok) {
    throw new Error(
      `Generated HTTP request failed (${response.status}): ${JSON.stringify(value)}; worker: ${stderr.join('')}`,
    );
  }
  return value;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
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

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
