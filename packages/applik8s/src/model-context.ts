import type { ResourceGetQuery, ResourceObject } from '@applik8s/core';
import type { InferSelectModel } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { getApplicationModelFacet, type ApplicationModelSnapshot, type PromotedDrizzleTable, type PromotedKubernetesResource } from './native-models.js';
import type { ApplicationAdmittedContext, ApplicationRelationalContext } from './relational-runtime.js';

export interface ApplicationKubernetesModelReader {
  get<TSpec extends object, TStatus extends object>(model: PromotedKubernetesResource<TSpec, TStatus>, query: ResourceGetQuery): Promise<ResourceObject<TSpec, TStatus> | undefined>;
  namespaceLabels(namespace: string): Promise<Readonly<Record<string, string>> | undefined>;
}

export type KubernetesModelIdentity = string | { readonly name: string; readonly namespace?: string };

export interface ApplicationModelContext {
  get<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, identity: unknown): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, unknown> | undefined>;
  get<TSpec extends object, TStatus extends object>(model: PromotedKubernetesResource<TSpec, TStatus>, identity: KubernetesModelIdentity): Promise<ApplicationModelSnapshot<TSpec> | undefined>;
  require<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, identity: unknown): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, unknown>>;
  require<TSpec extends object, TStatus extends object>(model: PromotedKubernetesResource<TSpec, TStatus>, identity: KubernetesModelIdentity): Promise<ApplicationModelSnapshot<TSpec>>;
}

export class ApplicationModelReferenceMissingError extends Error {
  readonly code = 'APPLIK8S_MODEL_REFERENCE_MISSING';
  constructor(readonly model: string, readonly identity: unknown) {
    super(`Required ${model} reference ${JSON.stringify(identity)} does not exist in the admitted provider context.`);
    this.name = 'ApplicationModelReferenceMissingError';
  }
}

export class ApplicationModelContextBoundaryError extends Error {
  readonly code = 'APPLIK8S_MODEL_CONTEXT_BOUNDARY';
  constructor(readonly model: string, message: string) {
    super(`Model ${model} trusted-context boundary rejected the read: ${message}`);
    this.name = 'ApplicationModelContextBoundaryError';
  }
}

// typecast-boundary: the provider discriminant narrows promoted models before dispatch through the generic provider-neutral context.
export function createApplicationModelContext(options: {
  readonly relational?: ApplicationRelationalContext;
  readonly kubernetes?: ApplicationKubernetesModelReader;
  readonly admittedContext: ApplicationAdmittedContext;
}): ApplicationModelContext {
  const get = async (model: PromotedDrizzleTable<AnyPgTable> | PromotedKubernetesResource<object, object>, identity: unknown): Promise<ApplicationModelSnapshot<unknown, unknown> | undefined> => {
    const facet = getApplicationModelFacet<object, unknown, object, object>(model);
    if (!facet) throw new Error('Application model context received an unpromoted model.');
    if (facet.provider === 'postgres') {
      if (!options.relational) throw new Error(`Model ${facet.name} requires a relational model reader in this runtime context.`);
      return options.relational.get(model as PromotedDrizzleTable<AnyPgTable>, identity);
    }
    if (!options.kubernetes) throw new Error(`Model ${facet.name} requires a Kubernetes model reader in this runtime context.`);
    const normalized = kubernetesIdentity(model as PromotedKubernetesResource<object, object>, identity);
    await enforceKubernetesContext(model as PromotedKubernetesResource<object, object>, normalized.namespace, options.kubernetes, options.admittedContext);
    const resource = await options.kubernetes.get(model as PromotedKubernetesResource<object, object>, normalized);
    if (!resource) return undefined;
    if (!resource.spec || resource.metadata.name !== normalized.name || (normalized.namespace && resource.metadata.namespace !== normalized.namespace)) throw new Error(`Kubernetes provider returned an invalid ${facet.name} resource for ${JSON.stringify(normalized)}.`);
    return {
      identity: normalized.name,
      value: resource.spec,
      ...(resource.metadata.resourceVersion ? { revision: resource.metadata.resourceVersion } : {}),
    };
  };
  return {
    get: get as ApplicationModelContext['get'],
    require: (async (model: PromotedDrizzleTable<AnyPgTable> | PromotedKubernetesResource<object, object>, identity: unknown) => {
      const snapshot = await get(model, identity);
      const facet = getApplicationModelFacet<object, unknown, object, object>(model);
      if (!facet) throw new Error('Application model context received an unpromoted model.');
      if (!snapshot) throw new ApplicationModelReferenceMissingError(facet.name, identity);
      return snapshot;
    }) as ApplicationModelContext['require'],
  };
}

function kubernetesIdentity(model: PromotedKubernetesResource<object, object>, identity: unknown): { readonly name: string; readonly namespace?: string } {
  const normalized = typeof identity === 'string' ? { name: identity } : identity;
  if (!normalized || typeof normalized !== 'object' || typeof Reflect.get(normalized, 'name') !== 'string' || !Reflect.get(normalized, 'name')) throw new Error(`Kubernetes model ${model.$model.name} requires a resource name identity.`);
  // typecast: the preceding runtime guard proves the reflected resource name is a non-empty string.
  const name = Reflect.get(normalized, 'name') as string;
  const namespace = Reflect.get(normalized, 'namespace');
  if (namespace !== undefined && (typeof namespace !== 'string' || !namespace)) throw new Error(`Kubernetes model ${model.$model.name} namespace identity must be a non-empty string.`);
  if (model.$model.resource.scope === 'Namespaced' && typeof namespace !== 'string') throw new Error(`Kubernetes model ${model.$model.name} requires { name, namespace } so provider context can be enforced without ambient namespace assumptions.`);
  if (model.$model.resource.scope === 'Cluster' && namespace !== undefined) throw new Error(`Cluster-scoped Kubernetes model ${model.$model.name} does not accept a namespace identity.`);
  return { name, ...(typeof namespace === 'string' ? { namespace } : {}) };
}

async function enforceKubernetesContext(model: PromotedKubernetesResource<object, object>, namespace: string | undefined, reader: ApplicationKubernetesModelReader, admitted: ApplicationAdmittedContext): Promise<void> {
  const access = model.$model.access;
  if (!access) return;
  if (!namespace) throw new ApplicationModelContextBoundaryError(model.$model.name, 'the model requires a concrete namespace');
  const expected = admitted.values[access.context];
  if (expected === undefined) throw new ApplicationModelContextBoundaryError(model.$model.name, `trusted context ${access.context} was not admitted`);
  const labels = await reader.namespaceLabels(namespace);
  if (!labels) throw new ApplicationModelContextBoundaryError(model.$model.name, `Namespace ${namespace} could not be read`);
  if (labels[access.namespaceLabel] !== String(expected)) throw new ApplicationModelContextBoundaryError(model.$model.name, `Namespace ${namespace} does not match admitted ${access.context}`);
}
