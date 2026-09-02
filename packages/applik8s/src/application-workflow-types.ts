import type {
  ApplicationBoundOperation,
  ApplicationBoundOperationInput,
  ApplicationBoundOperationOutput,
  ApplicationOperationLike,
  ApplicationQueryOperation,
  ApplicationScopedOperation,
} from '@applik8s/client';
import type {
  ApplicationAdmissionInvocationContextV1,
  ApplicationIdentityReference,
  ApplicationPrincipal,
  ApplicationTaskObjectOperation,
  JsonObject,
} from '@applik8s/core';
import type { ApplicationAIProviderToken } from '@applik8s/ai';
import type { ApplicationTanStackTaskCapability } from '@applik8s/ai-tanstack';
import type { ApplicationServiceIdentityBinding } from './application-authority.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import type { ApplicationObjectReference, ApplicationObjectStoreBinding, ApplicationTaskObjectStoreBinding } from './application-object-storage.js';
import type { ApplicationProviderState, ApplicationProviderToken } from './application-providers.js';
import type { ApplicationOnlineProjectionBinding } from './application-reactive.js';
import type { ApplicationProviderAccountingBinding } from './application-provider-accounting.js';
import type { WorkflowDefinition } from './dsl.js';
import type { ApplicationWorkflowTaskDefinition as TaskDefinition } from './application-workflow-internal.js';
import type { ApplicationOnlineProjectionRebuildResult } from './projection-rebuild-runtime.js';
import type { ApplicationStructuredGenerationProviderToken } from './structured-generation.js';
import type { ApplicationStructuredGenerationCapability } from './structured-generation-runtime.js';
import type { ApplicationWorkflowInvocationMetadata, ApplicationWorkflowResultOptions, ApplicationWorkflowRun, ApplicationWorkflowScheduleResult, ApplicationWorkflowScheduleSpec } from './workflow-runtime.js';

export interface ApplicationWorkflowState extends ApplicationGraphState, ApplicationProviderState {
  readonly workflowHandlers: Map<string, ApplicationWorkflowHandlerRegistration>;
  readonly workflowHandlerGroups: Map<string, string>;
}

export type ApplicationTaskOperationDependency =
  | ApplicationOperationLike
  | ApplicationScopedOperation<ApplicationOperationLike, unknown>
  | ApplicationBoundOperation<ApplicationOperationLike, string, 'input' | 'event' | 'resource'>;
export type ApplicationTaskOperations = Readonly<Record<string, ApplicationTaskOperationDependency>>;
export type ApplicationTaskQueries = Readonly<Record<string, ApplicationOperationLike>>;
export type ApplicationTaskProjections = Readonly<Record<string, ApplicationTaskProjectionTarget>>;
export type ApplicationTaskObjectStores = Readonly<
  Record<string, ApplicationTaskObjectStoreBinding>
>;
export type ApplicationTaskProviderAccounting = Readonly<
  Record<string, ApplicationProviderAccountingBinding<unknown>>
>;

export interface ApplicationTaskProjectionTarget {
  readonly projection: Pick<ApplicationOnlineProjectionBinding, 'kind' | 'storage' | 'name'>;
  readonly artifacts: ApplicationObjectStoreBinding;
  readonly bounds?: {
    readonly batchSize?: number;
    readonly maxSegments?: number;
    readonly maxSegmentBytes?: number;
    readonly maxEvents?: number;
    readonly maxCatchUpRounds?: number;
  };
}

export interface ApplicationTaskServicePrincipal {
  readonly id: string;
  /** Canonical identity established by the compiler-owned workload boundary. */
  readonly identity?: ApplicationIdentityReference;
  readonly kind?: ApplicationPrincipal['kind'];
  readonly authenticationMethod?: string;
  readonly roles?: readonly string[];
  readonly attributes?: JsonObject;
  readonly authorizationVersion: string;
  readonly trustedContext?: JsonObject;
}

