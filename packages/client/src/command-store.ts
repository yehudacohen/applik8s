import type { ApplicationCommandProgress, ApplicationCommandTransport } from './protocol.js';

export interface ApplicationCommandState<TOutput = unknown> extends Omit<ApplicationCommandProgress, 'output'> {
  readonly output?: TOutput;
  readonly phase: 'submitting' | 'pending' | 'succeeded' | 'rejected' | 'failed' | 'unknown' | 'error';
  readonly error?: Error;
  readonly revision: number;
}

export interface ApplicationCommandHandle<TOutput = unknown> {
  readonly commandId: string;
  getSnapshot(): ApplicationCommandState<TOutput>;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  dispose(): void;
}

export class ApplicationCommandRejectedError extends Error {
  readonly code = 'APPLIK8S_COMMAND_REJECTED';
  constructor(
    readonly command: string,
    readonly commandId: string,
    readonly rejection: { readonly name: string; readonly payload: unknown },
  ) {
    super(`Application command ${command} was rejected with ${rejection.name}.`);
    this.name = 'ApplicationCommandRejectedError';
  }
}

export class ApplicationCommandFailedError extends Error {
  readonly code = 'APPLIK8S_COMMAND_FAILED';
  constructor(
    readonly command: string,
    readonly commandId: string,
    readonly failure: { readonly code: 'processing_failed' | 'authorization_denied'; readonly attempts?: number },
  ) {
    super(failure.code === 'authorization_denied'
      ? `Application command ${command} was denied when its durable authorization was revalidated.`
      : `Application command ${command} failed after exhausting bounded processing attempts.`);
    this.name = 'ApplicationCommandFailedError';
  }
}

export interface ApplicationCommandClientOptions {
  readonly poll?: { readonly initialMs?: number; readonly maxMs?: number; readonly factor?: number };
  readonly id?: () => string;
}

export interface ApplicationClientRandomSource {
  randomUUID?(): string;
  getRandomValues<T extends ArrayBufferView>(value: T): T;
}

/**
 * Creates a browser-safe UUID without requiring a secure HTTP origin.
 *
 * `crypto.randomUUID()` is secure-context-only in browsers, while
 * `crypto.getRandomValues()` remains available on local cluster HTTP origins.
 * Command identity is therefore generated from the latter when necessary
 * without weakening entropy or burdening application code with environment
 * checks.
 */
