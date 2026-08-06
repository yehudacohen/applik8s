import type { TypeKroCompositionResource } from './index.js';

type ResourceSerializer = (
  resource: unknown,
  index: number,
) => TypeKroCompositionResource;

/**
 * Reads TypeKro's canonical singleton-owner materialization seam. This keeps
 * GitOps emission complete without rediscovering TypeKro ownership internals.
 */
export function typeKroSingletonOwnerInstances(
  factory: object,
  serialize: ResourceSerializer,
): readonly TypeKroCompositionResource[] {
  const materialize = Reflect.get(factory, 'materializedSingletonOwnerInstances');
  if (typeof materialize !== 'function') return [];
  const resources = materialize.call(factory, {});
  if (!Array.isArray(resources)) {
    throw new Error(
      'TypeKro singleton owner materialization returned a non-array value.',
    );
  }
  return resources.map(serialize);
}
