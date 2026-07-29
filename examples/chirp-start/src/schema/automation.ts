import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  persona: text('persona').notNull(),
  instructions: text('instructions').notNull(),
  schedule: text('schedule').notNull(),
  generationProfile: text('generation_profile').notNull(),
  maxPostsPerDay: text('max_posts_per_day').notNull(),
  maxUnitsPerDay: text('max_units_per_day').notNull(),
  state: text('state').notNull().default('active'),
  createdAt: text('created_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
}, (table) => [
  index('automations_owner_state').on(table.ownerId, table.state),
  index('automations_account').on(table.accountId),
]);

export const automationRuns = pgTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => automations.id),
  scheduledFor: text('scheduled_for').notNull(),
  quotaWindow: text('quota_window').notNull().default(''),
  state: text('state').notNull().default('pending'),
  publishedPostId: text('published_post_id'),
  usageUnits: text('usage_units').notNull().default('0'),
  reservedUnits: text('reserved_units').notNull().default('0'),
  resultReference: text('result_reference'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [index('automation_runs_automation_schedule').on(table.automationId, table.scheduledFor), index('automation_runs_quota_window').on(table.automationId, table.quotaWindow)]);

/** Low-cardinality product safety state, intentionally relational rather than a CRD. */
export const automationControls = pgTable('automation_controls', {
  id: text('id').primaryKey(),
  enabled: text('enabled').notNull().default('true'),
  reason: text('reason').notNull().default(''),
  changedAt: text('changed_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
});
