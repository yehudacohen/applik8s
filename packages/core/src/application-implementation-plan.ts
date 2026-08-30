import type {
  ApplicationCanonicalIdentity,
  ApplicationProviderMaturity,
  ApplicationSourceProvenance,
} from './application-foundation.js';
import { applicationProviderIdentity } from './application-foundation.js';
import { canonicalJsonV1String } from './canonical-json.js';

export const applicationImplementationPlanVersion = 'applik8s.implementationPlan/v1alpha1' as const;

export interface ApplicationCapabilityReference {
  readonly interface: string;
  readonly qualifier?: string;
}

export interface ApplicationProviderConstructorReference {
  readonly package: string;
  readonly export: string;
  readonly version: string;
}

export type ApplicationImplementationIdentitySource =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'declaration' }
  | { readonly kind: 'inline'; readonly parent: string; readonly slot: string };

export interface ApplicationImplementationDependencyDeclaration {
  readonly slot: string;
  readonly requirement: ApplicationCapabilityReference;
  readonly requiredGuarantees: readonly string[];
  /** Private provider-internal operations; never callback authority. */
  readonly operations: readonly string[];
  readonly input:
    | { readonly kind: 'implementation'; readonly declaration: string }
    | { readonly kind: 'capability-reference'; readonly capability: ApplicationCapabilityReference };
  readonly visibility: 'private' | 'explicitly-provided';
}

export interface ApplicationImplementationDeclaration {
  /** Compiler-local reference. This is never persisted as implementation identity. */
  readonly key: string;
  readonly capability: ApplicationCapabilityReference;
  readonly provider: ApplicationProviderConstructorReference;
  readonly identity: ApplicationImplementationIdentitySource;
  readonly provenance: ApplicationSourceProvenance;
  /** Digest of configuration shape and non-secret values; Secret values are forbidden. */
  readonly configurationDigest: string;
  readonly configurationSources: readonly {
    readonly kind: 'config' | 'secret';
    readonly reference: string;
    readonly required: boolean;
  }[];
  readonly guarantees: readonly string[];
  readonly runtimeAdapter: string;
  readonly deploymentContributor?: string;
  readonly readiness: string;
  readonly lifecycle: 'application' | 'shared' | 'external' | 'retained';
  readonly migration: string;
  readonly evidence: readonly string[];
  readonly maturity: ApplicationProviderMaturity;
  readonly dependencies: readonly ApplicationImplementationDependencyDeclaration[];
}

export interface ApplicationProfileImplementationBinding {
  readonly id: string;
  readonly capability: ApplicationCapabilityReference;
  readonly implementation: string;
  readonly provenance: ApplicationSourceProvenance;
}

export interface ApplicationImplementationResolutionInput {
  readonly application: string;
  readonly profile: {
    readonly id: string;
    readonly digest: string;
    readonly provenance: readonly ApplicationSourceProvenance[];
  };
  readonly declarations: readonly ApplicationImplementationDeclaration[];
  readonly bindings: readonly ApplicationProfileImplementationBinding[];
}

export interface ApplicationCapabilityImplementationIdentity {
  readonly apiVersion: 'applik8s.implementationIdentity/v1alpha1';
  readonly identityVersion: 1;
  readonly canonical: ApplicationCanonicalIdentity;
  readonly capability: ApplicationCapabilityReference;
  readonly provider: ApplicationProviderConstructorReference;
  readonly source: ApplicationImplementationIdentitySource['kind'];
  readonly explicitName?: string;
  readonly parent?: {
    readonly implementation: ApplicationCanonicalIdentity['id'];
    readonly slot: string;
  };
  readonly provenance: ApplicationSourceProvenance;
  readonly configurationDigest: string;
}

export interface ApplicationImplementationDependencyPlan {
  readonly id: string;
  readonly consumer: ApplicationCanonicalIdentity['id'];
  readonly dependency: ApplicationCanonicalIdentity['id'];
  readonly slot: string;
  readonly requirement: ApplicationCapabilityReference;
  readonly requiredGuarantees: readonly string[];
  readonly operations: readonly string[];
  readonly resolution: 'implementation' | 'capability-reference';
  readonly visibility: 'private' | 'explicitly-provided';
}

export interface ApplicationImplementationPlanNode {
  readonly id: ApplicationCanonicalIdentity['id'];
  readonly identity: ApplicationCapabilityImplementationIdentity;
  readonly configurationSources: ApplicationImplementationDeclaration['configurationSources'];
  readonly guarantees: readonly string[];
  readonly runtimeAdapter: string;
  readonly deploymentContributor?: string;
  readonly readiness: string;
  readonly lifecycle: ApplicationImplementationDeclaration['lifecycle'];
  readonly migration: string;
  readonly evidence: readonly string[];
  readonly maturity: ApplicationProviderMaturity;
}

