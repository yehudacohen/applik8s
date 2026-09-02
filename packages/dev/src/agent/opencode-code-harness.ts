// typecast-file-boundary: OpenCode's external JSON and event stream are
// validated before conversion to the provider-neutral code-agent protocol.
import type {
  ApplicationAgentHarnessProvider,
  ApplicationAgentHarnessRequest,
  ApplicationAgentHarnessResult,
  ApplicationSourceRepositoryChange,
} from '@applik8s/code-agent';
import { bindCodeAgentProviderRuntime } from '@applik8s/code-agent/runtime-contract';
import type { DevelopmentChangePlan } from '../contracts.js';
import type { DevelopmentEvent } from './index.js';
import { OpenCodeAgentProvider, type OpenCodeAgentProviderOptions } from './opencode.js';

export interface OpenCodeHarnessProviderOptions extends OpenCodeAgentProviderOptions {
  readonly provider?: OpenCodeAgentProvider;
}

/**
 * Maintained OpenCode adapter for the provider-neutral AgentHarness contract.
 * OpenCode remains advisory: repository mutation and validation are performed
 * only by the separately injected SourceRepository and ProcessRunner.
 */
export class OpenCodeHarnessProvider implements ApplicationAgentHarnessProvider {
  readonly provider = 'opencode';
  readonly kind = 'opencode-harness';
  readonly mode = 'live' as const;
  readonly #opencode: OpenCodeAgentProvider;
  readonly #sessions = new Map<string, { readonly id: string; readonly fencingToken: string }>();
  readonly #terminal = new Map<string, {
    readonly fencingToken: string;
    readonly result: ApplicationAgentHarnessResult;
  }>();
  readonly #cancellations = new Map<string, {
    readonly fencingToken: string;
    readonly settled: Promise<void>;
    readonly settle: () => void;
  }>();

  constructor(readonly options: OpenCodeHarnessProviderOptions) {
    this.#opencode = options.provider ?? new OpenCodeAgentProvider(options);
    bindCodeAgentProviderRuntime(this, 'harness', {
      env: { APPLIK8S_AGENT_HARNESS_KIND: 'opencode-loopback' },
    });
  }

  async run(input: ApplicationAgentHarnessRequest): Promise<ApplicationAgentHarnessResult> {
    validateRequest(input);
    const terminal = this.#terminal.get(input.runId);
    if (terminal) {
      if (terminal.fencingToken !== input.fencingToken) {
        throw new Error(`OpenCode run ${input.runId} rejected a stale fencing token.`);
      }
      return terminal.result;
    }
    const existing = this.#sessions.get(input.runId);
    if (existing && existing.fencingToken !== input.fencingToken) {
      throw new Error(`OpenCode run ${input.runId} rejected a stale fencing token.`);
    }
    const session = existing ?? await this.#start(input);
    const events: DevelopmentEvent[] = [];
    try {
      for await (const event of this.#opencode.propose({
        sessionId: session.id,
        request: input.instruction,
        requestedOutcome: input.instruction,
        attachments: input.source.files.map((file) => ({
          id: `source:${file.path}`,
          class: 'source',
          digest: file.digest,
          capturedAtRevision: input.source.revision,
          resolution: 'exact',
          redaction: 'none',
          payload: { path: file.path, source: file.text },
        })),
        referents: [],
      })) events.push(event);
    } catch (cause) {
      await this.#cancellations.get(input.runId)?.settled;
      const cancelled = this.#terminal.get(input.runId);
      if (cancelled?.result.status === 'cancelled') return cancelled.result;
      throw cause;
    }
    await this.#cancellations.get(input.runId)?.settled;
    const cancelled = this.#terminal.get(input.runId);
    if (cancelled?.result.status === 'cancelled') return cancelled.result;
    const plan = events.find(
      (event): event is Extract<DevelopmentEvent, { type: 'plan' }> => event.type === 'plan',
    )?.plan;
    const result = Object.freeze({
      apiVersion: 'applik8s.agentHarnessResult/v1alpha1' as const,
      runId: input.runId,
      sessionId: session.id,
      status: 'completed' as const,
      events: Object.freeze(events.map((event, index) => ({
        sequence: index + 1,
        type: event.type === 'plan'
          ? 'proposal' as const
          : event.type === 'diagnostic'
            ? 'status' as const
            : event.type,
        payload: developmentEventPayload(event),
      }))),
      changes: Object.freeze(plan ? planChanges(plan, input) : []),
      summary: plan?.summary ?? messageSummary(events) ?? 'OpenCode completed without proposing source changes.',
      receipt: Object.freeze({
        provider: 'opencode',
        sessionId: session.id,
        sourceRevision: input.source.revision,
        changeCount: plan?.files.length ?? 0,
      }),
    });
    this.#terminal.set(input.runId, { fencingToken: input.fencingToken, result });
    return result;
  }

  async cancel(input: { readonly runId: string; readonly fencingToken: string; readonly workspace: string }) {
    const session = this.#sessions.get(input.runId);
    const terminal = this.#terminal.get(input.runId);
    if (terminal) {
      if (terminal.fencingToken !== input.fencingToken) throw new Error(`OpenCode run ${input.runId} rejected a stale fencing token.`);
      return { status: 'alreadyTerminal' as const };
    }
    if (!session) return { status: 'alreadyTerminal' as const };
    if (session.fencingToken !== input.fencingToken) throw new Error(`OpenCode run ${input.runId} rejected a stale fencing token.`);
    const pending = this.#cancellations.get(input.runId) ?? cancellation(input.fencingToken);
    this.#cancellations.set(input.runId, pending);
    if (pending.fencingToken !== input.fencingToken) throw new Error(`OpenCode run ${input.runId} rejected a stale fencing token.`);
    try {
      const result = await this.#opencode.cancel({ sessionId: session.id, turnId: input.runId });
      if (result.state !== 'cancelled') return { status: 'alreadyTerminal' as const };
      this.#terminal.set(input.runId, {
        fencingToken: input.fencingToken,
        result: Object.freeze({
          apiVersion: 'applik8s.agentHarnessResult/v1alpha1',
          runId: input.runId,
          sessionId: session.id,
          status: 'cancelled',
          events: Object.freeze([{ sequence: 1, type: 'status' as const, payload: { state: 'cancelled' } }]),
          changes: Object.freeze([]),
          summary: 'OpenCode run was cancelled.',
          receipt: Object.freeze({ provider: 'opencode', sessionId: session.id, terminal: 'cancelled' }),
        }),
      });
      return { status: 'cancelled' as const };
    } finally {
      pending.settle();
    }
  }

  async stop(): Promise<void> {
    await this.#opencode.stop();
  }

  async #start(input: ApplicationAgentHarnessRequest) {
    const session = await this.#opencode.startSession({
      projectId: input.runId,
      workspaceRoot: input.workspace.root,
      mode: 'reviewed-apply',
      sourceEgress: {
        provider: 'local',
        remote: false,
        consentedAttachmentClasses: ['source'],
      },
    });
    const value = { id: session.id, fencingToken: input.fencingToken };
    this.#sessions.set(input.runId, value);
    return value;
  }
}

