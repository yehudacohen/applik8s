import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { and, desc, eq } from 'drizzle-orm';
import { applicationAgentProfiles } from './schema.js';

export const applicationAgentProfileResultSchema = type({
  id: 'string', principalScope: 'string', slug: 'string', name: 'string',
  description: 'string', instructions: 'string', logicalModel: 'string',
  tools: 'string[]', knowledgeSourceIds: 'string[]', memoryWindowMessages: 'number',
  maximumTurns: 'number', maximumToolCalls: 'number', outputContract: 'string',
  state: "'draft' | 'published' | 'retired'", version: 'number', revision: 'string',
  qualifiedVersion: 'number | null', qualificationScore: 'number | null',
  qualifiedAt: 'string | null', createdAt: 'string', updatedAt: 'string',
});

export interface ApplicationAgentQueryOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
}

export async function listApplicationAgentProfiles<TSchema extends Readonly<Record<string, unknown>>>(
  _input: object,
  context: ApplicationModelViewContext,
  options: ApplicationAgentQueryOptions<TSchema>,
) {
  return context.database(options.database).select().from(applicationAgentProfiles)
    .where(eq(applicationAgentProfiles.principalScope, options.scope(context)))
    .orderBy(desc(applicationAgentProfiles.updatedAt)).limit(50);
}

export async function loadActiveApplicationAgentProfile<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly slug: string },
  context: ApplicationModelViewContext,
  options: ApplicationAgentQueryOptions<TSchema>,
) {
  const [profile] = await context.database(options.database).select().from(applicationAgentProfiles)
    .where(and(
      eq(applicationAgentProfiles.principalScope, options.scope(context)),
      eq(applicationAgentProfiles.slug, input.slug),
      eq(applicationAgentProfiles.state, 'published'),
    )).orderBy(desc(applicationAgentProfiles.updatedAt)).limit(1);
  return profile ?? null;
}

export async function loadApplicationAgentProfileVersion<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly id: string; readonly version: number },
  context: ApplicationModelViewContext,
  options: ApplicationAgentQueryOptions<TSchema>,
) {
  const [profile] = await context.database(options.database).select().from(applicationAgentProfiles)
    .where(and(
      eq(applicationAgentProfiles.id, input.id),
      eq(applicationAgentProfiles.principalScope, options.scope(context)),
      eq(applicationAgentProfiles.version, input.version),
    )).limit(1);
  return profile ?? null;
}

export function assertApplicationAgentExecutionContract(profile: {
  readonly memoryWindowMessages: number;
  readonly maximumTurns: number;
  readonly maximumToolCalls: number;
  readonly outputContract: string;
}): void {
  if (!Number.isSafeInteger(profile.memoryWindowMessages) || profile.memoryWindowMessages < 1 || profile.memoryWindowMessages > 1_000) {
    throw new Error('Agent memory window must be between 1 and 1,000 messages.');
  }
  if (!Number.isSafeInteger(profile.maximumTurns) || profile.maximumTurns < 1 || profile.maximumTurns > 20) {
    throw new Error('Agent turn budget must be between 1 and 20.');
  }
  if (!Number.isSafeInteger(profile.maximumToolCalls) || profile.maximumToolCalls < 1 || profile.maximumToolCalls > 100) {
    throw new Error('Agent tool-call budget must be between 1 and 100.');
  }
  if (!profile.outputContract.trim()) throw new Error('Agent output contract must not be empty.');
}
