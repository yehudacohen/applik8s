// typecast-file-boundary: exhaustive profile derivation validates schema branches and provider qualifications before restoring typed selection maps.
import type {
  ApplicationProfileDescriptor,
  ApplicationProfileProviderSelectionContract,
  ApplicationProfileTransitionContract,
  JsonObject,
} from '@applik8s/core';
import type {
  ApplicationProviderQualification,
  ApplicationQualifiedProviderToken,
} from './application-providers.js';
import { applicationProviderSelectionSatisfies } from './application-providers.js';
import { applicationTypeKroExpressionValue } from './application-typekro-values.js';

export type ApplicationProfileStringKey<T> = Extract<keyof T, string>;
export type ApplicationProfileVariant<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
> =
  TSpec extends unknown ? Extract<TSpec[TDiscriminator], string> : never;
type ProfileVariantSpec<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariant extends string,
> = TSpec extends unknown
  ? TVariant extends Extract<TSpec[TDiscriminator], string>
    ? Omit<TSpec, TDiscriminator> & Record<TDiscriminator, TVariant>
    : never
  : never;

export interface ApplicationProfileBranchOptions {
  readonly implementation?: string;
  readonly credentialReferences?: readonly string[];
  readonly resources?: readonly string[];
  readonly provenance?: 'application' | 'start-default' | 'application-override';
  readonly transitions?: readonly ApplicationProfileTransitionContract[];
}

export interface ApplicationQualifiedProviderBindingMetadata<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationQualifiedProviderToken<TImplementation>;
  readonly implementation: TImplementation;
  readonly qualification: ApplicationProviderQualification;
  readonly profile: ApplicationProfileProviderSelectionContract;
}

/**
 * A lazy provider handle. Public implementation members are callable/readable
 * while graph metadata remains available to Applik8s planning.
 */
export type ApplicationQualifiedProviderBinding<TImplementation = unknown> =
  ApplicationQualifiedProviderBindingMetadata<TImplementation>
  & Pick<
    TImplementation,
    Exclude<
      keyof TImplementation,
      keyof ApplicationQualifiedProviderBindingMetadata<TImplementation>
    >
  >;

interface ApplicationProfileBranch<TImplementation> {
  readonly implementation: TImplementation;
  readonly options: ApplicationProfileBranchOptions;
}

interface ApplicationProfileProvisionState<TImplementation> {
  readonly token: ApplicationQualifiedProviderToken<TImplementation>;
  readonly branches: Map<string, ApplicationProfileBranch<TImplementation>>;
  binding?: ApplicationQualifiedProviderBinding<TImplementation>;
  captured: boolean;
}

export interface ApplicationProfileVariantOverride {
  override<TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
    implementation: TImplementation,
    options?: Omit<ApplicationProfileBranchOptions, 'provenance'>,
  ): ApplicationQualifiedProviderBinding<TImplementation>;
}

export type ApplicationProfileProvisionBuilder<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string,
  TRemaining extends TVariants,
  TImplementation,
> = {
  readonly [TVariant in TRemaining]: (
    factory: (
      spec: ProfileVariantSpec<TSpec, TDiscriminator, TVariant>,
    ) => TImplementation,
    options?: ApplicationProfileBranchOptions,
  ) => ApplicationProfileProvisionBuilder<
    TSpec,
    TDiscriminator,
    TVariants,
    Exclude<TRemaining, TVariant>,
    TImplementation
  >;
} & ([TRemaining] extends [never]
  ? {
      exhaustive(): ApplicationQualifiedProviderBinding<TImplementation>;
    }
  : {
      exhaustive(missing: {
        readonly unhandledVariants: TRemaining;
      }): never;
    });

export interface ApplicationProfileBase<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string,
> {
  readonly descriptor: ApplicationProfileDescriptor;
  provide<TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
  ): ApplicationProfileProvisionBuilder<
    TSpec,
    TDiscriminator,
    TVariants,
    TVariants,
    TImplementation
  >;
}

export type ApplicationProfile<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string = ApplicationProfileVariant<TSpec, TDiscriminator>,
> = ApplicationProfileBase<TSpec, TDiscriminator, TVariants> & {
  readonly [TVariant in TVariants]: ApplicationProfileVariantOverride;
};

