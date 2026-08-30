import type { JsonObject } from '@applik8s/core';
import { parseAllDocuments } from 'yaml';

import type { TypeKroCompositionResource } from './typekro-artifact-contracts.js';
import { typeKroResourceFingerprint } from './typekro-emission-plan.js';
import { safePathSegment } from './utilities.js';

export function uniqueTypeKroResources(
  resources: readonly TypeKroCompositionResource[],
): readonly TypeKroCompositionResource[] {
  const uniqueResources = new Map<string, TypeKroCompositionResource>();
  for (const [index, resource] of resources.entries()) {
    uniqueResources.set(
      typeKroResourceFingerprint(resource)
        ?? `${index}:${resource.apiVersion}:${resource.kind}`,
      resource,
    );
  }
  return [...uniqueResources.values()];
}

export function parseTypeKroYamlResources(
  source: unknown,
): readonly TypeKroCompositionResource[] {
  if (typeof source !== 'string' || source.trim().length === 0) return [];
  return parseAllDocuments(source)
    .map((document) => document.toJSON())
    .filter((value): value is object => Boolean(
      value && typeof value === 'object' && !Array.isArray(value),
    ))
    .map((resource, index) => serializeCompositionResource(resource, index));
}

export function serializeCompositionResource(
  resource: unknown,
  index: number,
): TypeKroCompositionResource {
  if (!resource || typeof resource !== 'object') {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not an object.`);
  }
  const sourceMetadata = Reflect.get(resource, 'metadata');
  const sourceName = sourceMetadata && (typeof sourceMetadata === 'object' || typeof sourceMetadata === 'function')
    ? serializeTypeKroReference('name', Reflect.get(sourceMetadata, 'name'))
    : undefined;
  const sourceNamespace = sourceMetadata && (typeof sourceMetadata === 'object' || typeof sourceMetadata === 'function')
    ? serializeTypeKroReference('namespace', Reflect.get(sourceMetadata, 'namespace'))
    : undefined;
  const nestedReferences = collectTypeKroReferencePaths(resource);
  // typecast: JSON.parse returns unknown and is narrowed before use.
  const serialized = JSON.parse(
    JSON.stringify(resource, serializeTypeKroReference),
  ) as unknown;
  if (!isJsonObject(serialized)) {
    throw new Error(`Resolved TypeKro resource ${index + 1} is not JSON-serializable as an object.`);
  }
  for (const reference of nestedReferences) {
    setSerializedPath(serialized, reference.path, reference.value);
  }
  const serializedMetadata = isJsonObject(serialized.metadata)
    ? serialized.metadata
    : {};
  const normalized = normalizeKubernetesTopLevelLists({
    ...serialized,
    metadata: {
      ...serializedMetadata,
      ...(typeof serializedMetadata.name === 'string'
        ? {}
        : typeof sourceName === 'string' ? { name: sourceName } : {}),
      ...(typeof serializedMetadata.namespace === 'string'
        ? {}
        : typeof sourceNamespace === 'string'
          ? { namespace: sourceNamespace }
          : {}),
    },
  });
  if (!isTypeKroCompositionResource(normalized)) {
    const resourceNumber = index + 1;
    if (typeof normalized.apiVersion !== 'string') {
      throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing apiVersion.`);
    }
    if (typeof normalized.kind !== 'string') {
      throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing kind.`);
    }
    throw new Error(`Resolved TypeKro resource ${resourceNumber} is missing metadata.name.`);
  }
  return normalized;
}

function serializeTypeKroReference(_key: string, value: unknown): unknown {
  if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
    if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
      const resourceId = Reflect.get(value, 'resourceId');
      const fieldPath = Reflect.get(value, 'fieldPath');
      if (resourceId === '__schema__' && nonEmptyString(fieldPath)) {
        return `\${schema.${fieldPath}}`;
      }
      if (nonEmptyString(resourceId) && nonEmptyString(fieldPath)) {
        return `\${${resourceId}.${fieldPath}}`;
      }
    }
    if (Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true) {
      const expression = Reflect.get(value, 'expression');
      if (nonEmptyString(expression)) return `\${${expression}}`;
    }
  }
  return value;
}

interface TypeKroReferencePath {
  readonly path: readonly string[];
  readonly value: string;
}

function collectTypeKroReferencePaths(value: unknown): readonly TypeKroReferencePath[] {
  const references: TypeKroReferencePath[] = [];
  const ancestors = new WeakSet<object>();
  const visit = (entry: unknown, path: readonly string[]): void => {
    if (!entry || (typeof entry !== 'object' && typeof entry !== 'function')) return;
    const serialized = serializeTypeKroReference('', entry);
    if (typeof serialized === 'string') {
      references.push({ path, value: serialized });
      return;
    }
    if (ancestors.has(entry)) return;
    ancestors.add(entry);
    try {
      for (const key of Object.keys(entry)) {
        visit(Reflect.get(entry, key), [...path, key]);
      }
    } finally {
      ancestors.delete(entry);
    }
  };
  visit(value, []);
  return references;
}

function setSerializedPath(
  root: JsonObject,
  path: readonly string[],
  value: string,
): void {
  if (path.length === 0) return;
  let parent: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') return;
    parent = Reflect.get(parent, segment);
  }
  const leaf = path.at(-1);
  if (!leaf || !parent || typeof parent !== 'object') return;
  Reflect.set(parent, leaf, value);
}

const kubernetesTopLevelListFields: Readonly<Record<string, readonly string[]>> = {
  'rbac.authorization.k8s.io/v1|ClusterRole': ['rules'],
  'rbac.authorization.k8s.io/v1|ClusterRoleBinding': ['subjects'],
  'rbac.authorization.k8s.io/v1|Role': ['rules'],
  'rbac.authorization.k8s.io/v1|RoleBinding': ['subjects'],
};

function normalizeKubernetesTopLevelLists(resource: JsonObject): JsonObject {
  const apiVersion = typeof resource.apiVersion === 'string' ? resource.apiVersion : undefined;
  const kind = typeof resource.kind === 'string' ? resource.kind : undefined;
  const listFields = apiVersion && kind
    ? kubernetesTopLevelListFields[`${apiVersion}|${kind}`]
    : undefined;
  if (!listFields) return resource;
  let normalized: Record<string, unknown> | undefined;
  for (const field of listFields) {
    const list = numericKeyedObjectToArray(resource[field]);
    if (!list) continue;
    normalized ??= { ...resource };
    normalized[field] = list;
  }
  // typecast: input is JSON; only known Kubernetes list fields are restored.
  return (normalized ?? resource) as JsonObject;
}

function numericKeyedObjectToArray(value: unknown): unknown[] | undefined {
  if (!isJsonObject(value)) return undefined;
  const indexed: { readonly index: number; readonly entry: unknown }[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
    indexed.push({ index: Number(key), entry });
  }
  indexed.sort((left, right) => left.index - right.index);
  if (indexed.some((entry, expectedIndex) => entry.index !== expectedIndex)) {
    return undefined;
  }
  return indexed.map((entry) => entry.entry);
}

export function isTypeKroCompositionResource(
  value: unknown,
): value is TypeKroCompositionResource {
  return Boolean(
    isJsonObject(value)
      && typeof value.apiVersion === 'string'
      && typeof value.kind === 'string'
      && isJsonObject(value.metadata)
      && typeof value.metadata.name === 'string',
  );
}

export function isTypeKroExternalReferenceResource(
  resource: TypeKroCompositionResource,
): boolean {
  return Reflect.get(resource, '__externalRef') === true;
}

export function compositionResourceFileName(
  resource: TypeKroCompositionResource,
  index: number,
): string {
  const namespace = typeof resource.metadata.namespace === 'string'
    ? `${resource.metadata.namespace}-`
    : '';
  const name = typeof resource.metadata.name === 'string'
    ? resource.metadata.name
    : `resource-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${safePathSegment(resource.kind.toLowerCase())}-${safePathSegment(`${namespace}${name}`.toLowerCase())}`;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
