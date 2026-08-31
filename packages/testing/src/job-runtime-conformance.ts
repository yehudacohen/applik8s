import {
  type ApplicationJobRuntime,
  type ApplicationJobRuntimeResolver,
  ApplicationJobIdempotencyConflictError,
  ApplicationJobInvocationTimeoutError,
  ApplicationJobRunError,
  createApplicationJobBinding,
} from '@applik8s/applik8s';
import {
  type ApplicationAdmissionInvocationContextV1,
  createApplicationExecutionPrincipalV1,
} from '@applik8s/core';
import { type as schema } from 'arktype';

const Input = schema({ value: 'number.integer' });
const Output = schema({ doubled: 'number.integer' });
const Progress = schema({ completed: 'number.integer >= 0' });
const Failure = schema({ code: "'invalid'" });

export interface ApplicationJobRuntimeConformanceAdapter {
  readonly name: string;
  createRuntime(options: { readonly maximumConcurrency: number }): ApplicationJobRuntime | Promise<ApplicationJobRuntime>;
}

export interface ApplicationJobRuntimeConformanceCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly message: string;
}

export interface ApplicationJobRuntimeConformanceReport {
  readonly protocol: 'applik8s.jobRuntimeConformance/v1alpha1';
  readonly provider: string;
  readonly ok: boolean;
  readonly checks: readonly ApplicationJobRuntimeConformanceCheck[];
}

/**
 * Runs the provider-neutral finite-Job behavioral contract without inspecting
 * provider state. Provider packages must run this exact suite before adding
 * their interruption, lifecycle, and deployment-specific evidence.
 */
