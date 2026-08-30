import {
  type ApplicationCapabilityReference,
  type ApplicationImplementationDeclaration,
  type ApplicationImplementationPlan,
  type ApplicationImplementationResolutionInput,
  type ApplicationProviderConstructorReference,
  type ApplicationProviderMaturity,
  type ApplicationSourceProvenance,
  canonicalJsonV1String,
  resolveApplicationImplementationPlan,
  sourceProvenance,
} from '@applik8s/core';
import { sha256Hex } from '@applik8s/deployment-contract';
import type { ApplicationProviderToken } from './application-providers.js';
import {
  applicationProviderQualificationFor,
  applicationProviderTokenName,
  isApplicationQualifiedProviderToken,
} from './application-providers.js';

const implementationMetadata = new WeakMap<object, ApplicationCapabilityImplementationMetadata>();

export interface ApplicationCapabilityImplementationOptions<TImplementation extends object> {
  readonly provider: ApplicationProviderConstructorReference;
  readonly configurationDigest: string;
  readonly configurationSources?: ApplicationImplementationDeclaration['configurationSources'];
  readonly guarantees?: readonly string[];
  readonly runtimeAdapter: string;
  readonly deploymentContributor?: string;
  readonly readiness: string;
  readonly lifecycle: ApplicationImplementationDeclaration['lifecycle'];
  readonly migration: string;
  readonly evidence?: readonly string[];
  readonly maturity: ApplicationProviderMaturity;
  readonly dependencies?: readonly ApplicationCapabilityImplementationDependency[];
  readonly value: TImplementation;
}

export interface ApplicationCapabilityImplementationDependency {
  readonly slot: string;
  readonly requirement: ApplicationProviderToken<object>;
  readonly requiredGuarantees?: readonly string[];
  readonly operations: readonly string[];
  readonly input:
    | ApplicationCapabilityImplementation<object>
    | ApplicationProviderToken<object>;
  readonly visibility?: 'private' | 'explicitly-provided';
}

export type ApplicationCapabilityImplementation<TImplementation extends object> = TImplementation & {
  identified(name: string): ApplicationCapabilityImplementation<TImplementation>;
};

interface ApplicationCapabilityImplementationMetadata {
  readonly token: ApplicationProviderToken<object>;
  readonly provider: ApplicationProviderConstructorReference;
  readonly configurationDigest: string;
  readonly configurationSources: ApplicationImplementationDeclaration['configurationSources'];
  readonly guarantees: readonly string[];
  readonly runtimeAdapter: string;
  readonly deploymentContributor?: string;
  readonly readiness: string;
  readonly lifecycle: ApplicationImplementationDeclaration['lifecycle'];
  readonly migration: string;
  readonly evidence: readonly string[];
  readonly maturity: ApplicationProviderMaturity;
  readonly dependencies: readonly ApplicationCapabilityImplementationDependency[];
  readonly explicitIdentity?: string;
}

export interface ApplicationAssemblyProfileDefaults {
  readonly retention?: 'retain' | 'delete';
  readonly deletionApproval?: 'required' | 'automatic';
}

export interface ApplicationAssemblyProfileQualification {
  readonly id: string;
}

export interface ApplicationProfileFragment {
  readonly id: string;
  readonly configure: (profile: ApplicationAssemblyProfileBuilder) => void;
}

export interface ApplicationAssemblyProfileBuilder {
  provide<TImplementation extends object>(
    token: ApplicationProviderToken<TImplementation>,
    implementation: ApplicationCapabilityImplementation<TImplementation>,
  ): void;
  include(fragment: ApplicationProfileFragment): void;
  qualify(qualification: ApplicationAssemblyProfileQualification): void;
  defaults(defaults: ApplicationAssemblyProfileDefaults): void;
}

export interface ApplicationAssemblyProfileDefinition {
  readonly apiVersion: 'applik8s.assemblyProfile/v1alpha1';
  readonly application: string;
  readonly name: string;
  readonly fragments: readonly string[];
  readonly defaults: ApplicationAssemblyProfileDefaults;
  readonly qualifications: readonly ApplicationAssemblyProfileQualification[];
  readonly resolutionInput: ApplicationImplementationResolutionInput;
  plan(): ApplicationImplementationPlan;
}

