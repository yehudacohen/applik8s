// typecast-file-boundary: managed-model status and condition values are normalized through their portable schema before generic model contracts are restored.
import type {
  PortableManagedModelCondition,
  PortableManagedModelConditionInput,
} from './handler.js';

/** Replaces schema-owned status while preserving the independently owned condition list. */
export function portableManagedModelStatus<TStatus extends object>(
  current: Readonly<TStatus> | undefined,
  next: TStatus,
  conditionsField = 'conditions',
): TStatus {
  const conditions = current ? Reflect.get(current, conditionsField) : undefined;
  const replacement = structuredClone(next) as TStatus;
  if (conditions !== undefined && !Object.hasOwn(replacement, conditionsField)) {
    Reflect.set(replacement, conditionsField, structuredClone(conditions));
  }
  return replacement;
}

export function setPortableManagedModelCondition(
  current: readonly PortableManagedModelCondition[],
  input: PortableManagedModelConditionInput,
  generation: number,
  now: string,
): readonly PortableManagedModelCondition[] {
  const previous = current.find((condition) => condition.type === input.type);
  const unchanged = previous
    && previous.status === input.status
    && previous.reason === input.reason
    && previous.message === input.message;
  return Object.freeze([
    ...current.filter((condition) => condition.type !== input.type),
    Object.freeze({
      ...input,
      observedGeneration: generation,
      lastTransitionTime: unchanged ? previous.lastTransitionTime : now,
    }),
  ]);
}

export function removePortableManagedModelCondition(
  current: readonly PortableManagedModelCondition[],
  type: string,
): readonly PortableManagedModelCondition[] {
  return Object.freeze(current.filter((condition) => condition.type !== type));
}
