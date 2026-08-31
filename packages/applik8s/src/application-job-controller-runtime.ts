// typecast-file-boundary: the controller accepts untrusted JSON only through a
// bounded HTTP boundary and narrows it before calling typed Job/store APIs.
import { timingSafeEqual } from 'node:crypto';
import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import type {
  ApplicationJobDefinition,
  ApplicationJobInvocationOptions,
  ApplicationJobReference,
  ApplicationJobRuntime,
} from './application-finite-jobs.js';
import { applicationJobRuntimeProtocol } from './application-finite-jobs.js';
import type { ApplicationJobStore } from './application-job-store.js';

const protocol = 'applik8s.jobControllerRequest/v1alpha1';

type ControllerJobDefinition = {
  readonly id: string;
  readonly contract: ApplicationJobDefinition<object, object, object, object>['contract'];
  readonly options: ApplicationJobDefinition<object, object, object, object>['options'];
  readonly handler: (...arguments_: never[]) => unknown;
};

export interface ApplicationJobControllerHandlerOptions {
  readonly runtime: ApplicationJobRuntime;
  readonly store: ApplicationJobStore;
  readonly definitions: readonly ControllerJobDefinition[];
  readonly authorization: string;
  readonly maximumRequestBytes?: number;
  /** Verifies the shared framework admission envelope before durable admission. */
  readonly decodeAdmission?: (
    envelope: string,
  ) => Promise<ApplicationAdmissionInvocationContextV1>;
}

/**
 * Provider-neutral, private HTTP boundary for a durable finite-Job runtime.
 * The immutable controller artifact owns definitions; callers send only a
 * typed Job identity, payload, invocation envelope, or durable reference.
 */
export function createApplicationJobControllerHandler(
  options: ApplicationJobControllerHandlerOptions,
): (request: Request) => Promise<Response> {
  const authorization = required(options.authorization, 'Job controller authorization');
  const maximumRequestBytes = positiveInteger(
    options.maximumRequestBytes ?? 1_048_576,
    'Job controller maximumRequestBytes',
  );
  const definitions = new Map(
    options.definitions.map((definition) => [definition.id, definition]),
  );
  if (definitions.size !== options.definitions.length) {
    throw new Error('Job controller definitions must have unique IDs.');
  }
  for (const definition of definitions.values()) {
    // typecast: controller definitions erase payload generics only after their
    // own schemas are retained; the runtime validates every input/output.
    options.runtime.register?.(definition as unknown as ApplicationJobDefinition<object, object, object, object>);
  }

  return async (request) => {
    if (request.method === 'GET') {
      const path = new URL(request.url).pathname;
      if (path === '/healthz' || path === '/readyz') {
        return json(200, { ok: true, jobs: definitions.size });
      }
      return json(404, { error: 'not_found' });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!authorized(request.headers.get('authorization'), authorization)) {
      return json(401, { error: 'unauthorized' });
    }
    try {
      const body = await boundedJsonObject(request, maximumRequestBytes);
      if (body.apiVersion !== protocol) return json(400, { error: 'invalid_protocol' });
      const action = string(body.action, 'Job controller action');
      if (action === 'start') {
        const job = string(body.job, 'Job ID');
        const definition = definitions.get(job);
        if (!definition) return json(404, { error: 'job_not_found' });
        const input = object(body.input, 'Job input');
        const invocation = await controllerInvocation(
          body.invocation,
          options.decodeAdmission,
        );
        const run = await options.runtime.start(
          definition as unknown as ApplicationJobDefinition<object, object, object, object>,
          input,
          invocation,
        );
        return json(200, { ok: true, result: run.reference });
      }

      const reference = jobReference(body.reference);
      const job = action === 'attach'
        ? string(body.job, 'Job ID')
        : reference.job;
      if (!definitions.has(job)) return json(404, { error: 'job_not_found' });
      if (job !== reference.job) return json(400, { error: 'reference_job_mismatch' });

      if (action === 'attach') {
        const run = await options.runtime.attach(job, reference);
        return json(200, { ok: true, result: run.reference });
      }
      if (action === 'outcome') {
        const stored = await exactStoredRun(options.store, reference);
        if (stored.phase !== 'terminal') {
          return json(200, { ok: true, result: { status: 'pending' } });
        }
        if (!stored.outcome) {
          return json(200, {
            ok: true,
            result: {
              status: 'expired',
              expiredAt: stored.resultExpiresAt ?? stored.terminalAt ?? reference.admittedAt,
            },
          });
        }
        return json(200, {
          ok: true,
          result: { status: 'terminal', outcome: stored.outcome },
        });
      }
      if (action === 'progress') {
        const stored = await exactStoredRun(options.store, reference);
        return json(200, { ok: true, result: stored.progress });
      }
      if (action === 'cancel') {
        const run = await options.runtime.attach(job, reference);
        const reason = body.reason === undefined
          ? undefined
          : string(body.reason, 'Job cancellation reason');
        return json(200, { ok: true, result: await run.cancel(reason) });
      }
      return json(400, { error: 'invalid_action' });
    } catch (cause) {
      const code = controllerErrorCode(cause);
      return json(code === 'request_too_large' ? 413 : 400, { error: code });
    }
  };
}

