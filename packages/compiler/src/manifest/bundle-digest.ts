import { createHash } from 'node:crypto';

import type { BundleArtifact, HandlerExport, OwnedCrd, RuntimePayloadSchemaDigests } from '@applik8s/core';

export interface BundleDigestInput {
  readonly compilerVersion: string;
  readonly handlerAbi: string;
  readonly operatorName: string;
  readonly artifacts: readonly BundleArtifact[];
  readonly handlerExports: readonly HandlerExport[];
  readonly ownedCrds: readonly OwnedCrd[];
  readonly payloadSchemaDigests: RuntimePayloadSchemaDigests;
}

export function computeBundleDigest(input: BundleDigestInput): string {
  return digestJson({
    compilerVersion: input.compilerVersion,
    handlerAbi: input.handlerAbi,
    operatorName: input.operatorName,
    artifacts: canonicalBundleArtifacts(input.artifacts),
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
