import type { ApplicationProcessorDeploymentContract } from '@applik8s/core';

export interface ApplicationProcessorOptions {
  /** Override the digest-pinned Node runtime image used by the inferred processor. */
  readonly image?: string;
  /** Number of processor pods. Bounded to 1..32. */
  readonly replicas?: number;
  /** Concurrent command executions per pod. Bounded to 1..64. */
  readonly concurrency?: number;
  /** Shared JetStream consumer delivery window; defaults to replicas * concurrency. */
  readonly maxAckPending?: number;
  readonly resources?: {
    readonly requests?: { readonly cpu?: string; readonly memory?: string };
    readonly limits?: { readonly cpu?: string; readonly memory?: string };
  };
  readonly disruption?: { readonly maxUnavailable: number } | { readonly minAvailable: number } | { readonly disabled: true };
  readonly nodeSelector?: Readonly<Record<string, string>>;
}

export const defaultApplicationProcessorDeployment: ApplicationProcessorDeploymentContract = {
  replicas: 1,
  concurrency: 8,
  maxAckPending: 8,
  resources: {
    requests: { cpu: '50m', memory: '128Mi' },
    limits: { cpu: '1', memory: '512Mi' },
  },
  disruption: { disabled: true },
};

export function normalizeApplicationProcessorOptions(owner: string, options?: ApplicationProcessorOptions, inherited: ApplicationProcessorDeploymentContract = defaultApplicationProcessorDeployment): {
  readonly image?: string;
  readonly deployment: ApplicationProcessorDeploymentContract;
} {
  const image = options?.image?.trim();
  if (options?.image !== undefined && !image) throw new Error(`${owner} processor.image must be a non-empty OCI image reference.`);
  const replicas = boundedInteger(owner, 'processor.replicas', options?.replicas ?? inherited.replicas, 1, 32);
  const concurrency = boundedInteger(owner, 'processor.concurrency', options?.concurrency ?? inherited.concurrency, 1, 64);
  const capacityChanged = options?.replicas !== undefined || options?.concurrency !== undefined;
  const maxAckPending = boundedInteger(owner, 'processor.maxAckPending', options?.maxAckPending ?? (capacityChanged ? replicas * concurrency : inherited.maxAckPending), replicas * concurrency, 65_536);
  const disruption = options?.disruption ?? (options?.replicas === undefined ? inherited.disruption : normalizeDisruption(owner, replicas, undefined));
  const nodeSelector = options?.nodeSelector ? normalizeNodeSelector(owner, options.nodeSelector) : inherited.nodeSelector;
  return {
    ...(image ? { image } : {}),
    deployment: {
      replicas,
      concurrency,
      maxAckPending,
      resources: {
        requests: {
          cpu: resourceQuantity(owner, 'processor.resources.requests.cpu', options?.resources?.requests?.cpu ?? inherited.resources.requests.cpu),
          memory: resourceQuantity(owner, 'processor.resources.requests.memory', options?.resources?.requests?.memory ?? inherited.resources.requests.memory),
        },
        limits: {
          cpu: resourceQuantity(owner, 'processor.resources.limits.cpu', options?.resources?.limits?.cpu ?? inherited.resources.limits.cpu),
          memory: resourceQuantity(owner, 'processor.resources.limits.memory', options?.resources?.limits?.memory ?? inherited.resources.limits.memory),
        },
      },
      disruption,
      ...(nodeSelector ? { nodeSelector } : {}),
    },
  };
}

export function sameApplicationProcessorDeployment(left: ApplicationProcessorDeploymentContract, right: ApplicationProcessorDeploymentContract): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedInteger(owner: string, field: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${owner} ${field} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

function resourceQuantity(owner: string, field: string, value: string): string {
  if (typeof value !== 'string') throw new Error(`${owner} ${field} must be a non-empty Kubernetes resource quantity.`);
  const normalized = value.trim();
  if (!/^[+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+|[numkKMGTP]i?)?$/.test(normalized)) throw new Error(`${owner} ${field} must be a non-empty Kubernetes resource quantity.`);
  return normalized;
}

function normalizeDisruption(owner: string, replicas: number, value: ApplicationProcessorOptions['disruption']): ApplicationProcessorDeploymentContract['disruption'] {
  if (!value) return replicas > 1 ? { maxUnavailable: 1 } : { disabled: true };
  if ('disabled' in value) return { disabled: true };
  if ('maxUnavailable' in value) return { maxUnavailable: boundedInteger(owner, 'processor.disruption.maxUnavailable', value.maxUnavailable, 0, Math.max(0, replicas - 1)) };
  return { minAvailable: boundedInteger(owner, 'processor.disruption.minAvailable', value.minAvailable, 1, replicas) };
}

function normalizeNodeSelector(owner: string, selector: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(selector).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (!key.trim() || !value.trim()) throw new Error(`${owner} processor.nodeSelector keys and values must be non-empty.`);
  }
  return Object.fromEntries(entries);
}