export function createApplicationClientId(
  source: ApplicationClientRandomSource = globalThis.crypto,
): string {
  try {
    const value = source.randomUUID?.();
    if (value) return value;
  } catch {
    // A browser may expose randomUUID while rejecting it on an insecure origin.
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

interface CommandEntry<TOutput = unknown> {
  readonly command: string;
  readonly commandId: string;
  readonly listeners: Set<() => void>;
  state: ApplicationCommandState<TOutput>;
  timer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController | undefined;
  attempt: number;
}

/** Browser-safe command submission and durable-result observation without conflating later workflow/reconciliation state. */
export class ApplicationCommandClient {
  readonly #entries = new Map<string, CommandEntry>();
  readonly #poll: { readonly initialMs: number; readonly maxMs: number; readonly factor: number };
  readonly #id: () => string;

  constructor(readonly transport: ApplicationCommandTransport, options: ApplicationCommandClientOptions = {}) {
    this.#poll = { initialMs: options.poll?.initialMs ?? 250, maxMs: options.poll?.maxMs ?? 5_000, factor: options.poll?.factor ?? 1.75 };
    this.#id = options.id ?? createApplicationClientId;
    if (this.#poll.initialMs < 10 || this.#poll.maxMs < this.#poll.initialMs || this.#poll.factor < 1) throw new Error('ApplicationCommandClient polling bounds are invalid.');
  }

  async submit<TInput, TOutput = unknown>(command: string, input: TInput, options: { readonly commandId?: string; readonly idempotencyKey?: string; readonly expectedRevision?: string; readonly signal?: AbortSignal } = {}): Promise<ApplicationCommandHandle<TOutput>> {
    const commandId = options.commandId ?? this.#id();
    if (this.#entries.has(commandId)) throw new Error(`Application command ${commandId} is already tracked by this client.`);
    const entry: CommandEntry<TOutput> = { command, commandId, listeners: new Set(), state: pendingState<TOutput>(command, commandId), timer: undefined, controller: undefined, attempt: 0 };
    this.#entries.set(commandId, entry);
    const handle = this.#handle(entry);
    try {
      const submission = await this.transport.submit(command, input, { commandId, idempotencyKey: options.idempotencyKey ?? commandId, ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {}), ...(options.signal ? { signal: options.signal } : {}) });
      this.#apply(entry, submission);
      if (requiresProgressPolling(entry.state)) this.#schedule(entry);
    } catch (error) {
      entry.state = { ...entry.state, phase: 'unknown', transport: 'failed', durableResult: 'unknown', error: error instanceof Error ? error : new Error(String(error)), revision: entry.state.revision + 1 };
      this.#notify(entry);
    }
    return handle;
  }

  async execute<TInput, TOutput = unknown>(
    command: string,
    input: TInput,
    options: { readonly commandId?: string; readonly idempotencyKey?: string; readonly expectedRevision?: string; readonly signal?: AbortSignal } = {},
  ): Promise<TOutput> {
    const handle = await this.submit<TInput, TOutput>(command, input, options);
    try {
      return await waitForApplicationCommand(handle, options.signal);
    } finally {
      handle.dispose();
    }
  }

  #handle<TOutput>(entry: CommandEntry<TOutput>): ApplicationCommandHandle<TOutput> {
    return { commandId: entry.commandId, getSnapshot: () => entry.state, subscribe: (listener) => { entry.listeners.add(listener); return () => entry.listeners.delete(listener); }, refresh: () => this.#refresh(entry), dispose: () => this.#dispose(entry) };
  }

  async #refresh(entry: CommandEntry): Promise<void> {
    const cursor = entry.state.progressCursor;
    if (!cursor || entry.controller) return;
    const controller = new AbortController();
    entry.controller = controller;
    try {
      this.#apply(entry, await this.transport.progress(entry.command, cursor, { signal: controller.signal }));
    } catch (error) {
      if (!controller.signal.aborted) {
        entry.state = { ...entry.state, phase: 'unknown', durableResult: 'unknown', error: error instanceof Error ? error : new Error(String(error)), revision: entry.state.revision + 1 };
        this.#notify(entry);
      }
    } finally {
      entry.controller = undefined;
    }
    if (requiresProgressPolling(entry.state)) this.#schedule(entry);
  }

  #apply(entry: CommandEntry, progress: ApplicationCommandProgress): void {
    if (progress.command !== entry.command || progress.commandId !== entry.commandId) throw new Error('Application command progress identity does not match the tracked command.');
    const phase = progress.durableResult === 'succeeded' ? 'succeeded' : progress.durableResult === 'rejected' ? 'rejected' : progress.durableResult === 'failed' ? 'failed' : progress.durableResult === 'pending' ? 'pending' : 'unknown';
    entry.state = { ...progress, phase, revision: entry.state.revision + 1 };
    entry.attempt = phase === 'pending' ? entry.attempt : 0;
    this.#notify(entry);
  }

  #schedule(entry: CommandEntry, delay?: number): void {
    if (entry.timer) return;
    const next = delay ?? Math.min(this.#poll.maxMs, this.#poll.initialMs * this.#poll.factor ** entry.attempt++);
    entry.timer = setTimeout(() => { entry.timer = undefined; void this.#refresh(entry); }, next);
  }

  #dispose(entry: CommandEntry): void {
    entry.controller?.abort();
    if (entry.timer) clearTimeout(entry.timer);
    this.#entries.delete(entry.commandId);
  }

  #notify(entry: CommandEntry): void { for (const listener of entry.listeners) listener(); }
}

export function waitForApplicationCommand<TOutput>(handle: ApplicationCommandHandle<TOutput>, signal?: AbortSignal): Promise<TOutput> {
  return new Promise<TOutput>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const finish = () => {
      const state = handle.getSnapshot();
      if (state.durableResult === 'succeeded') {
        unsubscribe();
        signal?.removeEventListener('abort', aborted);
        // typecast: the command protocol associates a succeeded durable result with this handle's declared output type.
        resolve(state.output as TOutput);
        return true;
      }
      if (state.durableResult === 'rejected') {
        unsubscribe();
        signal?.removeEventListener('abort', aborted);
        reject(new ApplicationCommandRejectedError(state.command, state.commandId, state.rejection ?? { name: 'unknown', payload: null }));
        return true;
      }
      if (state.durableResult === 'failed') {
        unsubscribe();
        signal?.removeEventListener('abort', aborted);
        reject(new ApplicationCommandFailedError(state.command, state.commandId, state.failure ?? { code: 'processing_failed' }));
        return true;
      }
      if (state.transport === 'failed' && state.error) {
        unsubscribe();
        signal?.removeEventListener('abort', aborted);
        reject(state.error);
        return true;
      }
      if (state.phase === 'error' && state.error) {
        unsubscribe();
        signal?.removeEventListener('abort', aborted);
        reject(state.error);
        return true;
      }
      return false;
    };
    const aborted = () => {
      unsubscribe();
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Application command wait was aborted.'));
    };
    if (signal?.aborted) {
      aborted();
      return;
    }
    unsubscribe = handle.subscribe(() => { finish(); });
    signal?.addEventListener('abort', aborted, { once: true });
    finish();
  });
}

function pendingState<TOutput>(command: string, commandId: string): ApplicationCommandState<TOutput> {
  return { protocol: 'applik8s.command/v1alpha1', command, commandId, correlationId: commandId, phase: 'submitting', transport: 'submitting', durableResult: 'unknown', workflow: 'notStarted', reconciliation: 'notObserved', revision: 0 };
}

function requiresProgressPolling(state: Pick<ApplicationCommandState, 'durableResult' | 'reconciliation'>): boolean {
  return state.durableResult === 'pending'
    || state.durableResult === 'unknown'
    || state.reconciliation === 'progressing';
}