export interface CreateApplicationProfileOptions<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string,
> {
  readonly application: string;
  readonly spec: TSpec;
  readonly discriminator: TDiscriminator;
  readonly variants: readonly TVariants[];
  readonly schemaRevision: string;
  /** The typed installation value used for graph lowering. */
  readonly selectionInput: string;
  /** Stable CEL path recorded in graph/profile contracts. */
  readonly selector: string;
  readonly selectProvider: <TImplementation>(
    selector: string,
    cases: Readonly<Record<string, TImplementation>> & {
      readonly default: TImplementation;
    },
  ) => TImplementation;
  readonly register: <TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
    implementation: TImplementation,
    contract: ApplicationProfileProviderSelectionContract,
  ) => ApplicationQualifiedProviderBinding<TImplementation>;
}

export function createApplicationProfileRuntime<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string,
>(
  options: CreateApplicationProfileOptions<TSpec, TDiscriminator, TVariants>,
): {
  readonly profile: ApplicationProfile<TSpec, TDiscriminator, TVariants>;
  inject<TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
  ): ApplicationQualifiedProviderBinding<TImplementation>;
} {
  const variants = [...new Set(options.variants)];
  if (variants.length !== options.variants.length || variants.length < 2) {
    throw new Error(
      `Application profile ${String(options.discriminator)} requires at least two distinct variants.`,
    );
  }
  const descriptor: ApplicationProfileDescriptor = Object.freeze({
    apiVersion: 'applik8s.profile/v1alpha1',
    id: `profile:${options.application}:${String(options.discriminator)}`,
    application: options.application,
    discriminator: String(options.discriminator),
    schemaRevision: options.schemaRevision,
    variants: Object.freeze(variants),
    installationIdentity: `installation:${options.application}`,
  });
  const provisions = new Map<
    string,
    ApplicationProfileProvisionState<unknown>
  >();

  const register = <TImplementation>(
    state: ApplicationProfileProvisionState<TImplementation>,
  ): ApplicationQualifiedProviderBinding<TImplementation> => {
    const missing = variants.filter((variant) => !state.branches.has(variant));
    if (missing.length > 0) {
      throw new Error(
        `Application profile provider ${state.token.qualification.key} is missing variants: ${missing.join(', ')}.`,
      );
    }
    const cases = Object.fromEntries(
      variants.map((variant) => [
        variant,
        requiredBranch(state, variant).implementation,
      ]),
    ) as Readonly<Record<string, TImplementation>>;
    const fallback = requiredBranch(state, variants[0] ?? '').implementation;
    const implementation = options.selectProvider(options.selectionInput, {
      ...cases,
      default: fallback,
    });
    const contract = profileProviderContract(
      descriptor,
      state.token,
      state.branches,
      options.selector,
    );
    state.binding = options.register(state.token, implementation, contract);
    return state.binding;
  };

  const profileBase: ApplicationProfileBase<
    TSpec,
    TDiscriminator,
    TVariants
  > = {
    descriptor,
    provide<TImplementation>(
      token: ApplicationQualifiedProviderToken<TImplementation>,
    ) {
      if (token.kind !== 'applicationQualifiedProvider') {
        throw new Error(
          'application.profile(...).provide(...) requires Capability.named("qualifier").',
        );
      }
      if (provisions.has(token.qualification.key)) {
        throw new Error(
          `Application profile already provides ${token.qualification.key}.`,
        );
      }
      const state: ApplicationProfileProvisionState<TImplementation> = {
        token,
        branches: new Map(),
        captured: false,
      };
      provisions.set(
        token.qualification.key,
        state as ApplicationProfileProvisionState<unknown>,
      );
      return provisionProxy(options.spec, variants, state, register);
    },
  };

  const profile = new Proxy(profileBase, {
    get(target, property, receiver) {
      if (
        typeof property !== 'string'
        || property in target
        || !variants.includes(property as TVariants)
      ) {
        return Reflect.get(target, property, receiver);
      }
      const override: ApplicationProfileVariantOverride = {
        override<TImplementation>(
          token: ApplicationQualifiedProviderToken<TImplementation>,
          implementation: TImplementation,
          branchOptions = {},
        ) {
          const state = provisions.get(token.qualification.key) as
            | ApplicationProfileProvisionState<TImplementation>
            | undefined;
          if (!state?.binding) {
            throw new Error(
              `Application profile cannot override ${token.qualification.key} before its exhaustive default provision.`,
            );
          }
          if (state.captured) {
            throw new Error(
              `Application profile cannot override ${token.qualification.key} after application.inject(...) captured it.`,
            );
          }
          assertProviderImplementation(token, implementation);
          state.branches.set(property, {
            implementation,
            options: {
              ...branchOptions,
              provenance: 'application-override',
            },
          });
          return register(state);
        },
      };
      return Object.freeze(override);
    },
  }) as ApplicationProfile<TSpec, TDiscriminator, TVariants>;

  return {
    profile,
    inject<TImplementation>(
      token: ApplicationQualifiedProviderToken<TImplementation>,
    ): ApplicationQualifiedProviderBinding<TImplementation> {
      const state = provisions.get(token.qualification.key) as
        | ApplicationProfileProvisionState<TImplementation>
        | undefined;
      if (!state?.binding) {
        throw new Error(
          `Application provider ${token.qualification.key} has not been provided exhaustively.`,
        );
      }
      state.captured = true;
      return state.binding;
    },
  };
}

