import { AI } from '@applik8s/ai';
import {
  ApplicationHost,
  actor,
  app,
  defineApplicationProvider,
  IdentityProvider,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';

const platform = app('agent-actor-proof', {
  namespace: 'agent-actor-proof',
  spec: type({ name: 'string', profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
const AcquisitionProvider = defineApplicationProvider<{
  readonly kind: 'acquisition';
  acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
}>({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  accepts: (candidate): candidate is {
    readonly kind: 'acquisition';
    acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
  } => candidate !== null
    && typeof candidate === 'object'
    && Reflect.get(candidate, 'kind') === 'acquisition'
    && typeof Reflect.get(candidate, 'acquire') === 'function',
}).named('primary');
platform
  .profile(platform.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => ({
    kind: 'acquisition',
    async acquire({ id }) { return { value: `starter:${id}` }; },
  }))
  .dedicated(() => ({
    kind: 'acquisition',
    async acquire({ id }) { return { value: `dedicated:${id}` }; },
  }))
  .exhaustive();
const acquisition = platform.inject(AcquisitionProvider);
const acquire = acquisition.acquire;
platform.provide(AI, AI.deterministic({ fixture: { response: 'recorded' } }));
platform.provide(ApplicationHost, ApplicationHost.managed({ replicas: 1, port: 3_000 }));
platform.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: 'agent-actor-proof',
    subject: 'test',
    audience: ['agent-actor-proof'],
    catalogRevision: 'catalog-test',
    authorityRevision: 'authority-test',
  }),
);

const conversations = pgTable('agent_actor_conversations', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
});
const database = platform.database.postgres('application', {
  schema: { conversations },
  migrations: { path: './drizzle' },
});
const Conversation = platform.model(conversations, {
  name: 'Conversation',
  database,
});
export const ResearchSession = platform.actor('research-session.v1', {
  key: type('string'),
  state: type({ observations: 'number.integer >= 0' }),
  protocol: {
    record: actor.command({
      input: type({ body: 'string' }),
      output: type({ observations: 'number.integer >= 0' }),
    }),
  },
});
ResearchSession.on.initialize(() => ({ observations: 0 }));
ResearchSession.on.record(async (session) => {
  const current = await session.state();
  const observations = current.observations + 1;
  await session.setState({ observations });
  return { observations };
});

const researcher = platform.serviceIdentity('researcher');
researcher.can(Conversation.create, ResearchSession.record);
export const Researcher = platform.agent(
  'researcher',
  {
    identity: researcher,
    model: AI.model('deterministic', { capabilities: [AI.chat, AI.tools] }),
    instructions: 'Record one observation.',
    tools: [Conversation.create],
  },
  async (request, context) => ({
    threadId: request.threadId,
    runId: context.runId,
    result: await ResearchSession.record(context.runId, {
      body: (await acquire({ id: context.runId })).value,
    }),
  }),
);

export const agentActorProof = platform.composition;
