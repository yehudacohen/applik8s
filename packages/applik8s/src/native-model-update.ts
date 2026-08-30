import type { ApplicationRuntimeModelContract } from './application-models.js';
import {
  isApplicationModelClearIntent,
  type ApplicationModelUpdatePatch,
} from './application-model-update-contract.js';

type NativeColumn = NonNullable<
  ApplicationRuntimeModelContract['nativeRelational']
>['columns'][number];

/** @internal Shared semantic patch lowering for command and participant writes. */
export function applyApplicationModelUpdatePatch<TValue extends object>(
  model: ApplicationRuntimeModelContract,
  current: TValue,
  patch: ApplicationModelUpdatePatch<TValue>,
  clearedProperties: Set<string>,
): TValue {
  // typecast: object spread preserves TValue while a string-keyed view applies the generic property patch.
  const next = { ...current } as Record<string, unknown>;
  for (const [property, value] of Object.entries(patch)) {
    if (!isApplicationModelClearIntent(value)) {
      clearedProperties.delete(property);
      Reflect.set(next, property, value);
      continue;
    }
    if (model.storageShape !== 'native-relational') {
      Reflect.deleteProperty(next, property);
      continue;
    }
    const column = requiredNativeRelationalContract(model).columns.find(
      (candidate) => candidate.property === property,
    );
    if (!column) {
      throw new Error(
        `applik8s-model-clear-field-unknown: Native model ${model.name} has no field ${property}.`,
      );
    }
    if (column.nullable !== true) {
      throw new Error(
        `applik8s-model-clear-field-required: Native model ${model.name}.${property} does not accept database NULL.`,
      );
    }
    clearedProperties.add(property);
    // Hydrated SQL NULL and JSON null intentionally share JavaScript null.
    // The side-channel above preserves the caller's physical clearing intent
    // through SQL rendering and change attribution without leaking it into
    // model snapshots, outbox payloads, or durable history.
    Reflect.set(next, property, null);
  }
  // typecast: every mutation above is constrained by ApplicationModelUpdatePatch<TValue>.
  return next as TValue;
}

/** @internal Selects only semantic changes plus the framework revision. */
export function applicationNativeModelMutableColumns(
  model: ApplicationRuntimeModelContract,
  before: object,
  after: object,
  clearedProperties: ReadonlySet<string>,
): readonly NativeColumn[] {
  const native = requiredNativeRelationalContract(model);
  return native.columns.filter(({ property }) =>
    property !== native.identity.property
    && (
      property === native.revision?.property
      || clearedProperties.has(property)
      || !Object.is(
        Reflect.get(before, property),
        Reflect.get(after, property),
      )
    ),
  );
}

function requiredNativeRelationalContract(
  model: ApplicationRuntimeModelContract,
): NonNullable<ApplicationRuntimeModelContract['nativeRelational']> {
  if (!model.nativeRelational) {
    throw new Error(
      `Native model ${model.name} is missing its relational storage contract.`,
    );
  }
  return model.nativeRelational;
}
