// typecast-file-boundary: Configuration normalization recursively validates the supported canonical JSON algebra before restoring its closed public type.
import {
  adaptApplicationGraphCanonicalJsonV1,
  type JsonValue,
} from '@applik8s/core';

export const applicationConfigurationBindingVersion =
  'applik8s.configurationBinding/v1alpha1' as const;

export type ApplicationConfigurationValueType =
  | 'string'
  | 'url'
  | 'integer'
  | 'boolean';

export interface ApplicationConfigSourceBinding<T> {
  readonly apiVersion: typeof applicationConfigurationBindingVersion;
  readonly kind: 'config';
  readonly source: 'environment';
  readonly reference: string;
  readonly valueType: ApplicationConfigurationValueType;
  readonly required: boolean;
  readonly default?: T;
}

export interface ApplicationSecretSourceBinding<TContract = unknown> {
  readonly apiVersion: typeof applicationConfigurationBindingVersion;
  readonly kind: 'secret';
  readonly source: 'environment';
  readonly reference: string;
  readonly required: boolean;
  /** Versioned expected key/schema contract; never resolved credential data. */
  readonly contract?: TContract;
}

export interface ApplicationConfigEnvironmentFactory {
  (reference: string): ApplicationConfigSourceBinding<string>;
  optional(reference: string): ApplicationConfigSourceBinding<string | undefined>;
  url(reference: string): ApplicationConfigSourceBinding<URL>;
  integer(
    reference: string,
    options?: { readonly default?: number },
  ): ApplicationConfigSourceBinding<number>;
  boolean(
    reference: string,
    options?: { readonly default?: boolean },
  ): ApplicationConfigSourceBinding<boolean>;
}

export interface ApplicationSecretEnvironmentFactory {
  <TContract = unknown>(
    reference: string,
    options?: { readonly contract?: TContract },
  ): ApplicationSecretSourceBinding<TContract>;
  optional<TContract = unknown>(
    reference: string,
    options?: { readonly contract?: TContract },
  ): ApplicationSecretSourceBinding<TContract>;
}

export const config: {
  readonly env: ApplicationConfigEnvironmentFactory;
} = Object.freeze({
  env: Object.assign(
    (reference: string): ApplicationConfigSourceBinding<string> =>
      configBinding<string>(reference, 'string', true),
    {
      optional: (reference: string): ApplicationConfigSourceBinding<string | undefined> =>
        configBinding<string | undefined>(reference, 'string', false),
      url: (reference: string): ApplicationConfigSourceBinding<URL> =>
        configBinding<URL>(reference, 'url', true),
      integer: (
        reference: string,
        options?: { readonly default?: number },
      ): ApplicationConfigSourceBinding<number> =>
        configBinding<number>(reference, 'integer', options?.default === undefined, options?.default),
      boolean: (
        reference: string,
        options?: { readonly default?: boolean },
      ): ApplicationConfigSourceBinding<boolean> =>
        configBinding<boolean>(reference, 'boolean', options?.default === undefined, options?.default),
    },
  ),
});

export const secret: {
  readonly env: ApplicationSecretEnvironmentFactory;
} = Object.freeze({
  env: Object.assign(
    <TContract = unknown>(
      reference: string,
      options?: { readonly contract?: TContract },
    ) => secretBinding(reference, true, options?.contract),
    {
      optional: <TContract = unknown>(
        reference: string,
        options?: { readonly contract?: TContract },
      ) => secretBinding(reference, false, options?.contract),
    },
  ),
});

export function isApplicationConfigurationBinding(
  value: unknown,
): value is ApplicationConfigSourceBinding<unknown> | ApplicationSecretSourceBinding<unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'apiVersion') === applicationConfigurationBindingVersion
    && (Reflect.get(value, 'kind') === 'config' || Reflect.get(value, 'kind') === 'secret'),
  );
}

/** @internal Produces a redacted, canonical-json-compatible configuration shape. */
export function applicationConfigurationValueForDigest(value: unknown): JsonValue {
  return normalizeConfigurationValue(value, new WeakSet<object>()) as JsonValue;
}

