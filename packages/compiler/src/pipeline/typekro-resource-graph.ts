import type { JsonObject } from '@applik8s/core';

import type { TypeKroCompositionResource } from './typekro-artifact-contracts.js';
import { typeKroResourceFingerprint } from './typekro-emission-plan.js';
import {
  isJsonObject,
  isTypeKroCompositionResource,
} from './typekro-resource-serialization.js';
import { unique } from './utilities.js';

export function typeKroTemplateResourceFingerprints(
  resources: readonly TypeKroCompositionResource[],
): ReadonlySet<string> {
  const fingerprints = new Set<string>();
  for (const rgd of typeKroResourceGraphDefinitions(resources)) {
    for (const resource of typeKroResourceGraphObservedResources(rgd)) {
      const fingerprint = typeKroResourceFingerprint(resource);
      if (fingerprint) fingerprints.add(fingerprint);
    }
  }
  return fingerprints;
}

export function typeKroInstanceResources(
  resources: readonly TypeKroCompositionResource[],
): readonly TypeKroCompositionResource[] {
  return typeKroResourceGraphDefinitions(resources).map((rgd) => {
    const schema = typeKroResourceGraphSchema(rgd);
    const kind = typeof schema?.kind === 'string' ? schema.kind : undefined;
    const schemaApiVersion = typeof schema?.apiVersion === 'string'
      ? schema.apiVersion
      : undefined;
    if (!kind || !schemaApiVersion) {
      throw new Error(`ResourceGraphDefinition ${rgd.metadata.name} is missing spec.schema.kind or spec.schema.apiVersion.`);
    }
    const version = schemaApiVersion.includes('/')
      ? schemaApiVersion.split('/').at(-1)
      : schemaApiVersion;
    const group = typeof schema?.group === 'string' && schema.group.length > 0
      ? schema.group
      : 'kro.run';
    const namespaces = unique(typeKroResourceGraphTemplates(rgd)
      .map((template) => template.metadata.namespace)
      .filter((value): value is string => typeof value === 'string'));
    return {
      apiVersion: `${group}/${version}`,
      kind,
      metadata: {
        name: rgd.metadata.name,
        ...(namespaces.length === 1 ? { namespace: namespaces[0] } : {}),
      },
      spec: {},
    };
  });
}

export function typeKroConditionalPrerequisiteInstance(
  instance: TypeKroCompositionResource,
  resources: readonly TypeKroCompositionResource[],
): TypeKroCompositionResource {
  const conditions = new Set<string>();
  for (const rgd of typeKroResourceGraphDefinitions(resources)) {
    const spec = isJsonObject(rgd.spec) ? rgd.spec : undefined;
    if (!spec || !Array.isArray(spec.resources)) continue;
    for (const entry of spec.resources) {
      if (!isJsonObject(entry)
        || !isJsonObject(entry.externalRef)
        || !isJsonObject(entry.externalRef.metadata)
        || !Array.isArray(entry.includeWhen)) continue;
      if (entry.externalRef.apiVersion !== instance.apiVersion
        || entry.externalRef.kind !== instance.kind
        || entry.externalRef.metadata.name !== instance.metadata.name
        || (entry.externalRef.metadata.namespace ?? '') !== (instance.metadata.namespace ?? '')) continue;
      for (const condition of entry.includeWhen) {
        if (typeof condition === 'string' && condition.trim()) conditions.add(condition);
      }
    }
  }
  if (conditions.size === 0) return instance;
  const annotations = isJsonObject(instance.metadata.annotations)
    ? instance.metadata.annotations
    : {};
  return {
    ...instance,
    metadata: {
      ...instance.metadata,
      annotations: {
        ...annotations,
        'applik8s.dev/include-when': JSON.stringify([...conditions]),
      },
    },
  };
}

export function isTypeKroTemplateResource(
  resource: TypeKroCompositionResource,
  templateFingerprints: ReadonlySet<string>,
): boolean {
  const fingerprint = typeKroResourceFingerprint(resource);
  return Boolean(fingerprint && templateFingerprints.has(fingerprint));
}

function typeKroResourceGraphDefinitions(
  resources: readonly TypeKroCompositionResource[],
): TypeKroCompositionResource[] {
  return resources.filter((resource) =>
    resource.apiVersion === 'kro.run/v1alpha1'
      && resource.kind === 'ResourceGraphDefinition');
}

function typeKroResourceGraphSchema(
  rgd: TypeKroCompositionResource,
): JsonObject | undefined {
  if (!isJsonObject(rgd.spec)) return undefined;
  return isJsonObject(rgd.spec.schema) ? rgd.spec.schema : undefined;
}

function typeKroResourceGraphTemplates(
  rgd: TypeKroCompositionResource,
): TypeKroCompositionResource[] {
  if (!isJsonObject(rgd.spec) || !Array.isArray(rgd.spec.resources)) return [];
  return rgd.spec.resources.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    return isTypeKroCompositionResource(entry.template) ? [entry.template] : [];
  });
}

function typeKroResourceGraphObservedResources(
  rgd: TypeKroCompositionResource,
): TypeKroCompositionResource[] {
  if (!isJsonObject(rgd.spec) || !Array.isArray(rgd.spec.resources)) return [];
  return rgd.spec.resources.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const resource = isTypeKroCompositionResource(entry.template)
      ? entry.template
      : isTypeKroCompositionResource(entry.externalRef)
        ? entry.externalRef
        : undefined;
    return resource ? [resource] : [];
  });
}
