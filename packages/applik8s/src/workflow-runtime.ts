// typecast-file-boundary: provider-neutral workflow runs preserve output/error generics across runtime registration and validated reference hydration.
import type {
  ApplicationCausalPrincipalContext,
  ApplicationPrincipal,
} from '@applik8s/core';
import { applicationCausalPrincipalContext } from '@applik8s/core';
import type { ApplicationWorkflowEngineProvider } from './application-providers.js';

/**
 * Framework-only causal metadata attached to provider-neutral workflow
 * invocations. A symbol keeps it out of the application-facing metadata
 * vocabulary while adapters can serialize it into their durable history.
 */
export const applicationWorkflowCausalPrincipalMetadata = Symbol.for(
  '@applik8s/workflow-causal-principal',
);

export interface ApplicationWorkflowInvocationMetadata {
  readonly idempotencyKey?: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly priority?: 'low' | 'medium' | 'high';
  /** Trusted provider-admitted values propagated as durable invocation metadata. */
  readonly trustedContext?: {
    readonly values: Readonly<Record<string, import('@applik8s/core').JsonValue>>;
    readonly digest: string;
    readonly changeScopes?: Readonly<Record<string, string>>;
  };
  /** @internal Framework-owned causal attribution; application input cannot set it. */
  readonly [applicationWorkflowCausalPrincipalMetadata]?:
    ApplicationCausalPrincipalContext;
}

/** @internal Attaches admitted causal attribution without exposing a public option. */
export function withApplicationWorkflowCausalPrincipal(
  metadata: ApplicationWorkflowInvocationMetadata | undefined,
  principal: ApplicationPrincipal,
): ApplicationWorkflowInvocationMetadata {
  return Object.freeze({
    ...(metadata ?? {}),
    [applicationWorkflowCausalPrincipalMetadata]:
      applicationCausalPrincipalContext(principal),
  });
}

export interface ApplicationDurableErrorDescriptor<TName extends string = string, TPayload extends object = object> {
  readonly name: TName;
  readonly payload: TPayload;
}

export type ApplicationDurableErrorUnion<TErrors extends Readonly<Record<string, object>>> = {
  readonly [TName in keyof TErrors & string]: ApplicationDurableErrorDescriptor<TName, TErrors[TName]>;
}[keyof TErrors & string];

export class ApplicationDurableError<TName extends string = string, TPayload extends object = object> extends Error {
  readonly durable: ApplicationDurableErrorDescriptor<TName, TPayload>;

  constructor(name: TName, payload: TPayload, message = `Durable application error ${name}`) {
    super(message);
    this.name = 'ApplicationDurableError';
    this.durable = { name, payload };
  }
}

export function isApplicationDurableError(value: unknown): value is ApplicationDurableError {
  return value instanceof ApplicationDurableError;
}

export interface ApplicationWorkflowResultOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export type ApplicationWorkflowObservationFailure = 'aborted' | 'timeout' | 'providerUnavailable' | 'cancelled' | 'failed';

export class ApplicationWorkflowObservationError extends Error {
  constructor(
    readonly failure: ApplicationWorkflowObservationFailure,
    readonly runId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationWorkflowObservationError';
  }
}

export type ApplicationWorkflowPhase =
  | 'Admitted'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'TimedOut';

export interface ApplicationWorkflowExecutionReference {
  readonly provider: 'workflow';
  readonly workflow: string;
  readonly run: string;
}

export interface ApplicationWorkflowExecutionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ApplicationWorkflowExecutionObservation<
  TResult extends object,
  TProgress = unknown,
