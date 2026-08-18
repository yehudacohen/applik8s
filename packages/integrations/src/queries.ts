import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { desc, eq } from 'drizzle-orm';
import { applicationIntegrationConnections } from './schema.js';

export const applicationIntegrationConnectionSummarySchema = type({
  id: 'string', name: 'string', kind: "'oauth' | 'api-key' | 'webhook' | 'mcp'",
  capability: 'string', requestedScopes: 'string[]', 'provider?': 'string',
  state: "'requested' | 'configuring' | 'ready' | 'degraded' | 'disconnected'",
  'expiresAt?': 'string', 'lastCheckedAt?': 'string', 'actionRequired?': 'string',
  createdAt: 'string', updatedAt: 'string',
});

export interface ApplicationIntegrationQueryOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
}

export async function listApplicationIntegrationConnections<TSchema extends Readonly<Record<string, unknown>>>(
  _input: object,
  context: ApplicationModelViewContext,
  options: ApplicationIntegrationQueryOptions<TSchema>,
) {
  const rows = await context.database(options.database).select({
    id: applicationIntegrationConnections.id, name: applicationIntegrationConnections.name,
    kind: applicationIntegrationConnections.kind, capability: applicationIntegrationConnections.capability,
    requestedScopes: applicationIntegrationConnections.requestedScopes,
    provider: applicationIntegrationConnections.provider, state: applicationIntegrationConnections.state,
    expiresAt: applicationIntegrationConnections.expiresAt,
    lastCheckedAt: applicationIntegrationConnections.lastCheckedAt,
    actionRequired: applicationIntegrationConnections.actionRequired,
    createdAt: applicationIntegrationConnections.createdAt,
    updatedAt: applicationIntegrationConnections.updatedAt,
  }).from(applicationIntegrationConnections)
    .where(eq(applicationIntegrationConnections.principalScope, options.scope(context)))
    .orderBy(desc(applicationIntegrationConnections.updatedAt)).limit(100);
  return rows.map(row => ({
    id: row.id, name: row.name, kind: row.kind, capability: row.capability,
    requestedScopes: row.requestedScopes, ...(row.provider ? { provider: row.provider } : {}),
    state: row.state, ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    ...(row.lastCheckedAt ? { lastCheckedAt: row.lastCheckedAt } : {}),
    ...(row.actionRequired ? { actionRequired: row.actionRequired } : {}),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }));
}
