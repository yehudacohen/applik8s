export type ApplicationSnapshotResumeCapability = 'atomicSnapshotResume' | 'resumableInvalidation' | 'resetOnly' | 'unsupported';

export interface ApplicationQuerySnapshot<TValue = unknown> {
  readonly kind: 'snapshot';
  readonly protocol: 'applik8s.query/v1alpha1';
  readonly query: string;
  readonly inputKey: string;
  readonly value: TValue;
  readonly cursor: string;
  readonly capability: ApplicationSnapshotResumeCapability;
  readonly generatedAt: string;
}

export type ApplicationQueryEvent = ApplicationQueryInvalidateEvent | ApplicationQueryResetEvent | ApplicationQueryKeepAliveEvent;

export interface ApplicationQueryInvalidateEvent {
  readonly kind: 'invalidate';
  readonly protocol: 'applik8s.query/v1alpha1';
  readonly id: string;
  /** Monotonic sequence of the authoritative provider change cursor. */
  readonly sequence: number;
  readonly query: string;
  readonly cursor: string;
  readonly models: readonly string[];
}

export interface ApplicationQueryResetEvent {
  readonly kind: 'reset';
  readonly protocol: 'applik8s.query/v1alpha1';
  readonly id: string;
  readonly query: string;
  readonly reason: 'cursorExpired' | 'cursorInvalid' | 'contextChanged' | 'authorizationChanged' | 'queryVersionChanged' | 'retentionGap' | 'providerReset';
}

export interface ApplicationQueryKeepAliveEvent {
  readonly kind: 'keepalive';
  readonly protocol: 'applik8s.query/v1alpha1';
  readonly id: string;
  /** Latest monotonic sequence observed by the authoritative provider. */
  readonly sequence: number;
  readonly query: string;
  readonly cursor: string;
}

export interface ApplicationQueryTransport {
  snapshot<TInput, TValue>(query: string, input: TInput, options?: { readonly signal?: AbortSignal }): Promise<ApplicationQuerySnapshot<TValue>>;
  subscribe<TInput>(query: string, input: TInput, cursor: string, options: { readonly signal: AbortSignal; readonly onEvent: (event: ApplicationQueryEvent) => void; readonly onError: (error: Error) => void }): void | Promise<void>;
}

export interface ApplicationCommandProgress {
  readonly protocol: 'applik8s.command/v1alpha1';
  readonly command: string;
  readonly commandId: string;
  readonly correlationId: string;
  readonly transport: 'idle' | 'submitting' | 'acknowledged' | 'failed';
  readonly durableResult: 'unknown' | 'pending' | 'succeeded' | 'rejected';
  readonly progressCursor?: string;
  readonly output?: unknown;
  readonly rejection?: { readonly name: string; readonly payload: unknown };
  readonly modelRevision?: string;
  readonly workflow?: 'notStarted' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
  readonly reconciliation?: 'notObserved' | 'progressing' | 'ready' | 'failed';
}

export interface ApplicationCommandSubmission extends ApplicationCommandProgress {
  readonly transport: 'acknowledged';
  readonly durableResult: 'unknown' | 'pending';
  readonly progressCursor: string;
}

export interface ApplicationCommandTransport {
  submit<TInput>(command: string, input: TInput, options: { readonly commandId: string; readonly idempotencyKey: string; readonly expectedRevision?: string; readonly signal?: AbortSignal }): Promise<ApplicationCommandSubmission>;
  progress(command: string, cursor: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationCommandProgress>;
}
