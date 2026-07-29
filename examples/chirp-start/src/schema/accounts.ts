import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { authenticatedPrincipalId } from './defaults';

export const accounts = pgTable('accounts', {
  id: text('id').default(authenticatedPrincipalId).primaryKey(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarObjectKey: text('avatar_object_key'),
  visibility: text('visibility').notNull().default('public'),
  kind: text('kind').notNull().default('human'),
  state: text('state').notNull().default('active'),
  joinedAt: text('joined_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('accounts_handle').on(table.handle),
  index('accounts_state_kind').on(table.state, table.kind),
]);

export const credentialLinks = pgTable('credential_links', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  linkedAt: text('linked_at').notNull(),
  revision: text('revision').notNull(),
}, (table) => [
  uniqueIndex('credential_links_issuer_subject').on(table.issuer, table.subject),
  index('credential_links_account').on(table.accountId),
]);

export const installationSettings = pgTable('installation_settings', {
  id: text('id').primaryKey(),
  siteName: text('site_name').notNull(),
  description: text('description').notNull(),
  registration: text('registration').notNull(),
  defaultVisibility: text('default_visibility').notNull(),
  mediaEnabled: text('media_enabled').notNull(),
  automationEnabled: text('automation_enabled').notNull(),
  revision: text('revision').notNull(),
});