export type ApplicationTaskOperationFunctions<TOperations extends ApplicationTaskOperations> = {
  readonly [TAlias in keyof TOperations]:
    (input: ApplicationBoundOperationInput<TOperations[TAlias]>, options?: {
      readonly idempotencyKey?: string;
      readonly expectedRevision?: string;
    }) => Promise<ApplicationBoundOperationOutput<TOperations[TAlias]>>;
};

export type ApplicationTaskQueryFunctions<TQueries extends ApplicationTaskQueries> = {
  readonly [TAlias in keyof TQueries]: TQueries[TAlias] extends ApplicationQueryOperation<infer TInput, infer TOutput>
    ? (input: TInput, options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }) => Promise<TOutput>
    : never;
};

export type ApplicationTaskProjectionFunctions<TProjections extends ApplicationTaskProjections> = {
  readonly [TAlias in keyof TProjections]-?: TProjections[TAlias] extends ApplicationTaskProjectionTarget
    ? {
        rebuild(input: { readonly generation: string; readonly artifactPrefix?: string }): Promise<ApplicationOnlineProjectionRebuildResult>;
        retire(input: { readonly generation: string; readonly references: readonly ApplicationObjectReference[] }): Promise<void>;
      }
    : never;
};

export type ApplicationTaskObjectFunctions<TObjects extends ApplicationTaskObjectStores> = {
	readonly [TAlias in keyof TObjects]-?: TObjects[TAlias] extends ApplicationTaskObjectStoreBinding<infer TOperations>
		? Pick<ApplicationObjectStoreBinding, TOperations[number]>
		: never;
};

export type ApplicationTaskProviderAccountingFunctions<
  TAccounting extends ApplicationTaskProviderAccounting,
> = {
  readonly [TAlias in keyof TAccounting]-?:
    TAccounting[TAlias] extends ApplicationProviderAccountingBinding<infer TCapability>
      ? TCapability
      : never;
};

export interface ApplicationTaskContext<
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>,
  TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>,
  TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>,
	TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>,
  TAccounting extends ApplicationTaskProviderAccounting = Readonly<Record<never, never>>,
> {
  /** Framework-admitted execution identity and immutable invocation provenance. */
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly trustedContext?: ApplicationWorkflowInvocationMetadata['trustedContext'];
  readonly signal: AbortSignal;
  /** Canonical durable model mutations explicitly injected into this task. */
  readonly operations: ApplicationTaskOperationFunctions<TOperations>;
  /** Authenticated bounded application views explicitly injected into this task. */
  readonly queries: ApplicationTaskQueryFunctions<TQueries>;
  /** Generation rebuild/retirement controls explicitly injected into this task. */
  readonly projections: ApplicationTaskProjectionFunctions<TProjections>;
	/** Bounded server-side object stores explicitly injected into this task. */
  readonly objects: ApplicationTaskObjectFunctions<TObjects>;
  /** Provider-call and immutable provider-cost journal scoped to this admitted task. */
  readonly providerAccounting: ApplicationTaskProviderAccountingFunctions<TAccounting>;
  use(token: ApplicationAIProviderToken): ApplicationTanStackTaskCapability;
  use(token: ApplicationStructuredGenerationProviderToken): ApplicationStructuredGenerationCapability;
  fail<TName extends keyof TErrors & string>(name: TName, payload: TErrors[TName]): never;
}

