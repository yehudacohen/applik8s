import type { DeleteTargetOptions, JsonObject, ObjectRef, PartialStatus, PermissionRule, Result } from '@applik8s/core';
import type {
  TypeKroGraph,
  TypeKroGraphAdapter,
  TypeKroGraphAdapterOptions,
  TypeKroOperationTarget,
  TypeKroOperationTargetSource,
  TypeKroOperationTargetSpec,
} from './interfaces.js';
import type { KroCompatibleType } from 'typekro';

interface KubernetesLikeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: { readonly name: string; readonly namespace?: string; readonly annotations?: Readonly<Record<string, string>> };
  readonly id?: string;
  readonly [key: string]: unknown;
}

interface TypeKroResourcePlanEntry {
  readonly id: string;
  readonly resource: KubernetesLikeResource;
}

interface TypeKroDependencyGraphLike {
  getTopologicalOrder(): string[];
  getDependencies(id: string): string[];
}

export const graphAdapter = createGraphAdapter;
export const operationTarget = toOperationTarget;
export const targetFactory = asOperationTargetFactory;

export function createGraphAdapter<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
): TypeKroGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus> {
  return {
    render(graph, _spec) {
      const operations = resourcePlanEntriesForSource(graph).map(({ resource }) => ({
        // typecast: operation-plan discriminants must stay literal for the runtime contract union.
        kind: 'apply' as const,
        resource,
        ...(options?.fieldManager ? { fieldManager: options.fieldManager } : {}),
      }));
      return ok({ operations });
    },
    inferRbac(graph) {
      return ok(rbacForResources(resourcePlanEntriesForSource(graph).map((entry) => entry.resource)));
    },
    renderStatus(_graph, _spec) {
      if (options?.statusMapper) {
        // typecast: graph-like fixtures and nested TypeKro resources may expose a status projection; absent live state remains an empty partial status.
        return ok(options.statusMapper(statusProjectionForSource(_graph) as PartialStatus<TGraphStatus>));
      }
      // typecast: no mapper means no status projection is requested, so the partial handler status is empty.
      return ok({} as PartialStatus<THandlerStatus>);
    },
  };
}

export function toOperationTarget<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>,
  spec: TypeKroOperationTargetSpec<TGraphSpec>,
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
): TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus> {
  const adapter = createGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus>(options);
  const graph = sourceAsGraph(source);
  const applyResources = resourcePlanEntriesForSource(graph).map((entry) => entry.resource);
  const deleteRefs = deletionPlanEntriesForSource(graph).map((entry) => objectRefForResource(entry.resource));
  // typecast: the object implements the OperationTarget contract plus TypeKro-specific source/spec fields.
  return {
    targetKind: 'operationTarget',
    __applik8sApplyResources: applyResources,
    __applik8sDeleteRefs: deleteRefs,
    adapter: {
      renderApply(target, renderOptions) {
        // typecast: TypeKro operation targets store the original spec with the same generic TGraphSpec accepted by this adapter.
        const rendered = adapter.render(sourceAsGraph(target.source), target.spec as TGraphSpec);
        if (!rendered.ok) {
          return rendered;
        }
        const operations = rendered.value.operations.map((entry) => entry.kind === 'apply' && renderOptions
          ? {
              ...entry,
              ...(renderOptions.fieldManager ? { fieldManager: renderOptions.fieldManager } : {}),
              ...(renderOptions.force === undefined ? {} : { force: renderOptions.force }),
              ...(renderOptions.ownership
                ? { ownership: renderOptions.ownership }
                : renderOptions.owner
                  // typecast: the owner shorthand maps to the literal operation-plan ownership discriminant.
                  ? { ownership: { mode: 'reference' as const, ref: renderOptions.owner } }
                  : {}),
            }
          : entry);
        return ok({ operations });
      },
      renderDelete(target, renderOptions) {
        return ok({
          operations: deletionPlanEntriesForSource(target.source).map(({ resource }) => ({
            // typecast: operation-plan discriminants must stay literal for the runtime contract union.
            kind: 'delete' as const,
            ref: objectRefForResource(resource),
            ...deleteOperationOptions(renderOptions),
          })),
        });
      },
      inferRbac(target) {
        return adapter.inferRbac(sourceAsGraph(target.source));
      },
    },
    source,
    spec,
  } as TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>;
}

export function asOperationTargetFactory<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  graph: TypeKroGraph<TGraphSpec, TGraphStatus>,
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
) {
  return (spec: TypeKroOperationTargetSpec<TGraphSpec>) => toOperationTarget(graph, spec, options);
}

function sourceAsGraph<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>): TypeKroGraph<TGraphSpec, TGraphStatus> {
  if ('__resources' in source) {
    // typecast: nested TypeKro composition resources expose __resources, which is sufficient for operation-plan rendering without requiring deployment factory methods.
    return { name: source.__compositionId, resources: source.__resources } as TypeKroGraph<TGraphSpec, TGraphStatus>;
  }
  return source;
}

function resourcePlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  if (!source || typeof source !== 'object') {
    throw new Error('TypeKro source must be an object with resources.');
  }
  const resources = '__resources' in source ? source.__resources : 'resources' in source ? source.resources : undefined;
  if (!Array.isArray(resources)) {
    throw new Error('TypeKro source must expose resources or __resources.');
  }
  return resources.map(resourcePlanEntry);
}

function statusProjectionForSource(source: unknown): JsonObject {
  if (!isRecord(source)) {
    return {};
  }
  const status = source.status;
  return isJsonObject(status) ? compactObject(status) : {};
}

function deletionPlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  const entries = resourcePlanEntriesForSource(source);
  const graph = dependencyGraphForSource(source);
  if (!graph) {
    return [...entries].reverse();
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const orderedIds = reverseTopologicalOrder(graph, entries.map((entry) => entry.id));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((entry): entry is TypeKroResourcePlanEntry => Boolean(entry));
  return ordered.length === entries.length ? ordered : [...entries].reverse();
}

function dependencyGraphForSource(source: unknown): TypeKroDependencyGraphLike | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const dependencyGraph = source.dependencyGraph;
  return isDependencyGraphLike(dependencyGraph) ? dependencyGraph : undefined;
}

function reverseTopologicalOrder(graph: TypeKroDependencyGraphLike, ids: readonly string[]): readonly string[] {
  const order = graph.getTopologicalOrder().filter((id) => ids.includes(id));
  if (order.length !== ids.length) {
    return [...ids].reverse();
  }
  return [...order].reverse();
}

function resourcePlanEntry(input: unknown, index: number): TypeKroResourcePlanEntry {
  const source = isRecord(input) && isRecord(input.manifest) ? input.manifest : input;
  const resource = resourceToKubernetesObject(source);
  return { id: resourceIdForEntry(input, resource, index), resource };
}

function resourceToKubernetesObject(resource: unknown): KubernetesLikeResource {
  const json = typeof resource === 'object' && resource !== null && 'toJSON' in resource && typeof resource.toJSON === 'function'
    ? resource.toJSON()
    // typecast: JSON serialization erases TypeKro proxy wrappers into plain Kubernetes manifest data for operation-plan emission.
    : JSON.parse(JSON.stringify(resource)) as unknown;
  if (!isKubernetesLikeResource(json)) {
    throw new Error('TypeKro resource did not serialize to a Kubernetes object with apiVersion, kind, and metadata.name.');
  }
  const { id: _id, ...withoutId } = json;
  return withoutId;
}

function resourceIdForEntry(input: unknown, resource: KubernetesLikeResource, index: number): string {
  if (isRecord(input) && typeof input.id === 'string' && input.id.length > 0) {
    return input.id;
  }
  if (typeof resource.id === 'string' && resource.id.length > 0) {
    return resource.id;
  }
  const annotated = resource.metadata.annotations?.['typekro.io/resource-id'];
  if (typeof annotated === 'string' && annotated.length > 0) {
    return annotated;
  }
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace ?? '_'}/${resource.metadata.name}/${index}`;
}

function deleteOperationOptions(options: DeleteTargetOptions | undefined): object {
  if (!options?.propagationPolicy && options?.gracePeriodSeconds === undefined) {
    return {};
  }
  return { options: compactObject({ propagationPolicy: options.propagationPolicy, gracePeriodSeconds: options.gracePeriodSeconds }) };
}

function objectRefForResource(resource: KubernetesLikeResource): ObjectRef {
  return { apiVersion: resource.apiVersion, kind: resource.kind, name: resource.metadata.name, ...(resource.metadata.namespace ? { namespace: resource.metadata.namespace } : {}) };
}

function rbacForResources(resources: readonly KubernetesLikeResource[]): readonly PermissionRule[] {
  const rules = new Map<string, PermissionRule>();
  for (const resource of resources) {
    const apiGroup = resource.apiVersion.includes('/') ? resource.apiVersion.split('/')[0] ?? '' : '';
    const key = `${apiGroup}/${resource.kind}`;
    if (!rules.has(key)) {
      rules.set(key, { apiGroups: [apiGroup], resources: [pluralize(resource.kind)], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
    }
  }
  return [...rules.values()];
}

function pluralize(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('s')) {
    return `${lower}es`;
  }
  if (lower.endsWith('y')) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

function compactObject<T extends Record<string, unknown>>(value: T): JsonObject {
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      compacted[key] = entry;
    }
  }
  // typecast: removing undefined fields preserves JSON object contents for Kubernetes manifest emission.
  return compacted as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDependencyGraphLike(value: unknown): value is TypeKroDependencyGraphLike {
  return Boolean(value && typeof value === 'object' && 'getTopologicalOrder' in value && typeof value.getTopologicalOrder === 'function' && 'getDependencies' in value && typeof value.getDependencies === 'function');
}

function isKubernetesLikeResource(value: unknown): value is KubernetesLikeResource {
  return Boolean(value && typeof value === 'object' && 'apiVersion' in value && typeof value.apiVersion === 'string' && 'kind' in value && typeof value.kind === 'string' && 'metadata' in value && value.metadata && typeof value.metadata === 'object' && 'name' in value.metadata && typeof value.metadata.name === 'string');
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
