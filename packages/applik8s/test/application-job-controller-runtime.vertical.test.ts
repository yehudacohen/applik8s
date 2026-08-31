// typecast-file-boundary: the in-memory test store intentionally implements
// only the read seam exercised by the controller after typed fixture creation.
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import {
  createApplicationJobBinding,
  createDeterministicApplicationJobRuntime,
} from '../src/application-finite-jobs.js';
import { createApplicationJobControllerHandler } from '../src/application-job-controller-runtime.js';
import { defaultApplicationJobLifecycleFactContracts, type ApplicationJobStore, type ApplicationJobStoredRun } from '../src/application-job-store.js';

const Input = type({ value: 'number.integer' });
const Output = type({ doubled: 'number.integer' });

describe('application Job private controller', () => {
  test('authenticates, admits, observes, attaches, and returns terminal outcomes', async () => {
    const runtime = createDeterministicApplicationJobRuntime({ id: () => 'run-1' });
    const definition = {
      id: 'numbers.double.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input: { value: number }) => ({ doubled: input.value * 2 }),
    };
    const binding = createApplicationJobBinding(definition, runtime);
    const run = await binding.start({ value: 4 });
    const store = memoryStore(async () => ({
      reference: run.reference,
      admittedAt: run.reference.admittedAt,
      input: { value: 4 },
      inputDigest: 'sha256:test',
      admission: admission(),
      events: defaultApplicationJobLifecycleFactContracts(definition.id),
      phase: 'terminal',
      attempt: 1,
      maximumAttempts: 1,
      availableAt: run.reference.admittedAt,
      outcome: { status: 'succeeded', output: { doubled: 8 } },
      terminalAt: run.reference.admittedAt,
    }));
    const handler = createApplicationJobControllerHandler({
      runtime,
      store,
      definitions: [definition],
      authorization: 'controller-secret',
    });

    await expect(handler(request({ action: 'outcome', reference: run.reference }))).resolves.toMatchObject({ status: 401 });
    const response = await handler(request(
      { action: 'outcome', reference: run.reference },
      'controller-secret',
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        status: 'terminal',
        outcome: { status: 'succeeded', output: { doubled: 8 } },
      },
    });
    const attached = await handler(request(
      { action: 'attach', job: definition.id, reference: run.reference },
      'controller-secret',
    ));
    expect(await attached.json()).toEqual({ ok: true, result: run.reference });
  });

  test('bounds bodies and fails closed for unknown definitions and references', async () => {
    const runtime = createDeterministicApplicationJobRuntime();
    const definition = {
      id: 'numbers.double.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input: { value: number }) => ({ doubled: input.value * 2 }),
    };
    const handler = createApplicationJobControllerHandler({
      runtime,
      store: memoryStore(async () => undefined),
      definitions: [definition],
      authorization: 'secret',
      maximumRequestBytes: 32,
    });
    const oversized = await handler(new Request('http://controller/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-length': '33' },
      body: '{}',
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'request_too_large' });

    const missing = await createApplicationJobControllerHandler({
      runtime,
      store: memoryStore(async () => undefined),
      definitions: [definition],
      authorization: 'secret',
    })(request({ action: 'start', job: 'missing.v1', input: {} }, 'secret'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'job_not_found' });
  });

  test('rejects client-authored admission and admits only verified envelopes', async () => {
    const runtime = createDeterministicApplicationJobRuntime({ id: () => 'verified-run' });
    const definition = {
      id: 'numbers.double.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input: { value: number }) => ({ doubled: input.value * 2 }),
    };
    const decoded: string[] = [];
    const handler = createApplicationJobControllerHandler({
      runtime,
      store: memoryStore(async () => undefined),
      definitions: [definition],
      authorization: 'secret',
      decodeAdmission: async envelope => {
        decoded.push(envelope);
        return admission();
      },
    });
    const raw = await handler(request({
      action: 'start',
      job: definition.id,
      input: { value: 2 },
      invocation: { admission: admission() },
    }, 'secret'));
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: 'raw_admission_rejected' });

    const verified = await handler(request({
      action: 'start',
      job: definition.id,
      input: { value: 2 },
      invocation: { admissionEnvelope: 'signed-admission' },
    }, 'secret'));
    expect(verified.status).toBe(200);
    expect(decoded).toEqual(['signed-admission']);
  });
});

function request(body: Record<string, unknown>, token?: string): Request {
  return new Request('http://controller/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      apiVersion: 'applik8s.jobControllerRequest/v1alpha1',
      ...body,
    }),
  });
}

function memoryStore(
  read: (runId: string) => Promise<ApplicationJobStoredRun | undefined>,
): ApplicationJobStore {
  return {
    protocol: 'applik8s.jobStore/v1alpha1',
    admit: unsupported,
    claim: unsupported,
    heartbeat: unsupported,
    recordProgress: unsupported,
    retry: unsupported,
    cancel: unsupported,
    terminalize: unsupported,
    read,
    purge: unsupported,
  } as ApplicationJobStore;
}

async function unsupported(): Promise<never> {
  throw new Error('unsupported');
}

function admission(): ApplicationJobStoredRun['admission'] {
  return {
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
}
