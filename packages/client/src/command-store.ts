import type { ApplicationCommandProgress, ApplicationCommandTransport } from './protocol.js';

export interface ApplicationCommandState<TOutput = unknown> extends Omit<ApplicationCommandProgress, 'output'> {
  readonly output?: TOutput;
  readonly phase: 'submitting' | 'pending' | 'succeeded' | 'rejected' | 'unknown' | 'error';
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

export interface ApplicationCommandClientOptions {
  readonly poll?: { readonly initialMs?: number; readonly maxMs?: number; readonly factor?: number };
  readonly id?: () => string;
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
    this.#id = options.id ?? (() => crypto.randomUUID());
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
      if (entry.state.durableResult === 'pending' || entry.state.durableResult === 'unknown') this.#schedule(entry);
    } catch (error) {
      entry.state = { ...entry.state, phase: 'unknown', transport: 'failed', durableResult: 'unknown', error: error instanceof Error ? error : new Error(String(error)), revision: entry.state.revision + 1 };
      this.#notify(entry);
    }
    return handle;
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
    if (entry.state.durableResult === 'pending' || entry.state.durableResult === 'unknown') this.#schedule(entry);
  }

  #apply(entry: CommandEntry, progress: ApplicationCommandProgress): void {
    if (progress.command !== entry.command || progress.commandId !== entry.commandId) throw new Error('Application command progress identity does not match the tracked command.');
    const phase = progress.durableResult === 'succeeded' ? 'succeeded' : progress.durableResult === 'rejected' ? 'rejected' : progress.durableResult === 'pending' ? 'pending' : 'unknown';
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

function pendingState<TOutput>(command: string, commandId: string): ApplicationCommandState<TOutput> {
  return { protocol: 'applik8s.command/v1alpha1', command, commandId, correlationId: commandId, phase: 'submitting', transport: 'submitting', durableResult: 'unknown', workflow: 'notStarted', reconciliation: 'notObserved', revision: 0 };
}
