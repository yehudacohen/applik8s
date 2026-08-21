// typecast-file-boundary: tests inspect heterogeneous generated Kubernetes
// resources after discriminating their runtime metadata and graph kinds.
import {
  app,
  applicationGraphFor,
  WorkflowEngine,
  workflow,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { bindApplicationCallableDependencies } from '@applik8s/applik8s/internal/provider-runtime';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('function-native HTTP authoring', () => {
  it('captures durable workflow calls as generated route bindings', () => {
    const application = app('typed-http-workflow', {
      namespace: 'typed-http-workflow',
    });
    application.provide(
      WorkflowEngine,
      WorkflowEngine.hatchet({ namespace: 'typed-http-workflow' }),
    );
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
    api.post(
      'provision-tenant',
      '/tenants/provision',
      {
        input: type({ tenantId: 'string' }),
        output: type({ accepted: 'boolean' }),
        __generatedCalls: [provision],
        __generatedBindings: { provision },
      },
      async ({ input }) =>
        provision(input, { idempotencyKey: input.tenantId }),
    ).public();

    const graph = applicationGraphFor(application.composition);
    const server = graph?.nodes.find(
      (node) => node.kind === 'server' && node.name === 'public-api',
    );
    expect(server?.kind === 'server' ? server.routes[0] : undefined)
      .toMatchObject({
        functionNative: {
          workflowBindings: [{
            identifier: 'provision',
            target: { nodeId: 'workflow.tenant.provision.v1' },
            contract: {
              name: 'tenant.provision',
              version: 'v1',
              input: expect.any(Object),
              output: expect.any(Object),
              signals: [],
            },
          }],
          workflowEngine: {
            interface: 'WorkflowEngine',
            nodeId: 'provider.workflow-engine',
          },
        },
      });
    expect(graph?.edges).toContainEqual({
      from: { nodeId: 'server.public-api' },
      to: { nodeId: 'workflow.tenant.provision.v1' },
      relationship: 'dependsOn',
    });
  });

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

  it('models signed webhooks as raw provider admission followed by typed input', () => {
    const application = app('typed-webhook', { namespace: 'typed-webhook' });
    const api = application.http('provider-events');
    const receive = api.webhook(
      'receive-event',
      '/webhooks/provider',
      {
        event: type({ id: 'string > 0', state: "'ready' | 'failed'" }),
        output: type({ received: 'true', id: 'string > 0' }),
        authenticate: async request => {
          if (!request.headers['provider-signature']) {
            throw new Error('signature missing');
          }
          return {
            id: new TextDecoder().decode(request.body),
            state: 'ready' as const,
          };
        },
      },
      async ({ input }) => ({ received: true as const, id: input.id }),
    );

    const server = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'server' && node.name === 'provider-events',
    );
    expect(server?.kind === 'server' ? server.routes[0] : undefined)
      .toMatchObject({
        path: '/webhooks/provider',
        authority: { classification: 'public' },
        functionNative: {
          webhookAuthentication: {
            source: expect.stringContaining('provider-signature'),
          },
          requestBoundary: {
            durableValues: 'schema-normalized-only',
            rawRequestCapture: 'rejected',
            principal: 'provider-authenticated',
          },
        },
      });
    expect(typeof receive).toBe('function');
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
        runtimeOperationId: 'Post.create',
        command: { nodeId: 'command.models.post.create.v1' },
        handler: { nodeId: 'command-handler.post-models.post.create.v1' },
      },
    ]);
  });

  it('infers a managed read scope for direct model reads reached through helpers', () => {
    const posts = pgTable('function_native_http_read_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const application = app('typed-http-model-read', {
      namespace: 'typed-http-model-read',
    });
    const Database = application.database.postgres('main', {
      schema: { posts },
    });
    const Post = application.model(posts, { name: 'Post', database: Database });
    const api = application.http('public-api');
    api.post(
      'list-posts',
      '/posts/list',
      {
        input: type({}),
        output: type({ count: 'number' }),
        // Compiler-equivalent transitive helper metadata.
        __generatedBindings: { 'Post.find': Post.find },
      },
      async () => ({ count: (await Post.find({ limit: 10 })).length }),
    );

    const route = applicationGraphFor(application.composition)?.nodes
      .find((node) => node.kind === 'server')
      ?.routes[0];
    expect(route?.functionNative?.transaction).toMatchObject({
      primaryModel: { nodeId: 'model.post' },
      models: [{ nodeId: 'model.post' }],
      modelBindings: [{
        identifier: 'Post.find',
        model: { nodeId: 'model.post' },
        access: 'read',
      }],
    });
  });

  it('expands maintained-module callable metadata without exposing dependency ceremony', () => {
    const records = pgTable('maintained_callable_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull().default(''),
    });
    const application = app('maintained-callable-dependencies');
    const Database = application.database.postgres('main', {
      schema: { records },
    });
    const Record = application.model(records, {
      name: 'Record',
      database: Database,
    });
    const listRecords = async () => Record.find({ limit: 10 });
    bindApplicationCallableDependencies(
      listRecords as (...args: never[]) => unknown,
      [{ identifier: 'Record.find', value: Record.find }],
    );
    const api = application.http('public-api');
    api.post(
      'count-records',
      '/records/count',
      {
        input: type({}),
        output: type({ count: 'number' }),
        // Compiler instrumentation records only the ordinary maintained call.
        __generatedCalls: [listRecords],
      },
      async () => ({ count: (await listRecords()).length }),
    );

    const route = applicationGraphFor(application.composition)?.nodes
      .find((node) => node.kind === 'server')
      ?.routes[0];
    expect(route?.functionNative?.transaction?.modelBindings).toEqual([
      {
        identifier: 'Record.find',
        model: { nodeId: 'model.record' },
        access: 'read',
      },
    ]);
  });
});
