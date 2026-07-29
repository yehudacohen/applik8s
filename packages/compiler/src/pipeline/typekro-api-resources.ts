import type { JsonObject } from '@applik8s/core';
import type { TypeKroEmissionResource } from './typekro-emission-plan.js';

/** Returns the generated API identities that must be discoverable before instances are applied. */
export function typeKroSchemaApiResources(resources: readonly TypeKroEmissionResource[]): readonly { readonly group: string; readonly kind: string }[] {
  const apiResources = resources.filter((resource) => resource.kind === 'ResourceGraphDefinition').flatMap((resource) => {
    const spec = isJsonObject(resource.spec) ? resource.spec : undefined;
    const schema = isJsonObject(spec?.schema) ? spec.schema : undefined;
    const kind = typeof schema?.kind === 'string' ? schema.kind : undefined;
    const apiVersion = typeof schema?.apiVersion === 'string' ? schema.apiVersion : undefined;
    const group = typeof schema?.group === 'string' && schema.group.length > 0
      ? schema.group
      : apiVersion?.includes('/')
        ? apiVersion.split('/')[0]
        : 'kro.run';
    return kind && group ? [{ group, kind }] : [];
  });
  const seen = new Set<string>();
  return apiResources.filter((resource) => {
    const key = `${resource.group}/${resource.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