/** @internal Extracts only provenance, never values, for implementation plans. */
export function applicationConfigurationProvenance(value: unknown): readonly {
  readonly kind: 'config' | 'secret';
  readonly reference: string;
  readonly required: boolean;
}[] {
  const sources = new Map<string, {
    readonly kind: 'config' | 'secret';
    readonly reference: string;
    readonly required: boolean;
  }>();
  const visit = (candidate: unknown, ancestors: WeakSet<object>): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if (isApplicationConfigurationBinding(candidate)) {
      const key = `${candidate.kind}:${candidate.reference}`;
      const existing = sources.get(key);
      sources.set(key, {
        kind: candidate.kind,
        reference: candidate.reference,
        required: (existing?.required ?? false) || candidate.required,
      });
      return;
    }
    if (ancestors.has(candidate)) throw new TypeError('Provider configuration must not contain cycles.');
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        for (const entry of candidate) visit(entry, ancestors);
        return;
      }
      for (const key of Object.keys(candidate)) visit(Reflect.get(candidate, key), ancestors);
    } finally {
      ancestors.delete(candidate);
    }
  };
  visit(value, new WeakSet<object>());
  return Object.freeze([...sources.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.reference.localeCompare(right.reference)));
}

function configBinding<T>(
  reference: string,
  valueType: ApplicationConfigurationValueType,
  required: boolean,
  defaultValue?: T,
): ApplicationConfigSourceBinding<T> {
  return Object.freeze({
    apiVersion: applicationConfigurationBindingVersion,
    kind: 'config',
    source: 'environment',
    reference: environmentReference(reference),
    valueType,
    required,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  });
}

function secretBinding<TContract>(
  reference: string,
  required: boolean,
  contract?: TContract,
): ApplicationSecretSourceBinding<TContract> {
  return Object.freeze({
    apiVersion: applicationConfigurationBindingVersion,
    kind: 'secret',
    source: 'environment',
    reference: environmentReference(reference),
    required,
    ...(contract === undefined ? {} : { contract }),
  });
}

function environmentReference(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new TypeError(`Environment binding ${JSON.stringify(value)} is not a valid variable name.`);
  }
  return value;
}

function normalizeConfigurationValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Provider configuration numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'object') {
    throw new TypeError(`Provider configuration cannot contain ${typeof value}.`);
  }
  const graphReference = adaptApplicationGraphCanonicalJsonV1(value);
  if (typeof graphReference === 'string') return graphReference;
  if (isApplicationConfigurationBinding(value)) {
    return {
      apiVersion: value.apiVersion,
      kind: value.kind,
      source: value.source,
      reference: value.reference,
      required: value.required,
      ...('valueType' in value ? { valueType: value.valueType } : {}),
      ...('default' in value && value.default !== undefined
        ? { default: normalizeConfigurationValue(value.default, ancestors) as JsonValue }
        : {}),
      ...('contract' in value && value.contract !== undefined
        ? { contract: normalizeConfigurationValue(value.contract, ancestors) as JsonValue }
        : {}),
    };
  }
  if (
    Reflect.get(value, 'kind') === 'applicationProvider'
    && Reflect.get(value, 'qualification')
    && Reflect.get(value, 'profile')
  ) {
    return {
      kind: 'applicationProvider',
      qualification: normalizeConfigurationValue(
        Reflect.get(value, 'qualification'),
        ancestors,
      ) as JsonValue,
      profile: normalizeConfigurationValue(
        Reflect.get(value, 'profile'),
        ancestors,
      ) as JsonValue,
      implementation: normalizeConfigurationValue(
        Reflect.get(value, 'implementation'),
        ancestors,
      ) as JsonValue,
    };
  }
  if (
    Reflect.get(value, 'kind') === 'applicationProvider'
    && Reflect.get(value, 'token')
    && typeof Reflect.get(value, 'token') === 'object'
  ) {
    const token = Reflect.get(value, 'token') as object;
    const tokenName = Reflect.get(token, 'name');
    if (typeof tokenName !== 'string' || !tokenName.trim()) {
      throw new TypeError('Provider binding configuration requires a stable capability token name.');
    }
    return {
      kind: 'applicationProvider',
      capability: tokenName,
      ...(Reflect.get(token, 'qualification')
        ? {
            qualification: normalizeConfigurationValue(
              Reflect.get(token, 'qualification'),
              ancestors,
            ) as JsonValue,
          }
        : {}),
      implementation: normalizeConfigurationValue(
        Reflect.get(value, 'implementation'),
        ancestors,
      ) as JsonValue,
    };
  }
  if (ancestors.has(value)) throw new TypeError('Provider configuration must not contain cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeConfigurationValue(entry, ancestors) ?? null);
    }
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = normalizeConfigurationValue(Reflect.get(value, key), ancestors);
      if (entry !== undefined) normalized[key] = entry;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}
