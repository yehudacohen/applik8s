import { AI } from '@applik8s/ai';
import {
  app,
  IdentityProvider,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';

const platform = app('agent-query-proof', {
  namespace: 'agent-query-proof',
  spec: type({ name: 'string' }),
  status: type({ ready: 'boolean' }),
});

platform.provide(
  AI,
  AI.deterministic({ fixture: { response: 'found' } }),
);
platform.provide(
  IdentityProvider,
  IdentityProvider.deterministic({
    mode: 'starter',
    application: 'agent-query-proof',
    subject: 'test',
    audience: ['agent-query-proof'],
    catalogRevision: 'catalog-test',
    authorityRevision: 'authority-test',
  }),
);

const records = pgTable('agent_query_records', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
});
const audits = pgTable('agent_query_audits', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
});
const database = platform.database.postgres('application', {
  schema: { records, audits },
  migrations: { path: './drizzle' },
});
const Record = platform.model(records, { name: 'Record', database });
const Audit = platform.model(audits, { name: 'Audit', database });

export const RecordById = Record.view({
  input: type({ id: 'string' }),
  output: type({ id: 'string', body: 'string' }).or('null'),
  database,
  authorize: ({ principal }) => principal.id.length > 0,
}, async function loadRecord(input, context) {
  const [record] = await context.database(database)
    .select()
    .from(Record)
    .where(eq(Record.id, input.id))
    .limit(1);
  return record ?? null;
});

platform.gateway('queries', {
  queries: [RecordById],
  deployment: {
    namespace: 'agent-query-proof',
    cursorSecret: {
      name: 'agent-query-cursor',
      namespace: 'agent-query-proof',
      key: 'key',
    },
  },
});

const researcher = platform.serviceIdentity('researcher');
researcher.can(Record.create, Audit.create, RecordById);
export const Researcher = platform.agent(
  'researcher',
  {
    identity: researcher,
    model: AI.model('deterministic', {
      capabilities: [AI.chat, AI.tools],
    }),
    instructions: 'Load one record before answering.',
    tools: [Record.create],
  },
  async (request, context) => {
    await Audit.create({ id: context.runId, body: 'agent callback admitted' });
    return {
      threadId: request.threadId,
      runId: context.runId,
      record: await RecordById({ id: request.threadId }),
    };
  },
);

export const agentQueryProof = platform.composition;
