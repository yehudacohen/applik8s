const applicationModelClearIntent = Symbol.for(
  'applik8s.application-model-clear-intent',
);

/**
 * Explicitly clears a nullable native-model column to database NULL. For the
 * JSON-envelope model backend it removes the property. This is distinct from
 * assigning JavaScript `null`, which remains a legitimate JSON value.
 */
export interface ApplicationModelClearIntent {
  readonly [applicationModelClearIntent]: true;
}

export type ApplicationModelUpdatePatch<TValue extends object> = {
  readonly [TKey in keyof TValue]?: TValue[TKey]
    | (null extends TValue[TKey]
      ? ApplicationModelClearIntent
      : undefined extends TValue[TKey]
        ? ApplicationModelClearIntent
        : never);
};

export function clear(): ApplicationModelClearIntent {
  const intent: ApplicationModelClearIntent = {
    [applicationModelClearIntent]: true,
  };
  return Object.freeze(intent);
}

/** @internal Runtime recognition shared by lightweight execution bundles. */
export function isApplicationModelClearIntent(
  value: unknown,
): value is ApplicationModelClearIntent {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, applicationModelClearIntent) === true;
}