export interface ApplicationAssemblyProfileCatalog {
  profile(
    name: string,
    configure: (profile: ApplicationAssemblyProfileBuilder) => void,
    options?: { readonly provenance?: ApplicationSourceProvenance },
  ): ApplicationAssemblyProfileDefinition;
  get(name: string): ApplicationAssemblyProfileDefinition | undefined;
  list(): readonly ApplicationAssemblyProfileDefinition[];
  plan(name: string): ApplicationImplementationPlan;
}

/**
 * Provider-author seam for an inspectable concrete implementation value.
 * Application authors normally receive these values from maintained provider
 * constructors and only call `.identified(...)` when a diagnostic asks them
 * to preserve identity across dynamic construction or source movement.
 */
export function defineApplicationCapabilityImplementation<TImplementation extends object>(
  token: ApplicationProviderToken<TImplementation>,
  options: ApplicationCapabilityImplementationOptions<TImplementation>,
): ApplicationCapabilityImplementation<TImplementation> {
  if (!token.contract) {
    throw new TypeError(
      `Capability implementation ${applicationProviderTokenName(token)} requires a versioned provider token.`,
    );
  }
  if (!token.accepts?.(options.value)) {
    throw new TypeError(
      `Capability implementation does not satisfy ${token.contract.interface}/${token.contract.version}.`,
    );
  }
  requireDigest(options.configurationDigest, 'Capability implementation configuration digest');
  const metadata: ApplicationCapabilityImplementationMetadata = Object.freeze({
    token: token as ApplicationProviderToken<object>,
    provider: Object.freeze({ ...options.provider }),
    configurationDigest: options.configurationDigest,
    configurationSources: Object.freeze([...(options.configurationSources ?? [])]),
    guarantees: Object.freeze([...(options.guarantees ?? token.contract.guarantees)]),
    runtimeAdapter: requiredText(options.runtimeAdapter, 'runtime adapter'),
    ...(options.deploymentContributor
      ? { deploymentContributor: requiredText(options.deploymentContributor, 'deployment contributor') }
      : {}),
    readiness: requiredText(options.readiness, 'readiness contract'),
    lifecycle: options.lifecycle,
    migration: requiredText(options.migration, 'migration contract'),
    evidence: Object.freeze([...(options.evidence ?? [])]),
    maturity: options.maturity,
    dependencies: Object.freeze([...(options.dependencies ?? [])]),
  });
  return implementationProxy(options.value, metadata);
}

export function profileFragment(
  id: string,
  configure: (profile: ApplicationAssemblyProfileBuilder) => void,
): ApplicationProfileFragment {
  return Object.freeze({
    id: requiredStableName(id, 'Profile fragment'),
    configure,
  });
}

