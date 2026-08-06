// typecast-file-boundary: signal fixtures intentionally cross erased generic contracts to verify runtime validation and typed hydration.
import {
  AnalyticalDatabase,
  app,
  applicationGraphFor,
  installApplicationWorkflowSignalRuntimeResolver,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { field, model } from '@applik8s/applik8s/drizzle';
import { describe, expect, it } from 'vitest';

describe('v0.7 function-native durable signals', () => {
  it('declares one typed signal contract as a replayable issuance stream', () => {
    const platform = app('signal-contract');
    platform.database.postgres('primary', { schema: {} });

    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string', organizationId: 'string' }),
      actions: {
        approve: type({ 'comment?': 'string' }),
        reject: type({ reason: 'string' }),
      },
    });
    const ReviewRequests = ReviewDecision.subscribe('review-requests', {
      delivery: 'sse',
      authorize: ({ principal }) =>
        principal.roles?.includes('reviewer') === true,
    });
    const Reviewer = platform.role('reviewer');
    Reviewer.can(
      ReviewDecision.read,
      ReviewDecision.approve,
      ReviewDecision.reject,
    );

    expect(ReviewDecision).toMatchObject({
      kind: 'applicationStream',
      signalKind: 'applicationSignal',
      signal: {
        id: 'review-decision.v1',
        name: 'review-decision',
        version: 'v1',
      },
      authority: 'postgres-outbox',
      replay: 'supported',
    });
    expect(ReviewRequests).toMatchObject({
      kind: 'applicationSubscription',
      name: 'review-requests',
    });
    expect(ReviewDecision.read.operation.id).toBe(
      'applik8s://signals/review-decision.v1/operations/issuance.read',
    );
    expect(ReviewDecision.approve.operation.id).toBe(
      'applik8s://signals/review-decision.v1/operations/approve',
    );
    expect(applicationGraphFor(platform.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'stream',
          name: 'review-decision',
          version: 'v1',
          authority: 'postgres-outbox',
        }),
        expect.objectContaining({
          kind: 'subscription',
          name: 'review-requests',
          source: { nodeId: 'stream.review-decision.v1' },
        }),
        expect.objectContaining({
          kind: 'authorityManifest',
          manifest: expect.objectContaining({
            roles: [
              expect.objectContaining({
                id: 'role:signal-contract:reviewer',
              }),
            ],
            permissions: expect.arrayContaining([
              expect.objectContaining({
                operationIds: [
                  'applik8s://signals/review-decision.v1/operations/issuance.read',
                ],
              }),
              expect.objectContaining({
                operationIds: [
                  'applik8s://signals/review-decision.v1/operations/approve',
                ],
              }),
              expect.objectContaining({
                operationIds: [
                  'applik8s://signals/review-decision.v1/operations/reject',
                ],
              }),
            ]),
          }),
        }),
      ]),
    );
  });

  it('keeps workflow.emitSignal unavailable outside durable execution', async () => {
    const platform = app('signal-runtime-boundary');
    platform.database.postgres('primary', { schema: {} });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({}) },
    });

    await expect(
      platform.workflow.emitSignal(ReviewDecision, {
        input: { postId: 'post-1' },
        expiresIn: '24h',
        target: { postId: 'post-1' },
        authorize: [],
      }),
    ).rejects.toThrow(/only inside durable workflow execution/);
  });

  it('hydrates workflow.emitSignal through an execution-scoped runtime', async () => {
    const platform = app('signal-runtime');
    platform.database.postgres('primary', { schema: {} });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({ 'comment?': 'string' }) },
    });
    const dispose = installApplicationWorkflowSignalRuntimeResolver(() => ({
      async emit(definition, options) {
        const reference = {
          $type: 'applik8s.signal/v1' as const,
          contract: {
            id: definition.id,
            name: definition.name,
            version: definition.version,
          },
          issuance: { id: 'signal-1' },
          expiresAt: '2030-01-01T00:00:00.000Z',
        };
        return Object.assign(
          async () => ({
            value: {
              status: 'expired' as const,
              signal: reference,
              expiredAt: reference.expiresAt,
            },
            async match(matcher: { expired(input: object): unknown }) {
              return matcher.expired({
                status: 'expired',
                signal: reference,
                expiredAt: reference.expiresAt,
              });
            },
          }),
          reference,
          {
            issueReceipt: {
              id: `issue:${String(
                Reflect.get(options.input, 'postId'),
              )}`,
            },
          },
        ) as never;
      },
    }));

    try {
      const decision = await platform.workflow.emitSignal(ReviewDecision, {
        input: { postId: 'post-1' },
        expiresIn: '24h',
        target: { postId: 'post-1' },
        authorize: [],
      });
      expect(decision.issuance).toEqual({ id: 'signal-1' });
      expect(decision.issueReceipt).toEqual({ id: 'issue:post-1' });
    } finally {
      dispose();
    }
  });

  it('persists only an explicitly bounded inert signal reference in a model-backed projection', () => {
    const platform = app('signal-projection-capability');
    const schema: Record<string, unknown> = {};
    const database = platform.database.postgres('primary', { schema });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({ 'comment?': 'string' }) },
    });
    const PendingReview = model(
      'pending_reviews',
      {
        id: field.text('id').primaryKey(),
        signal: field
          .signal(ReviewDecision, {
            visibility: 'same-as-issuance',
            maxAge: '24h',
          })
          .notNull(),
      },
      { name: 'PendingReview', revision: false },
    );
    schema.PendingReview = PendingReview;
    platform.model(PendingReview, { database, revision: false });

    ReviewDecision.project(
      PendingReview,
      function pendingReviewCapabilities(event, output) {
        // @ts-expect-error projection decoding deliberately exposes only the inert reference.
        void event.signal.approve;
        return output.upsert({
          partition: event.input.postId,
          key: event.id,
          score: Date.parse(event.issuedAt),
          value: {
            id: event.id,
            signal: event.signal,
          },
        });
      },
    )
      .rebuildFromReplay()
      .retain({ maxItemsPerPartition: 100, maxAge: '24h' });

    expect(applicationGraphFor(platform.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'projection',
          name: 'pending-review-capabilities',
          capabilityFields: [{
            path: 'signal',
            kind: 'signalReference',
            contract: {
              id: 'review-decision.v1',
              name: 'review-decision',
              version: 'v1',
            },
            visibility: 'same-as-issuance',
            maxAgeSeconds: 86_400,
          }],
        }),
      ]),
    );
  });

  it('rejects signal-reference laundering through an ordinary projection field', () => {
    const platform = app('signal-projection-laundering');
    platform.database.postgres('primary', { schema: {} });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({}) },
    });

    expect(() =>
      ReviewDecision.project(
        type({ id: 'string', signal: 'object' }),
        function unsafeSignalProjection(event, output) {
          return output.append({
            id: event.id,
            signal: event.signal,
          });
        },
      ),
    ).toThrow(/cannot persist a signal reference in an ordinary output field/);
  });

  it('allows inert signal metadata while ignoring signal-looking literal data', () => {
    const platform = app('signal-projection-metadata');
    platform.database.postgres('primary', { schema: {} });
    platform.defaults({
      analytics: AnalyticalDatabase.clickhouse({
        name: 'signal-metadata-analytics',
        provision: false,
        endpoint: 'http://clickhouse.signal-metadata.svc:8123',
      }),
    });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({}) },
    });

    const projection = ReviewDecision.project(
      type({
        issuanceId: 'string',
        documentation: 'string',
      }),
      function signalMetadata(event, output) {
        return output.append({
          issuanceId: event.signal.issuance.id,
          documentation: 'event.signal is intentionally inert here',
        });
      },
    );

    expect(projection).toMatchObject({
      kind: 'applicationProjection',
      name: 'signal-metadata',
      storage: 'analytical',
    });
  });

  it('rejects a mismatched signal contract and indirect capability assignment', () => {
    const platform = app('signal-projection-mismatch');
    const schema: Record<string, unknown> = {};
    const database = platform.database.postgres('primary', { schema });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({}) },
    });
    const EscalationDecision = platform.workflow.signal(
      'escalation-decision.v1',
      {
        input: type({ postId: 'string' }),
        actions: { escalate: type({}) },
      },
    );
    const PendingEscalation = model(
      'pending_escalations',
      {
        id: field.text('id').primaryKey(),
        signal: field
          .signal(EscalationDecision, {
            visibility: 'same-as-issuance',
            maxAge: '24h',
          })
          .notNull(),
      },
      { name: 'PendingEscalation', revision: false },
    );
    schema.PendingEscalation = PendingEscalation;
    platform.model(PendingEscalation, { database, revision: false });

    expect(() =>
      ReviewDecision.project(
        PendingEscalation,
        function mismatchedSignal(event, output) {
          return output.upsert({
            partition: event.input.postId,
            key: event.id,
            score: Date.parse(event.issuedAt),
            value: { id: event.id, signal: event.signal as never },
          });
        },
      ),
    ).toThrow(/declares escalation-decision\.v1 but the source emits review-decision\.v1/);

    expect(() =>
      EscalationDecision.project(
        PendingEscalation,
        function indirectSignal(event, output) {
          const signal = event.signal;
          return output.upsert({
            partition: event.input.postId,
            key: event.id,
            score: Date.parse(event.issuedAt),
            value: { id: event.id, signal },
          });
        },
      ),
    ).toThrow(/must receive the exact inert event\.signal reference directly/);

    expect(() =>
      EscalationDecision.project(
        PendingEscalation,
        function wrappedSignal(event, output) {
          const identity = <T>(value: T) => value;
          return output.upsert({
            partition: event.input.postId,
            key: event.id,
            score: Date.parse(event.issuedAt),
            value: { id: event.id, signal: identity(event.signal) },
          });
        },
      ),
    ).toThrow(/must receive the exact inert event\.signal reference directly/);
  });

  it('requires a positive bounded retention on signal fields', () => {
    const platform = app('signal-field-retention');
    platform.database.postgres('primary', { schema: {} });
    const ReviewDecision = platform.workflow.signal('review-decision.v1', {
      input: type({ postId: 'string' }),
      actions: { approve: type({}) },
    });

    expect(() =>
      field.signal(ReviewDecision, {
        visibility: 'same-as-issuance',
        maxAge: '0h',
      }),
    ).toThrow(/maxAge must be a positive duration/);
    expect(() =>
      field.signal(ReviewDecision, {
        visibility: 'same-as-issuance',
        maxAge: 'forever',
      }),
    ).toThrow(/maxAge must be a positive duration/);
  });

  it('fails closed for ambiguous database authority and invalid contracts', () => {
    const missing = app('signal-missing-database');
    expect(() =>
      missing.workflow.signal('review-decision.v1', {
        input: type({ postId: 'string' }),
        actions: { approve: type({}) },
      }),
    ).toThrow(/requires a registered native database/);

    const ambiguous = app('signal-ambiguous-database');
    ambiguous.database.postgres('one', { schema: {} });
    ambiguous.database.postgres('two', { schema: {} });
    expect(() =>
      ambiguous.workflow.signal('review-decision.v1', {
        input: type({ postId: 'string' }),
        actions: { approve: type({}) },
      }),
    ).toThrow(/ambiguous/);

    const valid = app('signal-invalid-contract');
    valid.database.postgres('primary', { schema: {} });
    expect(() =>
      valid.workflow.signal('ReviewDecision', {
        input: type({ postId: 'string' }),
        actions: { approve: type({}) },
      }),
    ).toThrow(/explicit .vN version/);
    expect(() =>
      valid.workflow.signal('review-decision.v1', {
        input: type({ postId: 'string' }),
        actions: {},
      }),
    ).toThrow(/at least one terminal action/);
  });
});
