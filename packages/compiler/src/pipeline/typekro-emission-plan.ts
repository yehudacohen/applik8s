import { createHash } from 'node:crypto';
import type { JsonObject } from '@applik8s/core';

export interface TypeKroEmissionResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & { readonly name: string; readonly namespace?: string };
}

export interface TypeKroEmissionPlanInput {
  readonly factory: readonly TypeKroEmissionResource[];
  readonly composition: readonly TypeKroEmissionResource[];
  readonly migrations: readonly TypeKroEmissionResource[];
  readonly processors: readonly TypeKroEmissionResource[];
  readonly workflows: readonly TypeKroEmissionResource[];
  readonly reactive: readonly TypeKroEmissionResource[];
  readonly mcp: readonly TypeKroEmissionResource[];
  readonly agents: readonly TypeKroEmissionResource[];
  readonly http: readonly TypeKroEmissionResource[];
}

export interface TypeKroEmissionPlan {
  readonly apiVersion: 'applik8s.compiler.typekro-plan/v1alpha1';
  readonly resources: readonly TypeKroEmissionResource[];
  readonly sources: {
    readonly factory: number;
    readonly composition: number;
    readonly migrations: number;
    readonly processors: number;
    readonly workflows: number;
    readonly reactive: number;
    readonly mcp: number;
    readonly agents: number;
    readonly http: number;
  };
}

/** Creates the deterministic lowering IR before any files or cluster-facing YAML are emitted. */
export function planTypeKroEmission(input: TypeKroEmissionPlanInput): TypeKroEmissionPlan {
  const ordered = [...input.factory, ...input.composition, ...input.migrations, ...input.processors, ...input.workflows, ...input.reactive, ...input.mcp, ...input.agents, ...input.http];
  const seen = new Set<string>();
  const resources: TypeKroEmissionResource[] = [];
  for (const [index, resource] of ordered.entries()) {
    const key = typeKroResourceFingerprint(resource) ?? `${index}\u0000${resource.apiVersion}\u0000${resource.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push(resource);
  }
  return {
    apiVersion: 'applik8s.compiler.typekro-plan/v1alpha1',
    resources,
    sources: {
      factory: input.factory.length,
      composition: input.composition.length,
      migrations: input.migrations.length,
      processors: input.processors.length,
      workflows: input.workflows.length,
      reactive: input.reactive.length,
      mcp: input.mcp.length,
      agents: input.agents.length,
      http: input.http.length,
    },
  };
}

export function typeKroResourceFingerprint(resource: Pick<TypeKroEmissionResource, 'apiVersion' | 'kind' | 'metadata'>): string | undefined {
  if (typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string' || !isJsonObject(resource.metadata) || typeof resource.metadata.name !== 'string') return undefined;
  const namespace = typeof resource.metadata.namespace === 'string' ? resource.metadata.namespace : '';
  return `${resource.apiVersion}\u0000${resource.kind}\u0000${namespace}\u0000${resource.metadata.name}`;
}

/** Produces a KRO node id that remains a valid Kubernetes label value. */
export function typeKroGeneratedResourceId(resource: Pick<TypeKroEmissionResource, 'kind' | 'metadata'>, index: number): string {
  const raw = `applik8sGenerated${safeResourceIdentifier(resource.kind)}${safeResourceIdentifier(resource.metadata.name)}${index + 1}`;
  if (raw.length <= 63) return raw;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  return `${raw.slice(0, 53)}${digest}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeResourceIdentifier(value: string): string {
  const identifier = value.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next: string | undefined) => next?.toUpperCase() ?? '');
  return identifier.length > 0 ? `${identifier[0]?.toUpperCase()}${identifier.slice(1)}` : 'Resource';
}
