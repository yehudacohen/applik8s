// typecast-file-boundary: validated scheduler configuration is narrowed to the portable graph object boundary.
import { createHash } from 'node:crypto';
import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';
import {
  applicationGraphBooleanCondition,
  applicationGraphStringValue,
} from './application-installation-values.js';

export interface ApplicationHatchetScheduleBinding {
  readonly providerId: string;
  readonly scheduleIds: readonly string[];
  readonly namespace: string;
  readonly hostPort: string;
  readonly apiUrl: string;
  readonly tlsStrategy: string;
  readonly workerTokenSecret: string;
  readonly tokenKey: string;
  readonly tokenMountName: string;
  readonly tokenMountPath: string;
  readonly tokenFile: string;
  readonly hostPortEnvironment: string;
  readonly apiUrlEnvironment: string;
  readonly tlsEnvironment: string;
  readonly tokenEnvironment: string;
}

/**
 * Resolves the deployment/runtime contract for every directly selected shared
 * Hatchet Scheduler. The application host remains the callback execution
 * boundary; these bindings expose only the provider connection needed to
 * converge and receive delivery projections.
 */
export function applicationHatchetScheduleBindings(
  graph: ApplicationGraph,
): readonly ApplicationHatchetScheduleBinding[] {
  const schedulesByProvider = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.kind !== 'schedule') continue;
    const current = schedulesByProvider.get(node.scheduler.nodeId) ?? [];
    current.push(node.definition.id);
    schedulesByProvider.set(node.scheduler.nodeId, current);
  }
  return graph.nodes.flatMap((provider) => {
    if (
      provider.kind !== 'provider'
      || provider.interface !== 'Scheduler'
      || provider.implementation !== 'hatchet-scheduler'
    ) return [];
    const scheduleIds = schedulesByProvider.get(provider.id);
    if (!scheduleIds || scheduleIds.length === 0) return [];
    return [hatchetScheduleBinding(graph, provider, scheduleIds)];
  }).sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function hatchetScheduleBinding(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode,
  scheduleIds: readonly string[],
): ApplicationHatchetScheduleBinding {
  const scheduler = objectValue(provider.config?.scheduler);
  if (stringValue(scheduler.kind) !== 'hatchet-scheduler') {
    throw new Error(
      `Scheduler provider ${provider.id} is classified as hatchet-scheduler but has no matching scheduler configuration.`,
    );
  }
  const explicitWorkflowEngine = objectValue(scheduler.workflowEngine);
  const sharedWorkflowEngine = graph.nodes.find(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === 'WorkflowEngine'
      && node.implementation === 'hatchet'
      && !node.config?.qualification,
  );
  const workflowEngine = Object.keys(explicitWorkflowEngine).length > 0
    ? explicitWorkflowEngine
    : objectValue(sharedWorkflowEngine?.config);
  const workflowKind = stringValue(workflowEngine.kind);
  if (workflowKind && workflowKind !== 'hatchet') {
    throw new Error(
      `Scheduler provider ${provider.id} requires a Hatchet workflowEngine dependency; received ${workflowKind}.`,
    );
  }
  const namespace = applicationGraphStringValue(workflowEngine.namespace)
    ?? applicationGraphStringValue(graph.metadata.namespace)
    ?? 'default';
  const engineName = kubernetesName(
    applicationGraphStringValue(workflowEngine.name) ?? 'applik8s-hatchet',
  );
  const workerToken = objectValue(workflowEngine.workerTokenSecret);
  const explicitWorkerToken = applicationGraphStringValue(workerToken.name);
  const workerTokenSecret = explicitWorkerToken
    ?? (workflowEngine.provision === false ? `${engineName}-worker` : 'hatchet-client-config');
  const workerTokenNamespace = applicationGraphStringValue(workerToken.namespace) ?? namespace;
  if (workerTokenNamespace !== namespace) {
    throw new Error(
      `Scheduler provider ${provider.id} worker token Secret ${workerTokenSecret} is in ${workerTokenNamespace}, but its Hatchet client boundary is ${namespace}.`,
    );
  }
  const tokenKey = applicationGraphStringValue(workflowEngine.tokenKey)
    ?? (explicitWorkerToken || workflowEngine.provision !== false
      ? 'HATCHET_CLIENT_TOKEN'
      : 'token');
  const digest = createHash('sha256').update(provider.id).digest('hex').slice(0, 12);
  const tokenMountName = `scheduler-token-${digest}`;
  const tokenMountPath = `/var/run/secrets/applik8s/schedulers/${digest}`;
  const environmentSuffix = digest.toUpperCase();
  return Object.freeze({
    providerId: provider.id,
    scheduleIds: Object.freeze([...scheduleIds].sort()),
    namespace,
    hostPort: applicationGraphStringValue(workflowEngine.hostPort)
      ?? `hatchet-engine.${namespace}.svc:7070`,
    apiUrl: applicationGraphStringValue(workflowEngine.apiUrl)
      ?? `http://hatchet-api.${namespace}.svc:8080`,
    tlsStrategy: hatchetTlsStrategy(workflowEngine.tls),
    workerTokenSecret,
    tokenKey,
    tokenMountName,
    tokenMountPath,
    tokenFile: `${tokenMountPath}/token`,
    hostPortEnvironment: `APPLIK8S_HATCHET_SCHEDULER_HOST_${environmentSuffix}`,
    apiUrlEnvironment: `APPLIK8S_HATCHET_SCHEDULER_API_${environmentSuffix}`,
    tlsEnvironment: `APPLIK8S_HATCHET_SCHEDULER_TLS_${environmentSuffix}`,
    tokenEnvironment: `APPLIK8S_HATCHET_SCHEDULER_TOKEN_${environmentSuffix}`,
  });
}

function hatchetTlsStrategy(value: unknown): string {
  if (value === true) return 'tls';
  if (value === false || value === undefined) return 'none';
  const condition = applicationGraphBooleanCondition(value);
  if (!condition) {
    throw new Error(
      'Hatchet Scheduler workflowEngine.tls must be boolean or an installation expression.',
    );
  }
  const expression = /^\$\{(.+)\}$/u.exec(condition)?.[1];
  if (expression) return `\${(${expression}) ? "tls" : "none"}`;
  return condition === 'true' ? 'tls' : 'none';
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function kubernetesName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 63)
    .replace(/-+$/gu, '');
  if (!normalized) throw new Error(`Kubernetes resource name ${JSON.stringify(value)} is invalid.`);
  return normalized;
}
