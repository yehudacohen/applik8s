// typecast-file-boundary: selection tests use focused SQL row fixtures after compiled query-contract validation.
import type { ApplicationQuerySelectionContract } from '@applik8s/applik8s/query-runtime';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { materializePostgresApplicationQuerySelection } from '../src/query-selection.js';

const selection: ApplicationQuerySelectionContract = {
  protocol: 'applik8s.query-selection/v1alpha1',
  sourceModel: 'Card',
  source: {
    provider: 'postgres',
    database: 'catalog',
    schema: 'application',
    table: 'cards',
    columns: [
      { property: 'id', column: 'id', logicalType: 'string', nullable: false },
      { property: 'setId', column: 'set_id', logicalType: 'string', nullable: false },
      { property: 'name', column: 'display_name', logicalType: 'string', nullable: false },
    ],
  },
  predicate: {
    kind: 'logical',
    operation: 'and',
    operands: [
      {
        kind: 'comparison',
        operation: 'eq',
        left: { kind: 'field', path: ['setId'] },
        right: { kind: 'input', path: ['setId'] },
      },
      {
        kind: 'membership',
        operation: 'in',
        value: { kind: 'field', path: ['name'] },
        candidates: { kind: 'input', path: ['names'] },
      },
    ],
  },
  order: [
    { expression: { kind: 'field', path: ['name'] }, direction: 'asc' },
    { expression: { kind: 'field', path: ['id'] }, direction: 'asc' },
  ],
  identity: [{ kind: 'field', path: ['id'] }],
  relationshipReads: [],
  sourceAuthority: 'postgres:catalog:application.cards',
  digest: 'selection-v1',
};

describe('PostgreSQL portable query selection', () => {
  test('lowers trusted physical metadata and binds all application values', async () => {
    let statement: unknown;
    const rows = await materializePostgresApplicationQuerySelection<{
      readonly id: string;
      readonly setId: string;
      readonly name: string;
    }>({
      selection,
      input: { setId: 'set-1', names: ['Alpha', 'Beta'] },
      maximumRows: 250,
      database: {
        async execute(value) {
          statement = value;
          return [{ id: 'card-1', setId: 'set-1', name: 'Alpha' }];
        },
      },
    });
    const query = new PgDialect().sqlToQuery(statement as never);
    expect(query.sql.replace(/\s+/gu, ' ').trim()).toBe(
      'SELECT "id" AS "id", "set_id" AS "setId", "display_name" AS "name" FROM "application"."cards" WHERE ("set_id" = $1 AND "display_name" IN ($2, $3)) ORDER BY "display_name" ASC NULLS FIRST, "id" ASC NULLS FIRST LIMIT $4',
    );
    expect(query.params).toEqual(['set-1', 'Alpha', 'Beta', 250]);
    expect(rows).toEqual([{ id: 'card-1', setId: 'set-1', name: 'Alpha' }]);
  });

  test('fails closed for unknown physical fields', async () => {
    await expect(materializePostgresApplicationQuerySelection({
      selection: {
        ...selection,
        order: [{ expression: { kind: 'field', path: ['unknown'] }, direction: 'asc' }],
      },
      input: { setId: 'set-1', names: ['Alpha'] },
      maximumRows: 10,
      database: { async execute() { return []; } },
    })).rejects.toThrow(/unknown field unknown/u);
  });

  test('preserves deterministic null membership and ordering semantics', async () => {
    let statement: unknown;
    await materializePostgresApplicationQuerySelection({
      selection: {
        ...selection,
        predicate: {
          kind: 'membership',
          operation: 'in',
          value: { kind: 'field', path: ['name'] },
          candidates: { kind: 'input', path: ['names'] },
        },
        order: [{ expression: { kind: 'field', path: ['name'] }, direction: 'desc' }],
      },
      input: { names: [null, 'Alpha'] },
      maximumRows: 10,
      database: {
        async execute(value) {
          statement = value;
          return [];
        },
      },
    });
    const query = new PgDialect().sqlToQuery(statement as never);
    expect(query.sql.replace(/\s+/gu, ' ').trim()).toBe(
      'SELECT "id" AS "id", "set_id" AS "setId", "display_name" AS "name" FROM "application"."cards" WHERE ("display_name" IN ($1) OR "display_name" IS NULL) ORDER BY "display_name" DESC NULLS LAST LIMIT $2',
    );
    expect(query.params).toEqual(['Alpha', 10]);
  });
});
