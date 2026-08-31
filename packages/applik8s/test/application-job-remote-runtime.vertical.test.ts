import { type } from 'arktype';
import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import { describe, expect, test } from 'vitest';
import type { ApplicationJobReference } from '../src/application-finite-jobs.js';
import { createApplicationJobBinding } from '../src/application-finite-jobs.js';
import {
  ApplicationJobControllerRequestError,
  createRemoteApplicationJobRuntime,
} from '../src/application-job-remote-runtime.js';

describe('remote finite Job runtime', () => {
  test('preserves the function-native handle across the private controller boundary', async () => {
    const actions: string[] = [];
    let outcomeReads = 0;
    const runtime = createRemoteApplicationJobRuntime({
      endpoint: 'http://jobs.application-system.svc.cluster.local/v1/jobs',
      authorization: 'internal-job-token',
      pollIntervalMs: 1,
      async encodeAdmission(value) {
        expect(value).toBe(admission);
        return 'signed-admission';
      },
      async fetch(_input, init) {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer internal-job-token' });
        const body = JSON.parse(String(init?.body));
        actions.push(body.action);
        if (body.action === 'start') {
          expect(body).toMatchObject({ job: 'reports.export.v1', input: { value: 4 } });
          expect(body.invocation).toEqual({ admissionEnvelope: 'signed-admission' });
          expect(body).not.toHaveProperty('handler');
          return json({ ok: true, result: reference });
        }
        if (body.action === 'attach') return json({ ok: true, result: reference });
        if (body.action === 'outcome') {
          outcomeReads += 1;
          return json({
            ok: true,
            result: outcomeReads === 1
              ? { status: 'pending' }
              : { status: 'terminal', outcome: { status: 'succeeded', output: { doubled: 8 } } },
          });
        }
        if (body.action === 'progress') {
          return json({ ok: true, result: { run: reference, sequence: 1, recordedAt: reference.admittedAt, value: { completed: 1 } } });
        }
        if (body.action === 'cancel') {
          return json({ ok: true, result: { status: 'requested', receipt: { run: reference, requestedAt: reference.admittedAt, reason: body.reason } } });
        }
        return json({ error: 'unsupported_action' }, 400);
      },
    });
    const definition = {
      id: 'reports.export.v1',
      contract: {
        input: type({ value: 'number' }),
        output: type({ doubled: 'number' }),
        progress: type({ completed: 'number' }),
      },
      options: {},
      handler: () => ({ doubled: -1 }),
    };
    const job = createApplicationJobBinding(definition, runtime);
    const run = await job.start({ value: 4 }, { admission });
    await expect(run.progress()).resolves.toMatchObject({ value: { completed: 1 } });
    await expect(run.result()).resolves.toEqual({ doubled: 8 });
    await expect(job.attach(reference)).resolves.toMatchObject({ reference });
    await expect(run.cancel('superseded')).resolves.toMatchObject({
      status: 'requested',
      receipt: { reason: 'superseded' },
    });
    expect(actions).toEqual(['start', 'progress', 'outcome', 'outcome', 'attach', 'cancel']);
  });

  test('fails closed on malformed and unbounded controller responses', async () => {
    const malformed = createRemoteApplicationJobRuntime({
      endpoint: 'https://jobs.example.test/v1/jobs',
      authorization: 'token',
      fetch: async () => new Response('{', { status: 200 }),
    });
    await expect(malformed.attach('reports.export.v1', reference)).rejects.toBeInstanceOf(ApplicationJobControllerRequestError);

    const oversized = createRemoteApplicationJobRuntime({
      endpoint: 'https://jobs.example.test/v1/jobs',
      authorization: 'token',
      fetch: async () => new Response('', { headers: { 'content-length': '1048577' } }),
    });
    await expect(oversized.attach('reports.export.v1', reference)).rejects.toMatchObject({ code: 'response_too_large' });
  });
});

const reference: ApplicationJobReference = {
  protocol: 'applik8s.jobRuntime/v1alpha1',
  job: 'reports.export.v1',
  runId: 'run-1',
  admittedAt: '2026-01-01T00:00:00.000Z',
};

const admission: ApplicationAdmissionInvocationContextV1 = {
  apiVersion: 'applik8s.admission/v1',
  principal: {
    id: 'principal:test',
    identity: { id: 'identity:test', kind: 'service', issuer: 'test', subject: 'test' },
    kind: 'service',
    authenticationMethod: 'framework',
    audience: ['test'],
    trustedContextDigest: 'sha256:test',
    catalogRevision: 'test',
    authorityRevision: 'test',
    admittedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
  },
  authorityRevision: 'test',
  trustedContext: { values: {}, digest: 'sha256:test' },
  operation: { id: 'test', transport: 'framework' },
  correlationId: 'test',
  deadline: '2026-01-02T00:00:00.000Z',
};

function json(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
