// typecast-file-boundary: native model facets are recovered from a symbol-keyed identity registry that preserves their declaration-time table generic.
import { getTableName } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { DrizzleApplicationModelFacet, PromotedDrizzleTable } from './native-models.js';

/** Runtime-only metadata key shared with the native model authoring layer. */
export const applicationModelFacet = Symbol.for('@applik8s/model-facet');

/** Collision-safe runtime access without importing schema authoring dependencies. */
export function getRequiredDrizzleApplicationModelFacet<TTable extends AnyPgTable>(
  value: PromotedDrizzleTable<TTable>,
): DrizzleApplicationModelFacet<TTable>;
export function getRequiredDrizzleApplicationModelFacet<TTable extends AnyPgTable>(
  value: TTable,
): DrizzleApplicationModelFacet<TTable>;
export function getRequiredDrizzleApplicationModelFacet(
  value: AnyPgTable,
): DrizzleApplicationModelFacet<AnyPgTable> {
  const facet = Reflect.get(value, applicationModelFacet);
  if (!facet || typeof facet !== 'object' || Reflect.get(facet, 'provider') !== 'postgres') {
    throw new Error(`Drizzle table ${getTableName(value)} is not an Applik8s-promoted relational model.`);
  }
  return facet as unknown as DrizzleApplicationModelFacet<AnyPgTable>;
}