export interface ApplicationImplementationBindingPlan {
  readonly id: string;
  readonly capability: ApplicationCapabilityReference;
  readonly implementation: ApplicationCanonicalIdentity['id'];
  readonly provenance: ApplicationSourceProvenance;
}

export interface ApplicationImplementationPlan {
  readonly schemaVersion: typeof applicationImplementationPlanVersion;
  readonly application: string;
  readonly profile: ApplicationImplementationResolutionInput['profile'];
  readonly bindings: readonly ApplicationImplementationBindingPlan[];
  readonly implementations: readonly ApplicationImplementationPlanNode[];
  readonly dependencies: readonly ApplicationImplementationDependencyPlan[];
}

export class ApplicationImplementationResolutionError extends Error {
  constructor(
    readonly code:
      | 'PROFILE_BINDING_CONFLICT'
      | 'PROVIDER_DEPENDENCY_MISSING'
      | 'PROVIDER_DEPENDENCY_INCOMPATIBLE'
      | 'PROVIDER_DEPENDENCY_CYCLE'
      | 'PROVIDER_IMPLEMENTATION_IDENTITY_UNSTABLE'
      | 'PROVIDER_IMPLEMENTATION_IDENTITY_COLLISION'
      | 'PROVIDER_CONFIGURATION_INVALID',
    message: string,
    readonly path: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApplicationImplementationResolutionError';
  }
}