function provisionProxy<
  TSpec,
  TDiscriminator extends ApplicationProfileStringKey<TSpec>,
  TVariants extends string,
  TImplementation,
>(
  spec: TSpec,
  variants: readonly TVariants[],
  state: ApplicationProfileProvisionState<TImplementation>,
  register: (
    state: ApplicationProfileProvisionState<TImplementation>,
  ) => ApplicationQualifiedProviderBinding<TImplementation>,
): ApplicationProfileProvisionBuilder<
  TSpec,
  TDiscriminator,
  TVariants,
  TVariants,
  TImplementation
> {
  const target = {
    exhaustive() {
      return register(state);
    },
  };
  return new Proxy(target, {
    get(source, property, receiver) {
      if (
        typeof property !== 'string'
        || property === 'exhaustive'
        || !variants.includes(property as TVariants)
      ) {
        return Reflect.get(source, property, receiver);
      }
      return (
        factory: (variantSpec: TSpec) => TImplementation,
        branchOptions: ApplicationProfileBranchOptions = {},
      ) => {
        if (state.branches.has(property)) {
          throw new Error(
            `Application profile provider ${state.token.qualification.key} declares ${property} more than once.`,
          );
        }
        const implementation = factory(spec);
        if (
          implementation
          && typeof implementation === 'object'
          && typeof Reflect.get(implementation, 'then') === 'function'
        ) {
          throw new Error(
            `Application profile provider ${state.token.qualification.key}.${property}(...) must be side-effect-free and synchronous.`,
          );
        }
        assertProviderImplementation(state.token, implementation);
        state.branches.set(property, {
          implementation,
          options: branchOptions,
        });
        return receiver;
      };
    },
  }) as ApplicationProfileProvisionBuilder<
    TSpec,
    TDiscriminator,
    TVariants,
    TVariants,
    TImplementation
  >;
}

/**
 * Inspects only ArkType's documented JSON projection. It deliberately rejects
 * ambiguous/non-literal discriminators instead of depending on ArkType's
 * internal node classes or guessing from TypeScript-only information.
 */
export function applicationProfileVariantsFromSchema(
  schemaJson: unknown,
  discriminator: string,
  explicit?: readonly string[],
): readonly string[] {
  const derived = applicationProfileLiteralUnits(
    applicationProfilePropertySchema(schemaJson, discriminator),
  );
  if (explicit) {
    const normalized = applicationProfileDistinctVariants(explicit, discriminator);
    if (
      derived
      && (
        derived.length !== normalized.length
        || derived.some((variant) => !normalized.includes(variant))
      )
    ) {
      throw new Error(
        `Application profile ${discriminator} explicit variants (${normalized.join(', ')}) do not match its ArkType discriminator (${derived.join(', ')}).`,
      );
    }
    return normalized;
  }
  if (!derived) {
    throw new Error(
      `Application profile ${discriminator} is not a top-level ArkType string-literal union. Pass { variants: [...] as const } explicitly.`,
    );
  }
  return applicationProfileDistinctVariants(derived, discriminator);
}

