import { field, index, model } from '@applik8s/applik8s/drizzle';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';
import { posts } from './posts';

export const reports = model('reports', {
  id: field.text('id').primaryKey(),
  reporterId: field.text('reporter_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: field.text('post_id').references(() => posts.id),
  accountId: field.text('account_id').references(() => accounts.id),
  reason: field.text('reason').notNull(),
  detail: field.text('detail').notNull(),
  state: field.text('state').notNull().default('open'),
  createdAt: field.text('created_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [index('reports_state_created').on(table.state, table.createdAt)]);

export const moderationCases = model('moderation_cases', {
  id: field.text('id').primaryKey(),
  reportId: field.text('report_id').notNull().references(() => reports.id),
  assigneeId: field.text('assignee_id').default(authenticatedPrincipalId).references(() => accounts.id),
  targetType: field.text('target_type').notNull(),
  targetId: field.text('target_id').notNull(),
  state: field.text('state').notNull().default('open'),
  resolution: field.text('resolution'),
  openedAt: field.text('opened_at').notNull().default(''),
  resolvedAt: field.text('resolved_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [index('moderation_cases_state_opened').on(table.state, table.openedAt)]);
