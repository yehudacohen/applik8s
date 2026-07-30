import type {
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOAuthAuthorizationFlowStore,
} from './oauth-contracts.js';

export class MemoryApplicationOAuthAuthorizationFlowStore
  implements ApplicationOAuthAuthorizationFlowStore
{
  readonly #flows = new Map<string, ApplicationOAuthAuthorizationFlowRecord>();

  async create(
    flow: ApplicationOAuthAuthorizationFlowRecord,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    if (this.#flows.has(flow.id)) {
      throw new Error(`OAuth authorization flow ${flow.id} already exists.`);
    }
    const stored = structuredClone(flow);
    this.#flows.set(flow.id, stored);
    return structuredClone(stored);
  }

  async get(
    flowId: string,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord | undefined> {
    const flow = this.#flows.get(flowId);
    return flow ? structuredClone(flow) : undefined;
  }

  async replace(
    flow: ApplicationOAuthAuthorizationFlowRecord,
    expectedVersion: number,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord> {
    const current = this.#flows.get(flow.id);
    if (!current || current.version !== expectedVersion) {
      throw new Error(
        `OAuth authorization flow ${flow.id} expected version ${expectedVersion}, observed ${current?.version ?? 'missing'}.`,
      );
    }
    if (flow.version !== expectedVersion + 1) {
      throw new Error(
        `OAuth authorization flow ${flow.id} replacement must advance exactly one version.`,
      );
    }
    const stored = structuredClone(flow);
    this.#flows.set(flow.id, stored);
    return structuredClone(stored);
  }
}