export function createApplicationAssemblyProfileCatalog(
  application: string,
): ApplicationAssemblyProfileCatalog {
  requiredStableName(application, 'Application');
  const profiles = new Map<string, ApplicationAssemblyProfileDefinition>();

  const catalog: ApplicationAssemblyProfileCatalog = {
    profile(
      name: string,
      configure: (profile: ApplicationAssemblyProfileBuilder) => void,
      options: { readonly provenance?: ApplicationSourceProvenance } = {},
    ) {
      requiredStableName(name, 'Application profile');
      if (profiles.has(name)) {
        throw new Error(`Application ${application} profile ${name} is already declared.`);
      }
      const provenance = options.provenance ?? sourceProvenance({
        origin: 'framework-generated',
        symbol: name,
        generatedBy: 'application.profile',
      });
      const bindings = new Map<string, {
        readonly token: ApplicationProviderToken<object>;
        readonly implementation: ApplicationCapabilityImplementation<object>;
      }>();
      const fragments = new Set<string>();
      const activeFragments: string[] = [];
      const qualifications = new Map<string, ApplicationAssemblyProfileQualification>();
      let defaults: ApplicationAssemblyProfileDefaults = {};

      const builder: ApplicationAssemblyProfileBuilder = {
        provide(token, implementation) {
          const capability = capabilityReference(token);
          const key = capabilityKey(capability);
          if (bindings.has(key)) {
            throw new Error(`Application profile ${name} binds ${key} more than once.`);
          }
          const metadata = implementationMetadata.get(implementation);
          if (!metadata) {
            throw new Error(
              `Application profile ${name} provider ${key} is not an inspectable capability implementation. Maintained constructors must preserve provider metadata.`,
            );
          }
          if (capabilityKey(capabilityReference(metadata.token)) !== key) {
            throw new Error(
              `Application profile ${name} cannot bind ${capabilityKey(capabilityReference(metadata.token))} to ${key}.`,
            );
          }
          bindings.set(key, {
            token: token as ApplicationProviderToken<object>,
            implementation: implementation as ApplicationCapabilityImplementation<object>,
          });
        },
        include(fragment) {
          if (fragments.has(fragment.id)) return;
          if (activeFragments.includes(fragment.id)) {
            throw new Error(
              `Application profile fragment cycle: ${[...activeFragments, fragment.id].join(' -> ')}.`,
            );
          }
          activeFragments.push(fragment.id);
          try {
            fragment.configure(builder);
            fragments.add(fragment.id);
          } finally {
            activeFragments.pop();
          }
        },
        qualify(qualification) {
          const id = requiredStableName(qualification.id, 'Profile qualification');
          qualifications.set(id, Object.freeze({ id }));
        },
        defaults(next) {
          defaults = Object.freeze({ ...defaults, ...next });
        },
      };
      configure(builder);
      if (bindings.size === 0) {
        throw new Error(`Application profile ${name} must provide at least one capability.`);
      }

      const resolutionInput = profileResolutionInput({
        application,
        name,
        provenance,
        bindings,
        fragments: [...fragments],
        defaults,
        qualifications: [...qualifications.values()],
      });
      const definition: ApplicationAssemblyProfileDefinition = Object.freeze({
        apiVersion: 'applik8s.assemblyProfile/v1alpha1',
        application,
        name,
        fragments: Object.freeze([...fragments].sort()),
        defaults,
        qualifications: Object.freeze([...qualifications.values()].sort((left, right) => left.id.localeCompare(right.id))),
        resolutionInput,
        plan: () => resolveApplicationImplementationPlan(resolutionInput),
      });
      profiles.set(name, definition);
      return definition;
    },
    get(name: string) {
      return profiles.get(name);
    },
    list() {
      return Object.freeze([...profiles.values()].sort((left, right) => left.name.localeCompare(right.name)));
    },
    plan(name: string) {
      const profile = profiles.get(name);
      if (!profile) {
        throw new Error(
          `Application ${application} has no profile ${name}. Available profiles: ${[...profiles.keys()].sort().join(', ') || '<none>'}.`,
        );
      }
      return profile.plan();
    },
  };
  return Object.freeze(catalog);
}

