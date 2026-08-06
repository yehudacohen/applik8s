import { AI } from '@applik8s/ai';
import {
  app,
  IdentityProvider,
} from '@applik8s/applik8s';
import { event, type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const PublishPostInput = type({
  postId: 'string',
  body: 'string',
});
const PublishPostOutput = type({
  postId: 'string',
  state: "'published'",
});

const platform = app('function-agent-proof', {
  namespace: 'function-agent-proof',
  spec: type({ name: 'string' }),
  status: type({ ready: 'boolean' }),
});

platform.provide(
  AI,
  AI.deterministic({ fixture: { response: 'published' } }),
);
platform.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: 'function-agent-proof',
    subject: 'test',
    audience: ['function-agent-proof'],
    catalogRevision: 'catalog-test',
    authorityRevision: 'authority-test',
  }),
);

const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  state: text('state').notNull(),
});
const database = platform.database.postgres('application', {
  schema: { posts },
  migrations: { path: './drizzle' },
});
const Post = platform.model(posts, { name: 'Post', database });
const PostPublished = event('posts.published.v1', {
  payload: type({ postId: 'string', body: 'string' }),
});

export async function publishPost(
  input: typeof PublishPostInput.infer,
): Promise<typeof PublishPostOutput.infer> {
  return Post.edit(input.postId, async (post) => {
    await post.update({
      body: input.body,
      state: 'published',
    });
    PostPublished.emit({
      postId: post.id,
      body: input.body,
    });
    return {
      postId: post.id,
      state: 'published',
    };
  });
}

const publisher = platform.serviceIdentity('publisher');
publisher.can(publishPost);
export const Publisher = platform.agent(
  'publisher',
  {
    identity: publisher,
    model: AI.model('deterministic', {
      capabilities: [AI.chat, AI.tools],
    }),
    instructions: 'Publish an admitted post.',
    tools: [publishPost],
  },
  async (request, context) => ({
    threadId: request.threadId,
    runId: context.runId,
  }),
);

export const functionAgentProof = platform.composition;
