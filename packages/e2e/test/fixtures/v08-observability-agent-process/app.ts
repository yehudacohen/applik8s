import { AI } from '@applik8s/ai';
import {
  ApplicationHost,
  app,
  IdentityProvider,
  Observability,
  type,
} from '@applik8s/applik8s';
import { chat } from '@tanstack/ai';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

const namespace = 'v08-observability-agent';
const agentPort = Number(process.env.APPLIK8S_V08_AGENT_PROCESS_PORT ?? '31080');

const posts = pgTable('v08_observability_agent_posts', {
  id: uuid('id').primaryKey(),
  body: text('body').notNull(),
  state: text('state').notNull(),
  revision: text('revision').notNull().default(''),
});

const PublishPostInput = type({
  postId: 'string',
  body: 'string',
});
const PublishPostOutput = type({
  postId: 'string',
  state: "'published'",
});

const application = app('v08-observability-agent', { namespace });
application.provide(Observability, Observability.local());
application.provide(
  ApplicationHost,
  ApplicationHost.managed({ replicas: 1, port: 3_000 }),
);
application.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: 'v08-observability-agent',
    subject: 'agent-reviewer',
    audience: ['v08-observability-agent'],
    catalogRevision: 'v08-observability-agent-catalog-v1',
    authorityRevision: 'v1',
  }),
);
application.provide(
  AI,
  AI.deterministic({
    latencyMs: 350,
    fixture: {
      response: 'The post was published through the typed operation.',
      tool: {
        index: 0,
        input: {
          postId: '10000000-0000-0000-0000-000000000808',
          body: 'published by the generated agent process',
        },
      },
    },
  }),
);

const database = application.database.postgres('agent-state', {
  schema: { posts },
  migrations: './migrations',
  database: 'v08_observability_agent',
});
const Post = application.model(posts, { name: 'Post', database });

export async function publishPost(
  input: typeof PublishPostInput.infer,
): Promise<typeof PublishPostOutput.infer> {
  return Post.edit(input.postId, async (post) => {
    await post.update({ body: input.body, state: 'published' });
    return { postId: post.id, state: 'published' };
  });
}

const publisher = application.serviceIdentity('publisher');
publisher.can(publishPost);

export const Publisher = application.agent(
  'publisher',
  {
    identity: publisher,
    model: AI.model('deterministic', {
      capabilities: [AI.chat, AI.tools, AI.streaming],
    }),
    instructions: 'Publish the admitted post using the declared typed tool.',
    tools: [publishPost],
    budgets: { timeoutMs: 10_000 },
    deployment: {
      port: agentPort,
      maximumConcurrency: 2,
      gracefulShutdownSeconds: 5,
    },
  },
  async (request, context) => chat({
    adapter: context.tanstack.adapter,
    messages: request.messages,
    threadId: request.threadId,
    runId: context.runId,
    tools: context.tanstack.tools,
    context: context.tanstack.execution,
  }),
);

export const v08ObservabilityAgentProcess = application.composition;
