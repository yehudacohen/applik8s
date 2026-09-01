// typecast-file-boundary: Compiler-owned provider configuration is validated
// structurally before it is lowered into a non-secret credential reference.
import { createHash } from 'node:crypto';
import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';

export interface ApplicationStructuredGenerationEnvironmentCredential {
  readonly reference: string;
  readonly required: boolean;
  readonly secretName: string;
  readonly secretKey: 'apiKey';
}

/**
 * Lower a provider-neutral environment credential to one stable Kubernetes
 * Secret identity. Only the environment variable name enters portable state;
 * the operation host resolves its value when it materializes the Secret.
 */
export function applicationStructuredGenerationEnvironmentCredential(
  provider: Pick<ApplicationProviderNode, 'id' | 'config'>,
): ApplicationStructuredGenerationEnvironmentCredential | undefined {
  const credential = record(provider.config?.credential);
  if (Object.keys(credential).length === 0) return undefined;
  if (
    credential.apiVersion !== 'applik8s.configurationBinding/v1alpha1'
    || credential.kind !== 'secret'
    || credential.source !== 'environment'
    || typeof credential.reference !== 'string'
    || !credential.reference.trim()
  ) {
    throw new Error(
      `StructuredGeneration provider ${provider.id} has an unsupported credential binding. Kubernetes deployment accepts only secret.env(...).`,
    );
  }
  return {
    reference: credential.reference,
    required: credential.required !== false,
    // The source binding, not a logical provider alias, owns the credential.
    // Default and qualified views of one implementation must therefore
    // resolve to the same Secret even when a compiler stage sees only one of
    // those views.
    secretName: `applik8s-structured-generation-${createHash('sha256').update(`StructuredGeneration\0${credential.reference}`).digest('hex').slice(0, 12)}`,
    secretKey: 'apiKey',
  };
}

/** Resolve logical aliases to the single provider that owns credential state. */
export function applicationStructuredGenerationAuthorityId(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode,
): string {
  const providers = new Map(graph.nodes.flatMap((node) =>
    node.kind === 'provider' ? [[node.id, node] as const] : []));
  const visited = new Set<string>();
  let current = provider;
  while (true) {
    if (visited.has(current.id)) {
      throw new Error(`StructuredGeneration provider alias cycle includes ${current.id}.`);
    }
    visited.add(current.id);
    const aliasOf = typeof current.config?.aliasOf === 'string'
      ? current.config.aliasOf.trim()
      : '';
    if (!aliasOf) return current.id;
    const target = providers.get(aliasOf);
    if (!target || target.interface !== provider.interface) {
      throw new Error(
        `StructuredGeneration provider ${current.id} aliases missing or incompatible provider ${aliasOf}.`,
      );
    }
    current = target;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}
