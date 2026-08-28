// typecast-file-boundary: Actor invocation lowering inspects compiler-validated callable operations and preserves their literal runtime contract identity.
import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';
import { applicationGraphStringValue } from './application-installation-values.js';

export interface ApplicationActorInvocationBoundary {
  readonly endpoint: string;
  readonly host: ApplicationProviderNode<'ApplicationHost'>;
}

export function applicationActorInvocationBoundary(
  graph: ApplicationGraph,
  namespace: string,
  consumer: string,
): ApplicationActorInvocationBoundary {
  const hosts = graph.nodes.filter(
    (node): node is ApplicationProviderNode<'ApplicationHost'> =>
      node.kind === 'provider' && node.interface === 'ApplicationHost',
  );
  if (hosts.length !== 1) {
    throw new Error(
      `${consumer} calls actors but the application resolves ${hosts.length} ApplicationHost providers; exactly one authenticated application boundary is required.`,
    );
  }
  const host = hosts[0]!;
  const config = host.config?.host;
  const record = config && typeof config === 'object' && !Array.isArray(config)
    ? config as Readonly<Record<string, unknown>>
    : {};
  const hostNamespace = applicationGraphStringValue(record.namespace) || namespace;
  if (hostNamespace !== namespace) {
    throw new Error(
      `${consumer} actor invocation host is in ${hostNamespace}, but its managed runtime is in ${namespace}. Cross-namespace internal actor invocation is intentionally unsupported.`,
    );
  }
  const configuredName = applicationGraphStringValue(record.name);
  const name = kubernetesName(configuredName || `${graph.metadata.name}-app`);
  const port = typeof record.port === 'number'
    && Number.isInteger(record.port)
    && record.port > 0
    && record.port <= 65_535
    ? record.port
    : 3_000;
  return { host, endpoint: `http://${name}.${namespace}.svc:${port}` };
}

/** Generated runtime helper shared by agents and reactive processors. */
export function generatedApplicationActorInvocationClientSource(): string {
  return `async function invokeApplicationActorBinding(binding, key, input, options, authority, signal, telemetry) {
  const endpoint = requiredEnv('APPLIK8S_ACTOR_APPLICATION_ENDPOINT').replace(/\\/+$/u, '') + '/__applik8s/v1/internal/actors/invoke';
  const invocation = options && typeof options === 'object' ? options : {};
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + requiredEnv('APPLIK8S_INTERNAL_OPERATION_SECRET'),
    },
    body: JSON.stringify({
      actor: binding.actor,
      member: binding.member,
      memberKind: binding.memberKind,
      key,
      input,
      idempotencyKey: invocation.idempotencyKey ?? authority.idempotencyKey,
      ...(invocation.scheduledAt ? { scheduledAt: invocation.scheduledAt } : {}),
      authority: authority.envelope,
      ...(telemetry ? { telemetry } : {}),
    }),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Actor ' + binding.actor + '.' + binding.member + ' failed with HTTP ' + response.status + ': ' + JSON.stringify(body));
  return binding.memberKind === 'command' ? body.result : body.receipt;
}`;
}

function kubernetesName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!normalized) return 'application';
  return normalized.length <= 63 ? normalized : normalized.slice(0, 63).replace(/-+$/gu, '');
}
// typecast-file-boundary: Actor invocation lowering inspects compiler-validated callable operations and preserves their literal runtime contract identity.
