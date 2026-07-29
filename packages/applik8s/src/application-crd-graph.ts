// typecast-file-boundary: Graph lowering erases heterogeneous model generics after discriminant and schema validation.
import type { AnyResourceDefinition } from '@applik8s/core';
import { addApplicationGraphNode, type ApplicationGraphState } from './application-graph-state.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import { serializeApplicationCallback } from './application-callback.js';
import {
  getApplicationModelFacet,
  type KubernetesApplicationModelFacet,
} from './native-models.js';

/** Records the provider-neutral graph contract for a Kubernetes-backed application model. */
export function recordApplicationCrdGraph(
  state: ApplicationGraphState,
  name: string,
  resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'> & Partial<AnyResourceDefinition>,
): void {
  const model = getApplicationModelFacet<object, string, never, never>(resource);
  const kubernetesModel = model?.native === 'kubernetes-resource'
    ? model as KubernetesApplicationModelFacet<object>
    : undefined;
  const create = kubernetesModel?.create;
  const createSchema = create ? resource.spec?.emitJsonSchema() : undefined;
  if (createSchema && !createSchema.ok) {
    throw new Error(`Kubernetes model ${name} create input schema could not be emitted: ${createSchema.error.message}`);
  }
  const createAuthorization = create
    ? serializeApplicationCallback({ registrar: 'crd', argumentIndex: 1, property: 'authorize', label: `Kubernetes model ${name} create authorization`, callback: create.authorize as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  const createPlacement = create
    ? serializeApplicationCallback({ registrar: 'crd', argumentIndex: 1, property: 'place', label: `Kubernetes model ${name} create placement`, callback: create.place as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  addApplicationGraphNode(state, {
    id: `crd.${kubernetesNameSegment(name)}`,
    kind: 'crd',
    name,
    stability: 'stable',
    materialization: 'kubernetes-crd',
    resource: { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope },
    ...(model?.native === 'kubernetes-resource' ? {
      native: {
        kind: 'kubernetes-resource' as const,
        authority: 'kubernetes' as const,
        artifact: { name: `${resource.apiVersion}/${resource.kind}` },
        schemaAuthority: 'arktype' as const,
        runtimeSchema: 'declared-arktype' as const,
        nativeApi: 'preserved' as const,
      },
      common: {
        identity: model.identity,
        ...(model.revision ? { revision: model.revision } : {}),
        snapshot: { shape: 'identity-value-revision' as const, revisionOptional: true as const },
        changes: { authority: 'kubernetes-watch' as const, rawWrites: 'observed' as const },
        relationships: model.relationships,
        operations: [{
          name: 'create',
          operation: 'create' as const,
          transport: 'command' as const,
          publicId: `${model.name}.create`,
          ...(createSchema?.ok ? { input: { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: createSchema.value.schema } } : {}),
          authorization: create ? 'application-defined' as const : 'undeclared' as const,
        }],
        ...(model.access ? { access: { context: model.access.context, enforcement: 'kubernetes-namespace-label' as const, providerField: model.access.namespaceLabel } } : {}),
      },
      ...(create && createSchema?.ok && createAuthorization && createPlacement ? {
        create: {
          kind: 'kubernetes-create' as const,
          input: { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: createSchema.value.schema },
          authorize: serializedApplicationGraphCallback(createAuthorization),
          place: serializedApplicationGraphCallback(createPlacement),
        },
      } : {}),
    } : {}),
  });
}

function serializedApplicationGraphCallback(callback: ReturnType<typeof serializeApplicationCallback>) {
  return {
    source: callback.source,
    ...(callback.dependencies ? { dependencies: callback.dependencies } : {}),
    ...(callback.location ? { location: callback.location } : {}),
    ...(callback.unresolved ? { unresolved: callback.unresolved } : {}),
  };
}
