import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const applicationEvaluationRunState = pgEnum(
  'applik8s_evaluation_run_state',
  ['pending', 'running', 'completed', 'failed', 'cancelled'],
);

export const applicationEvaluationDatasets = pgTable(
  'applik8s_evaluation_datasets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
    schemaDigest: text('schema_digest').notNull(),
    createdAt: timestamp('created_at', {
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
);

export const applicationEvaluationCases = pgTable(
  'applik8s_evaluation_cases',
  {
    id: text('id').primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => applicationEvaluationDatasets.id, {
        onDelete: 'cascade',
      }),
    input: jsonb('input').notNull(),
    expected: jsonb('expected').notNull(),
    tags: jsonb('tags').notNull(),
  },
  (table) => [
    index('applik8s_evaluation_cases_dataset_idx').on(table.datasetId),
  ],
);

export const applicationEvaluationScorers = pgTable(
  'applik8s_evaluation_scorers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
    implementationDigest: text('implementation_digest').notNull(),
    createdAt: timestamp('created_at', {
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
);

export const applicationEvaluationRuns = pgTable(
  'applik8s_evaluation_runs',
  {
    id: text('id').primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => applicationEvaluationDatasets.id),
    scorerId: text('scorer_id')
      .notNull()
      .references(() => applicationEvaluationScorers.id),
    logicalModel: text('logical_model').notNull(),
    status: applicationEvaluationRunState('status').notNull().default('pending'),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    }),
    completedAt: timestamp('completed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
);

export const applicationEvaluationResults = pgTable(
  'applik8s_evaluation_results',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => applicationEvaluationRuns.id, {
        onDelete: 'cascade',
      }),
    caseId: text('case_id')
      .notNull()
      .references(() => applicationEvaluationCases.id),
    score: real('score').notNull(),
    evidence: jsonb('evidence').notNull(),
    artifactId: text('artifact_id'),
    invocationId: text('invocation_id'),
    createdAt: timestamp('created_at', {
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

export interface ApplicationEvaluationsModuleOptions {
  readonly database?: ApplicationDatabaseBinding;
}

export function evaluations(
  application: Pick<KubernetesApplicationBuilder, 'model'>,
  options: ApplicationEvaluationsModuleOptions = {},
) {
  const modelOptions = options.database
    ? { database: options.database }
    : undefined;
  const Dataset = application.model(applicationEvaluationDatasets, {
    ...modelOptions,
    name: 'EvaluationDataset',
  });
  const Case = application.model(applicationEvaluationCases, {
    ...modelOptions,
    name: 'EvaluationCase',
    revision: false,
  });
  const Scorer = application.model(applicationEvaluationScorers, {
    ...modelOptions,
    name: 'EvaluationScorer',
  });
  const EvaluationRun = application.model(applicationEvaluationRuns, {
    ...modelOptions,
    name: 'EvaluationRun',
    revision: false,
  });
  const EvaluationResult = application.model(applicationEvaluationResults, {
    ...modelOptions,
    name: 'EvaluationResult',
    revision: false,
  });
  return Object.freeze({
    Dataset,
    Case,
    Scorer,
    EvaluationRun,
    EvaluationResult,
  });
}
