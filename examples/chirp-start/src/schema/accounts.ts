import { field, index, model, uniqueIndex } from '@applik8s/applik8s/drizzle';
import { authenticatedPrincipalId } from './defaults';

export const accounts = model('accounts', {
  id: field.text('id').default(authenticatedPrincipalId).primaryKey(),
  handle: field.text('handle').notNull(),
  displayName: field.text('display_name').notNull(),
  bio: field.text('bio').notNull().default(''),
  avatarObjectKey: field.text('avatar_object_key'),
  visibility: field.text('visibility').notNull().default('public'),
  kind: field.text('kind').notNull().default('human'),
  state: field.text('state').notNull().default('active'),
  joinedAt: field.text('joined_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('accounts_handle').on(table.handle),
  index('accounts_state_kind').on(table.state, table.kind),
]);

export const credentialLinks = model('credential_links', {
  id: field.text('id').primaryKey(),
  accountId: field.text('account_id').notNull().references(() => accounts.id),
  issuer: field.text('issuer').notNull(),
  subject: field.text('subject').notNull(),
  linkedAt: field.text('linked_at').notNull(),
  revision: field.text('revision').notNull(),
}, (table) => [
  uniqueIndex('credential_links_issuer_subject').on(table.issuer, table.subject),
  index('credential_links_account').on(table.accountId),
]);

export const installationSettings = model('installation_settings', {
  id: field.text('id').primaryKey(),
  siteName: field.text('site_name').notNull(),
  description: field.text('description').notNull(),
  registration: field.text('registration').notNull(),
  defaultVisibility: field.text('default_visibility').notNull(),
  mediaEnabled: field.text('media_enabled').notNull(),
  automationEnabled: field.text('automation_enabled').notNull(),
  revision: field.text('revision').notNull(),
});
