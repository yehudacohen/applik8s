import type {
  ApplicationIdentityAdmissionReceipt,
  ApplicationIdentityFlowStore,
  ApplicationOrphanedProviderSession,
  ApplicationPreAuthenticationFlowRecord,
} from './contracts.js';
import type {
  ApplicationIdentityProjectionFrontier,
  ApplicationIdentityProjectionFrontierStore,
} from './projection-contracts.js';

export class MemoryApplicationIdentityFlowStore
  implements ApplicationIdentityFlowStore
{
  readonly #flows = new Map<string, ApplicationPreAuthenticationFlowRecord>();
  readonly #receipts = new Map<string, ApplicationIdentityAdmissionReceipt>();
  readonly #orphans = new Map<string, ApplicationOrphanedProviderSession>();

  async createFlow(
    flow: ApplicationPreAuthenticationFlowRecord,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    if (this.#flows.has(flow.id)) {
      throw new Error(`Identity flow ${flow.id} already exists.`);
    }
    const stored = structuredClone(flow);
    this.#flows.set(flow.id, stored);
    return structuredClone(stored);
  }

  async getFlow(
    flowId: string,
  ): Promise<ApplicationPreAuthenticationFlowRecord | undefined> {
    const flow = this.#flows.get(flowId);
    return flow ? structuredClone(flow) : undefined;
  }

  async replaceFlow(
    flow: ApplicationPreAuthenticationFlowRecord,
    expectedVersion: number,
  ): Promise<ApplicationPreAuthenticationFlowRecord> {
    const current = this.#flows.get(flow.id);
    if (!current || current.version !== expectedVersion) {
      throw new Error(
        `Identity flow ${flow.id} expected version ${expectedVersion}, observed ${current?.version ?? 'missing'}.`,
      );
    }
    if (flow.version !== expectedVersion + 1) {
      throw new Error(
        `Identity flow ${flow.id} replacement must advance exactly one version.`,
      );
    }
    const stored = structuredClone(flow);
    this.#flows.set(flow.id, stored);
    return structuredClone(stored);
  }

  async getAdmissionReceipt(
    providerCompletionKey: string,
  ): Promise<ApplicationIdentityAdmissionReceipt | undefined> {
    const receipt = this.#receipts.get(providerCompletionKey);
    return receipt ? structuredClone(receipt) : undefined;
  }

  async commitAdmission(input: {
    readonly flow: ApplicationPreAuthenticationFlowRecord;
    readonly expectedFlowVersion: number;
    readonly receipt: ApplicationIdentityAdmissionReceipt;
  }) {
    const replay = this.#receipts.get(input.receipt.providerCompletionKey);
    if (replay) {
      const flow = this.#flows.get(replay.flowId);
      if (!flow) {
        throw new Error(
          `Identity admission ${replay.id} exists without flow ${replay.flowId}.`,
        );
      }
      return {
        kind: 'replayed' as const,
        flow: structuredClone(flow),
        receipt: structuredClone(replay),
      };
    }
    const current = this.#flows.get(input.flow.id);
    if (!current || current.version !== input.expectedFlowVersion) {
      throw new Error(
        `Identity admission flow ${input.flow.id} expected version ${input.expectedFlowVersion}, observed ${current?.version ?? 'missing'}.`,
      );
    }
    if (
      input.flow.version !== input.expectedFlowVersion + 1
      || input.flow.state !== 'consumed'
    ) {
      throw new Error(
        `Identity admission flow ${input.flow.id} must atomically advance to consumed.`,
      );
    }
    const flow = structuredClone(input.flow);
    const receipt = structuredClone(input.receipt);
    this.#flows.set(flow.id, flow);
    this.#receipts.set(receipt.providerCompletionKey, receipt);
    return {
      kind: 'committed' as const,
      flow: structuredClone(flow),
      receipt: structuredClone(receipt),
    };
  }

  async recordOrphan(
    orphan: ApplicationOrphanedProviderSession,
  ): Promise<ApplicationOrphanedProviderSession> {
    const existing = this.#orphans.get(orphan.id);
    if (existing) return structuredClone(existing);
    const stored = structuredClone(orphan);
    this.#orphans.set(orphan.id, stored);
    return structuredClone(stored);
  }

  async listPendingOrphans(
    limit: number,
  ): Promise<readonly ApplicationOrphanedProviderSession[]> {
    return [...this.#orphans.values()]
      .filter((orphan) => orphan.state === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
      .map((orphan) => structuredClone(orphan));
  }

  async resolveOrphan(
    orphanId: string,
    expectedVersion: number,
    resolution: {
      readonly state: Exclude<ApplicationOrphanedProviderSession['state'], 'pending'>;
      readonly resolvedAt: string;
      readonly evidence?: Readonly<Record<string, import('@applik8s/core').JsonValue>>;
    },
  ): Promise<ApplicationOrphanedProviderSession> {
    const current = this.#orphans.get(orphanId);
    if (
      !current
      || current.version !== expectedVersion
      || current.state !== 'pending'
    ) {
      throw new Error(
        `Identity orphan ${orphanId} expected pending version ${expectedVersion}.`,
      );
    }
    const next: ApplicationOrphanedProviderSession = {
      ...current,
      state: resolution.state,
      resolvedAt: resolution.resolvedAt,
      ...(resolution.evidence
        ? { resolutionEvidence: structuredClone(resolution.evidence) }
        : {}),
      version: current.version + 1,
    };
    this.#orphans.set(orphanId, next);
    return structuredClone(next);
  }
}

/** Explicit starter/test frontier store. Dedicated profiles use a durable implementation. */
export class MemoryApplicationIdentityProjectionFrontierStore
  implements ApplicationIdentityProjectionFrontierStore
{
  readonly #frontiers = new Map<string, ApplicationIdentityProjectionFrontier>();

  async read(projection: string): Promise<ApplicationIdentityProjectionFrontier | undefined> {
    const frontier = this.#frontiers.get(projection);
    return frontier ? structuredClone(frontier) : undefined;
  }

  async commit(
    frontier: ApplicationIdentityProjectionFrontier,
    expectedSourceSequence: number | undefined,
  ): Promise<ApplicationIdentityProjectionFrontier> {
    const current = this.#frontiers.get(frontier.projection);
    if (current?.sourceSequence !== expectedSourceSequence) {
      throw new Error(
        `Identity projection ${frontier.projection} expected frontier ${expectedSourceSequence ?? 'missing'}, observed ${current?.sourceSequence ?? 'missing'}.`,
      );
    }
    if (current && frontier.sourceSequence < current.sourceSequence) {
      throw new Error(`Identity projection ${frontier.projection} cannot move backward.`);
    }
    const stored = structuredClone(frontier);
    this.#frontiers.set(frontier.projection, stored);
    return structuredClone(stored);
  }
}
