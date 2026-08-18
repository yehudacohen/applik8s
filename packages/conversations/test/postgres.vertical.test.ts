import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from '@applik8s/applik8s/postgres-runtime-contract';
import { describe, expect, it } from 'vitest';
import { createPostgresApplicationConversationStore } from '../src/postgres.js';

describe('PostgreSQL conversation scope', () => {
  it('installs the admitted principal scope in the same transaction as every RLS-protected operation', async () => {
    const statements: Array<{
      readonly query: string;
      readonly parameters: readonly unknown[];
    }> = [];
    const now = '2026-08-16T00:00:00.000Z';
    const transaction: ApplicationPostgresTransactionSql = {
      json: value => value,
      async unsafe(query, parameters = []) {
        statements.push({ query, parameters });
        if (query.includes('INSERT INTO') && query.includes('applik8s_conversations')) {
          return [{
            id: 'conversation-1',
            principal_scope: 'principal:application:human:one',
            revision: 0,
            created_at: now,
            updated_at: now,
          }];
        }
        return [];
      },
    };
    const sql: ApplicationPostgresSql = {
      async unsafe() {
        return [];
      },
      async begin(operation) {
        return operation(transaction);
      },
      async end() {},
    };
    const store = createPostgresApplicationConversationStore({
      sql,
      access: { setting: 'applik8s.context.principalScope' },
    });

    await store.createConversation({
      apiVersion: 'applik8s.aiConversation/v1alpha1',
      id: 'conversation-1',
      principalScope: 'principal:application:human:one',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    expect(statements[0]).toEqual({
      query: 'SELECT set_config($1, $2, true)',
      parameters: [
        'applik8s.context.principalScope',
        'principal:application:human:one',
      ],
    });
    expect(statements[1]?.query).toContain('INSERT INTO');
  });
});