export function resolveApplicationImplementationPlan(
  input: ApplicationImplementationResolutionInput,
): ApplicationImplementationPlan {
  requireText(input.application, 'application');
  requireText(input.profile.id, 'profile ID');
  requireDigest(input.profile.digest, 'profile digest');
  const declarations = new Map<string, ApplicationImplementationDeclaration>();
  for (const declaration of input.declarations) {
    requireText(declaration.key, 'implementation declaration key');
    if (declarations.has(declaration.key)) {
      throw resolutionError(
        'PROVIDER_IMPLEMENTATION_IDENTITY_COLLISION',
        `Implementation declaration ${declaration.key} is duplicated.`,
        declaration.key,
      );
    }
    validateDeclaration(declaration);
    declarations.set(declaration.key, declaration);
  }

  const bindingsByCapability = new Map<string, ApplicationProfileImplementationBinding>();
  const bindingsById = new Set<string>();
  for (const binding of input.bindings) {
    requireText(binding.id, 'profile binding ID');
    if (bindingsById.has(binding.id)) {
      throw resolutionError('PROFILE_BINDING_CONFLICT', `Profile binding ${binding.id} is duplicated.`, binding.id);
    }
    bindingsById.add(binding.id);
    const capability = capabilityKey(binding.capability);
    if (bindingsByCapability.has(capability)) {
      throw resolutionError('PROFILE_BINDING_CONFLICT', `Profile binds ${capability} more than once.`, binding.id);
    }
    if (!declarations.has(binding.implementation)) {
      throw resolutionError(
        'PROVIDER_DEPENDENCY_MISSING',
        `Profile binding ${binding.id} references missing implementation ${binding.implementation}.`,
        binding.id,
      );
    }
    bindingsByCapability.set(capability, binding);
  }

  const reachable = new Set<string>();
  const discover = (key: string, path: readonly string[]): void => {
    if (reachable.has(key)) return;
    const declaration = declarations.get(key);
    if (!declaration) {
      throw resolutionError('PROVIDER_DEPENDENCY_MISSING', `Implementation ${key} does not exist.`, ...path, key);
    }
    reachable.add(key);
    if (declaration.identity.kind === 'inline') {
      discover(declaration.identity.parent, [...path, key, declaration.identity.slot]);
    }
    for (const dependency of declaration.dependencies) {
      const target = dependency.input.kind === 'implementation'
        ? dependency.input.declaration
        : bindingsByCapability.get(capabilityKey(dependency.input.capability))?.implementation;
      if (!target) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_MISSING',
          `Implementation ${key} cannot resolve ${capabilityKey(dependency.requirement)} for slot ${dependency.slot}.`,
          ...path,
          key,
          dependency.slot,
        );
      }
      discover(target, [...path, key, dependency.slot]);
    }
  };
  for (const binding of input.bindings) discover(binding.implementation, [binding.id]);

  const identityByDeclaration = new Map<string, ApplicationCapabilityImplementationIdentity>();
  const resolvingIdentity = new Set<string>();
  const resolveIdentity = (key: string): ApplicationCapabilityImplementationIdentity => {
    const existing = identityByDeclaration.get(key);
    if (existing) return existing;
    const declaration = declarations.get(key);
    if (!declaration) {
      throw resolutionError('PROVIDER_DEPENDENCY_MISSING', `Implementation ${key} does not exist.`, key);
    }
    if (resolvingIdentity.has(key)) {
      throw resolutionError('PROVIDER_DEPENDENCY_CYCLE', `Implementation identity cycle reaches ${key}.`, ...resolvingIdentity, key);
    }
    resolvingIdentity.add(key);
    const identity = implementationIdentity(input.application, declaration, resolveIdentity);
    resolvingIdentity.delete(key);
    identityByDeclaration.set(key, identity);
    return identity;
  };
  for (const key of reachable) resolveIdentity(key);

  const declarationByIdentity = new Map<string, string>();
  for (const [key, identity] of identityByDeclaration) {
    const previous = declarationByIdentity.get(identity.canonical.id);
    if (previous && previous !== key) {
      throw resolutionError(
        'PROVIDER_IMPLEMENTATION_IDENTITY_COLLISION',
        `Implementations ${previous} and ${key} claim ${identity.canonical.id}. Reuse one value or assign distinct stable IDs.`,
        previous,
        key,
      );
    }
    declarationByIdentity.set(identity.canonical.id, key);
  }

  const dependencies: ApplicationImplementationDependencyPlan[] = [];
  for (const declaration of [...declarations.values()].filter(({ key }) => reachable.has(key))) {
    const consumer = resolveIdentity(declaration.key);
    const slots = new Set<string>();
    for (const dependency of declaration.dependencies) {
      requireText(dependency.slot, 'implementation dependency slot');
      requireUniqueValues(
        dependency.requiredGuarantees,
        `Implementation ${declaration.key} dependency ${dependency.slot} required guarantees`,
      );
      if (slots.has(dependency.slot)) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_INCOMPATIBLE',
          `Implementation ${declaration.key} declares dependency slot ${dependency.slot} more than once.`,
          declaration.key,
          dependency.slot,
        );
      }
      slots.add(dependency.slot);
      const targetKey = dependency.input.kind === 'implementation'
        ? dependency.input.declaration
        : bindingsByCapability.get(capabilityKey(dependency.input.capability))?.implementation;
      if (!targetKey) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_MISSING',
          `Implementation ${declaration.key} cannot resolve ${capabilityKey(dependency.requirement)} for slot ${dependency.slot}.`,
          declaration.key,
          dependency.slot,
        );
      }
      const targetDeclaration = declarations.get(targetKey);
      if (!targetDeclaration) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_MISSING',
          `Implementation ${declaration.key} references missing dependency ${targetKey}.`,
          declaration.key,
          dependency.slot,
        );
      }
      if (capabilityKey(targetDeclaration.capability) !== capabilityKey(dependency.requirement)) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_INCOMPATIBLE',
          `Implementation ${targetKey} satisfies ${capabilityKey(targetDeclaration.capability)}, not required ${capabilityKey(dependency.requirement)}.`,
          declaration.key,
          dependency.slot,
          targetKey,
        );
      }
      const missingGuarantees = dependency.requiredGuarantees.filter(
        (guarantee) => !targetDeclaration.guarantees.includes(guarantee),
      );
      if (missingGuarantees.length > 0) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_INCOMPATIBLE',
          `Implementation ${targetKey} lacks required guarantees ${missingGuarantees.join(', ')} for ${declaration.key}.${dependency.slot}.`,
          declaration.key,
          dependency.slot,
          targetKey,
        );
      }
      const operations = [...new Set(dependency.operations)].sort();
      if (operations.length !== dependency.operations.length || operations.some((operation) => !operation.trim() || operation.includes('*'))) {
        throw resolutionError(
          'PROVIDER_DEPENDENCY_INCOMPATIBLE',
          `Implementation ${declaration.key} dependency ${dependency.slot} requires explicit unique provider-internal operations without wildcards.`,
          declaration.key,
          dependency.slot,
        );
      }
      const target = resolveIdentity(targetKey);
      dependencies.push({
        id: dependencyPlanId(consumer.canonical.id, dependency.slot, target.canonical.id),
        consumer: consumer.canonical.id,
        dependency: target.canonical.id,
        slot: dependency.slot,
        requirement: dependency.requirement,
        requiredGuarantees: [...new Set(dependency.requiredGuarantees)].sort(),
        operations,
        resolution: dependency.input.kind,
        visibility: dependency.visibility,
      });
    }
  }
  for (const declaration of [...declarations.values()].filter(({ key }) => reachable.has(key))) {
    if (declaration.identity.kind !== 'inline') continue;
    const identity = resolveIdentity(declaration.key);
    const parent = resolveIdentity(declaration.identity.parent);
    if (!dependencies.some((edge) => (
      edge.consumer === parent.canonical.id
      && edge.dependency === identity.canonical.id
      && edge.slot === declaration.identity.slot
    ))) {
      throw resolutionError(
        'PROVIDER_DEPENDENCY_INCOMPATIBLE',
        `Inline implementation ${declaration.key} must be consumed by parent ${declaration.identity.parent} through slot ${declaration.identity.slot}.`,
        declaration.identity.parent,
        declaration.identity.slot,
        declaration.key,
      );
    }
  }
  assertAcyclic(dependencies);

  const bindings = input.bindings.map((binding) => {
    const declaration = declarations.get(binding.implementation) as ApplicationImplementationDeclaration;
    if (capabilityKey(declaration.capability) !== capabilityKey(binding.capability)) {
      throw resolutionError(
        'PROVIDER_DEPENDENCY_INCOMPATIBLE',
        `Profile binding ${binding.id} selects ${capabilityKey(declaration.capability)} for ${capabilityKey(binding.capability)}.`,
        binding.id,
      );
    }
    return {
      id: binding.id,
      capability: binding.capability,
      implementation: resolveIdentity(binding.implementation).canonical.id,
      provenance: binding.provenance,
    };
  });

  const implementations = [...declarations.values()].filter(({ key }) => reachable.has(key)).map((declaration): ApplicationImplementationPlanNode => {
    const identity = resolveIdentity(declaration.key);
    return {
      id: identity.canonical.id,
      identity,
      configurationSources: sortedConfigurationSources(declaration.configurationSources),
      guarantees: [...new Set(declaration.guarantees)].sort(),
      runtimeAdapter: declaration.runtimeAdapter,
      ...(declaration.deploymentContributor ? { deploymentContributor: declaration.deploymentContributor } : {}),
      readiness: declaration.readiness,
      lifecycle: declaration.lifecycle,
      migration: declaration.migration,
      evidence: [...new Set(declaration.evidence)].sort(),
      maturity: declaration.maturity,
    };
  });

  return {
    schemaVersion: applicationImplementationPlanVersion,
    application: input.application,
    profile: {
      ...input.profile,
      provenance: [...input.profile.provenance].sort(compareProvenance),
    },
    bindings: bindings.sort((left, right) => left.id.localeCompare(right.id)),
    implementations: implementations.sort((left, right) => left.id.localeCompare(right.id)),
    dependencies: dependencies.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function serializeApplicationImplementationPlan(plan: ApplicationImplementationPlan): string {
  return `${canonicalJsonV1String(plan)}\n`;
}

function implementationIdentity(
  application: string,
  declaration: ApplicationImplementationDeclaration,
  resolveIdentity: (key: string) => ApplicationCapabilityImplementationIdentity,
): ApplicationCapabilityImplementationIdentity {
  const capability = capabilityKey(declaration.capability);
  let semanticKey: string;
  let parent: ApplicationCapabilityImplementationIdentity['parent'];
  let explicitName: string | undefined;
  if (declaration.identity.kind === 'named') {
    requireText(declaration.identity.name, 'implementation explicit identity');
    explicitName = declaration.identity.name;
    semanticKey = lengthPrefixed(['named', capability, declaration.provider.package, declaration.provider.export, explicitName]);
  } else if (declaration.identity.kind === 'inline') {
    requireText(declaration.identity.slot, 'inline implementation slot');
    const parentIdentity = resolveIdentity(declaration.identity.parent);
    parent = { implementation: parentIdentity.canonical.id, slot: declaration.identity.slot };
    semanticKey = lengthPrefixed(['inline', parentIdentity.canonical.id, declaration.identity.slot, capability, declaration.provider.package, declaration.provider.export]);
  } else {
    if (!declaration.provenance.module || !declaration.provenance.symbol) {
      throw resolutionError(
        'PROVIDER_IMPLEMENTATION_IDENTITY_UNSTABLE',
        `Unnamed implementation ${declaration.key} requires module and declaration-symbol provenance or .identified(...).`,
        declaration.key,
      );
    }
    semanticKey = lengthPrefixed([
      'declaration',
      capability,
      declaration.provider.package,
      declaration.provider.export,
      declaration.provenance.module,
      declaration.provenance.symbol,
    ]);
  }
  const canonical = applicationProviderIdentity({
    application,
    capabilityInterface: capability,
    nodeId: semanticKey,
    ...(parent ? { parentId: parent.implementation } : {}),
  });
  return {
    apiVersion: 'applik8s.implementationIdentity/v1alpha1',
    identityVersion: 1,
    canonical,
    capability: declaration.capability,
    provider: declaration.provider,
    source: declaration.identity.kind,
    ...(explicitName ? { explicitName } : {}),
    ...(parent ? { parent } : {}),
    provenance: declaration.provenance,
    configurationDigest: declaration.configurationDigest,
  };
}

function validateDeclaration(declaration: ApplicationImplementationDeclaration): void {
  requireCapability(declaration.capability, declaration.key);
  requireText(declaration.provider.package, 'provider package');
  requireText(declaration.provider.export, 'provider export');
  requireText(declaration.provider.version, 'provider version');
  requireDigest(declaration.configurationDigest, `implementation ${declaration.key} configuration digest`);
  requireText(declaration.runtimeAdapter, 'runtime adapter');
  requireText(declaration.readiness, 'readiness observer');
  requireText(declaration.migration, 'migration contract');
  requireUniqueValues(declaration.guarantees, `Implementation ${declaration.key} guarantees`);
  requireUniqueValues(declaration.evidence, `Implementation ${declaration.key} evidence`);
  const sourceReferences = new Set<string>();
  for (const source of declaration.configurationSources) {
    requireText(source.reference, 'configuration source reference');
    const key = `${source.kind}:${source.reference}`;
    if (sourceReferences.has(key)) {
      throw resolutionError('PROVIDER_CONFIGURATION_INVALID', `Implementation ${declaration.key} repeats configuration source ${key}.`, declaration.key);
    }
    sourceReferences.add(key);
  }
}

function requireCapability(capability: ApplicationCapabilityReference, path: string): void {
  requireText(capability.interface, 'capability interface');
  if (capability.qualifier !== undefined) requireText(capability.qualifier, 'capability qualifier');
  if (capability.interface.includes('*') || capability.qualifier?.includes('*')) {
    throw resolutionError('PROVIDER_DEPENDENCY_INCOMPATIBLE', `Capability ${capabilityKey(capability)} cannot contain wildcards.`, path);
  }
}

function assertAcyclic(edges: readonly ApplicationImplementationDependencyPlan[]): void {
  const outgoing = new Map<string, readonly ApplicationImplementationDependencyPlan[]>();
  for (const edge of edges) outgoing.set(edge.consumer, [...(outgoing.get(edge.consumer) ?? []), edge]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      const cycle = [...path.slice(start), node];
      throw resolutionError('PROVIDER_DEPENDENCY_CYCLE', `Provider dependency cycle: ${cycle.join(' -> ')}.`, ...cycle);
    }
    visiting.add(node);
    path.push(node);
    for (const edge of outgoing.get(node) ?? []) visit(edge.dependency);
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of outgoing.keys()) visit(node);
}

