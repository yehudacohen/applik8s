import { app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { createDeterministicApplicationAdmission } from '@applik8s/identity';

const cards = pgTable('cards', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
});

export const modularViewApplication = app('modular-view-fixture', { namespace: 'catalog' });
const Database = modularViewApplication.database.postgres('catalog', {
  schema: { cards },
  migrations: { path: './migrations' },
  provision: false,
  namespace: 'catalog',
  connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: 'catalog-app', namespace: 'catalog' },
});
const BaseCard = modularViewApplication.model(cards, { name: 'Card', database: Database });

const CardOwned = BaseCard.view(
  {
    input: type({ ownerId: 'string' }),
    output: type({ id: 'string', name: 'string' }).array(),
    database: Database,
    authorize: ({ principal, input }) => principal.identity.subject === input.ownerId,
  },
  async function owned(input) {
    const rows = await Database
      .select({ id: BaseCard.id, name: BaseCard.name })
      .from(BaseCard)
      .where(eq(BaseCard.ownerId, input.ownerId));
    return rows.map(({ id, name }) => ({ id, name }));
  },
);

modularViewApplication.gateway('public', {
  queries: [CardOwned],
  deployment: {
    namespace: 'catalog',
    cursorSecret: { name: 'gateway-cursor', namespace: 'catalog', key: 'secret' },
    authenticate: async (request) => createDeterministicApplicationAdmission({
      mode: 'starter',
      application: 'modular-view-fixture',
      subject: request.headers.get('x-principal') ?? 'anonymous',
      catalogRevision: 'fixture-catalog-v1',
      authorityRevision: 'v1',
      admittedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
});
