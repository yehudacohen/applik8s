// typecast-file-boundary: tests inspect heterogeneous generated Kubernetes
// resources after discriminating their runtime metadata and graph kinds.
import { app, applicationGraphFor } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { text, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('function-native HTTP authoring', () => {
  it('collects typed routes once and lowers their boundary into the application graph', async () => {
    const application = app('typed-http', { namespace: 'typed-http' });
    const api = application.http('public-api', { replicas: 2 });
    api.post(
      'update-post',
      '/posts/:id',
      {
        input: type({ id: 'string', body: 'string' }),
        output: type({ id: 'string', body: 'string' }),
        authorize: async (_request, context) =>
          context.principal.id !== 'anonymous',
      },
      async ({ input }) => input,
    );
    const createPost = api.post(
      'create-post',
      '/posts',
      {
        input: type({ body: 'string' }),
        output: type({ id: 'string', body: 'string' }),
        authorize: async (_request, context) =>
          context.principal.id !== 'anonymous',
      },
      async ({ input }) => ({ id: 'post-1', body: input.body }),
    );
    createPost.public();

    const graph = applicationGraphFor(application.composition);
    const server = graph?.nodes.find(
      (node) => node.kind === 'server' && node.name === 'public-api',
    );
    expect(server).toMatchObject({
      kind: 'server',
    });
    if (!server || server.kind !== 'server') {
      throw new Error('Expected the function-native HTTP server.');
    }
    expect(server.routes.find(route => route.id === 'create-post')).toMatchObject({
        id: 'create-post',
        method: 'POST',
        path: '/posts',
        authority: { classification: 'public' },
        functionNative: {
          input: {
            kind: 'declared',
            runtime: 'arktype',
            jsonSchema: expect.objectContaining({ type: 'object' }),
          },
          output: {
            kind: 'declared',
            runtime: 'arktype',
            jsonSchema: expect.objectContaining({ type: 'object' }),
          },
          handler: expect.objectContaining({
            source: expect.stringContaining('input'),
          }),
          authorize: expect.objectContaining({
            source: expect.stringContaining('principal'),
          }),
          idempotency: {
            source: 'http-idempotency-key',
            contextScoped: true,
          },
          requestBoundary: {
            durableValues: 'schema-normalized-only',
            rawRequestCapture: 'rejected',
            principal: 'framework-authenticated',
          },
        },
      });
    expect(server.routes.find(route => route.id === 'update-post')).toMatchObject({
        id: 'update-post',
        authority: { classification: 'application-policy' },
      });
    expect(
      graph?.nodes.filter(
        (node) => node.kind === 'server' && node.name === 'public-api',
      ),
    ).toHaveLength(1);
    expect(application.resources.some((resource) => {
      // typecast: narrow heterogeneous resource metadata for the compiler-only
      // workload ownership assertion.
      const candidate = resource as object;
      const metadata = Reflect.get(candidate, 'metadata');
      return metadata !== null
        && typeof metadata === 'object'
        && Reflect.get(metadata, 'name') === 'public-api';
    })).toBe(false);
    await expect(createPost({ body: 'unsafe-local-bypass' })).rejects.toThrow(
      'generated authenticated route boundary',
    );
  });

  it('fails closed for duplicate route and server identities', () => {
    const application = app('typed-http-duplicates');
    const api = application.http('public-api');
    const contract = {
      input: type({ body: 'string' }),
      output: type({ body: 'string' }),
    };
    api.post('echo', '/echo', contract, async ({ input }) => input);
    expect(() =>
      api.post('echo', '/other', contract, async ({ input }) => input),
    ).toThrow('already declared');
    expect(() => application.http('public-api')).toThrow('already declared');
  });

  it('captures direct model operations without an author-declared dependency map', () => {
    const posts = pgTable('function_native_http_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const application = app('typed-http-model', {
      namespace: 'typed-http-model',
    });
    const Database = application.database.postgres('main', {
      schema: { posts },
    });
    const Post = application.model(posts, { name: 'Post', database: Database });
    const api = application.http('public-api');
    api.post(
      'create-post',
      '/posts',
      {
        input: type({ id: 'string', body: 'string' }),
        output: type({
          identity: 'string',
          value: { id: 'string', body: 'string', revision: 'string' },
          'revision?': 'string',
        }),
        // Compiler-equivalent metadata; application source never writes this.
        __generatedBindings: { 'Post.create': Post.create },
      },
      async ({ input }) => Post.create(input),
    );

    const route = applicationGraphFor(application.composition)?.nodes
      .find((node) => node.kind === 'server')
      ?.routes[0];
    expect(route?.functionNative?.operationBindings).toEqual([
      {
        identifier: 'Post.create',
        operationId: 'applik8s://models/Post/operations/create',
        command: { nodeId: 'command.models.post.create.v1' },
        handler: { nodeId: 'command-handler.post-models.post.create.v1' },
      },
    ]);
  });
});
