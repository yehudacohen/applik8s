import { app, postgres, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';

const cards = pgTable('cards', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
});

const OrganizationId = trustedContext('organizationId', { schema: type('string') });
export const nativeQueryApplication = app('native-query-fixture', { namespace: 'catalog' });
const Database = nativeQueryApplication.database.postgres('catalog', {
  schema: { cards },
  provision: false,
  namespace: 'catalog',
  connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'catalog-app', namespace: 'catalog' },
  access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
});
const Card = nativeQueryApplication.model(cards, { name: 'Card', database: Database });

const CardsForOrganization = nativeQueryApplication.query('cards.for-organization.v1', {
  input: type({ organizationId: 'string' }),
  output: Card.$model.schema.select.array(),
  database: Database,
  context: [OrganizationId],
  reads: [Card],
  authorize: ({ principal, input }) => principal.id === input.organizationId,
  run: async ({ context, input }) => context.database(Database).select().from(Card).where(eq(Card.organizationId, input.organizationId)),
});

nativeQueryApplication.gateway('public', {
  queries: [CardsForOrganization],
  deployment: {
    namespace: 'catalog',
    cursorSecret: { name: 'gateway-cursor', namespace: 'catalog', key: 'secret' },
    authenticate: async (request) => ({ principal: { id: request.headers.get('x-principal') ?? 'anonymous' }, trustedContext: { organizationId: request.headers.get('x-organization') ?? 'unknown' }, authorizationVersion: request.headers.get('x-authorization-version') ?? 'v1' }),
  },
});
