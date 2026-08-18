import type { ApplicationRelationalModel } from '@applik8s/applik8s';
import {
  causalPrincipalId,
  field,
  index,
  model,
  pgEnum,
} from '@applik8s/applik8s/drizzle';

export const applicationAgentProfileState = pgEnum('agent_profile_state', [
  'draft',
  'published',
  'retired',
]);

const agentProfileTable = model(
  'agent_profiles',
  {
    id: field.uuid('id').defaultRandom().primaryKey(),
    principalScope: field.text('principal_scope').notNull().default(causalPrincipalId),
    slug: field.text('slug').notNull(),
    name: field.text('name').notNull(),
    description: field.text('description').notNull().default(''),
    instructions: field.text('instructions').notNull(),
    logicalModel: field.text('logical_model').notNull().default('fast'),
    tools: field.text('tools').array().notNull().default([]),
    knowledgeSourceIds: field.text('knowledge_source_ids').array().notNull().default([]),
    memoryWindowMessages: field.integer('memory_window_messages').notNull().default(100),
    maximumTurns: field.integer('maximum_turns').notNull().default(5),
    maximumToolCalls: field.integer('maximum_tool_calls').notNull().default(8),
    outputContract: field.text('output_contract').notNull().default('Create or update an authoritative workspace Document when the request asks for a deliverable.'),
    state: applicationAgentProfileState('state').notNull().default('draft'),
    /** Human-readable agent-definition version; independent of the opaque model revision token. */
    version: field.integer('version').notNull().default(1),
    revision: field.text('revision').notNull().default(''),
    qualifiedVersion: field.integer('qualified_version'),
    qualificationScore: field.real('qualification_score'),
    qualifiedAt: field.timestamp('qualified_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  table => [
    index('agent_profiles_scope_slug_idx').on(table.principalScope, table.slug),
  ],
  { name: 'AgentProfile', revision: 'revision' },
);

export const applicationAgentProfiles: ApplicationRelationalModel<typeof agentProfileTable> = agentProfileTable;
export const applicationAgentSchema = Object.freeze({ applicationAgentProfiles });
