// typecast-file-boundary: This provider-author boundary validates structural capability contracts before attaching hidden generic implementation metadata.
import {
  type ApplicationImplementationDeclaration,
  type ApplicationProviderConstructorReference,
  type ApplicationProviderMaturity,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';
import { sha256Hex } from '@applik8s/deployment-contract';
import type { ApplicationProviderToken } from './application-providers.js';
import {
  applicationConfigurationProvenance,
  applicationConfigurationValueForDigest,
} from './application-configuration.js';

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

export interface ApplicationCapabilityImplementationMetadata {
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

export interface MaintainedApplicationCapabilityImplementationOptions<
  TImplementation extends object,
> extends Omit<
  ApplicationCapabilityImplementationOptions<TImplementation>,
  'configurationDigest' | 'configurationSources' | 'value'
> {
  readonly value: TImplementation;
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
  const contract = providerContract(token);
  if (!contract) {
    throw new TypeError(
      `Capability implementation ${providerTokenName(token)} requires a versioned provider token.`,
    );
  }
  if (token.accepts && !token.accepts(options.value)) {
    throw new TypeError(
      `Capability implementation does not satisfy ${contract.interface}/${contract.version}.`,
    );
  }
  requireDigest(options.configurationDigest, 'Capability implementation configuration digest');
  return implementationProxy(options.value, Object.freeze({
    token: token as ApplicationProviderToken<object>,
    provider: Object.freeze({ ...options.provider }),
    configurationDigest: options.configurationDigest,
    configurationSources: Object.freeze([...(options.configurationSources ?? [])]),
    guarantees: Object.freeze([...(options.guarantees ?? contract.guarantees)]),
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
  }));
}

/** @internal Maintained constructors use one canonical, Secret-safe metadata path. */
export function maintainedApplicationCapabilityImplementation<TImplementation extends object>(
  token: ApplicationProviderToken<TImplementation>,
  options: MaintainedApplicationCapabilityImplementationOptions<TImplementation>,
): ApplicationCapabilityImplementation<TImplementation> {
  const normalizedConfiguration = applicationConfigurationValueForDigest(options.value);
  return defineApplicationCapabilityImplementation(token, {
    ...options,
    configurationDigest: `sha256:${sha256Hex(canonicalJsonV1String(
      normalizedConfiguration,
      canonicalJsonCompatibleV1Policy,
    ))}`,
    configurationSources: applicationConfigurationProvenance(options.value),
  });
}

/** @internal Profile resolution reads metadata without exposing it in provider values. */
export function applicationCapabilityImplementationMetadata(
  value: object,
): ApplicationCapabilityImplementationMetadata | undefined {
  return implementationMetadata.get(value);
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

function providerContract(token: ApplicationProviderToken<unknown>) {
  const base = Reflect.get(token, 'base') as ApplicationProviderToken<unknown> | undefined;
  return (base ?? token).contract;
}

function providerTokenName(token: ApplicationProviderToken<unknown>): string {
  const qualification = Reflect.get(token, 'qualification') as { readonly name?: string } | undefined;
  return qualification?.name ? `${token.name}.${qualification.name}` : token.name;
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