function capabilityKey(capability: ApplicationCapabilityReference): string {
  return `${capability.interface}${capability.qualifier ? `#${capability.qualifier}` : ''}`;
}

function dependencyPlanId(consumer: string, slot: string, dependency: string): string {
  return `implementation-dependency:${lengthPrefixed([consumer, slot, dependency])}`;
}

function sortedConfigurationSources(
  sources: ApplicationImplementationDeclaration['configurationSources'],
): ApplicationImplementationDeclaration['configurationSources'] {
  return [...sources].sort((left, right) => `${left.kind}:${left.reference}`.localeCompare(`${right.kind}:${right.reference}`));
}

function compareProvenance(left: ApplicationSourceProvenance, right: ApplicationSourceProvenance): number {
  return left.id.localeCompare(right.id);
}

function lengthPrefixed(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

function requireText(value: string, label: string): void {
  if (!value.trim() || [...value].some((character) => character.charCodeAt(0) < 0x20)) {
    throw resolutionError('PROVIDER_IMPLEMENTATION_IDENTITY_UNSTABLE', `${label} must be non-empty and contain no control characters.`);
  }
}

function requireDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw resolutionError('PROVIDER_CONFIGURATION_INVALID', `${label} must be a full sha256 digest.`);
  }
}

function requireUniqueValues(values: readonly string[], label: string): void {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value) || new Set(normalized).size !== values.length) {
    throw resolutionError('PROVIDER_CONFIGURATION_INVALID', `${label} must contain unique non-empty values.`);
  }
}

function resolutionError(
  code: ApplicationImplementationResolutionError['code'],
  message: string,
  ...path: string[]
): ApplicationImplementationResolutionError {
  return new ApplicationImplementationResolutionError(code, message, path);
}
