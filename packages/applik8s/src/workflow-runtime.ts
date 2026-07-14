import type { ApplicationWorkflowEngineProvider } from './application-providers.js';

export interface ApplicationWorkflowInvocationMetadata {
  readonly idempotencyKey?: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly priority?: 'low' | 'medium' | 'high';
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

export interface ApplicationWorkflowRun<
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly id: string;
  readonly __errors?: TErrors;
  result(options?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  cancel(options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>): Promise<void>;
}

export interface ApplicationWorkflowRuntime {
  run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  schedule<TInput extends object>(contract: string, input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
  signal<TPayload extends object>(contract: string, runId: string, signal: string, payload: TPayload, metadata?: ApplicationWorkflowInvocationMetadata): Promise<void>;
}

export type ApplicationWorkflowRuntimeFactory = (provider: ApplicationWorkflowEngineProvider) => Promise<ApplicationWorkflowRuntime>;

let workflowRuntimeFactory: ApplicationWorkflowRuntimeFactory = async (provider) => {
  if (provider.kind !== 'hatchet') throw new Error(`Unsupported WorkflowEngine provider ${String(Reflect.get(provider, 'kind'))}.`);
  // static-import-exception: keep the optional Hatchet SDK adapter outside applications that never invoke workflows.
  const runtime = await import('./workflow-runtime-hatchet.js');
  return runtime.createHatchetWorkflowRuntime(provider);
};

export function applicationWorkflowRuntime(provider: ApplicationWorkflowEngineProvider): Promise<ApplicationWorkflowRuntime> {
  return workflowRuntimeFactory(provider);
}

/** Testing/integration seam; production applications use the selected WorkflowEngine provider. */
export function setApplicationWorkflowRuntimeFactory(factory: ApplicationWorkflowRuntimeFactory): () => void {
  const previous = workflowRuntimeFactory;
  workflowRuntimeFactory = factory;
  return () => {
    workflowRuntimeFactory = previous;
  };
}
