import { field, index, model } from '@applik8s/applik8s/drizzle';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';

export const automations = model('automations', {
  id: field.text('id').primaryKey(),
  ownerId: field.text('owner_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  accountId: field.text('account_id').notNull().references(() => accounts.id),
  persona: field.text('persona').notNull(),
  instructions: field.text('instructions').notNull(),
  schedule: field.text('schedule').notNull(),
  generationProfile: field.text('generation_profile').notNull(),
  maxPostsPerDay: field.text('max_posts_per_day').notNull(),
  maxUnitsPerDay: field.text('max_units_per_day').notNull(),
  state: field.text('state').notNull().default('active'),
  createdAt: field.text('created_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  index('automations_owner_state').on(table.ownerId, table.state),
  index('automations_account').on(table.accountId),
]);

export const automationRuns = model('automation_runs', {
  id: field.text('id').primaryKey(),
  automationId: field.text('automation_id').notNull().references(() => automations.id),
  scheduledFor: field.text('scheduled_for').notNull(),
  quotaWindow: field.text('quota_window').notNull().default(''),
  state: field.text('state').notNull().default('pending'),
  publishedPostId: field.text('published_post_id'),
  usageUnits: field.text('usage_units').notNull().default('0'),
  reservedUnits: field.text('reserved_units').notNull().default('0'),
  resultReference: field.text('result_reference'),
  startedAt: field.text('started_at'),
  finishedAt: field.text('finished_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [index('automation_runs_automation_schedule').on(table.automationId, table.scheduledFor), index('automation_runs_quota_window').on(table.automationId, table.quotaWindow)]);

/** Low-cardinality product safety state, intentionally relational rather than a CRD. */
export const automationControls = model('automation_controls', {
  id: field.text('id').primaryKey(),
  enabled: field.text('enabled').notNull().default('true'),
  reason: field.text('reason').notNull().default(''),
  changedAt: field.text('changed_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
});
