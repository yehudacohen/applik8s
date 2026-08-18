import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { and, desc, eq, like } from 'drizzle-orm';
import {
  applicationEvaluationCases,
  applicationEvaluationDatasets,
  applicationEvaluationResults,
  applicationEvaluationRuns,
  applicationEvaluationScorers,
} from './schema.js';

export const applicationAgentEvaluationSummarySchema = type({
  id: 'string', agentId: 'string', revision: 'string',
  status: "'pending' | 'running' | 'completed' | 'failed' | 'cancelled'",
  'score?': 'number', 'evidence?': 'unknown', createdAt: 'string', 'completedAt?': 'string',
});

export const applicationEvaluationCatalogSchema = type({
  datasets: type({ id: 'string', name: 'string', revision: 'string', schemaDigest: 'string' }).array(),
  cases: type({ id: 'string', datasetId: 'string', input: 'unknown', expected: 'unknown', tags: 'unknown' }).array(),
  scorers: type({ id: 'string', name: 'string', revision: 'string', implementationDigest: 'string' }).array(),
});

export const applicationEvaluationCasesForRunSchema = type({
  id: 'string', input: 'unknown', expected: 'unknown', tags: 'unknown',
}).array();

export interface ApplicationEvaluationQueryOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
}

export async function loadApplicationEvaluationCatalog<TSchema extends Readonly<Record<string, unknown>>>(
  _input: object,
  context: ApplicationModelViewContext,
  options: ApplicationEvaluationQueryOptions<TSchema>,
) {
  const client = context.database(options.database);
  const [datasets, cases, scorers] = await Promise.all([
    client.select({ id: applicationEvaluationDatasets.id, name: applicationEvaluationDatasets.name, revision: applicationEvaluationDatasets.revision, schemaDigest: applicationEvaluationDatasets.schemaDigest }).from(applicationEvaluationDatasets).orderBy(desc(applicationEvaluationDatasets.createdAt)).limit(100),
    client.select({ id: applicationEvaluationCases.id, datasetId: applicationEvaluationCases.datasetId, input: applicationEvaluationCases.input, expected: applicationEvaluationCases.expected, tags: applicationEvaluationCases.tags }).from(applicationEvaluationCases).limit(300),
    client.select({ id: applicationEvaluationScorers.id, name: applicationEvaluationScorers.name, revision: applicationEvaluationScorers.revision, implementationDigest: applicationEvaluationScorers.implementationDigest }).from(applicationEvaluationScorers).orderBy(desc(applicationEvaluationScorers.createdAt)).limit(100),
  ]);
  return { datasets, cases, scorers };
}

export async function loadApplicationEvaluationCases<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly datasetId: string },
  context: ApplicationModelViewContext,
  options: ApplicationEvaluationQueryOptions<TSchema>,
) {
  return context.database(options.database).select({
    id: applicationEvaluationCases.id, input: applicationEvaluationCases.input,
    expected: applicationEvaluationCases.expected, tags: applicationEvaluationCases.tags,
  }).from(applicationEvaluationCases)
    .where(eq(applicationEvaluationCases.datasetId, input.datasetId)).limit(250);
}

export async function listApplicationAgentEvaluationRuns<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly agentId?: string },
  context: ApplicationModelViewContext,
  options: ApplicationEvaluationQueryOptions<TSchema>,
) {
  const prefix = input.agentId ? `agent:${input.agentId}:` : 'agent:';
  const rows = await context.database(options.database).select({
    id: applicationEvaluationRuns.id, logicalModel: applicationEvaluationRuns.logicalModel,
    status: applicationEvaluationRuns.status, createdAt: applicationEvaluationRuns.createdAt,
    completedAt: applicationEvaluationRuns.completedAt, score: applicationEvaluationResults.score,
    evidence: applicationEvaluationResults.evidence,
  }).from(applicationEvaluationRuns)
    .leftJoin(applicationEvaluationResults, eq(applicationEvaluationResults.runId, applicationEvaluationRuns.id))
    .where(and(
      eq(applicationEvaluationRuns.principalScope, options.scope(context)),
      like(applicationEvaluationRuns.logicalModel, `${prefix}%`),
    )).orderBy(desc(applicationEvaluationRuns.createdAt)).limit(100);
  return rows.filter(row => row.logicalModel.startsWith(prefix)).map(row => {
    const parts = row.logicalModel.split(':');
    return {
      id: row.id, agentId: parts[1] ?? '', revision: parts.slice(2).join(':'), status: row.status,
      ...(row.score === null ? {} : { score: row.score }),
      ...(row.evidence === null ? {} : { evidence: row.evidence }),
      createdAt: row.createdAt, ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    };
  });
}