function applicationProfilePropertySchema(
  schemaJson: unknown,
  discriminator: string,
): unknown {
  if (Array.isArray(schemaJson)) {
    const branchValues = schemaJson.map((branch) =>
      applicationProfilePropertySchema(branch, discriminator),
    );
    if (branchValues.some((value) => value === undefined)) {
      return undefined;
    }
    return branchValues.flatMap((value) =>
      Array.isArray(value) ? value : [value],
    );
  }
  if (!schemaJson || typeof schemaJson !== 'object') return undefined;
  for (const collection of ['required', 'optional'] as const) {
    const entries = Reflect.get(schemaJson, collection);
    if (!Array.isArray(entries)) continue;
    const property = entries.find(
      (entry) =>
        entry
        && typeof entry === 'object'
        && Reflect.get(entry, 'key') === discriminator,
    );
    if (property) return Reflect.get(property, 'value');
  }
  return undefined;
}

function applicationProfileLiteralUnits(value: unknown): readonly string[] | undefined {
  const branches = Array.isArray(value) ? value : [value];
  const units: string[] = [];
  for (const branch of branches) {
    if (!branch || typeof branch !== 'object') return undefined;
    const unit = Reflect.get(branch, 'unit');
    if (typeof unit !== 'string' || unit.length === 0) return undefined;
    units.push(unit);
  }
  return units.length > 0 ? units : undefined;
}

function applicationProfileDistinctVariants(
  variants: readonly string[],
  discriminator: string,
): readonly string[] {
  const normalized = variants.map((variant) => variant.trim());
  if (
    normalized.length < 2
    || normalized.some((variant) => variant.length === 0)
    || new Set(normalized).size !== normalized.length
  ) {
    throw new Error(
      `Application profile ${discriminator} requires at least two distinct non-empty variants.`,
    );
  }
  return Object.freeze(normalized);
}

function requiredBranch<TImplementation>(
  state: ApplicationProfileProvisionState<TImplementation>,
  variant: string,
): ApplicationProfileBranch<TImplementation> {
  const branch = state.branches.get(variant);
  if (!branch) {
    throw new Error(
      `Application profile provider ${state.token.qualification.key} has no ${variant} branch.`,
    );
  }
  return branch;
}

function assertProviderImplementation<TImplementation>(
  token: ApplicationQualifiedProviderToken<TImplementation>,
  implementation: TImplementation,
): void {
  if (token.accepts
    && !token.accepts(implementation)
    && !applicationProviderSelectionSatisfies(implementation, token.accepts)) {
    throw new Error(
      `Application profile provider ${token.qualification.key} does not satisfy ${token.name}.`,
    );
  }
}

function profileProviderContract<TImplementation>(
  descriptor: ApplicationProfileDescriptor,
  token: ApplicationQualifiedProviderToken<TImplementation>,
  branches: ReadonlyMap<string, ApplicationProfileBranch<TImplementation>>,
  selector: string,
): ApplicationProfileProviderSelectionContract {
  const transitions = applicationProfileTransitions(
    descriptor,
    [...branches.values()].flatMap(
      (branch) => branch.options.transitions ?? [],
    ),
  );
  return Object.freeze({
    apiVersion: 'applik8s.profileProvider/v1alpha1',
    profileId: descriptor.id,
    descriptor,
    qualification: token.qualification,
    branches: Object.freeze(
      descriptor.variants.map((variant) => {
        const branch = branches.get(variant);
        if (!branch) {
          throw new Error(
            `Application profile provider ${token.qualification.key} has no ${variant} branch.`,
          );
        }
        return Object.freeze({
          variant,
          implementation:
            branch.options.implementation
            ?? providerImplementationIdentity(branch.implementation),
          credentialReferences: Object.freeze([
            ...(branch.options.credentialReferences ?? []),
          ]),
          resources: Object.freeze([...(branch.options.resources ?? [])]),
          provenance: branch.options.provenance ?? 'application',
          config: providerSafeConfig(branch.implementation),
        });
      }),
    ),
    transitions,
    selectedBy: selector,
    inactiveBranches: 'plan-only',
  });
}

