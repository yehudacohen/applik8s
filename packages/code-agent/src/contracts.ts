// typecast-file-boundary: Protocol constants and JSON transport contracts are
// branded only after their public literal shape is declared in this module.
import type { JsonObject } from '@applik8s/core';
import type { ApplicationAIModelDefinition } from '@applik8s/ai';

export const applicationCodeAgentProtocol = 'applik8s.codeAgent/v1alpha1' as const;

export interface ApplicationCodeWorkspaceLease {
  readonly apiVersion: 'applik8s.codeWorkspaceLease/v1alpha1';
  readonly id: string;
  readonly workspace: string;
  readonly runId: string;
  readonly fencingToken: string;
  readonly generation: number;
  readonly root: string;
  readonly baseRevision: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

/** Stable developer-facing workspace evidence; lease internals remain runtime-only. */
export interface ApplicationCodeWorkspaceReference {
  readonly apiVersion: 'applik8s.codeWorkspaceReference/v1alpha1';
  readonly id: string;
  readonly workspace: string;
  readonly runId: string;
}

export interface ApplicationCodeWorkspaceLeaseRequest {
  readonly workspace: string;
  readonly runId: string;
  readonly fencingToken: string;
  readonly baseRevision?: string;
  readonly ttlMs?: number;
}

export interface ApplicationCodeWorkspaceReleaseRequest {
  readonly lease: ApplicationCodeWorkspaceLease;
  readonly disposition: 'retain' | 'release';
}

export interface ApplicationCodeWorkspaceProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  lease(input: ApplicationCodeWorkspaceLeaseRequest): Promise<ApplicationCodeWorkspaceLease>;
  release(input: ApplicationCodeWorkspaceReleaseRequest): Promise<{ readonly released: boolean }>;
}

export interface ApplicationSourceRepositorySnapshot {
  readonly revision: string;
  readonly files: readonly {
    readonly path: string;
    readonly digest: `sha256:${string}`;
    readonly text: string;
  }[];
}

export interface ApplicationSourceRepositoryChange {
  readonly path: string;
  readonly baseDigest: `sha256:${string}`;
  readonly nextText: string;
}

export interface ApplicationSourceRepositoryProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  inspect(input: {
    readonly lease: ApplicationCodeWorkspaceLease;
    readonly paths?: readonly string[];
    readonly maximumBytes?: number;
  }): Promise<ApplicationSourceRepositorySnapshot>;
  apply(input: {
    readonly lease: ApplicationCodeWorkspaceLease;
    readonly changes: readonly ApplicationSourceRepositoryChange[];
  }): Promise<ApplicationSourceRepositorySnapshot>;
}

export interface ApplicationProcessResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface ApplicationProcessRunnerProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  run(input: {
    readonly lease: ApplicationCodeWorkspaceLease;
    readonly idempotencyKey?: string;
    readonly executable: string;
    readonly arguments?: readonly string[];
    readonly timeoutMs?: number;
  }): Promise<ApplicationProcessResult>;
}

export interface ApplicationAgentHarnessEvent {
  readonly sequence: number;
  readonly type: 'status' | 'message' | 'proposal' | 'tool';
  readonly payload: JsonObject;
}

export interface ApplicationAgentHarnessRequest {
  readonly apiVersion: 'applik8s.agentHarnessRun/v1alpha1';
  readonly runId: string;
  readonly fencingToken: string;
  readonly workspace: ApplicationCodeWorkspaceLease;
  readonly instruction: string;
  /** Logical model selection remains provider-neutral and plan-visible. */
  readonly model: ApplicationAIModelDefinition;
  readonly source: ApplicationSourceRepositorySnapshot;
  readonly deadline: string;
  readonly grants: readonly string[];
  /** Bounded process tools the harness may offer during this run. */
  readonly processTools?: readonly {
    readonly executable: string;
    readonly arguments?: readonly string[];
    readonly timeoutMs?: number;
  }[];
}

export interface ApplicationAgentHarnessCancellationRequest {
  readonly runId: string;
  readonly fencingToken: string;
  /** Stable durable-cell routing key. */
  readonly workspace: string;
}

export interface ApplicationAgentHarnessResult {
  readonly apiVersion: 'applik8s.agentHarnessResult/v1alpha1';
  readonly runId: string;
  readonly sessionId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly events: readonly ApplicationAgentHarnessEvent[];
  readonly changes: readonly ApplicationSourceRepositoryChange[];
  readonly summary: string;
  readonly receipt: JsonObject;
}

export interface ApplicationAgentHarnessProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'deterministic' | 'live';
  run(input: ApplicationAgentHarnessRequest): Promise<ApplicationAgentHarnessResult>;
  cancel(input: ApplicationAgentHarnessCancellationRequest): Promise<{ readonly status: 'cancelled' | 'alreadyTerminal' }>;
}

export type ApplicationCodeAgentResult =
  | {
      readonly status: 'completed';
      readonly runId: string;
      readonly workspace: ApplicationCodeWorkspaceReference;
      readonly revision: string;
      readonly summary: string;
      readonly harness: {
        readonly sessionId: string;
        readonly receipt: JsonObject;
      };
      readonly validation: readonly ApplicationProcessResult[];
    }
  | {
      readonly status: 'failed' | 'cancelled';
      readonly runId: string;
      readonly workspace?: ApplicationCodeWorkspaceReference;
      readonly reason: string;
    };