export interface ApplicationWorkflowContext<
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<string, object>>,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  /** Framework-admitted execution identity and immutable invocation provenance. */
  readonly admission: ApplicationAdmissionInvocationContextV1;
  task<TAlias extends keyof TTasks & string>(alias: TAlias, input: ApplicationTaskReferenceInput<TTasks[TAlias]>, options?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationTaskReferenceOutput<TTasks[TAlias]>>;
  child<TAlias extends keyof TWorkflows & string>(alias: TAlias, input: ApplicationWorkflowReferenceInput<TWorkflows[TAlias]>, options?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowReferenceOutput<TWorkflows[TAlias]>>;
  sleep(duration: string): Promise<void>;
  waitFor<TName extends keyof TSignals & string>(signal: TName, options?: { readonly expression?: string; readonly scope?: string; readonly lookback?: string }): Promise<TSignals[TName]>;
  now(): Promise<Date>;
  cancelled(): boolean;
  rethrowIfCancelled(error: unknown): void;
  readonly invocationId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly trustedContext?: ApplicationWorkflowInvocationMetadata['trustedContext'];
  fail<TName extends keyof TErrors & string>(name: TName, payload: TErrors[TName]): never;
}

export type ApplicationTaskHandler<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>,
  TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>,
  TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>,
	TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>,
  TAccounting extends ApplicationTaskProviderAccounting = Readonly<Record<never, never>>,
> = (input: TInput, context: ApplicationTaskContext<TErrors, TOperations, TQueries, TProjections, TObjects, TAccounting>) => TOutput | Promise<TOutput>;

export type ApplicationWorkflowHandler<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
> = (input: TInput, context: ApplicationWorkflowContext<TTasks, TWorkflows, TSignals, TErrors>) => TOutput | Promise<TOutput>;

export interface ApplicationTaskOptions<
  TInput extends object,
  TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>,
  TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>,
  TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>,
	TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>,
  TAccounting extends ApplicationTaskProviderAccounting = Readonly<Record<never, never>>,
> {
  readonly retries?: number;
  readonly retryBackoff?: { readonly factor?: number; readonly maxSeconds?: number };
  readonly executionTimeoutSeconds?: number;
  readonly scheduleTimeoutSeconds?: number;
  readonly idempotencyKey?: (input: TInput) => string;
  /** External capabilities made available through context.use(...) in this task only. */
  readonly requires?: readonly ApplicationProviderToken<unknown>[];
  /**
   * Explicit maximum authority for direct callable model operations. Ordinary
   * statically reachable query handles are inferred by the compiler.
   */
  readonly authority?: readonly ApplicationTaskOperationDependency[];
  /** Durable model operations made available as context.operations.<alias>(...). */
  readonly operations?: TOperations;
  /** Bounded application views made available as context.queries.<alias>(...). */
  readonly queries?: TQueries;
  /** Online projections this task may rebuild, with immutable evidence storage. */
  readonly projections?: TProjections;
	/** Bounded object stores made available as context.objects.<alias>. */
  readonly objects?: TObjects;
  /** Compiler-lowered provider-call accounting handles. Requires options.identity. */
  readonly providerAccounting?: TAccounting;
  /** Canonical logical identity for this task's declared operation/query dependencies. */
  readonly identity?: ApplicationServiceIdentityBinding;
  /**
   * Compiler-captured service identity used for declared operations. Required
   * whenever operations are present and unavailable to the task handler for
   * arbitrary impersonation.
   */
  readonly principal?: (input: TInput) => ApplicationTaskServicePrincipal;
  readonly worker?: ApplicationWorkflowWorkerOptions;
  /** Compiler-owned direct callable captures; never authored by applications. */
  readonly __generatedCalls?: readonly unknown[];
  /** Compiler-owned source identifiers for direct callable captures. */
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
  /** Compiler-owned object-store method authority inferred from direct calls. */
  readonly __generatedObjectOperations?: Readonly<
    Record<string, readonly ApplicationTaskObjectOperation[]>
  >;
}

export interface ApplicationWorkflowWorkerOptions {
  readonly group?: string;
  readonly replicas?: number;
  readonly taskSlots?: number;
  readonly durableSlots?: number;
  readonly gracefulShutdownSeconds?: number;
  readonly healthPort?: number;
  /** Defaults to allowAll because tasks are the declared external-effect boundary. */
  readonly egress?: 'allowAll' | 'sameNamespace';
  readonly scaling?: { readonly mode: 'fixed' } | { readonly mode: 'kedaHatchetSlots'; readonly minReplicas?: number; readonly maxReplicas: number; readonly pollingIntervalSeconds?: number };
}

export interface ApplicationWorkflowOptions<
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
> {
  readonly tasks?: TTasks;
  readonly workflows?: TWorkflows;
  readonly crons?: readonly { readonly name?: string; readonly expression: string; readonly input: object }[];
  readonly worker?: ApplicationWorkflowWorkerOptions;
  /** Compiler-owned direct callable captures; never authored by applications. */
  readonly __generatedCalls?: readonly unknown[];
  /** Compiler-owned source identifiers for direct callable captures. */
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
}

export type ApplicationTaskReference = { readonly kind: 'applik8sTask'; readonly id: string } | { readonly kind: 'applicationTask'; readonly definition: { readonly id: string } };
export type ApplicationWorkflowReference = { readonly kind: 'applik8sWorkflow'; readonly id: string } | { readonly kind: 'applicationWorkflow'; readonly definition: { readonly id: string } };

export type ApplicationTaskReferenceInput<TReference> = TReference extends TaskDefinition<infer TInput, infer _TOutput, infer _TErrors>
  ? TInput
  : TReference extends ApplicationTaskBinding<infer TInput, infer _TOutput, infer _TErrors>
    ? TInput
    : never;

export type ApplicationTaskReferenceOutput<TReference> = TReference extends TaskDefinition<infer _TInput, infer TOutput, infer _TErrors>
  ? TOutput
  : TReference extends ApplicationTaskBinding<infer _TInput, infer TOutput, infer _TErrors>
    ? TOutput
    : never;

export type ApplicationWorkflowReferenceInput<TReference> = TReference extends WorkflowDefinition<infer TInput, infer _TOutput, infer _TErrors, infer _TSignals>
  ? TInput
  : TReference extends ApplicationWorkflowBinding<infer TInput, infer _TOutput, infer _TErrors, infer _TSignals>
    ? TInput
    : never;

export type ApplicationWorkflowReferenceOutput<TReference> = TReference extends WorkflowDefinition<infer _TInput, infer TOutput, infer _TErrors, infer _TSignals>
  ? TOutput
  : TReference extends ApplicationWorkflowBinding<infer _TInput, infer TOutput, infer _TErrors, infer _TSignals>
    ? TOutput
    : never;

export interface ApplicationTaskBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>> {
  (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  readonly kind: 'applicationTask';
  readonly definition: TaskDefinition<TInput, TOutput, TErrors>;
  readonly __errors?: TErrors;
  run(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  attach(reference: import('./workflow-runtime.js').ApplicationWorkflowExecutionReference, admittedAt: string): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
  reconcile(schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowScheduleResult>;
}

export interface ApplicationWorkflowBinding<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  readonly kind: 'applicationWorkflow';
  readonly definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>;
  readonly __errors?: TErrors;
  readonly __signals?: TSignals;
  run(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  attach(reference: import('./workflow-runtime.js').ApplicationWorkflowExecutionReference, admittedAt: string): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
  reconcile(schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowScheduleResult>;
  signal<TName extends [keyof TSignals] extends [never] ? string : keyof TSignals & string>(
    runId: string,
    name: TName,
    payload: [keyof TSignals] extends [never] ? object : TSignals[TName & keyof TSignals],
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<void>;
}

export type ApplicationWorkflowHandlerRegistration =
  | { readonly kind: 'task'; readonly id: string; readonly source: string }
  | { readonly kind: 'workflow'; readonly id: string; readonly source: string; readonly tasks: Readonly<Record<string, string>>; readonly workflows: Readonly<Record<string, string>> }
  | { readonly kind: 'saga'; readonly id: string; readonly source: string };
