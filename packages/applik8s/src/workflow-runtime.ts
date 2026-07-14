import type { ApplicationWorkflowEngineProvider } from './application-providers.js';

export interface ApplicationWorkflowInvocationMetadata {
  readonly idempotencyKey?: string;
  readonly tenant?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly priority?: 'low' | 'medium' | 'high';
}

export interface ApplicationWorkflowRun<TOutput extends object> {
  readonly id: string;
  result(): Promise<TOutput>;
  cancel(): Promise<void>;
}

export interface ApplicationWorkflowRuntime {
  run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<TOutput>;
  start<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput>>;
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
