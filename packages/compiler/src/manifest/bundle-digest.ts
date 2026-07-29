import { createHash } from 'node:crypto';

import type { BundleArtifact, HandlerExport, OwnedCrd, ReadResource, RuntimePayloadSchemaDigests } from '@applik8s/core';

export interface BundleDigestInput {
  readonly compilerVersion: string;
  readonly handlerAbi: string;
  readonly operatorName: string;
  readonly artifacts: readonly BundleArtifact[];
  readonly handlerExports: readonly HandlerExport[];
  readonly ownedCrds: readonly OwnedCrd[];
  readonly readResources?: readonly ReadResource[];
  readonly payloadSchemaDigests: RuntimePayloadSchemaDigests;
}

export function computeBundleDigest(input: BundleDigestInput): string {
  return computeDigest(input, canonicalBundleArtifacts(input.artifacts));
}

/**
 * Computes the stable execution identity of an operator from semantic inputs.
 *
 * ComponentizeJS/Wizer snapshots currently contain nondeterministic engine
 * state, so byte-identical JavaScript and WIT inputs can produce different
 * WASM bytes. The exact bundle digest still inventories those bytes for
 * verification; deployment identity deliberately excludes backend products
 * and debug-only artifacts so equivalent builds do not trigger image rebuilds
 * or Kubernetes rollouts.
 */
export function computeBundleBuildIdentityDigest(input: BundleDigestInput): string {
  const canonical = canonicalBundleArtifacts(input.artifacts);
  const hasJavaScriptSource = canonical.some((artifact) => artifact.kind === 'javascript-bundle');
  const semanticArtifacts = canonical.filter((artifact) =>
    artifact.kind === 'javascript-bundle'
    || artifact.kind === 'handler-wit'
    || artifact.kind === 'runtime-contract'
    || (!hasJavaScriptSource && artifact.kind === 'wasm-component'));
  return computeDigest(input, semanticArtifacts);
}

function computeDigest(input: BundleDigestInput, artifacts: readonly BundleArtifact[]): string {
  return digestJson({
    compilerVersion: input.compilerVersion,
    handlerAbi: input.handlerAbi,
    operatorName: input.operatorName,
    artifacts,
    handlerExports: input.handlerExports.map((handler) => ({
      event: handler.event,
      exportName: handler.exportName,
      handlerId: handler.handlerId,
      resource: handler.resource,
    })),
    ownedCrds: input.ownedCrds.map((crd) => ({
      apiVersion: crd.apiVersion,
      kind: crd.kind,
      plural: crd.plural,
      scope: crd.scope,
      conversionStrategy: crd.conversionStrategy,
      storageVersion: crd.storageVersion,
      versioning: crd.versioning,
      versions: crd.versions,
    })),
    readResources: [...(input.readResources ?? [])].sort((left, right) => `${left.apiVersion}/${left.kind}`.localeCompare(`${right.apiVersion}/${right.kind}`)),
    payloadSchemaDigests: input.payloadSchemaDigests,
  });
}

export function canonicalBundleArtifacts(artifacts: readonly BundleArtifact[]): readonly BundleArtifact[] {
  return [...artifacts].sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    return left.kind.localeCompare(right.kind);
  });
}

function digestJson(value: unknown): string {
  return digestText(stableJson(value));
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}
