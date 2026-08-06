// typecast-file-boundary: compiler-generated workflow identities are restored
// into the typed callable facade while runtime input validation remains at the
// private workflow gateway.
import type {
  ApplicationWorkflowInvocationMetadata,
  ApplicationWorkflowProviderRun,
  ApplicationWorkflowResultOptions,
  ApplicationWorkflowRun,
  ApplicationWorkflowScheduleSpec,
} from './workflow-runtime.js';
import { applicationWorkflowRuntime } from './workflow-runtime.js';

interface GeneratedWorkflowGatewayBinding<
  TInput extends object = object,
  TOutput extends object = object,
> {
  (
    input: TInput,
    metadata?: ApplicationWorkflowInvocationMetadata,
    result?: ApplicationWorkflowResultOptions,
  ): Promise<TOutput>;
  readonly kind: 'applicationWorkflow';
  readonly definition: {
    readonly id: string;
    readonly version: string;
  };
  run(
    input: TInput,
    metadata?: ApplicationWorkflowInvocationMetadata,
    result?: ApplicationWorkflowResultOptions,
  ): Promise<TOutput>;
  start(
    input: TInput,
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<ApplicationWorkflowRun<TOutput>>;
  schedule(
    input: TInput,
    at: Date,
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<{ readonly id: string }>;
  reconcile(
    schedule: ApplicationWorkflowScheduleSpec<TInput>,
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<import('./workflow-runtime.js').ApplicationWorkflowScheduleResult>;
  signal(
    runId: string,
    name: string,
    payload: object,
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<void>;
}

/**
 * Rehydrates a compiler-proven workflow handle inside a Kubernetes resource
 * handler. The SDK installs the authorized gateway runtime for the invocation;
 * the ordinary callable facade remains identical to application code.
 */
export function createApplicationWorkflowGatewayBinding<
  TInput extends object = object,
  TOutput extends object = object,
>(
  id: string,
  version: string,
): GeneratedWorkflowGatewayBinding<TInput, TOutput> {
  const definition = Object.freeze({ id, version });
  const runtime = () =>
    applicationWorkflowRuntime({
      kind: 'hatchet',
      tls: true,
    });
  const run = (
    input: TInput,
    metadata?: ApplicationWorkflowInvocationMetadata,
    result?: ApplicationWorkflowResultOptions,
  ) => runtime().then((selected) => selected.run<TInput, TOutput>(
    id,
    input,
    metadata,
    result,
  ));
  return Object.assign(run, {
    kind: 'applicationWorkflow' as const,
    definition,
    run,
    async start(
      input: TInput,
      metadata?: ApplicationWorkflowInvocationMetadata,
    ): Promise<ApplicationWorkflowRun<TOutput>> {
      const providerRun = await (await runtime()).start<TInput, TOutput>(
        id,
        input,
        metadata,
      );
      return workflowRun(providerRun, id, version);
    },
    async schedule(
      input: TInput,
      at: Date,
      metadata?: ApplicationWorkflowInvocationMetadata,
    ) {
      return (await runtime()).schedule(id, input, at, metadata);
    },
    async reconcile(
      schedule: ApplicationWorkflowScheduleSpec<TInput>,
      metadata?: ApplicationWorkflowInvocationMetadata,
    ) {
      return (await runtime()).reconcileSchedule(id, schedule, metadata);
    },
    async signal(
      runId: string,
      name: string,
      payload: object,
      metadata?: ApplicationWorkflowInvocationMetadata,
    ) {
      await (await runtime()).signal(id, runId, name, payload, metadata);
    },
  });
}

function workflowRun<TOutput extends object>(
  providerRun: ApplicationWorkflowProviderRun<TOutput>,
  workflow: string,
  workflowRevision: string,
): ApplicationWorkflowRun<TOutput> {
  const reference = Object.freeze({
    provider: 'workflow' as const,
    workflow,
    run: providerRun.id,
  });
  return Object.freeze({
    id: providerRun.id,
    reference,
    workflowRevision,
    result: (options?: ApplicationWorkflowResultOptions) =>
      providerRun.result(options),
    cancel: (
      options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
    ) => providerRun.cancel(options),
    ...(providerRun.__cancelReference
      ? {
          __cancelReference: (
            runId: string,
            options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
          ) => providerRun.__cancelReference?.(runId, options) as Promise<void>,
        }
      : {}),
    async observe(options?: ApplicationWorkflowResultOptions) {
      if (!providerRun.observe) {
        throw new Error(
          `Workflow provider cannot observe ${workflow} run ${providerRun.id}.`,
        );
      }
      return Object.freeze({
        ...(await providerRun.observe(options)),
        reference,
        workflowRevision,
      });
    },
  });
}
