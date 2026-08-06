// typecast-file-boundary: UI tests inspect generated operation fixtures after asserting their protocol shape.
import {
  app,
  applicationGraphFor,
  TransactionalDatabase,
} from '@applik8s/applik8s';
import {
  applicationApprovalReviews,
  applicationApprovalSchema,
  approvals,
} from '@applik8s/approvals';
import {
  applicationArtifacts,
  applicationArtifactSchema,
  artifacts,
} from '@applik8s/artifacts';
import {
  applicationConversations,
  applicationConversationSchema,
  conversations,
} from '@applik8s/conversations';
import {
  applicationEvaluationDatasets,
  applicationEvaluationSchema,
  evaluations,
} from '@applik8s/evals';
import { isApplicationRelationalModel } from '@applik8s/applik8s/drizzle';
import {
  applicationOperationalObservations,
  applicationAuthorityAudit,
  applicationOperationsInferredRecords,
  applicationOperationsRouteContribution,
  applicationOperationsRedactedDomainRecords,
  applicationOperationsRedactedAuditRecords,
  applicationOperationsRedactedRecords,
  operationsOverview,
  operationsControlCenter,
} from '@applik8s/operations-ui';
import {
  applicationUsageFacts,
  applicationUsageSchema,
  usage,
} from '@applik8s/usage';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('maintained operations control center', () => {
  it('authors every maintained relational entity once through the public model API', () => {
    expect([
      applicationConversations,
      applicationApprovalReviews,
      applicationArtifacts,
      applicationEvaluationDatasets,
      applicationUsageFacts,
    ].every(isApplicationRelationalModel)).toBe(true);
  });

  it('registers one bounded, protected query over explicitly declared model reads', async () => {
    const application = app('operations-ui-fixture', {
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const provider = TransactionalDatabase.postgres({
      clusterName: 'operations-db',
      namespace: 'operations',
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
    const database = application.database.bind('operations', {
      provider: databaseProvider,
      schema: {
        ...applicationConversationSchema,
        ...applicationApprovalSchema,
        ...applicationArtifactSchema,
        ...applicationEvaluationSchema,
        ...applicationUsageSchema,
        applicationOperationalObservations,
        applicationAuthorityAudit,
      },
      migrations: { path: './drizzle' },
    });
    const Conversations = application.include(conversations);
    const Approvals = application.include(approvals);
    const Artifacts = application.include(artifacts);
    const Evaluations = application.include(evaluations);
    const Usage = application.include(usage);
    const inferred = applicationOperationsInferredRecords(
      applicationGraphFor(application),
    );

    const module = operationsControlCenter(application, {
      database,
      conversations: Conversations,
      approvals: Approvals,
      artifacts: Artifacts,
      evaluations: Evaluations,
      usage: Usage,
    });
    const snapshotNode = applicationGraphFor(application)?.nodes.find(
      (node) =>
        node.kind === 'query'
        && node.name === 'Conversation.operationsSnapshot',
    );
    const authorityNode = applicationGraphFor(application)?.nodes.find(
      (node) => node.kind === 'authorityManifest',
    );
    expect(module.snapshot.operation.id).toBe('Conversation.operationsSnapshot');
    expect(module.Conversation.operationsSnapshot).toBe(module.snapshot);
    expect(module.snapshot.operation.transport).toBe('query');
    expect(applicationOperationalObservations.application).toBeDefined();
    expect(applicationAuthorityAudit.application).toBeDefined();
    expect(snapshotNode).toMatchObject({
      kind: 'query',
      handlerSource: expect.stringContaining(
        'applicationOperationalObservations.application',
      ),
      authority: {
        classification: 'assigned',
        permissionIds: [expect.stringMatching(/^permission:operations-ui-fixture:role-administrator-/)],
      },
    });
    expect(authorityNode).toMatchObject({
      manifest: {
        roles: [{
          name: 'administrator',
          permissionIds: [expect.stringMatching(/^permission:operations-ui-fixture:role-administrator-/)],
        }],
      },
    });
    expect(inferred).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'database',
          state: 'unknown',
          authority: 'inferred',
        }),
      ]),
    );
    expect(inferred).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'ready' }),
      ]),
    );
    expect('OperationalObservation' in module).toBe(false);
    expect(applicationOperationsRouteContribution).toMatchObject({
      path: '/operations',
      authority: 'application-operation',
      operation: 'Conversation.operationsSnapshot',
    });
  });

  it('offers a lightweight overview without installing unrelated product domains', () => {
    const application = app('operations-overview-fixture', {
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const database = application.database.postgres('application', {
      schema: {},
      clusterName: 'overview-db',
      namespace: 'operations',
    });

    const overview = application.include(operationsOverview);
    const graph = applicationGraphFor(application);
    const modelIds = graph?.nodes
      .filter((node) => node.kind === 'model')
      .map((node) => node.id);

    expect(database).toBeDefined();
    expect(overview.snapshot.operation.id).toContain('operationsSnapshot');
    expect(modelIds).not.toContain('model.conversation');
    expect(modelIds).not.toContain('model.approval-review');
    expect(modelIds).not.toContain('model.artifact');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'query',
        authority: expect.objectContaining({
          classification: 'assigned',
        }),
      }),
    ]));
  });

  it('searches a redacted canonical audit timeline without exposing actor or target evidence', () => {
    const rows = applicationOperationsRedactedAuditRecords([{
      application: 'chirp',
      id: 'audit-1',
      occurredAt: '2026-08-01T12:00:00.000Z',
      document: {
        kind: 'authorization.allowed',
        operationId: 'applik8s://models/Post/operations/delete',
        targetDigest: 'sha256:private-target',
        principal: {
          id: 'identity:private-administrator',
          subject: 'private-administrator',
        },
        details: {
          credential: 'never-public',
        },
      },
    }], 'post');

    expect(rows).toEqual([{
      category: 'audit',
      id: 'audit-1',
      label: 'authorization.allowed',
      state: 'recorded',
      authority: 'canonical',
      observedAt: '2026-08-01T12:00:00.000Z',
    }]);
    expect(JSON.stringify(rows)).not.toContain('private');
    expect(applicationOperationsRedactedAuditRecords([{
      id: 'audit-1',
      document: { kind: 'authorization.allowed' },
    }], 'revoked')).toEqual([]);
  });

  it('never exposes raw content, evidence, targets, grants, or credentials through the browser snapshot', () => {
    const rows = applicationOperationsRedactedRecords('approval', [{
      id: 'approval-1',
      operationId: 'Post.publish',
      status: 'pending',
      authority: 'canonical',
      createdAt: '2026-08-01T00:00:00.000Z',
      content: 'private conversation',
      evidence: { secret: 'private evidence' },
      target: { organizationId: 'private-target' },
      grantId: 'grant-private',
      token: 'credential-private',
    }]);

    expect(rows).toEqual([{
      category: 'approval',
      id: 'approval-1',
      label: 'Post.publish',
      state: 'pending',
      authority: 'canonical',
      observedAt: '2026-08-01T00:00:00.000Z',
    }]);
    expect(JSON.stringify(rows)).not.toMatch(
      /private|grant-private|credential-private/,
    );
  });

  it('downgrades expired provider observations instead of presenting stale readiness', () => {
    expect(
      applicationOperationsRedactedRecords('eventConsumer', [{
        id: 'consumer-1',
        subject: 'commands',
        state: 'running',
        authority: 'provider',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }]),
    ).toEqual([{
      category: 'eventConsumer',
      id: 'consumer-1',
      label: 'commands',
      state: 'unknown',
      authority: 'provider',
    }]);
  });

  it('partitions operational observations into honest domain lanes without copying raw evidence', () => {
    const rows = [
      {
        id: 'workflow-1',
        domain: 'workflow',
        subject: 'PostReview',
        state: 'waiting',
        authority: 'canonical',
        evidence: { token: 'never-browser-visible' },
      },
      {
        id: 'search-1',
        domain: 'projection',
        subject: 'PostSearch',
        state: 'degraded',
        authority: 'provider',
      },
    ];
    expect(
      applicationOperationsRedactedDomainRecords(
        'workflow',
        'workflow',
        rows,
      ),
    ).toEqual([{
      category: 'workflow',
      id: 'workflow-1',
      label: 'PostReview',
      state: 'waiting',
      authority: 'canonical',
    }]);
    expect(
      applicationOperationsRedactedDomainRecords(
        'projection',
        'projection',
        rows,
      ),
    ).toEqual([{
      category: 'projection',
      id: 'search-1',
      label: 'PostSearch',
      state: 'degraded',
      authority: 'provider',
    }]);
  });
});
