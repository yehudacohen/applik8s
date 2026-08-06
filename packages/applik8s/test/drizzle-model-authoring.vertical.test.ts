import { getTableName, isTable } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { app, applicationGraphFor } from '../src/application.js';
import { field, index, model } from '../src/drizzle.js';
import { promoteDrizzleTable } from '../src/native-models.js';

describe('model-first relational authoring', () => {
  test('declares one Drizzle-compatible model without exposing pgTable authoring', () => {
    const posts = model('posts', {
      id: field.text('id').primaryKey(),
      body: field.text('body').notNull(),
      revision: field.text('revision').notNull(),
    });

    expect(isTable(posts)).toBe(true);
    expect(getTableName(posts)).toBe('posts');

    const Post = promoteDrizzleTable(posts, {
      name: 'Post',
      database: 'chirp',
      revision: 'revision',
    });

    expect(Post).toBe(posts);
    expect(Post.$model.schema.select.assert({
      id: 'post-1',
      body: 'hello',
      revision: '1',
    })).toEqual({
      id: 'post-1',
      body: 'hello',
      revision: '1',
    });
  });

  test('binds authored models from the typed database schema without app.model promotion', () => {
    const entries = model('guestbook_entries', {
      id: field.text('id').primaryKey(),
      message: field.text('message').notNull(),
      revision: field.text('revision').notNull(),
    });
    const application = app('single-definition-model');

    application.database.postgres('guestbook', {
      schema: { entries },
    });

    expect(entries.$model.name).toBe('Entry');
    expect(entries.$model.database).toBe('guestbook');
    expect(entries.create).toBeTypeOf('function');
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'model',
          name: 'Entry',
        }),
      ]),
    );
  });

  test('declares public identity and a domain revision exception once at the model', () => {
    const conversations = model(
      'application_conversations',
      {
        id: field.text('id').primaryKey(),
        revision: field.bigint('revision', { mode: 'number' }).notNull(),
      },
      (table) => [
        index('application_conversations_revision_idx').on(table.revision),
      ],
      {
        name: 'Conversation',
        revision: false,
      },
    );
    const application = app('declared-model-semantics');

    application.database.postgres('application', {
      schema: { internalConversationRows: conversations },
    });

    expect(conversations.$model.name).toBe('Conversation');
    expect(conversations.$model.revision).toBeUndefined();
    expect(conversations.$model.database).toBe('application');
  });
});