export async function inspectApplicationJobRuntimeConformance(
  adapter: ApplicationJobRuntimeConformanceAdapter,
): Promise<ApplicationJobRuntimeConformanceReport> {
  const checks: ApplicationJobRuntimeConformanceCheck[] = [];
  const check = async (id: string, execute: () => Promise<void>): Promise<void> => {
    const started = performance.now();
    try {
      await execute();
      checks.push({ id, passed: true, durationMs: performance.now() - started, message: `${id} passed.` });
    } catch (cause) {
      checks.push({
        id,
        passed: false,
        durationMs: performance.now() - started,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  await check('direct-and-start-result-parity', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    const job = createApplicationJobBinding({
      id: 'conformance.parity.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: (input) => ({ doubled: input.value * 2 }),
    }, runtime);
    equal(await job({ value: 4 }), { doubled: 8 }, 'Direct invocation result');
    const run = await job.start({ value: 5 });
    equal(await run.result(), { doubled: 10 }, 'Started invocation result');
    const attached = await job.attach(run.reference);
    equal(await attached.result(), { doubled: 10 }, 'Attached invocation result');
  });

  await check('scoped-idempotency-and-conflict', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    let executions = 0;
    const job = createApplicationJobBinding({
      id: 'conformance.idempotency.v1',
      contract: { input: Input, output: Output },
      options: { idempotencyKey: () => 'stable-key' },
      handler: (input) => {
        executions += 1;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const first = await job.start({ value: 2 });
    const duplicate = await job.start({ value: 2 });
    equal(duplicate.reference, first.reference, 'Duplicate run reference');
    equal(await duplicate.result(), { doubled: 4 }, 'Duplicate result');
    exact(executions, 1, 'Idempotent execution count');
    await rejects(
      () => job.start({ value: 3 }),
      (cause) => cause instanceof ApplicationJobIdempotencyConflictError,
      'Conflicting idempotent input',
    );
  });

  await check('whole-attempt-retry-and-typed-failure', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    let attempts = 0;
    const retrying = createApplicationJobBinding({
      id: 'conformance.retry.v1',
      contract: { input: Input, output: Output },
      options: { retries: 2 },
      handler: (input) => {
        attempts += 1;
        if (attempts < 3) throw new Error('retryable conformance failure');
        return { doubled: input.value * 2 };
      },
    }, runtime);
    equal(await retrying({ value: 3 }), { doubled: 6 }, 'Retried result');
    exact(attempts, 3, 'Whole-attempt count');

    const failing = createApplicationJobBinding({
      id: 'conformance.typed-failure.v1',
      contract: { input: Input, output: Output, error: Failure },
      options: { retries: 3 },
      handler: (_input, execution) => execution.fail({ code: 'invalid' }),
    }, runtime);
    const run = await failing.start({ value: 1 });
    equal(await run.outcome(), {
      status: 'failed',
      failure: { kind: 'application', error: { code: 'invalid' } },
    }, 'Typed application failure');
    await rejects(
      () => run.result(),
      (cause) => cause instanceof ApplicationJobRunError,
      'Typed failure result',
    );
  });

  await check('queued-cancellation-and-terminal-race', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let queuedExecutions = 0;
    const blocker = createApplicationJobBinding({
      id: 'conformance.blocker.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const queued = createApplicationJobBinding({
      id: 'conformance.cancel.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: (input) => {
        queuedExecutions += 1;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const active = await blocker.start({ value: 1 });
    const pending = await queued.start({ value: 2 });
    const cancellation = await pending.cancel('superseded');
    exact(cancellation.status, 'requested', 'Queued cancellation status');
    equal(await pending.outcome(), { status: 'cancelled', reason: 'superseded' }, 'Queued cancellation outcome');
    exact(queuedExecutions, 0, 'Cancelled queued execution count');
    release();
    await active.result();
    const late = await active.cancel('late');
    exact(late.status, 'alreadyTerminal', 'Late cancellation status');
    if (late.status !== 'alreadyTerminal') {
      throw new Error('Late cancellation did not retain the terminal Job outcome.');
    }
    exact(late.outcome.status, 'succeeded', 'Late cancellation outcome');
  });

  await check('caller-timeout-rejoin', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const job = createApplicationJobBinding({
      id: 'conformance.wait.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    let timedOut: ApplicationJobInvocationTimeoutError | undefined;
    try {
      await job({ value: 6 }, { wait: { timeout: '1s' } });
    } catch (cause) {
      if (cause instanceof ApplicationJobInvocationTimeoutError) timedOut = cause;
      else throw cause;
    }
    if (!timedOut) throw new Error('Caller wait did not return a timeout with a rejoinable run reference.');
    release();
    equal(await job.attach(timedOut.run).then((run) => run.result()), { doubled: 12 }, 'Rejoined result');
  });

  await check('deadline-first-terminal-transition', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const job = createApplicationJobBinding({
      id: 'conformance.deadline.v1',
      contract: { input: Input, output: Output },
      options: { timeout: '1s' },
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const run = await job.start({ value: 7 });
    exact((await run.outcome()).status, 'timedOut', 'Deadline outcome');
    release();
    await Promise.resolve();
    exact((await run.outcome()).status, 'timedOut', 'Late completion terminal outcome');
  });

  await check('progress-and-causal-admission', async () => {
    const runtime = await adapter.createRuntime({ maximumConcurrency: 1 });
    const admission = conformanceAdmission();
    let observed: ApplicationAdmissionInvocationContextV1 | undefined;
    const job = createApplicationJobBinding({
      id: 'conformance.context.v1',
      contract: { input: Input, output: Output, progress: Progress },
      options: {},
      handler: async (input, execution) => {
        observed = execution.admission;
        await execution.progress({ completed: input.value });
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const run = await job.start({ value: 9 }, { admission });
    equal(await run.result(), { doubled: 18 }, 'Context result');
    equal(observed, admission, 'Framework admission context');
    if (observed?.principal.kind !== 'execution') {
      throw new Error('Job execution did not retain its framework execution principal.');
    }
    exact(observed.principal.executionKind, 'job', 'Managed execution kind');
    exact(observed.principal.causalPrincipalId, 'principal:human-reviewer', 'Causal principal ID');
    equal((await run.progress())?.value, { completed: 9 }, 'Latest progress payload');
    exact((await run.progress())?.sequence, 1, 'Latest progress sequence');
  });

  const report: ApplicationJobRuntimeConformanceReport = Object.freeze({
    protocol: 'applik8s.jobRuntimeConformance/v1alpha1',
    provider: adapter.name,
    ok: checks.every(({ passed }) => passed),
    checks: Object.freeze(checks.map((item) => Object.freeze(item))),
  });
  return report;
}

/** Bridges a conformance-selected runtime into an application resolver safely. */
export function applicationJobRuntimeConformanceResolver(
  providerNodeId: string,
  runtime: ApplicationJobRuntime,
): ApplicationJobRuntimeResolver {
  return (candidate) => candidate === providerNodeId ? runtime : undefined;
}

function conformanceAdmission(): ApplicationAdmissionInvocationContextV1 {
  const operationId = 'applik8s://jobs/conformance.context.v1/operations/run';
  const deadline = '2027-01-02T00:00:00.000Z';
  return {
    apiVersion: 'applik8s.admission/v1',
    principal: createApplicationExecutionPrincipalV1({
      application: 'job-runtime-conformance',
      executionKind: 'job',
      executionId: 'run-1',
      attempt: 1,
      workloadIdentity: {
        id: 'identity:conformance-worker',
        kind: 'workload',
        issuer: 'applik8s://testing',
        subject: 'job-worker',
      },
      causalPrincipal: {
        id: 'principal:human-reviewer',
        identity: {
          id: 'identity:human-reviewer',
          kind: 'human',
          issuer: 'https://identity.example.test',
          subject: 'reviewer-1',
        },
        grantIds: ['grant:job-conformance'],
      },
      envelopes: [],
      trustedContextDigest: 'trusted-context-digest',
      audience: [operationId],
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      deadline,
      cancellationRevision: 'cancellation-v1',
      admittedAt: '2027-01-01T00:00:00.000Z',
    }),
    authorityRevision: 'authority-v1',
    trustedContext: { values: { tenantId: 'tenant-1' }, digest: 'trusted-context-digest' },
    operation: { id: operationId, transport: 'framework' },
    correlationId: 'correlation-1',
    causationId: 'causation-1',
    deadline,
  };
}

function exact(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`);
  }
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label} expected ${right} but received ${left}.`);
}

async function rejects(
  invoke: () => Promise<unknown>,
  matches: (cause: unknown) => boolean,
  label: string,
): Promise<void> {
  try {
    await invoke();
  } catch (cause) {
    if (matches(cause)) return;
    throw new Error(`${label} rejected with an unexpected error: ${cause instanceof Error ? cause.message : String(cause)}.`);
  }
  throw new Error(`${label} did not reject.`);
}
