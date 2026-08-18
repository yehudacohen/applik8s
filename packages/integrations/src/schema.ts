import type { ApplicationRelationalModel } from '@applik8s/applik8s';
import { causalPrincipalId, field, index, model, pgEnum } from '@applik8s/applik8s/drizzle';

export const applicationIntegrationConnectionKind = pgEnum('integration_connection_kind', [
  'oauth',
  'api-key',
  'webhook',
  'mcp',
]);

export const applicationIntegrationConnectionState = pgEnum('integration_connection_state', [
  'requested',
  'configuring',
  'ready',
  'degraded',
  'disconnected',
]);

const integrationConnectionTable = model('integration_connections', {
  id: field.uuid('id').defaultRandom().primaryKey(),
  principalScope: field.text('principal_scope').notNull().default(causalPrincipalId),
  name: field.text('name').notNull(),
  kind: applicationIntegrationConnectionKind('kind').notNull(),
  capability: field.text('capability').notNull(),
  requestedScopes: field.text('requested_scopes').array().notNull().default([]),
  provider: field.text('provider'),
  state: applicationIntegrationConnectionState('state').notNull().default('requested'),
  expiresAt: field.timestamp('expires_at', { withTimezone: true, mode: 'string' }),
  lastCheckedAt: field.timestamp('last_checked_at', { withTimezone: true, mode: 'string' }),
  actionRequired: field.text('action_required'),
  createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: field.timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, table => [
  index('integration_connections_scope_state_idx').on(table.principalScope, table.state),
], { name: 'IntegrationConnection', revision: false });

export const applicationIntegrationConnections: ApplicationRelationalModel<typeof integrationConnectionTable> = integrationConnectionTable;
export const applicationIntegrationSchema = Object.freeze({ applicationIntegrationConnections });
