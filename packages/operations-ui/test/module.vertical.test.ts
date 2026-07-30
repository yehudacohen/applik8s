import { app, TransactionalDatabase } from '@applik8s/applik8s';
import {
  applicationOperationsRouteContribution,
  operationsControlCenter,
} from '@applik8s/operations-ui';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('maintained operations control center', () => {
  it('registers one bounded, protected query over explicitly declared model reads', async () => {
    const application = app('operations-ui-fixture', {
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const provider = TransactionalDatabase.postgres({
      clusterName: 'operations-db',
      connectionSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'operations-db-app',
      },
      database: 'operations',
    });
    const databaseProvider = application.provide(
      TransactionalDatabase,
      provider,
    );
    const names = [
      'Conversation',
      'ProtocolRun',
      'ApprovalReview',
      'Artifact',
      'EvaluationRun',
      'UsageFact',
    ] as const;
    const tables = Object.fromEntries(
      names.map((name) => [
        name,
        pgTable(name.toLowerCase(), {
            id: text('id').primaryKey(),
        }),
      ]),
    );
    const database = application.database.bind('operations', {
      provider: databaseProvider,
      schema: tables,
      migrations: { path: './drizzle' },
    });
    const models = Object.fromEntries(
      names.map((name) => {
        const table = tables[name];
        if (!table) throw new Error(`Missing test table ${name}.`);
        return [
          name,
          application.model(table, { name, database, revision: false }),
        ];
      }),
    ) as never;

    const module = operationsControlCenter(application, { database, models });
    expect(module.snapshot.operation.id).toBe('Conversation.operationsSnapshot');
    expect(module.snapshot.operation.transport).toBe('query');
    expect(applicationOperationsRouteContribution).toMatchObject({
      path: '/operations',
      authority: 'application-operation',
      operation: 'Conversation.operationsSnapshot',
    });
  });
});
