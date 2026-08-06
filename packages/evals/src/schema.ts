import {
  field,
  index,
  model,
  pgEnum,
  relations,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationEvaluationRunState = pgEnum(
  'applik8s_evaluation_run_state',
  ['pending', 'running', 'completed', 'failed', 'cancelled'],
);

export const applicationEvaluationDatasets = model(
  'applik8s_evaluation_datasets',
  {
    id: field.text('id').primaryKey(),
    name: field.text('name').notNull(),
    revision: field.text('revision').notNull(),
    schemaDigest: field.text('schema_digest').notNull(),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_evaluation_datasets_revision_uidx').on(
      table.name,
      table.revision,
    ),
  ],
  { name: 'EvaluationDataset', revision: 'revision' },
);

export const applicationEvaluationCases = model(
  'applik8s_evaluation_cases',
  {
    id: field.text('id').primaryKey(),
    datasetId: field.text('dataset_id')
      .notNull()
      .references(() => applicationEvaluationDatasets.id, {
        onDelete: 'cascade',
      }),
    input: field.jsonb('input').notNull(),
    expected: field.jsonb('expected').notNull(),
    tags: field.jsonb('tags').notNull(),
  },
  (table) => [
    index('applik8s_evaluation_cases_dataset_idx').on(table.datasetId),
  ],
  { name: 'EvaluationCase', revision: false },
);

export const applicationEvaluationScorers = model(
  'applik8s_evaluation_scorers',
  {
    id: field.text('id').primaryKey(),
    name: field.text('name').notNull(),
    revision: field.text('revision').notNull(),
    implementationDigest: field.text('implementation_digest').notNull(),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_evaluation_scorers_revision_uidx').on(
      table.name,
      table.revision,
    ),
  ],
  { name: 'EvaluationScorer', revision: 'revision' },
);

export const applicationEvaluationRuns = model(
  'applik8s_evaluation_runs',
  {
    id: field.text('id').primaryKey(),
    datasetId: field.text('dataset_id')
      .notNull()
      .references(() => applicationEvaluationDatasets.id),
    scorerId: field.text('scorer_id')
      .notNull()
      .references(() => applicationEvaluationScorers.id),
    logicalModel: field.text('logical_model').notNull(),
    status: applicationEvaluationRunState('status').notNull().default('pending'),
    startedAt: field.timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    }),
    completedAt: field.timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  { name: 'EvaluationRun', revision: false },
);

export const applicationEvaluationResults = model(
  'applik8s_evaluation_results',
  {
    id: field.text('id').primaryKey(),
    runId: field.text('run_id')
      .notNull()
      .references(() => applicationEvaluationRuns.id, {
        onDelete: 'cascade',
      }),
    caseId: field.text('case_id')
      .notNull()
      .references(() => applicationEvaluationCases.id),
    score: field.real('score').notNull(),
    evidence: field.jsonb('evidence').notNull(),
    artifactId: field.text('artifact_id'),
    invocationId: field.text('invocation_id'),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_evaluation_results_case_uidx').on(
      table.runId,
      table.caseId,
    ),
  ],
  { name: 'EvaluationResult', revision: false },
);

export const applicationEvaluationDatasetRelations = relations(
  applicationEvaluationDatasets,
  ({ many }) => ({ cases: many(applicationEvaluationCases) }),
);
export const applicationEvaluationCaseRelations = relations(
  applicationEvaluationCases,
  ({ one }) => ({
    dataset: one(applicationEvaluationDatasets, {
      fields: [applicationEvaluationCases.datasetId],
      references: [applicationEvaluationDatasets.id],
    }),
  }),
);
export const applicationEvaluationRunRelations = relations(
  applicationEvaluationRuns,
  ({ many, one }) => ({
    dataset: one(applicationEvaluationDatasets, {
      fields: [applicationEvaluationRuns.datasetId],
      references: [applicationEvaluationDatasets.id],
    }),
    scorer: one(applicationEvaluationScorers, {
      fields: [applicationEvaluationRuns.scorerId],
      references: [applicationEvaluationScorers.id],
    }),
    results: many(applicationEvaluationResults),
  }),
);
export const applicationEvaluationResultRelations = relations(
  applicationEvaluationResults,
  ({ one }) => ({
    run: one(applicationEvaluationRuns, {
      fields: [applicationEvaluationResults.runId],
      references: [applicationEvaluationRuns.id],
    }),
    case: one(applicationEvaluationCases, {
      fields: [applicationEvaluationResults.caseId],
      references: [applicationEvaluationCases.id],
    }),
  }),
);

export const applicationEvaluationSchema = Object.freeze({
  applicationEvaluationDatasets,
  applicationEvaluationCases,
  applicationEvaluationScorers,
  applicationEvaluationRuns,
  applicationEvaluationResults,
  applicationEvaluationDatasetRelations,
  applicationEvaluationCaseRelations,
  applicationEvaluationRunRelations,
  applicationEvaluationResultRelations,
});
