export const kubernetesApplicationOperatorRuntimeProtocol = 'applik8s.operator-runtime.kubernetes/v1alpha1' as const;

export interface KubernetesApplicationOperatorRuntimeOptions {
  readonly namespace?: string;
  readonly leaseDuration?: string;
  readonly resyncInterval?: string;
  readonly maximumResyncItems?: number;
}

export interface KubernetesApplicationOperatorRuntimeContract {
  readonly protocol: typeof kubernetesApplicationOperatorRuntimeProtocol;
  readonly namespace?: string;
  readonly leaseDurationSeconds: number;
  readonly resyncIntervalSeconds: number;
  readonly maximumResyncItems: number;
  readonly fencing: 'uidGenerationResourceVersion';
  readonly notification: 'watchInvalidationHint';
  readonly resync: 'boundedList';
  readonly delayedWakeup: 'workQueue';
  readonly finalization: 'kubernetesFinalizer';
}

/** Normalizes assembly-time provider selection into the existing controller runtime contract. */
export function kubernetesApplicationOperatorRuntime(
  options: KubernetesApplicationOperatorRuntimeOptions = {},
): KubernetesApplicationOperatorRuntimeContract {
  const maximumResyncItems = options.maximumResyncItems ?? 500;
  if (!Number.isSafeInteger(maximumResyncItems) || maximumResyncItems < 1) {
    throw new TypeError('Kubernetes OperatorRuntime maximumResyncItems must be a positive safe integer.');
  }
  return Object.freeze({
    protocol: kubernetesApplicationOperatorRuntimeProtocol,
    ...(options.namespace ? { namespace: required(options.namespace, 'Kubernetes OperatorRuntime namespace') } : {}),
    leaseDurationSeconds: durationSeconds(options.leaseDuration ?? '60s', 'Kubernetes OperatorRuntime leaseDuration'),
    resyncIntervalSeconds: durationSeconds(options.resyncInterval ?? '5m', 'Kubernetes OperatorRuntime resyncInterval'),
    maximumResyncItems,
    fencing: 'uidGenerationResourceVersion',
    notification: 'watchInvalidationHint',
    resync: 'boundedList',
    delayedWakeup: 'workQueue',
    finalization: 'kubernetesFinalizer',
  });
}

function durationSeconds(value: string, label: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new TypeError(`${label} must be a whole-second duration such as 30s, 5m, or 1h.`);
  const amount = Number(match[1]);
  const seconds = amount * ({ s: 1, m: 60, h: 3_600, d: 86_400 }[match[2] ?? ''] ?? 0);
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new TypeError(`${label} is outside the supported range.`);
  return seconds;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}