function applicationProfileTransitions(
  descriptor: ApplicationProfileDescriptor,
  authored: readonly ApplicationProfileTransitionContract[],
): readonly ApplicationProfileTransitionContract[] {
  const byPair = new Map<string, ApplicationProfileTransitionContract>();
  for (const transition of authored) {
    if (
      transition.from === transition.to
      || !descriptor.variants.includes(transition.from)
      || !descriptor.variants.includes(transition.to)
    ) {
      throw new Error(
        `Application profile ${descriptor.id} transition ${transition.from} -> ${transition.to} must name two distinct declared variants.`,
      );
    }
    if (transition.destructive && !transition.acknowledgement?.trim()) {
      throw new Error(
        `Application profile ${descriptor.id} destructive transition ${transition.from} -> ${transition.to} requires an installation-scoped acknowledgement key.`,
      );
    }
    const key = `${transition.from}\u0000${transition.to}`;
    if (byPair.has(key)) {
      throw new Error(
        `Application profile ${descriptor.id} declares transition ${transition.from} -> ${transition.to} more than once.`,
      );
    }
    byPair.set(key, Object.freeze({ ...transition }));
  }
  for (const from of descriptor.variants) {
    for (const to of descriptor.variants) {
      if (from === to) continue;
      const key = `${from}\u0000${to}`;
      if (byPair.has(key)) continue;
      byPair.set(
        key,
        Object.freeze({
          from,
          to,
          kind: 'unsupported',
          destructive: false,
          authority: 'external',
          drainDependents: true,
          rollback: 'unsupported',
        }),
      );
    }
  }
  return Object.freeze([...byPair.values()]);
}

function providerImplementationIdentity(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'application-target-provider-selection') return kind;
  const name = Reflect.get(value, 'name');
  return [kind, name]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('/') || 'provider';
}

function providerSafeConfig(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const config: Record<string, import('@applik8s/core').JsonValue> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (providerProfileSensitiveValueKey(key)) continue;
    const portable = providerSafeValue(candidate, new WeakSet());
    if (portable !== undefined) config[key] = portable;
  }
  return config;
}

/**
 * Profile branches are the concrete deployment-selection authority. Preserve
 * recursively portable provider configuration instead of retaining only
 * top-level scalars; otherwise nested topology/lifecycle/provisioning choices
 * disappear and the compiler is forced to guess from a CEL-merged alias.
 *
 * Secret-bearing keys remain excluded at every depth. Those values travel
 * through the provider's explicit reference contract and the selected alias,
 * never this inspectable profile metadata.
 */
function providerSafeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): import('@applik8s/core').JsonValue | undefined {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (
    value === undefined
    || typeof value === 'function'
    || typeof value === 'symbol'
    || typeof value === 'bigint'
  ) {
    return undefined;
  }
  if (typeof value !== 'object' || ancestors.has(value)) return undefined;
  // Preserve only the portable expression identity of schema/CEL values.
  // Serializing the proxy object itself would expose TypeKro internals, while
  // omitting it loses installation-derived provider configuration whenever a
  // whole provider object is later merged through CEL. The deployment compiler
  // resolves this exact marker against the concrete installation spec.
  const expression = applicationTypeKroExpressionValue(value);
  if (expression) return `\${${expression}}`;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((candidate) => {
        const portable = providerSafeValue(candidate, ancestors);
        // Match JSON's array semantics: an unsupported value occupies a
        // stable null slot instead of shifting every later element. Profile
        // branch overlays are merged by position, so compaction could apply a
        // later provider option to the wrong authored entry.
        return portable === undefined ? null : portable;
      });
    }
    const entries: [string, import('@applik8s/core').JsonValue][] = [];
    for (const [key, candidate] of Object.entries(value)) {
      if (providerProfileSensitiveValueKey(key)) continue;
      const portable = providerSafeValue(candidate, ancestors);
      if (portable !== undefined) entries.push([key, portable]);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

function providerProfileSensitiveValueKey(key: string): boolean {
  return /^(?:password|token|secret|apiKey|privateKey|clientSecret|accessKeyId|secretAccessKey)$/iu
    .test(key);
}