> {
  readonly reference: ApplicationWorkflowExecutionReference;
  readonly workflowRevision: string;
  readonly phase: ApplicationWorkflowPhase;
  readonly progress?: TProgress;
  readonly result?: TResult;
  readonly error?: ApplicationWorkflowExecutionFailure;
  readonly admittedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface ApplicationWorkflowProviderObservation<
  TResult extends object,
  TProgress = unknown,
> {
  readonly phase: ApplicationWorkflowPhase;
  readonly progress?: TProgress;
  readonly result?: TResult;
  readonly error?: ApplicationWorkflowExecutionFailure;
  readonly admittedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface ApplicationWorkflowProviderRun<
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly id: string;
  readonly __errors?: TErrors;
  /** @internal Enables resource tracking to adopt an admitted run after restart. */
  readonly __idempotencyKey?: string;
  result(options?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  observe?(
    options?: ApplicationWorkflowResultOptions,
  ): Promise<ApplicationWorkflowProviderObservation<TOutput>>;
  cancel(options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>): Promise<void>;
  /** Internal tracking bridge for superseding a previously persisted run. */
  __cancelReference?(
    runId: string,
    options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
  ): Promise<void>;
}

export interface ApplicationWorkflowRun<
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> extends ApplicationWorkflowProviderRun<TOutput, TErrors> {
  readonly reference: ApplicationWorkflowExecutionReference;
  readonly workflowRevision: string;
  observe(
    options?: ApplicationWorkflowResultOptions,
  ): Promise<ApplicationWorkflowExecutionObservation<TOutput>>;
  /** @internal Used by job.track(..., { onGenerationChange: "cancel" }). */
  readonly __cancelReference?: (
    runId: string,
    options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
  ) => Promise<void>;
}

export interface ApplicationWorkflowScheduleSpec<TInput extends object> {
  /** Stable application-owned identity; provider IDs remain implementation details. */
  readonly id: string;
  readonly expression: string;
  readonly revision: string;
  readonly enabled: boolean;
  readonly input: TInput;
}

export interface ApplicationWorkflowScheduleResult {
  readonly id: string;
  readonly revision: string;
  readonly state: 'created' | 'unchanged' | 'removed';
  readonly providerId?: string;
}

export interface ApplicationWorkflowRuntime {
  run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowProviderRun<TOutput, TErrors>>;
  schedule<TInput extends object>(contract: string, input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
  /** Converges one application-owned recurring schedule without exposing provider APIs to domain code. */
  reconcileSchedule<TInput extends object>(contract: string, schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowScheduleResult>;
  signal<TPayload extends object>(contract: string, runId: string, signal: string, payload: TPayload, metadata?: ApplicationWorkflowInvocationMetadata): Promise<void>;
}

export type ApplicationWorkflowRuntimeFactory = (provider: ApplicationWorkflowEngineProvider) => Promise<ApplicationWorkflowRuntime>;

let workflowRuntimeFactory: ApplicationWorkflowRuntimeFactory = async (provider) => {
  if (provider.kind !== 'hatchet') throw new Error(`Unsupported WorkflowEngine provider ${String(Reflect.get(provider, 'kind'))}.`);
  // Composition evaluation bundles the application graph, and a literal
  // dynamic import makes esbuild eagerly include the optional Hatchet adapter
  // and SDK even for applications with no workflows.
  // static-import-exception: computed provider import preserves that runtime-only boundary.
  const importProvider = (specifier: string) => import(specifier);
  const runtime = await importProvider('@applik8s/runtime-hatchet') as typeof import('@applik8s/runtime-hatchet');
  return runtime.createHatchetWorkflowRuntime(provider);
};
const workflowRuntimeResolvers: Array<() => ApplicationWorkflowRuntime | undefined> = [];

export function applicationWorkflowRuntime(provider: ApplicationWorkflowEngineProvider): Promise<ApplicationWorkflowRuntime> {
  for (let index = workflowRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = workflowRuntimeResolvers[index]?.();
    if (runtime) return Promise.resolve(runtime);
  }
  const injected = Reflect.get(
    globalThis,
    Symbol.for('applik8s.workflowRuntimeResolver'),
  );
  if (typeof injected === 'function') {
    const runtime = injected();
    if (runtime) return Promise.resolve(runtime as ApplicationWorkflowRuntime);
  }
  return workflowRuntimeFactory(provider);
}

/** Installs an execution-scoped workflow runtime resolver for generated durable workers. */
export function installApplicationWorkflowRuntimeResolver(
  resolver: () => ApplicationWorkflowRuntime | undefined,
): () => void {
  workflowRuntimeResolvers.push(resolver);
  return () => {
    const index = workflowRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) workflowRuntimeResolvers.splice(index, 1);
  };
}

/** Testing/integration seam; production applications use the selected WorkflowEngine provider. */
export function setApplicationWorkflowRuntimeFactory(factory: ApplicationWorkflowRuntimeFactory): () => void {
  const previous = workflowRuntimeFactory;
  workflowRuntimeFactory = factory;
  return () => {
    workflowRuntimeFactory = previous;
  };
}
