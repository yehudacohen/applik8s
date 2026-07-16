import { app, postgres, ProjectionStore, stream, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? 'applik8s-v06-generated';
const stackName = process.env.APPLIK8S_E2E_STACK_NAME ?? 'v06-generated-proof';

const cards = pgTable('cards', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
});
const schema = { cards };
const OrganizationId = trustedContext('organizationId', { schema: type('string') });

export const v06GeneratedApp = app(stackName, { namespace });
const Database = v06GeneratedApp.database.postgres('catalog', {
  schema,
  migrations: './migrations',
  database: 'catalog',
  access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
});
const Card = v06GeneratedApp.model(cards, { name: 'Card', database: Database });

const CardsForOrganization = v06GeneratedApp.query('cards.for-organization.v1', {
  input: type({ organizationId: 'string' }),
  output: Card.$model.schema.select.array(),
  database: Database,
  context: [OrganizationId],
  reads: [Card],
  budgets: { timeoutMs: 2_000, maxRows: 100, maxResultBytes: 64 * 1_024 },
  authorize: ({ principal, input }) => principal.id === input.organizationId,
  run: async ({ context, input }) => context.database(Database).select().from(Card).where(eq(Card.organizationId, input.organizationId)),
});

const CardChanged = stream('cards.changed.v1', { payload: type({ cardId: 'string', organizationId: 'string', name: 'string', revision: 'string' }) });
const CardChanges = v06GeneratedApp.stream(CardChanged, {
  database: Database,
  retention: { maxAgeSeconds: 3_600, maxMessages: 10_000 },
  partitionBy: (payload) => payload.cardId,
  authorize: ({ principal }) => principal.id.startsWith('applik8s:projection:') || principal.id.length > 0,
});
const CardEvents = v06GeneratedApp.subscription('card-events', { source: CardChanges, authorize: ({ principal }) => principal.id.length > 0 });

v06GeneratedApp.defaults({
  projections: ProjectionStore.clickhouse({ name: 'v06-analytics', namespace, storageSize: '1Gi', storageClassName: 'local-path' }),
});
v06GeneratedApp.projection('card-history', {
  source: CardChanges,
  output: type({ eventId: 'string', cardId: 'string', organizationId: 'string', name: 'string', revision: 'string' }),
  project: (payload, event) => ({ eventId: event.id, ...payload }),
});

v06GeneratedApp.gateway('public', {
  queries: [CardsForOrganization],
  subscriptions: [CardEvents],
  subscriptionLimits: { perPrincipal: 2, total: 8 },
  deployment: {
    namespace,
    replicas: 1,
    cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'v06-gateway-cursor', namespace, key: 'secret' },
    authenticate: async (request) => ({
      principal: { id: request.headers.get('x-principal') ?? 'anonymous' },
      trustedContext: { organizationId: request.headers.get('x-organization') ?? 'missing' },
      authorizationVersion: request.headers.get('x-authorization-version') ?? 'v1',
    }),
  },
});
