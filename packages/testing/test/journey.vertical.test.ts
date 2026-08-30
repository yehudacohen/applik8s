import { describe, expect, it } from 'vitest';
import {
  type JourneyExecutionAdapter,
  type JourneyIdentityFixture,
  type JourneyOwnedResourceDescription,
  type JourneyRunOptions,
  journey,
  localJourneyAdapter,
  runJourney,
} from '../src/journey.js';

const digest = `sha256:${'a'.repeat(64)}`;

function runOptions(runId = 'run-001'): JourneyRunOptions {
  return {
    application: 'journey-test',
    mode: 'local',
    runId,
    fixtureSeed: `fixture-${runId}`,
    sourceRevision: 'test-revision',
    sourceDigest: digest,
  };
}

interface ResourceFixture {
  readonly id: string;
  readonly scope: string;
}

function adapter(
  runId: string,
  overrides: Partial<JourneyExecutionAdapter> = {},
): JourneyExecutionAdapter {
  return localJourneyAdapter({
    supports: () => true,
    begin: async () => ({
      isolation: {
        id: `lease-${runId}`,
        scope: `journey-test/${runId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        orphanPolicy: 'retain-with-remediation',
      },
      providerReceipts: [{ kind: 'provider', reference: `provider/${runId}` }],
      physicalResourceReceipts: [{ kind: 'resource', reference: `resource/${runId}` }],
      evidence: [{ kind: 'trace', reference: `trace/${runId}` }],
    }),
    createIdentity: async (_request, _run, options) => identity(options.runId),
    runAs: async (_identity, closure) => closure(),
    waitForEvent: async <TEvent>(_selection: unknown, predicate: (event: TEvent) => boolean) => {
      const event = { type: 'post.published', postId: 'post-1' } as TEvent;
      if (!predicate(event)) throw new Error('event did not match');
      return event;
    },
    checkAuthority: async () => ({ allowed: true, explanation: 'role allows operation', receipt: 'receipt-1' }),
    readApplicationPlan: async () => ({ providers: ['postgres'] }),
    describeOwnedResource: (resource) => describeResource(resource),
    verifyCleanupAuthority: async () => true,
    ...overrides,
  });
}

function identity(runId: string): JourneyIdentityFixture {
  return {
    id: `identity-${runId}`,
    runId,
    principalId: `principal-${runId}`,
    identity: {
      id: `principal-${runId}`,
      kind: 'human',
      issuer: 'journey-test',
      subject: `subject-${runId}`,
    },
  };
}

function describeResource(resource: unknown): JourneyOwnedResourceDescription {
  if (!resource || typeof resource !== 'object') throw new TypeError('resource fixture must be an object');
  const id = Reflect.get(resource, 'id');
  const scope = Reflect.get(resource, 'scope');
  if (typeof id !== 'string' || typeof scope !== 'string') throw new TypeError('invalid resource fixture');
  return { id, scope, kind: 'test-resource', summary: `test resource ${id}` };
}

describe('source-owned application journeys', () => {
  it('runs the callback-native golden path through the public local admission adapter', async () => {
    const definition = journey('post.publish.v1', async (context) => {
      const author = await context.identity({ roles: ['author'] });
      const post = await context.as(author, async () => ({ id: 'post-1', state: 'published' as const }));
      await context.expect(post).toEqual({ id: 'post-1', state: 'published' });
      await context.expect(post).toMatch({ state: 'published' });
      await context.expectEvent<{ type: string; postId: string }>(
        { event: 'post.published' },
        (event) => event.type === 'post.published' && event.postId === post.id,
      );
      await context.expectAuthority(author, { operationId: 'Post.approve', target: { postId: post.id } }).toAllow();
      await context.expectPlan(
        (plan) => Boolean(plan && typeof plan === 'object' && Reflect.get(plan, 'providers')),
        'selects a concrete provider',
      );
    }, {
      requirements: ['identity-fixtures', 'application-events', 'authority-explanations', 'application-plan'],
    });

    const result = await runJourney(definition, adapter('run-001'), runOptions());

    expect(result).toMatchObject({
      apiVersion: 'applik8s.journeyResult/v1alpha1',
      journeyId: 'post.publish.v1',
      runId: 'run-001',
      status: 'passed',
    });
    expect(result.steps).toHaveLength(1);
    expect(result.assertions).toHaveLength(5);
    expect(result.providerReceipts).toEqual([{ kind: 'provider', reference: 'provider/run-001' }]);
  });

  it('blocks an unsupported requirement instead of reporting a false pass', async () => {
    const definition = journey('browser.review.v1', async () => {}, {
      modes: ['local'],
      requirements: ['browser'],
    });
    const result = await runJourney(
      definition,
      adapter('run-002', { supports: () => false }),
      runOptions('run-002'),
    );

    expect(result.status).toBe('blocked');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'JOURNEY_PROVIDER_INCOMPATIBLE' }));
  });

  it('cleans external fixtures in reverse dependency order and proves absence', async () => {
    const removed = new Set<string>();
    const cleanupOrder: string[] = [];
    const scope = 'journey-test/run-003';
    const database: ResourceFixture = { id: 'database', scope };
    const row: ResourceFixture = { id: 'row', scope };
    const definition = journey('fixture.cleanup.v1', async (context) => {
      context.owns(database, {
        cleanup: async (resource) => { cleanupOrder.push(resource.id); removed.add(resource.id); },
        verifyAbsent: async (resource) => removed.has(resource.id),
      });
      context.owns(row, {
        dependsOn: [database],
        cleanup: async (resource) => { cleanupOrder.push(resource.id); removed.add(resource.id); },
        verifyAbsent: async (resource) => removed.has(resource.id),
      });
    });

    const result = await runJourney(definition, adapter('run-003'), runOptions('run-003'));

    expect(result.status).toBe('passed');
    expect(cleanupOrder).toEqual(['row', 'database']);
    expect(result.cleanup.map(({ status }) => status)).toEqual(['removed', 'removed']);
  });

  it('fails closed before deleting a resource outside the isolation lease', async () => {
    let cleanupCalled = false;
    const definition = journey('fixture.scope.v1', async (context) => {
      context.owns({ id: 'foreign', scope: 'another-run' }, {
        cleanup: async () => { cleanupCalled = true; },
        verifyAbsent: async () => false,
      });
    });

    const result = await runJourney(definition, adapter('run-004'), runOptions('run-004'));

    expect(result.status).toBe('failed');
    expect(cleanupCalled).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'JOURNEY_CLEANUP_INCOMPLETE' }));
  });

  it('withholds dependency cleanup when a consumer cannot be removed', async () => {
    const cleaned: string[] = [];
    const scope = 'journey-test/run-005';
    const database: ResourceFixture = { id: 'database', scope };
    const row: ResourceFixture = { id: 'row', scope };
    const definition = journey('fixture.failure.v1', async (context) => {
      context.owns(database, {
        cleanup: async (resource) => { cleaned.push(resource.id); },
        verifyAbsent: async () => false,
        maximumAttempts: 1,
      });
      context.owns(row, {
        dependsOn: [database],
        cleanup: async () => { throw new Error('delete denied'); },
        verifyAbsent: async () => false,
        maximumAttempts: 1,
      });
    });

    const result = await runJourney(definition, adapter('run-005'), runOptions('run-005'));

    expect(result.status).toBe('cleanupFailed');
    expect(cleaned).toEqual([]);
    expect(result.cleanup).toEqual([
      expect.objectContaining({ resource: expect.objectContaining({ id: 'row' }), status: 'failed' }),
      expect.objectContaining({ resource: expect.objectContaining({ id: 'database' }), status: 'blocked' }),
    ]);
  });

  it('reports an invalid cleanup graph as cleanup failure rather than an ordinary assertion failure', async () => {
    const scope = 'journey-test/run-005b';
    const first: ResourceFixture = { id: 'first', scope };
    const second: ResourceFixture = { id: 'second', scope };
    const definition = journey('fixture.cycle.v1', async (context) => {
      context.owns(first, {
        dependsOn: [second],
        cleanup: async () => {},
        verifyAbsent: async () => false,
      });
      context.owns(second, {
        dependsOn: [first],
        cleanup: async () => {},
        verifyAbsent: async () => false,
      });
    });

    const result = await runJourney(definition, adapter('run-005b'), runOptions('run-005b'));

    expect(result.status).toBe('cleanupFailed');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'JOURNEY_CLEANUP_INCOMPLETE' }));
  });

  it('settles a non-cooperative handler at the declared deadline and still returns evidence', async () => {
    const definition = journey('timeout.boundary.v1', async () => new Promise<void>(() => {}), {
      modes: ['local'],
      timeoutMs: 20,
    });
    const startedAt = Date.now();

    const result = await runJourney(definition, adapter('run-006'), runOptions('run-006'));

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'JOURNEY_ASSERTION_TIMEOUT' }));
  });

  it('keeps returned evidence immutable when timed-out application code completes later', async () => {
    const definition = journey('timeout.snapshot.v1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }, {
      modes: ['local'],
      timeoutMs: 10,
    });

    const result = await runJourney(definition, adapter('run-006b'), runOptions('run-006b'));
    const snapshot = JSON.stringify(result);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(result.status).toBe('failed');
    expect(result.steps).toEqual([expect.objectContaining({ name: 'journey', status: 'failed' })]);
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it('bounds cleanup callbacks that ignore cancellation', async () => {
    const definition = journey('cleanup.timeout.v1', async (context) => {
      context.owns({ id: 'hung', scope: 'journey-test/run-006c' }, {
        cleanup: async () => new Promise<void>(() => {}),
        verifyAbsent: async () => false,
        timeoutMs: 10,
        maximumAttempts: 1,
      });
    });

    const result = await runJourney(definition, adapter('run-006c'), runOptions('run-006c'));

    expect(result.status).toBe('cleanupFailed');
    expect(result.cleanup).toEqual([
      expect.objectContaining({ resource: expect.objectContaining({ id: 'hung' }), status: 'failed', attempts: 1 }),
    ]);
  });

  it('redacts adapter-supplied credential evidence and returns a safe failed result', async () => {
    const definition = journey('evidence.redaction.v1', async () => {});
    const unsafe = adapter('run-007', {
      begin: async () => ({
        isolation: {
          id: 'lease-run-007',
          scope: 'journey-test/run-007',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          orphanPolicy: 'retain-with-remediation',
        },
        providerReceipts: [{ kind: 'provider', reference: 'Bearer this-must-not-escape' }],
        physicalResourceReceipts: [],
        evidence: [],
      }),
    });

    const result = await runJourney(definition, unsafe, runOptions('run-007'));

    expect(result.status).toBe('failed');
    expect(result.providerReceipts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('this-must-not-escape');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'JOURNEY_EVIDENCE_REDACTION_FAILED' }));
  });
});
