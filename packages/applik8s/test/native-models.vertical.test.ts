// typecast-file-boundary: metadata fixtures inspect deliberately type-erased Drizzle and ArkType adapter boundaries.
import { describe, expect, test } from 'vitest';
import { createTableRelationsHelpers, eq, extractTablesRelationalConfig, relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { alias, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { getApplicationOperationContract } from '@applik8s/client';
import { getApplicationModelFacet, isPromotedApplicationModel, modelReferenceContract, promoteDrizzleTable } from '../src/native-models.js';

const sets = pgTable('sets', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const cards = pgTable('cards', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  setId: uuid('set_id').notNull().references(() => sets.id),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
});

const setsRelations = relations(sets, ({ many }) => ({ cards: many(cards) }));
const cardsRelations = relations(cards, ({ one }) => ({ set: one(sets, { fields: [cards.setId], references: [sets.id] }) }));
const schema = { sets, cards, setsRelations, cardsRelations };

describe('native Drizzle application models', () => {
  test('promotes the table by identity without changing native enumeration or SQL behavior', () => {
    const keysBefore = Object.keys(cards);
    const Card = promoteDrizzleTable(cards, { name: 'Card', database: 'catalog', schema });
    expect(Card).toBe(cards);
    expect(Object.keys(Card)).toEqual(keysBefore);
    expect(Object.prototype.propertyIsEnumerable.call(Card, '$model')).toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(Card, 'create')).toBe(false);
    expect(isPromotedApplicationModel(Card)).toBe(true);
    expect(getApplicationModelFacet(Card)).toBe(Card.$model);
    expect(getApplicationOperationContract(Card.create)).toMatchObject({
      id: 'Card.create',
      model: 'Card',
      operation: 'create',
      transport: 'command',
    });

    const db = drizzle(async () => ({ rows: [] }), { schema });
    const query = db.select().from(Card).where(eq(Card.setId, '00000000-0000-0000-0000-000000000001')).toSQL();
    expect(query.sql).toContain('from "cards"');
    expect(query.sql).toContain('"cards"."set_id" = $1');

    const aliased = alias(Card, 'card_alias');
    const aliasQuery = db.select().from(aliased).where(eq(aliased.name, 'hello')).toSQL();
    expect(aliasQuery.sql).toContain('"cards" "card_alias"');
  });

  test('derives ArkType select, insert, and update schemas with no field mapping', () => {
    const Card = promoteDrizzleTable(cards, { name: 'Card', database: 'catalog', schema });
    const selected = Card.$model.schema.select({
      id: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002',
      setId: '00000000-0000-0000-0000-000000000003',
      name: 'Card',
      revision: '1',
    });
    expect(selected).not.toHaveProperty('summary');
    const inserted = Card.$model.schema.insert({
      id: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002',
      setId: '00000000-0000-0000-0000-000000000003',
      name: 'Card',
      revision: '1',
    });
    expect(inserted).not.toHaveProperty('summary');
    const updated = Card.$model.schema.update({ name: 'Renamed' });
    expect(updated).not.toHaveProperty('summary');
  });

  test('normalizes native relations and carries typed reference metadata', () => {
    const SetModel = promoteDrizzleTable(sets, { name: 'Set', database: 'catalog', schema });
    const Card = promoteDrizzleTable(cards, { name: 'Card', database: 'catalog', schema });
    expect(Card.$model.relationships).toEqual([
      {
        source: 'Card',
        name: 'set',
        target: 'Set',
        cardinality: 'one',
        integrity: 'foreign-key',
        fields: ['setId'],
        references: ['id'],
      },
    ]);
    expect(SetModel.$model.relationships[0]).toMatchObject({ source: 'Set', name: 'cards', target: 'Card', cardinality: 'many', integrity: 'relation-only' });

    const ref = SetModel.$model.ref();
    expect(ref('00000000-0000-0000-0000-000000000001')).toBe('00000000-0000-0000-0000-000000000001');
    expect(modelReferenceContract(ref)).toEqual({
      target: 'Set',
      identity: { fields: ['id'], encoding: 'scalar' },
      integrity: 'soft',
    });
  });

  test('does not perturb Drizzle relational schema discovery', () => {
    const before = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
    promoteDrizzleTable(sets, { name: 'Set', database: 'catalog', schema });
    promoteDrizzleTable(cards, { name: 'Card', database: 'catalog', schema });
    const after = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
    expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables));
    expect(after.tableNamesMap).toEqual(before.tableNamesMap);
    expect(Object.keys(after.tables.cards?.relations ?? {})).toEqual(['set']);
  });

  test('fails closed for ambiguous identity and rebinding', () => {
    const composite = pgTable('composite', {
      left: text('left').notNull(),
      right: text('right').notNull(),
    }, (table) => [{ columns: [table.left, table.right] } as never]);
    expect(() => promoteDrizzleTable(composite, { identity: ['left', 'right'] })).toThrow('composite identity');

    const rebound = pgTable('rebound', { id: text('id').primaryKey(), revision: text('revision').notNull() });
    promoteDrizzleTable(rebound, { name: 'First', database: 'one' });
    expect(() => promoteDrizzleTable(rebound, { name: 'Second', database: 'two' })).toThrow('already promoted');
  });
});
