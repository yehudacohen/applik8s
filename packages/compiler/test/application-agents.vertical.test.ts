// typecast-file-boundary: generated-agent fixtures inspect JSON manifests only after compiler emission and explicit discriminator assertions.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI } from '@applik8s/ai';
import { app, applicationGraphFor } from '@applik8s/applik8s';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import { emitGeneratedApplicationAgents } from '../src/application-agents/index.js';
import {
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../src/application-operations/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated application AI agents', () => {
  it('emits one focused immutable workload with canonical tools and authority', async () => {
    const application = app('research-platform', {
      namespace: 'research-system',
    });
    application.provide(
      AI,
      AI.deterministic({ fixture: { response: 'deterministic evidence' } }),
    );
    const posts = pgTable('research_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const database = application.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = application.model(posts, { name: 'Post', database });
    const identity = application.serviceIdentity('researcher');
    application.agent(
      'researcher',
      {
        identity,
        model: AI.model('fast', {
          capabilities: [AI.chat, AI.tools, AI.streaming],
        }),
        instructions: 'Answer only with evidence.',
        tools: [Post.create],
        deployment: { replicas: 2, maximumConcurrency: 7 },
      },
      async (request, context) => ({
        threadId: request.threadId,
        runId: context.runId,
      }),
    );
    identity.can(Post.create);
    application.gateway('agent-tools', {
      commands: [Post.create],
      authorizeCommand: async () => true,
      deployment: {
        namespace: 'research-system',
        cursorSecret: {
          name: 'research-agent-gateway-cursor',
          key: 'key',
        },
        authenticate: async () => ({
          principal: {
            id: 'principal:test',
            identity: {
              id: 'identity:test',
              kind: 'human',
              issuer: 'https://identity.example.test',
              subject: 'test',
            },
            kind: 'human',
            authenticationMethod: 'test',
            audience: ['https://research.example.test'],
            trustedContextDigest: 'sha256:test',
            catalogRevision: 'catalog-test',
            authorityRevision: 'authority-test',
            admittedAt: '2026-07-30T00:00:00.000Z',
          },
          trustedContext: {},
        }),
      },
    });
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected an application graph.');
    const catalog = compileApplicationOperationCatalog(graph);
    const authority = compileApplicationWorkloadAuthority(graph, catalog);
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-agent-'));
    temporaryDirectories.push(outDir);

    const artifacts = await emitGeneratedApplicationAgents({
      graph,
      operationCatalog: catalog,
      workloadAuthority: authority,
      outDir,
      entrypoint: import.meta.filename,
    });

    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    if (!artifact) throw new Error('Expected one generated agent artifact.');
    expect(artifact.container.image).toMatch(
      /^applik8s\/research-platform-ai-agent-researcher:sha-[a-f0-9]{64}$/,
    );
    expect(artifact.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ServiceAccount',
          metadata: expect.objectContaining({
            name: 'researcher',
            namespace: 'research-system',
          }),
        }),
        expect.objectContaining({
          kind: 'Service',
          spec: expect.objectContaining({
            ports: [expect.objectContaining({ name: 'http', port: 3000 })],
          }),
        }),
        expect.objectContaining({
          kind: 'Deployment',
          spec: expect.objectContaining({
            replicas: 2,
            template: expect.objectContaining({
              spec: expect.objectContaining({
                automountServiceAccountToken: false,
                containers: [
                  expect.objectContaining({
                    env: expect.arrayContaining([
                      {
                        name: 'APPLIK8S_DATABASE_APPLICATION_URL',
                        valueFrom: {
                          secretKeyRef: {
                            name: 'application-app',
                            key: 'uri',
                            optional: false,
                          },
                        },
                      },
                    ]),
                  }),
                ],
              }),
            }),
          }),
        }),
      ]),
    );
    const manifest = JSON.parse(
      await readFile(artifact.manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      kind: 'GeneratedApplicationAgent',
      spec: {
        operationCatalogRevision: catalog.revision,
        tools: [
          {
            operationId: 'applik8s://models/Post/operations/create',
            transport: 'command',
            workloadAuthorityId: expect.stringMatching(/^workload-authority:/),
          },
        ],
      },
    });
    const source = await readFile(artifact.sourcePath, 'utf8');
    const normalizedSource = source.replaceAll('\\\n', '');
    expect(normalizedSource).toContain('x-applik8s-execution-admission');
    expect(normalizedSource).toContain('x-applik8s-internal-invocation');
    expect(normalizedSource).toContain(
      'Agent execution admission is required.',
    );
    expect(normalizedSource).toContain(
      'AI operation has no compiled placement route.',
    );
    expect(normalizedSource).not.toContain(
      'requires canonical execution-principal admission',
    );
    expect(JSON.stringify(artifact.resources)).toContain(
      'APPLIK8S_INTERNAL_OPERATION_SECRET',
    );
    expect(normalizedSource).toContain('applik8s_ai_attempts');
    expect(normalizedSource).toContain('completion-uncertain');
    expect(normalizedSource).toMatch(
      /return\{action:\w+\.action,runId:\w+,invocationId:/u,
    );
    expect(normalizedSource).toMatch(
      /recovery:\{observe:\w+=>\w+\.observe\(\w+\),timeoutMs:/u,
    );
    expect(normalizedSource).not.toContain(
      'stream joining and terminal replay must complete before redispatch',
    );
    expect(source).not.toContain('packageManagerAtStartup');
    expect(artifact.sizeBytes).toBeLessThan(1_500_000);
  });
});
