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

  it('declares provider-admitted roles directly against typed operations', () => {
    const posts = pgTable('role_authority_posts', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const chirp = app('role-authority-chirp');
    const database = chirp.database.postgres('application', {
      schema: { posts },
      migrations: { path: './drizzle' },
    });
    const Post = chirp.model(posts, { name: 'Post', database });

    const Administrator = chirp.role('administrator');
    Administrator.can(Post.delete.all());

    const authority = applicationGraphFor(chirp)?.nodes.find(
      (node) => node.kind === 'authorityManifest',
    );
    expect(authority).toMatchObject({
      manifest: {
        roles: [{
          id: 'role:role-authority-chirp:administrator',
          name: 'administrator',
          permissionIds: [
            expect.stringMatching(
              /^permission:role-authority-chirp:role-administrator-0:/,
            ),
          ],
        }],
        permissions: [
          expect.objectContaining({
            operationIds: ['applik8s://models/Post/operations/delete'],
            scope: { kind: 'all' },
          }),
        ],
      },
    });
  });

  it('declares an exact provider-verified one-time role bootstrap', () => {
    const application = app('operator-bootstrap');
    const database = application.database.postgres('application', {
      schema: {},
    });
    const records = pgTable('operator_records', {
      id: text('id').primaryKey(),
    });
    const Record = application.model(records, { name: 'Record', database });
    application.role('application-operator')
      .can(Record.delete.all())
      .bootstrap({
        id: 'identity:deterministic:local-developer',
        kind: 'human',
        issuer: 'applik8s://operator-bootstrap/identity/deterministic',
        subject: 'local-developer',
      });

    const authority = applicationGraphFor(application)?.nodes.find(
      (node) => node.kind === 'authorityManifest',
    );
    expect(authority).toMatchObject({
      manifest: {
        roleBootstraps: [{
          id: 'bootstrap:operator-bootstrap:role:application-operator',
          roleId: 'role:operator-bootstrap:application-operator',
          identity: {
            id: 'identity:deterministic:local-developer',
            subject: 'local-developer',
          },
        }],
      },
    });
  });

  it('binds an OAuth workload client to its exact issuer and typed operation', () => {
    const requests = pgTable('oauth_authority_requests', {
      id: text('id').primaryKey(),
      evidence: text('evidence').notNull(),
    });
    const application = app('oauth-authority');
    const database = application.database.postgres('application', {
      schema: { requests },
      migrations: { path: './drizzle' },
    });
    const Request = application.model(requests, {
      name: 'AccessRequest',
      database,
    });

    const automation = application.oauthClient('release-automation', {
      issuer: 'https://identity.example.test',
    });
    automation.can(Request.create.all());

    expect(automation).toMatchObject({
      kind: 'applicationOAuthClientIdentity',
      clientId: 'release-automation',
      identity: {
        id: 'identity:oauth:fa5c66f5a6d11204c5f704dac23b9063fdc666be06b603bddc55a526b7a4cad1',
        kind: 'workload',
        issuer: 'https://identity.example.test',
        subject: 'release-automation',
      },
    });
    const authority = applicationGraphFor(application)?.nodes.find(
      (node) => node.kind === 'authorityManifest',
    );
    expect(authority).toMatchObject({
      manifest: {
        identities: expect.arrayContaining([
          automation.identity,
        ]),
        grants: [
          expect.objectContaining({
            identity: automation.identity,
            operationIds: [
              'applik8s://models/AccessRequest/operations/create',
            ],
            scope: { kind: 'all' },
          }),
        ],
      },
    });
    expect(() => application.oauthClient('not a client', {
      issuer: 'https://identity.example.test',
    })).toThrow(/OAuth client ID/);
  });
});
