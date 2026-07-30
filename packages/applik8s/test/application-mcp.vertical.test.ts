import { app, applicationGraphFor } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { compileApplicationOperationCatalog } from '@applik8s/compiler';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('application MCP declarations', () => {
  it('exposes an existing operation without copying its implementation or schema', () => {
    const application = app('research-platform', {
      namespace: 'research-system',
    });
    const posts = pgTable('research_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const database = application.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = application.model(posts, { name: 'Post', database });
    application.permission('post-writer', Post.create);
    application.permission('post-maintainer', Post.update, Post.delete);
    const server = application.mcp('research', {
      tools: [Post.create],
      resource: 'https://research.example.test/mcp',
      authorizationServers: ['https://identity.example.test'],
    });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected application graph.');
    expect(server).toMatchObject({
      kind: 'applicationMcpServer',
      name: 'research',
      path: '/__applik8s/mcp/research',
      tools: [{
        name: 'create',
        operation: Post.create,
        operationId: 'applik8s://models/Post/operations/create',
      }],
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'mcpServer',
        name: 'research',
        resource: 'https://research.example.test/mcp',
        audience: 'https://research.example.test/mcp',
        tools: [{
          publicName: 'create',
          operationId: 'applik8s://models/Post/operations/create',
          schemaRevision: 'operation',
        }],
        sessions: expect.objectContaining({
          mode: 'stateful-pinned',
          authorization: 'revalidate-every-call',
          incompatibleBindings: 'reinitialize',
        }),
        transport: expect.objectContaining({
          protectedResourceMetadata: true,
          tokenPassthrough: 'forbidden',
        }),
      }),
    ]));
    expect(validateApplicationGraphStructure(graph)).toEqual([]);

    const catalog = compileApplicationOperationCatalog(graph, {
      requireClassified: true,
    });
    const operation = catalog.operations.find(
      (candidate) =>
        candidate.id === 'applik8s://models/Post/operations/create',
    );
    expect(operation?.transports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mcp.research.create',
        transport: 'mcp',
        mcp: {
          server: 'research',
          tool: 'create',
          schemaRevision: `${operation?.input.digest}:${operation?.output.digest}`,
        },
      }),
    ]));
    expect(operation?.placement.runtime).toBe('command-processor');
  });

  it('records external clients as allowlisted, separately credentialed egress', () => {
    const application = app('external-tools');
    const credentials = application.secret('retrieval-oauth', {
      secretName: 'retrieval-oauth',
      key: 'client-secret',
      ownership: 'external',
    });
    const client = application.mcp.client('retrieval', {
      server: 'https://retrieval.example.test/mcp',
      resource: 'https://retrieval.example.test/mcp',
      audience: 'https://retrieval.example.test/mcp',
      credentials,
      tools: [
        { name: 'fetch', schemaRevision: 'sha256:fetch-v1' },
        'screenshot',
      ],
      timeout: '30s',
      concurrency: 8,
      maximumResponseBytes: 10_000_000,
    });
    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected application graph.');
    expect(client).toMatchObject({
      kind: 'applicationMcpClient',
      name: 'retrieval',
      tools: ['fetch', 'screenshot'],
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'mcpClient',
        credentials: { nodeId: 'secret.retrieval-oauth' },
        egress: {
          timeoutMs: 30_000,
          concurrency: 8,
          maximumRequestBytes: 1_048_576,
          maximumResponseBytes: 10_000_000,
          tokenPassthrough: 'forbidden',
          schemaChanges: 'quarantine',
        },
        tools: [
          {
            name: 'fetch',
            schemaRevision: 'sha256:fetch-v1',
            contentClassification: 'untrusted-external',
          },
          {
            name: 'screenshot',
            contentClassification: 'untrusted-external',
          },
        ],
      }),
    ]));
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('fails duplicate public tool names instead of guessing an alias', () => {
    const application = app('mcp-collision');
    const posts = pgTable('collision_posts', {
      id: text('id').primaryKey(),
    });
    const database = application.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = application.model(posts, { name: 'Post', database });
    expect(() => application.mcp('research', {
      tools: [
        Post.create,
        { name: 'create', operation: Post.delete },
      ],
    })).toThrow(/duplicate public tool name create/);
  });
});