function validateRequest(input: ApplicationAgentHarnessRequest): void {
  if (input.apiVersion !== 'applik8s.agentHarnessRun/v1alpha1') throw new Error('OpenCode harness request protocol is unsupported.');
  if (!input.runId || !input.fencingToken || !input.instruction) throw new Error('OpenCode harness requires run identity, fencing, and an instruction.');
  if (input.workspace.runId !== input.runId || input.workspace.fencingToken !== input.fencingToken) {
    throw new Error(`OpenCode run ${input.runId} does not own the supplied workspace lease.`);
  }
  if (Date.parse(input.deadline) <= Date.now()) throw new Error(`OpenCode run ${input.runId} deadline has expired.`);
}

function planChanges(
  plan: DevelopmentChangePlan,
  input: ApplicationAgentHarnessRequest,
): readonly ApplicationSourceRepositoryChange[] {
  const source = new Map(input.source.files.map((file) => [file.path, file]));
  return plan.files.map((file) => {
    const admitted = source.get(file.path);
    if (!admitted || admitted.digest !== file.baseDigest) {
      throw new Error(`OpenCode proposal ${file.path} is outside the admitted source revision.`);
    }
    return Object.freeze({
      path: file.path,
      baseDigest: file.baseDigest,
      nextText: file.nextText,
    });
  });
}

function developmentEventPayload(event: DevelopmentEvent) {
  switch (event.type) {
    case 'message': return { text: event.text };
    case 'status': return { state: event.state, message: event.message };
    case 'diagnostic': return { code: event.code, message: event.message };
    case 'plan': return { id: event.plan.id, summary: event.plan.summary };
  }
}

function messageSummary(events: readonly DevelopmentEvent[]): string | undefined {
  return events.find((event): event is Extract<DevelopmentEvent, { type: 'message' }> => event.type === 'message')?.text;
}

function cancellation(fencingToken: string): {
  readonly fencingToken: string;
  readonly settled: Promise<void>;
  readonly settle: () => void;
} {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  return { fencingToken, settled, settle };
}
