// typecast-file-boundary: This lowering validates portable plan JSON and graph
// node kinds before rebuilding the selected physical application graph.
import type {
  ApplicationGraph,
  ApplicationImplementationPlan,
  ApplicationProviderNode,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import { isApplicationProviderInterfaceKind } from '@applik8s/core';

/**
 * Derive the provider view consumed by physical planning from one resolved
 * assembly profile. The authored semantic graph remains immutable and is
 * still the authority for application behavior.
 */
export function applicationDeploymentGraphForImplementationPlan(
  graph: ApplicationGraph,
  plan: ApplicationImplementationPlan,
  options: {
    readonly configuration?: Readonly<Record<string, string | undefined>>;
  } = {},
): ApplicationGraph {
  if (plan.application !== graph.metadata.name) {
    throw new Error(
      `Implementation plan ${plan.profile.id} belongs to ${plan.application}, expected ${graph.metadata.name}.`,
    );
  }
  const implementations = new Map(plan.implementations.map((entry) => [entry.id, entry]));
  const replacements = new Map<string, ApplicationProviderNode>();
  const additions: ApplicationProviderNode[] = [];
  const bindingSources = plan.bindings.map((binding) => {
    const providerInterface = semanticProviderInterface(binding.capability.interface);
    const candidates = graph.nodes.filter((node): node is ApplicationProviderNode =>
      node.kind === 'provider'
      && node.interface === providerInterface
      && providerQualification(node) === binding.capability.qualifier,
    );
    if (candidates.length > 1) {
      const suffix = binding.capability.qualifier ? `#${binding.capability.qualifier}` : '';
      throw new Error(
        `Profile ${plan.profile.id} binding ${providerInterface}${suffix} matches ${candidates.length} semantic provider nodes; expected exactly one.`,
      );
    }
    if (!isApplicationProviderInterfaceKind(providerInterface)) {
      throw new Error(`Profile ${plan.profile.id} binds unsupported provider interface ${providerInterface}.`);
    }
    const source = candidates[0] ?? {
      id: `provider.implementation.${safeSegment(providerInterface)}${binding.capability.qualifier ? `.${safeSegment(binding.capability.qualifier)}` : ''}`,
      kind: 'provider' as const,
      name: binding.capability.qualifier
        ? `${providerInterface}.${binding.capability.qualifier}`
        : providerInterface,
      stability: 'experimental' as const,
      interface: providerInterface,
      implementation: 'unresolved-profile-implementation',
      ...(binding.capability.qualifier
        ? { config: { qualification: { apiVersion: 'applik8s.qualification/v1alpha1', name: binding.capability.qualifier } } }
        : {}),
    } satisfies ApplicationProviderNode;
    return { binding, providerInterface, candidates, source };
  });
  const sharedAuthorities = new Map<string, string>();
  for (const entry of [...bindingSources].sort((left, right) => {
    // An authored semantic node is the stable physical authority when the
    // same implementation is exposed through multiple logical capability
    // bindings. This commonly makes an unqualified application default an
    // alias of a named provider rather than a second installation.
    const leftAliases = Boolean(existingProviderAlias(left.source));
    const rightAliases = Boolean(existingProviderAlias(right.source));
    const independent = Number(leftAliases) - Number(rightAliases);
    const authored = Number(right.candidates.length > 0) - Number(left.candidates.length > 0);
    return independent || authored || left.source.id.localeCompare(right.source.id);
  })) {
    const key = `${entry.providerInterface}\u0000${entry.binding.implementation}`;
    if (!sharedAuthorities.has(key)) sharedAuthorities.set(key, entry.source.id);
  }

  for (const { binding, providerInterface, candidates, source } of bindingSources) {
    if (replacements.has(source.id)) {
      throw new Error(`Profile ${plan.profile.id} binds semantic provider ${source.id} more than once.`);
    }
    const implementation = implementations.get(binding.implementation);
    if (!implementation) {
      throw new Error(
        `Profile ${plan.profile.id} binding ${binding.id} references missing implementation ${binding.implementation}.`,
      );
    }
    const configuration = jsonObject(
      options.configuration
        ? resolveConfigurationBindings(implementation.configuration, options.configuration)
        : implementation.configuration,
      `Implementation ${implementation.id} configuration`,
    );
    const kind = requiredString(
      configuration.kind,
      `Implementation ${implementation.id} configuration.kind`,
    );
    const key = applicationProviderGraphConfigurationKey(providerInterface);
    const qualification = providerQualificationRecord(source);
    const semanticConfig = applicationProviderSemanticMetadata(source);
    const aliasCandidate = existingProviderAlias(source);
    const bindingKindCandidate = source.config
      ? Reflect.get(source.config, 'bindingKind')
      : undefined;
    const aliasOf = aliasCandidate;
    const bindingKind = typeof bindingKindCandidate === 'string'
      && bindingKindCandidate.trim()
      ? bindingKindCandidate
      : undefined;
    const sharedAuthorityId = sharedAuthorities.get(
      `${providerInterface}\u0000${binding.implementation}`,
    );
    const physicalAliasOf = sharedAuthorityId && sharedAuthorityId !== source.id
      ? sharedAuthorityId
      : aliasOf;
    replacements.set(source.id, {
      ...source,
      implementation: kind,
      config: {
        // Profile selection chooses physical configuration; it must not erase
        // semantic runtime metadata (for example IdentityProvider callback
        // sources) carried by the authored provider node.
        ...semanticConfig,
        provider: kind,
        ...(bindingKind ? { bindingKind } : {}),
        ...(physicalAliasOf ? { aliasOf: physicalAliasOf } : {}),
        ...(qualification ? { qualification } : {}),
        ...(key ? { [key]: configuration } : configuration),
      },
    });
    if (candidates.length === 0) additions.push(source);
  }

  return {
    ...graph,
    nodes: [
      ...graph.nodes.map((node) => replacements.get(node.id) ?? node),
      ...additions.map((node) => replacements.get(node.id) as ApplicationProviderNode),
    ],
  };
}

/**
 * Metadata authored on a semantic provider can survive physical selection,
 * but its physical configuration cannot. In particular, installation-profile
 * branches and their flattened values are an older selection authority. A
 * blanket object spread here allowed those values to override the provider
 * chosen by an assembly profile (for example a new JetStream installation
 * retaining the legacy server endpoint).
 *
 * Keep this deliberately explicit. New semantic metadata must earn a place in
 * the portable contract instead of accidentally becoming deployment input.
 */
function applicationProviderSemanticMetadata(
  provider: ApplicationProviderNode,
): Record<string, JsonValue> {
  const config = provider.config;
  if (!config) return {};
  return Object.fromEntries(
    [
      'runtimeContract',
      'callableRuntime',
      'identity',
      'identityRuntime',
      // MCP OAuth admission is a semantic property of the authored identity
      // surface. Compatibility profile selections use this contract to omit
      // OAuth-only servers from deterministic profiles while retaining Ory
      // coordinates for Dedicated/External instances.
      'identityInfrastructure',
    ]
      .flatMap((key) => {
        const value = Reflect.get(config, key);
        return value === undefined ? [] : [[key, value as JsonValue]];
      }),
  );
}

function existingProviderAlias(provider: ApplicationProviderNode): string | undefined {
  const candidate = provider.config
    ? Reflect.get(provider.config, 'aliasOf')
    : undefined;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate
    : undefined;
}

export function applicationProviderGraphConfigurationKey(
  providerInterface: string,
): string | undefined {
  switch (providerInterface) {
    case 'AI': return 'ai';
    case 'AnalyticalDatabase': return 'analyticalDatabase';
    case 'ApplicationHost': return 'host';
    case 'ContainerRegistry': return 'containerRegistry';
    case 'IndexStore': return 'indexStore';
    case 'JobRuntime': return 'jobRuntime';
    case 'ObjectStorage': return 'objectStorage';
    case 'Scheduler': return 'scheduler';
    case 'ActorRuntime': return 'actorRuntime';
    case 'Observability': return 'observability';
    case 'LakehouseDataset': return 'lakehouseDataset';
    case 'LakehouseQuery': return 'lakehouseQuery';
    case 'Search': return 'search';
    case 'WebSearch': return 'webSearch';
    case 'TransactionalDatabase': return 'transactionalDatabase';
    default: return undefined;
  }
}

/**
 * Select only declared non-secret configuration values at the operation-host
 * boundary. Secret bindings are deliberately excluded from the returned map.
 */
export function applicationImplementationConfigurationValues(
  plan: ApplicationImplementationPlan,
  lookup: (reference: string) => string | undefined,
): Readonly<Record<string, string | undefined>> {
  const references = new Set(
    plan.implementations.flatMap((implementation) =>
      implementation.configurationSources
        .filter((source) => source.kind === 'config')
        .map((source) => source.reference)),
  );
  return Object.freeze(Object.fromEntries(
    [...references].sort().map((reference) => [reference, lookup(reference)]),
  ));
}

function semanticProviderInterface(value: string): string {
  return value.replace(/@v[0-9][A-Za-z0-9.-]*$/u, '');
}

function providerQualification(provider: ApplicationProviderNode): string | undefined {
  return providerQualificationRecord(provider)?.name;
}

function providerQualificationRecord(
  provider: ApplicationProviderNode,
): { readonly apiVersion: string; readonly name: string } | undefined {
  const direct = jsonObjectOrUndefined(provider.config?.qualification);
  const profile = jsonObjectOrUndefined(provider.config?.profile);
  const nested = jsonObjectOrUndefined(profile?.qualification);
  const qualification = direct ?? nested;
  const name = typeof qualification?.name === 'string' && qualification.name.trim()
    ? qualification.name
    : undefined;
  if (!name) return undefined;
  return {
    apiVersion: typeof qualification?.apiVersion === 'string'
      ? qualification.apiVersion
      : 'applik8s.qualification/v1alpha1',
    name,
  };
}

function jsonObject(value: JsonValue, label: string): JsonObject {
  const result = jsonObjectOrUndefined(value);
  if (!result) throw new Error(`${label} must be an object.`);
  return result;
}

function jsonObjectOrUndefined(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function safeSegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function resolveConfigurationBindings(
  value: JsonValue,
  sources: Readonly<Record<string, string | undefined>>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveConfigurationBindings(entry, sources));
  }
  if (value === null || typeof value !== 'object') return value;
  const object = value as JsonObject;
  if (
    object.apiVersion === 'applik8s.configurationBinding/v1alpha1'
    && object.kind === 'config'
    && object.source === 'environment'
  ) {
    const reference = requiredString(object.reference, 'Configuration binding reference');
    const raw = sources[reference];
    if (raw === undefined || raw === '') {
      if (object.default !== undefined) return object.default;
      if (object.required === false) return null;
      throw new Error(`Required application configuration ${reference} is not set.`);
    }
    switch (object.valueType) {
      case 'integer': {
        const integer = Number(raw);
        if (!Number.isSafeInteger(integer)) throw new Error(`Application configuration ${reference} must be a safe integer.`);
        return integer;
      }
      case 'boolean':
        if (raw === 'true' || raw === '1') return true;
        if (raw === 'false' || raw === '0') return false;
        throw new Error(`Application configuration ${reference} must be true, false, 1, or 0.`);
      case 'url':
        try {
          return new URL(raw).toString();
        } catch {
          throw new Error(`Application configuration ${reference} must be an absolute URL.`);
        }
      case 'string':
        return raw;
      default:
        throw new Error(`Application configuration ${reference} has unsupported valueType ${String(object.valueType)}.`);
    }
  }
  if (
    object.apiVersion === 'applik8s.configurationBinding/v1alpha1'
    && object.kind === 'secret'
  ) {
    return object;
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [key, resolveConfigurationBindings(entry, sources)]),
  );
}
