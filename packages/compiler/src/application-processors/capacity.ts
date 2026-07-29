import type { ApplicationProcessorNode } from '@applik8s/core';

export function generatedProcessorCapacity(processor: ApplicationProcessorNode) {
  return {
    replicas: processor.deployment.replicas,
    concurrencyPerReplica: processor.deployment.concurrency,
    maximumInFlight: multipliedIntegerValue(processor.deployment.replicas, processor.deployment.concurrency),
    maxAckPending: processor.deployment.maxAckPending,
    requests: processor.deployment.resources.requests,
    limits: processor.deployment.resources.limits,
  };
}

export function generatedProcessorDisruptionResource(
  processor: ApplicationProcessorNode,
  metadata: Readonly<Record<string, unknown>>,
  labels: Readonly<Record<string, string>>,
) {
  if ('disabled' in processor.deployment.disruption) return undefined;
  return {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata,
    spec: { ...processor.deployment.disruption, selector: { matchLabels: labels } },
  };
}

export function generatedProcessorPodScheduling(processor: ApplicationProcessorNode, labels: Readonly<Record<string, string>>) {
  return {
    ...(processor.deployment.nodeSelector ? { nodeSelector: processor.deployment.nodeSelector } : {}),
    ...(typeof processor.deployment.replicas === 'string' || processor.deployment.replicas > 1 ? {
      topologySpreadConstraints: [{
        maxSkew: 1,
        topologyKey: 'kubernetes.io/hostname',
        whenUnsatisfiable: 'ScheduleAnyway',
        labelSelector: { matchLabels: labels },
      }],
    } : {}),
  };
}

function multipliedIntegerValue(left: number | string, right: number | string): number | string {
  if (typeof left === 'number' && typeof right === 'number') return left * right;
  return `\${(${integerExpression(left)}) * (${integerExpression(right)})}`;
}

function integerExpression(value: number | string): string {
  if (typeof value === 'number') return String(value);
  const expression = /^\$\{(.+)\}$/.exec(value)?.[1];
  if (!expression) throw new Error(`Expected a serialized installation integer expression, received ${JSON.stringify(value)}.`);
  return expression;
}
