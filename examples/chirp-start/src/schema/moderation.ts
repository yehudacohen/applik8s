import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';
import { posts } from './posts';

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: text('post_id').references(() => posts.id),
  accountId: text('account_id').references(() => accounts.id),
  reason: text('reason').notNull(),
  detail: text('detail').notNull(),
  state: text('state').notNull().default('open'),
  createdAt: text('created_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
}, (table) => [index('reports_state_created').on(table.state, table.createdAt)]);

export const moderationCases = pgTable('moderation_cases', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => reports.id),
  assigneeId: text('assignee_id').default(authenticatedPrincipalId).references(() => accounts.id),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  state: text('state').notNull().default('open'),
  resolution: text('resolution'),
  openedAt: text('opened_at').notNull().default(''),
  resolvedAt: text('resolved_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [index('moderation_cases_state_opened').on(table.state, table.openedAt)]);