async function controllerInvocation(
  value: unknown,
  decodeAdmission: ApplicationJobControllerHandlerOptions['decodeAdmission'],
): Promise<Omit<ApplicationJobInvocationOptions, 'wait'> | undefined> {
  if (value === undefined) return undefined;
  const input = object(value, 'Job invocation');
  if ('admission' in input) {
    throw new JobControllerInputError('raw_admission_rejected');
  }
  const idempotencyKey = input.idempotencyKey === undefined
    ? undefined
    : string(input.idempotencyKey, 'Job idempotency key');
  if (input.admissionEnvelope === undefined) {
    return idempotencyKey ? { idempotencyKey } : undefined;
  }
  if (!decodeAdmission) throw new JobControllerInputError('admission_codec_missing');
  const admission = await decodeAdmission(
    string(input.admissionEnvelope, 'Job admission envelope'),
  );
  return {
    ...(idempotencyKey ? { idempotencyKey } : {}),
    admission,
  };
}

async function exactStoredRun(
  store: ApplicationJobStore,
  reference: ApplicationJobReference,
) {
  const stored = await store.read(reference.runId);
  if (
    !stored
    || stored.reference.protocol !== reference.protocol
    || stored.reference.job !== reference.job
    || stored.reference.admittedAt !== reference.admittedAt
  ) throw new JobControllerInputError('run_not_found');
  return stored;
}

async function boundedJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new JobControllerInputError('request_too_large');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new JobControllerInputError('request_too_large');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new JobControllerInputError('invalid_json');
  }
  return object(value, 'Job controller request');
}

function jobReference(value: unknown): ApplicationJobReference {
  const record = object(value, 'Job reference');
  const reference = {
    protocol: string(record.protocol, 'Job reference protocol'),
    job: string(record.job, 'Job reference job'),
    runId: string(record.runId, 'Job reference runId'),
    admittedAt: string(record.admittedAt, 'Job reference admittedAt'),
  };
  if (
    reference.protocol !== applicationJobRuntimeProtocol
    || !Number.isFinite(Date.parse(reference.admittedAt))
  ) throw new JobControllerInputError('invalid_reference');
  return { ...reference, protocol: applicationJobRuntimeProtocol };
}

function authorized(header: string | null, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice('Bearer '.length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function json(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JobControllerInputError(`${label.toLowerCase().replaceAll(' ', '_')}_invalid`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new JobControllerInputError(`${label.toLowerCase().replaceAll(' ', '_')}_invalid`);
  }
  return value.trim();
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

function controllerErrorCode(cause: unknown): string {
  return cause instanceof JobControllerInputError ? cause.code : 'request_failed';
}

class JobControllerInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'JobControllerInputError';
  }
}