function implementationProxy<TImplementation extends object>(
  value: TImplementation,
  metadata: ApplicationCapabilityImplementationMetadata,
): ApplicationCapabilityImplementation<TImplementation> {
  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      if (property === 'identified') {
        return (name: string) => implementationProxy(target, Object.freeze({
          ...metadata,
          explicitIdentity: requiredStableName(name, 'Capability implementation identity'),
        }));
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ApplicationCapabilityImplementation<TImplementation>;
  implementationMetadata.set(proxy, metadata);
  return proxy;
}

function profileResolutionInput(input: {
  readonly application: string;
  readonly name: string;
  readonly provenance: ApplicationSourceProvenance;
  readonly bindings: ReadonlyMap<string, {
    readonly token: ApplicationProviderToken<object>;
    readonly implementation: ApplicationCapabilityImplementation<object>;
  }>;
  readonly fragments: readonly string[];
  readonly defaults: ApplicationAssemblyProfileDefaults;
  readonly qualifications: readonly ApplicationAssemblyProfileQualification[];
}): ApplicationImplementationResolutionInput {
  const declarations: ApplicationImplementationDeclaration[] = [];
  const bindings: ApplicationImplementationResolutionInput['bindings'][number][] = [];
  const keys = new Map<object, string>();

  const visit = (
    implementation: ApplicationCapabilityImplementation<object>,
    identity: ApplicationImplementationDeclaration['identity'],
    fallbackKey: string,
  ): string => {
    const existing = keys.get(implementation);
    if (existing) return existing;
    const metadata = implementationMetadata.get(implementation);
    if (!metadata) {
      throw new Error(`Implementation ${fallbackKey} lost its provider metadata.`);
    }
    const key = `implementation:${fallbackKey}`;
    keys.set(implementation, key);
    const dependencies: ApplicationImplementationDeclaration['dependencies'][number][] = [];
    for (const dependency of metadata.dependencies) {
      const requirement = capabilityReference(dependency.requirement);
      if (isCapabilityToken(dependency.input)) {
        dependencies.push({
          slot: dependency.slot,
          requirement,
          requiredGuarantees: [...(dependency.requiredGuarantees ?? [])],
          operations: [...dependency.operations],
          input: { kind: 'capability-reference', capability: capabilityReference(dependency.input) },
          visibility: dependency.visibility ?? 'private',
        });
        continue;
      }
      const dependencyKey = visit(
        dependency.input,
        { kind: 'inline', parent: key, slot: dependency.slot },
        `${fallbackKey}/${dependency.slot}`,
      );
      dependencies.push({
        slot: dependency.slot,
        requirement,
        requiredGuarantees: [...(dependency.requiredGuarantees ?? [])],
        operations: [...dependency.operations],
        input: { kind: 'implementation', declaration: dependencyKey },
        visibility: dependency.visibility ?? 'private',
      });
    }
    declarations.push({
      key,
      capability: capabilityReference(metadata.token),
      provider: metadata.provider,
      identity: metadata.explicitIdentity
        ? { kind: 'named', name: metadata.explicitIdentity }
        : identity,
      provenance: input.provenance,
      configurationDigest: metadata.configurationDigest,
      configurationSources: metadata.configurationSources,
      guarantees: metadata.guarantees,
      runtimeAdapter: metadata.runtimeAdapter,
      ...(metadata.deploymentContributor ? { deploymentContributor: metadata.deploymentContributor } : {}),
      readiness: metadata.readiness,
      lifecycle: metadata.lifecycle,
      migration: metadata.migration,
      evidence: metadata.evidence,
      maturity: metadata.maturity,
      dependencies,
    });
    return key;
  };

  for (const [capability, entry] of [...input.bindings.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const key = visit(
      entry.implementation,
      { kind: 'binding', binding: capability },
      capability,
    );
    bindings.push({
      id: `binding:${capability}`,
      capability: capabilityReference(entry.token),
      implementation: key,
      provenance: input.provenance,
    });
  }

  const profileDigest = `sha256:${sha256Hex(canonicalJsonV1String({
    application: input.application,
    profile: input.name,
    bindings: bindings.map(({ id, capability, implementation }) => ({ id, capability, implementation })),
    fragments: [...input.fragments].sort(),
    defaults: input.defaults,
    qualifications: input.qualifications.map(({ id }) => id).sort(),
  }))}`;
  return Object.freeze({
    application: input.application,
    profile: {
      id: input.name,
      digest: profileDigest,
      provenance: Object.freeze([input.provenance]),
    },
    declarations: Object.freeze(declarations),
    bindings: Object.freeze(bindings),
  });
}

function capabilityReference(token: ApplicationProviderToken<unknown>): ApplicationCapabilityReference {
  const base = isApplicationQualifiedProviderToken(token) ? token.base : token;
  const contract = base.contract;
  if (!contract) {
    throw new TypeError(
      `Capability ${applicationProviderTokenName(token)} requires a versioned provider contract.`,
    );
  }
  const qualification = applicationProviderQualificationFor(token);
  return Object.freeze({
    interface: `${contract.interface}@${contract.version}`,
    ...(qualification ? { qualifier: qualification.name } : {}),
  });
}

function capabilityKey(capability: ApplicationCapabilityReference): string {
  return `${capability.interface}:${capability.qualifier ?? 'default'}`;
}

function isCapabilityToken(value: unknown): value is ApplicationProviderToken<object> {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof Reflect.get(value, 'name') === 'string'
    && Reflect.get(value, 'contract'),
  );
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
  return value;
}

function requiredStableName(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TypeError(`${label} ${JSON.stringify(value)} must be a stable lowercase identifier.`);
  }
  return normalized;
}

function requireDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a complete sha256 digest.`);
  }
}
