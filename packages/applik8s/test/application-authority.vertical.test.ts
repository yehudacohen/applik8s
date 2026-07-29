import { app, applicationGraphFor } from '@applik8s/applik8s';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('application static authority declarations', () => {
  it('records typed service authority once and replays it into the materialized application graph', () => {
    const posts = pgTable('authority_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const chirp = app('authority-chirp', { namespace: 'authority-chirp' });
    const database = chirp.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = chirp.model(posts, { name: 'Post', database });
    const bot = chirp.serviceIdentity('timeline-bot');
    const publish = chirp.permission('publish-post', Post.create.all());
    bot.can(publish);

    const graph = applicationGraphFor(chirp.composition);
    const authority = graph?.nodes.find((node) => node.kind === 'authorityManifest');
    expect(authority).toMatchObject({
      id: 'authority-manifest.application',
      manifest: {
        apiVersion: 'applik8s.authorityManifest/v1alpha1',
        application: 'authority-chirp',
        revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        identities: expect.arrayContaining([
          expect.objectContaining({
            id: 'identity:authority-chirp:service:timeline-bot',
            kind: 'service',
          }),
        ]),
        permissions: [
          expect.objectContaining({
            name: 'publish-post-0',
            operationIds: ['applik8s://models/Post/operations/create'],
            scope: { kind: 'all' },
          }),
        ],
        grants: [
          expect.objectContaining({
            identity: expect.objectContaining({
              id: 'identity:authority-chirp:service:timeline-bot',
            }),
            operationIds: ['applik8s://models/Post/operations/create'],
          }),
        ],
      },
    });
    expect(Post.create.authority).toMatchObject({
      classification: 'assigned',
      permissionIds: [expect.stringMatching(/^permission:authority-chirp:publish-post-0:/)],
    });
  });
});
