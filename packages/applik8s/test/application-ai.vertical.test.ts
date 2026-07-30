// typecast-file-boundary: negative AI authoring fixtures deliberately erase operation types to prove construction fails closed.
import { AI } from '@applik8s/ai';
import { app, applicationGraphFor } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('application AI agents', () => {
  it('binds a logical model to an exhaustively selected qualified inference provider', () => {
    const application = app('profiled-ai', {
      spec: type({
        name: 'string',
        profile: "'starter' | 'dedicated' | 'external'",
      }),
      status: type({ ready: 'boolean' }),
    });
    const Inference = AI.named('inference');
    application
      .profile(application.installation.spec, 'profile')
      .provide(Inference)
      .starter(() => AI.deterministic())
      .dedicated(() => AI.deterministic())
      .external(() => AI.deterministic())
      .exhaustive();

    expect(
      AI.model('fast', {
        inference: application.inject(Inference),
        capabilities: [AI.chat, AI.tools],
      }),
    ).toMatchObject({
      inference: {
        qualification: {
          capability: 'AI',
          name: 'inference',
          key: 'AI@v1alpha1:inference',
        },
      },
    });
  });

  it('records one portable agent node over a logical model, service identity, and canonical tools', () => {
    const research = app('research-platform', { namespace: 'research-system' });
    research.provide(AI, AI.deterministic());
    const posts = pgTable('research_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const database = research.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = research.model(posts, { name: 'Post', database });
    const identity = research.serviceIdentity('source-researcher');
    const model = AI.model('reasoning', {
      capabilities: [AI.chat, AI.tools, AI.streaming],
      constraints: {
        dataResidency: ['us'],
        maximumInputCostPerMillion: 5,
      },
    });

    const agent = research.agent('source-researcher', {
      identity,
      model,
      instructions: 'Research the supplied source and write only supported conclusions.',
      tools: [Post.create],
      budgets: {
        maximumInputTokens: 8_000,
        maximumOutputTokens: 2_000,
        timeoutMs: 90_000,
      },
      deployment: {
        replicas: 2,
        maximumConcurrency: 12,
      },
    }, async (request, context) => ({
      threadId: request.threadId,
      runId: context.runId,
      adapterKind: context.tanstack.adapter.kind,
      toolCount: context.tanstack.tools.length,
      invocationId: context.tanstack.execution.invocationId,
    }));
    identity.can(Post.create);

    const graph = applicationGraphFor(research.composition);
    expect(agent).toMatchObject({
      kind: 'applicationAgent',
      name: 'source-researcher',
      model: { name: 'reasoning' },
    });
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'AI',
        implementation: 'ai-deterministic',
        config: expect.objectContaining({
          ai: expect.objectContaining({ kind: 'ai-deterministic' }),
        }),
      }),
      expect.objectContaining({
        kind: 'aiAgent',
        name: 'source-researcher',
        serviceIdentity: expect.objectContaining({
          id: 'identity:research-platform:service:source-researcher',
        }),
        model: expect.objectContaining({
          name: 'reasoning',
          capabilities: ['chat', 'tools', 'streaming'],
        }),
        inference: {
          interface: 'AI',
          nodeId: 'provider.ai',
        },
        tools: [
          expect.objectContaining({
            operationId: 'applik8s://models/Post/operations/create',
            graphNode: { nodeId: 'model.post' },
          }),
        ],
        compatibility: expect.objectContaining({
          tanstackAI: '0.42.0',
          tanstackAIPersistence: 'unreleased',
          applik8sAdapter: 'applik8s.ai-tanstack/v1alpha1',
        }),
        runtime: 'node',
        lifecycle: 'longLived',
        deployment: expect.objectContaining({
          replicas: 2,
          maximumConcurrency: 12,
          healthPort: 8081,
        }),
        handlerSource: expect.stringContaining('async'),
      }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        interface: 'AI',
        consumer: { nodeId: 'aiAgent.source-researcher' },
        purpose: 'agentInference',
      }),
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      {
        from: { nodeId: 'provider.ai' },
        to: { nodeId: 'aiAgent.source-researcher' },
        relationship: 'provides',
      },
      {
        from: { nodeId: 'aiAgent.source-researcher' },
        to: { nodeId: 'model.post' },
        relationship: 'writes',
      },
    ]));
    if (!graph) throw new Error('Expected application graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('fails graph validation when an agent tool has no baseline, requestable, or delegated authority', () => {
    const application = app('unauthorized-agent');
    application.provide(AI, AI.deterministic());
    const posts = pgTable('unauthorized_posts', {
      id: text('id').primaryKey(),
    });
    const database = application.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = application.model(posts, { name: 'Post', database });
    const identity = application.serviceIdentity('writer');
    application.agent('writer', {
      identity,
      model: AI.model('fast', { capabilities: [AI.chat, AI.tools] }),
      instructions: 'Write a post.',
      tools: [Post.create],
    }, async (_request, context) => ({ runId: context.runId }));

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected application graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining(
          'tool applik8s://models/Post/operations/create is unavailable',
        ),
      }),
    ]));
  });

  it('rejects tools that lack preserved authoring schemas', () => {
    const application = app('unsafe-tool-agent');
    application.provide(AI, AI.deterministic());
    const identity = application.serviceIdentity('unsafe');
    const model = AI.model('fast', { capabilities: [AI.chat, AI.tools] });
    const unsafe = Object.assign(async () => ({}), {
      operation: {
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: 'applik8s://models/Unsafe/operations/run',
        model: 'Unsafe',
        name: 'run',
        operation: 'custom',
        transport: 'runtime',
      },
    });

    expect(() => application.agent('unsafe', {
      identity,
      model,
      instructions: 'Do not run.',
      // typecast: this fixture intentionally bypasses the public operation
      // constructor to prove that missing authoring schemas fail closed.
      tools: [unsafe as never],
    }, async (_request, context) => ({ runId: context.runId }))).toThrow(
      /must be an application operation handle|authored input\/output schemas/,
    );
  });
});
