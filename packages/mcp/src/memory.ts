import type { ApplicationMcpSession, ApplicationMcpSessionStore } from './contracts.js';

export class InMemoryApplicationMcpSessionStore
  implements ApplicationMcpSessionStore
{
  readonly #sessions = new Map<string, ApplicationMcpSession>();

  async create(session: ApplicationMcpSession): Promise<ApplicationMcpSession> {
    if (this.#sessions.has(session.id)) {
      throw new Error(`MCP session ${session.id} already exists.`);
    }
    this.#sessions.set(session.id, clone(session));
    return clone(session);
  }

  async get(sessionId: string): Promise<ApplicationMcpSession | undefined> {
    const session = this.#sessions.get(sessionId);
    return session ? clone(session) : undefined;
  }

  async replace(
    session: ApplicationMcpSession,
    expectedVersion: number,
  ): Promise<ApplicationMcpSession> {
    const current = this.#sessions.get(session.id);
    if (!current || current.version !== expectedVersion) {
      throw new Error(
        `MCP session ${session.id} changed concurrently; expected version ${expectedVersion}.`,
      );
    }
    this.#sessions.set(session.id, clone(session));
    return clone(session);
  }

  async list(input: {
    readonly serverId: string;
    readonly states: readonly ApplicationMcpSession['state'][];
    readonly limit: number;
  }): Promise<readonly ApplicationMcpSession[]> {
    return [...this.#sessions.values()]
      .filter(
        (session) =>
          session.serverId === input.serverId
          && input.states.includes(session.state),
      )
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, input.limit)
      .map(clone);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
