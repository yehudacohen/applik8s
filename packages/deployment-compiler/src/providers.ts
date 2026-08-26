// typecast-file-boundary: Provider option records are validated by provider kind before deployment bindings are materialized.
import type { ApplicationProviderNode, ApplicationRuntimeAccessRequirement } from "@applik8s/core";
import {
  type ApplicationDeploymentEdge,
  type ApplicationDeploymentNode,
  type ApplicationExternalProviderDeploymentNode,
  type ApplicationKubernetesDirectDeploymentNode,
  applicationDeploymentOutputReference,
  type DeploymentJsonObject,
  type DeploymentJsonValue,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import { celldProviderRuntimeAccess } from './celld-runtime-access.js';
import type { ApplicationRuntimeAccessWorkloadPlacement } from './runtime-access-plan.js';
import type {
  ApplicationDeploymentContribution,
  ApplicationDeploymentContributor,
  ApplicationDeploymentPlanningContext,
  ApplicationDeploymentRuntimeAccessTarget,
  ApplicationTypeKroFragmentDescriptor,
} from "./types.js";

export type ApplicationProviderExecution =
  | "root-composition"
  | "direct-provider"
  | "runtime-only"
  | "external-controller";

interface BuiltinProviderRegistration {
  readonly interface: string;
  readonly implementation: string;
  readonly execution: ApplicationProviderExecution;
}

const builtinProviderRegistrations: readonly BuiltinProviderRegistration[] = [
  { interface: "AI", implementation: "ai-deterministic", execution: "runtime-only" },
  { interface: "AI", implementation: "envoy-ai-gateway", execution: "external-controller" },
  { interface: "ApplicationHost", implementation: "kubernetes-application-host", execution: "root-composition" },
  { interface: "ApplicationHost", implementation: "managed-application-host", execution: "root-composition" },
  { interface: "Authorization", implementation: "application-authorization", execution: "runtime-only" },
  { interface: "Certificate", implementation: "cert-manager", execution: "root-composition" },
  { interface: "Certificate", implementation: "custom", execution: "runtime-only" },
  { interface: "ContainerRegistry", implementation: "application-provider-selection", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "harbor-container-registry", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "oci-container-registry", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "orbstack-container-registry", execution: "external-controller" },
  { interface: "CounterStore", implementation: "kubernetes-resource-counter", execution: "runtime-only" },
  { interface: "CredentialStore", implementation: "kubernetes-secret-credentials", execution: "runtime-only" },
  { interface: "DnsPublication", implementation: "custom", execution: "runtime-only" },
  { interface: "DnsPublication", implementation: "external-dns", execution: "root-composition" },
  { interface: "EventLog", implementation: "nats-jetstream", execution: "direct-provider" },
  { interface: "EventSource", implementation: "kubernetes-watch", execution: "runtime-only" },
  { interface: "HttpExposure", implementation: "ingress", execution: "root-composition" },
  { interface: "HttpExposure", implementation: "node-port", execution: "root-composition" },
  { interface: "IndexStore", implementation: "valkey", execution: "root-composition" },
  { interface: "TransactionalDatabase", implementation: "postgres", execution: "root-composition" },
  { interface: "ObjectStorage", implementation: "kubernetes-configmap-objects", execution: "runtime-only" },
  { interface: "ObjectStorage", implementation: "s3", execution: "root-composition" },
  { interface: "NotificationDelivery", implementation: "local-inspectable", execution: "runtime-only" },
  { interface: "NotificationDelivery", implementation: "smtp", execution: "runtime-only" },
  { interface: "PaymentProvider", implementation: "local-simulated", execution: "runtime-only" },
  { interface: "PaymentProvider", implementation: "stripe", execution: "runtime-only" },
  { interface: "AnalyticalDatabase", implementation: "clickhouse", execution: "root-composition" },
  { interface: "Queue", implementation: "kubernetes-configmap-queue", execution: "runtime-only" },
  { interface: "IdentityProvider", implementation: "identity-provider", execution: "runtime-only" },
  { interface: "OAuthAuthorizationServer", implementation: "oauth-authorization-server", execution: "runtime-only" },
  { interface: "Search", implementation: "opensearch", execution: "external-controller" },
  { interface: "Search", implementation: "postgres-search", execution: "runtime-only" },
  { interface: "Secret", implementation: "kubernetes-secret", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "application-provider-selection", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "structured-generation-deterministic", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "structured-generation-http", execution: "runtime-only" },
  { interface: "WorkflowEngine", implementation: "hatchet", execution: "direct-provider" },
  { interface: "Scheduler", implementation: "target-selected", execution: "runtime-only" },
  { interface: "Scheduler", implementation: "local-scheduler", execution: "runtime-only" },
  { interface: "Scheduler", implementation: "kubernetes-cronjob-scheduler", execution: "root-composition" },
  { interface: "Scheduler", implementation: "hatchet-scheduler", execution: "direct-provider" },
  { interface: "Scheduler", implementation: "eventbridge-scheduler", execution: "external-controller" },
  { interface: "ActorRuntime", implementation: "target-selected", execution: "runtime-only" },
  { interface: "ActorRuntime", implementation: "deterministic-local-actors", execution: "runtime-only" },
  { interface: "ActorRuntime", implementation: "celld-actors", execution: "direct-provider" },
  { interface: "ActorRuntime", implementation: "rivet-actors", execution: "external-controller" },
  { interface: "Observability", implementation: "local-otel", execution: "direct-provider" },
  { interface: "Observability", implementation: "clickstack", execution: "direct-provider" },
  { interface: "Observability", implementation: "cloudwatch", execution: "external-controller" },
  { interface: "Observability", implementation: "otlp", execution: "runtime-only" },
  { interface: "LakehouseDataset", implementation: "duckdb-dataset", execution: "runtime-only" },
  { interface: "LakehouseDataset", implementation: "s3-dataset", execution: "external-controller" },
  { interface: "LakehouseQuery", implementation: "duckdb-queries", execution: "runtime-only" },
  { interface: "LakehouseQuery", implementation: "athena-queries", execution: "external-controller" },
];

/**
 * Pure built-in provider catalog. Entries contribute portable data only;
 * TypeKro resolution happens later at the pinned adapter boundary.
 */
export function builtinApplicationDeploymentContributors(): readonly ApplicationDeploymentContributor[] {
  return builtinProviderRegistrations.map((registration) => ({
    interface: registration.interface,
    implementation: registration.implementation,
    version: 1,
    contribute(
      provider: ApplicationProviderNode,
      context: ApplicationDeploymentPlanningContext,
    ): ApplicationDeploymentContribution {
      const concreteProvider = targetSelectedProvider(provider, context);
      const providerDirect = context.target === "kubernetes"
        ? providerDirectContribution(concreteProvider, context)
        : { nodes: [], edges: [] };
      const runtimeAccessTargets = [
        ...applicationProviderRuntimeAccessTargets(concreteProvider, context),
        ...(providerDirect.runtimeAccessTargets ?? []),
      ];
      const nodes = [
        ...(registration.interface === "ContainerRegistry"
          ? managedHarborNodes(concreteProvider, context)
          : []),
        ...providerDirect.nodes,
      ];
      return {
        nodes,
        edges: providerDirect.edges,
        ...(runtimeAccessTargets.length > 0 ? { runtimeAccessTargets } : {}),
        ...(providerDirect.runtimeAccessRequirements?.length
          ? { runtimeAccessRequirements: providerDirect.runtimeAccessRequirements }
          : {}),
        ...(providerDirect.runtimeAccessWorkloads?.length
          ? { runtimeAccessWorkloads: providerDirect.runtimeAccessWorkloads }
          : {}),
        compositionFragments: [
          providerFragment(
            concreteProvider,
            context,
            providerExecution(concreteProvider.interface, concreteProvider.implementation),
          ),
        ],
      };
    },
  }));
}

function targetSelectedProvider(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode {
  if (provider.implementation !== "target-selected") return provider;
  if (provider.interface === "Scheduler") {
    return {
      ...provider,
      implementation:
        context.target === "local"
          ? "local-scheduler"
          : context.target === "aws" || context.target === "aws-local"
            ? "eventbridge-scheduler"
            : "kubernetes-cronjob-scheduler",
    };
  }
  if (provider.interface === "ActorRuntime") {
    const implementation =
      context.target === "local" || context.target === "aws-local"
        ? "deterministic-local-actors"
        : "celld-actors";
    const actorRuntime = context.target === "kubernetes"
      ? inferredKubernetesCelldConfiguration(context)
      : { kind: implementation };
    return {
      ...provider,
      implementation,
      config: {
        ...(provider.config ?? {}),
        actorRuntime,
      },
    };
  }
  if (provider.interface === "EventLog") {
    const implementation = context.target === "aws" || context.target === "aws-local"
      ? "kinesis"
      : "nats-jetstream";
    return {
      ...provider,
      implementation,
      config: {
        ...(provider.config ?? {}),
        ...(implementation === "nats-jetstream"
          ? {
              kind: implementation,
              name: `${safeProviderNodeId(context.graph.metadata.name)}-events`,
              namespace: applicationNamespace(context),
              provision: true,
              stream: "APPLIK8S_EVENTS",
              subjectPrefix: "applik8s",
              replicas: 1,
              storageSize: "8Gi",
            }
          : { kind: implementation }),
      },
    };
  }
  throw new Error(
    `Application provider ${provider.id} uses target-selected without a maintained ${context.target} mapping.`,
  );
}

/**
 * The default actor runtime is a semantic choice, not an instruction for an
 * application author to wire Celld's implementation details. On Kubernetes,
 * reuse the application's selected S3-compatible ObjectStorage authority as
 * the actor state store. This keeps one lifecycle owner and preserves the
 * provider-neutral `application.actor(...)` source surface.
 */
function inferredKubernetesCelldConfiguration(
  context: ApplicationDeploymentPlanningContext,
): DeploymentJsonObject {
  const candidates = context.graph.nodes.filter(
    (candidate): candidate is ApplicationProviderNode =>
      candidate.kind === "provider"
      && candidate.interface === "ObjectStorage"
      && !optionalObject(candidate.config?.qualification),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Target-selected ActorRuntime on Kubernetes requires exactly one unqualified ObjectStorage provider; found ${candidates.length}. `
      + "Bind one S3-compatible application ObjectStorage capability or select ActorRuntime.celld(...) explicitly.",
    );
  }
  const storageProvider = resolveApplicationProviderForTarget(
    candidates[0]!,
    context,
  );
  const storage = nestedObject(storageProvider.config, "objectStorage")
    ?? storageProvider.config
    ?? {};
  if (storageProvider.implementation !== "s3" || storage.kind !== "s3") {
    throw new Error(
      `Target-selected ActorRuntime on Kubernetes requires S3-compatible ObjectStorage, but ${candidates[0]!.id} selected ${storageProvider.implementation}. `
      + "Select an S3 provider or bind ActorRuntime explicitly.",
    );
  }
  const credentials = optionalObject(storage.credentialsSecret);
  if (!credentials || !optionalString(credentials.name)) {
    throw new Error(
      `Target-selected ActorRuntime cannot derive reference-only credentials from ${candidates[0]!.id}; the selected S3 provider must expose credentialsSecret.`,
    );
  }
  return compactJson({
    kind: "celld-actors",
    stateStore: storage,
  });
}

/**
 * Profile selections are a framework-owned deployment indirection rather than
 * a provider implementation. The selected branches remain encoded in the
 * source composition so TypeKro can lower their installation-schema
 * conditions. This keeps qualified/custom interfaces extensible without
 * requiring every provider adapter to register the same meta implementation.
 */
export function applicationProviderSelectionDeploymentContributor(
  providerInterface: string,
): ApplicationDeploymentContributor {
  return {
    interface: providerInterface,
    implementation: "application-provider-selection",
    version: 1,
    contribute(
      provider: ApplicationProviderNode,
      context: ApplicationDeploymentPlanningContext,
    ): ApplicationDeploymentContribution {
      const selected = resolveApplicationProviderForTarget(provider, context);
      const providerDirect = context.target === "kubernetes"
        ? providerDirectContribution(selected, context)
        : { nodes: [], edges: [] };
      const runtimeAccessTargets = [
        ...applicationProviderRuntimeAccessTargets(selected, context),
        ...(providerDirect.runtimeAccessTargets ?? []),
      ];
      return {
        nodes: [
          ...(selected.interface === "ContainerRegistry"
            ? managedHarborNodes(selected, context)
            : []),
          ...providerDirect.nodes,
        ],
        edges: providerDirect.edges,
        ...(runtimeAccessTargets.length > 0 ? { runtimeAccessTargets } : {}),
        ...(providerDirect.runtimeAccessRequirements?.length
          ? { runtimeAccessRequirements: providerDirect.runtimeAccessRequirements }
          : {}),
        ...(providerDirect.runtimeAccessWorkloads?.length
          ? { runtimeAccessWorkloads: providerDirect.runtimeAccessWorkloads }
          : {}),
        compositionFragments: [
          providerFragment(
            selected,
            context,
            providerExecution(selected.interface, selected.implementation),
          ),
        ],
      };
    },
  };
}

function selectedProfileProvider(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode {
  const profile = optionalObject(provider.config?.profile);
  const branches = Array.isArray(profile?.branches) ? profile.branches : [];
  if (branches.length === 0) {
    // Some non-profile indirections (notably the registry bootstrap) retain a
    // concrete provider configuration while using the selection identity.
    return {
      ...provider,
      implementation:
        selectedProviderImplementationFromConfig(provider.config)
        ?? provider.implementation,
    };
  }
  const branch = branches.find((candidate) => {
    const value = optionalObject(candidate);
    return value?.variant === context.profile;
  });
  const selectedBranch = optionalObject(branch);
  if (!selectedBranch) {
    throw new Error(
      `Application provider ${provider.id} has no deployment branch for profile ${context.profile}.`,
    );
  }
  const implementation = requiredString(
    selectedBranch.implementation,
    `Application provider ${provider.id} profile ${context.profile} implementation`,
  ).split("/", 1)[0]!;
  const selectedConfig = selectedProviderConfiguration(provider.config, context);
  const aliasConfig = selectedProviderAliasConfiguration(
    provider,
    implementation,
    context,
  );
  const branchConfig = optionalObject(
    selectedBranch.config === undefined
      ? undefined
      : selectedProviderValue(
          selectedBranch.config as DeploymentJsonValue,
          context,
        ),
  );
  const mergedConfig = {
    ...(selectedConfig ?? {}),
    ...(aliasConfig ?? {}),
  };
  const branchConfigKey = providerGraphConfigurationKey(provider.interface);
  const config =
    selectedConfig || aliasConfig || branchConfig
      ? branchConfig && branchConfigKey
        ? {
            ...mergedConfig,
            [branchConfigKey]: mergeProviderBranchConfiguration(
              optionalObject(mergedConfig[branchConfigKey]) ?? {},
              branchConfig,
            ),
          }
        : {
            ...mergedConfig,
            ...(branchConfig ?? {}),
          }
      : undefined;
  return {
    ...provider,
    implementation,
    ...(config ? { config } : { config: {} }),
  };
}

/** Resolves framework-owned target/profile indirections before a target adapter lowers a provider. */
export function resolveApplicationProviderForTarget(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode {
  const profiled = provider.implementation === 'application-provider-selection'
    || providerHasProfileBranches(provider)
    ? selectedProfileProvider(provider, context)
    : provider;
  const targeted = profiled.implementation === 'application-target-provider-selection'
    ? selectedTargetProvider(profiled, context)
    : profiled;
  return targetSelectedProvider(targeted, context);
}

function providerHasProfileBranches(provider: ApplicationProviderNode): boolean {
  const profile = optionalObject(provider.config?.profile);
  return Array.isArray(profile?.branches) && profile.branches.length > 0;
}

function selectedTargetProvider(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode {
  const configurationKey = providerGraphConfigurationKey(provider.interface);
  const nestedConfiguration = configurationKey
    ? optionalObject(provider.config?.[configurationKey])
    : undefined;
  const nestedTargetSelection = nestedConfiguration?.kind === 'application-target-provider-selection'
    ? nestedConfiguration
    : undefined;
  const targetSelection = optionalObject(provider.config?.targetSelection)
    ?? nestedTargetSelection;
  const targets = optionalObject(targetSelection?.targets);
  const selected = optionalObject(
    targets?.[context.target]
      ?? (context.target === 'aws-local' ? targets?.aws : undefined),
  );
  if (!selected) {
    throw new Error(
      `Application provider ${provider.id} has no deployment implementation for target ${context.target}. Add .${context.target === 'aws-local' ? 'awsLocal(...) or .aws(...)' : `${context.target}(...)`}.`,
    );
  }
  const implementation = requiredString(
    selected.implementation ?? selected.kind,
    `Application provider ${provider.id} target ${context.target} implementation`,
  );
  const configuration = optionalObject(selected.configuration) ?? selected;
  const key = providerGraphConfigurationKey(provider.interface);
  const { targetSelection: _targetSelection, ...baseConfig } = provider.config ?? {};
  const normalizedBaseConfig = nestedTargetSelection && configurationKey
    ? Object.fromEntries(Object.entries(baseConfig).filter(([candidate]) => candidate !== configurationKey))
    : baseConfig;
  return {
    ...provider,
    implementation,
    config: {
      ...normalizedBaseConfig,
      provider: implementation,
      ...(key ? { [key]: configuration } : configuration),
    },
  };
}

function mergeProviderBranchConfiguration(
  base: DeploymentJsonObject,
  branch: DeploymentJsonObject,
): DeploymentJsonObject {
  const merged: Record<string, DeploymentJsonValue> = { ...base };
  for (const [key, value] of Object.entries(branch)) {
    const previous = merged[key];
    const previousObject = optionalObject(previous);
    const valueObject = optionalObject(value);
    if (previousObject && valueObject) {
      merged[key] = mergeProviderBranchConfiguration(
        previousObject,
        valueObject,
      );
      continue;
    }
    if (Array.isArray(previous) && Array.isArray(value)) {
      merged[key] = Array.from(
        { length: Math.max(previous.length, value.length) },
        (_, index) => {
          const previousValue = previous[index];
          const branchValue = value[index];
          if (branchValue === undefined) return previousValue ?? null;
          const previousEntry = optionalObject(previousValue);
          const branchEntry = optionalObject(branchValue);
          return previousEntry && branchEntry
            ? mergeProviderBranchConfiguration(previousEntry, branchEntry)
            : branchValue;
        },
      );
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * Profile metadata stores the provider implementation itself, while ordinary
 * ApplicationGraph provider nodes wrap several implementations under a
 * capability-specific key. Merge the selected concrete branch at that same
 * boundary so nested topology/lifecycle configuration replaces CEL-merged
 * aliases rather than being stranded at the root of `config`.
 */
function providerGraphConfigurationKey(
  providerInterface: string,
): string | undefined {
  switch (providerInterface) {
    case "AI":
      return "ai";
    case "AnalyticalDatabase":
      return "analyticalDatabase";
    case "ApplicationHost":
      return "host";
    case "ContainerRegistry":
      return "containerRegistry";
    case "IndexStore":
      return "indexStore";
    case "ObjectStorage":
      return "objectStorage";
    case "Scheduler":
      return "scheduler";
    case "ActorRuntime":
      return "actorRuntime";
    case "Observability":
      return "observability";
    case "LakehouseDataset":
      return "lakehouseDataset";
    case "LakehouseQuery":
      return "lakehouseQuery";
    case "Search":
      return "search";
    case "TransactionalDatabase":
      return "transactionalDatabase";
    default:
      return undefined;
  }
}

/**
 * A qualified profile binding can also be installed as an application's
 * unqualified default. That derived alias carries the complete provider-native
 * configuration (including nested provisioning/lifecycle fields), while the
 * profile contract intentionally contains only non-sensitive descriptive
 * fields. Reuse the alias configuration for deployment planning without
 * compiling the alias as a second provider.
 */
function selectedProviderAliasConfiguration(
  provider: ApplicationProviderNode,
  implementation: string,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode["config"] {
  const candidates = context.graph.nodes.filter(
    (candidate): candidate is ApplicationProviderNode =>
      candidate.kind === "provider"
      && candidate.id !== provider.id
      && candidate.interface === provider.interface
      && candidate.implementation === implementation
      && !optionalObject(candidate.config?.qualification),
  );
  if (candidates.length > 1) {
    throw new Error(
      `Application provider ${provider.id} has multiple unqualified ${provider.interface}/${implementation} aliases; deployment configuration is ambiguous.`,
    );
  }
  return candidates[0]
    ? selectedProviderConfiguration(candidates[0].config, context)
    : undefined;
}

function selectedProviderConfiguration(
  config: ApplicationProviderNode["config"],
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode["config"] {
  if (!config) return config;
  return Object.fromEntries(
    Object.entries(config)
      .map(([key, value]) => [
        key,
        selectedProviderValue(value, context),
      ] as const)
      .filter((entry): entry is readonly [string, DeploymentJsonValue] =>
        entry[1] !== undefined),
  ) as ApplicationProviderNode["config"];
}

function selectedProviderValue(
  value: DeploymentJsonValue,
  context: ApplicationDeploymentPlanningContext,
): DeploymentJsonValue | undefined {
  if (typeof value === "string") {
    return materializedInstallationValue(value, context.installationSpec);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => selectedProviderValue(entry, context))
      .filter((entry): entry is DeploymentJsonValue => entry !== undefined);
  }
  const object = optionalObject(value);
  if (!object) return value;
  if (object.kind === "application-provider-selection") {
    const cases = optionalObject(object.cases);
    const selected = cases?.[context.profile] ?? object.default;
    if (selected === undefined) {
      throw new Error(
        `Application provider selection has no branch for profile ${context.profile}.`,
      );
    }
    return selectedProviderValue(selected, context);
  }
  return Object.fromEntries(
    Object.entries(object)
      .map(([key, entry]) => [
        key,
        selectedProviderValue(entry, context),
      ] as const)
      .filter((entry): entry is readonly [string, DeploymentJsonValue] =>
        entry[1] !== undefined),
  ) as DeploymentJsonObject;
}

function materializedInstallationValue(
  value: string,
  installationSpec: DeploymentJsonObject,
): DeploymentJsonValue | undefined {
  const exact = /^\$\{schema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/.exec(
    value,
  );
  if (exact) {
    return installationPathValue(installationSpec, exact[1] ?? "");
  }
  return value.replace(
    /\$\{schema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g,
    (_marker, path: string) => {
      const resolved = installationPathValue(installationSpec, path);
      if (
        resolved === undefined
        || resolved === null
        || typeof resolved === "object"
      ) {
        throw new Error(
          `Application provider configuration cannot interpolate installation path schema.spec${path} as text.`,
        );
      }
      return String(resolved);
    },
  );
}

function installationPathValue(
  installationSpec: DeploymentJsonObject,
  path: string,
): DeploymentJsonValue | undefined {
  let current: DeploymentJsonValue | undefined = installationSpec;
  for (const segment of path.split(".").filter(Boolean)) {
    const object = optionalObject(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

function selectedProviderImplementationFromConfig(
  config: ApplicationProviderNode["config"],
): string | undefined {
  if (!config) return undefined;
  for (const key of [
    "containerRegistry",
    "search",
    "transactionalDatabase",
    "analyticalDatabase",
    "objectStorage",
    "identityInfrastructure",
    "ai",
  ]) {
    const value = optionalObject(config[key]);
    const kind = optionalString(value?.kind);
    if (kind && kind !== "application-provider-selection") return kind;
  }
  return undefined;
}

function providerExecution(
  providerInterface: string,
  implementation: string,
): ApplicationProviderExecution {
  return builtinProviderRegistrations.find(
    (registration) =>
      registration.interface === providerInterface
      && registration.implementation === implementation,
  )?.execution ?? "root-composition";
}

interface ProviderDirectContribution {
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
  readonly runtimeAccessTargets?: readonly ApplicationDeploymentRuntimeAccessTarget[];
  readonly runtimeAccessRequirements?: readonly ApplicationRuntimeAccessRequirement[];
  readonly runtimeAccessWorkloads?: readonly ApplicationRuntimeAccessWorkloadPlacement[];
}

/**
 * Provider-owned non-private transports. The allowlist is deliberately
 * implementation-specific: adding another external provider requires an
 * adapter change and review instead of inheriting a config-shape heuristic.
 */
export function applicationProviderRuntimeAccessTargets(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): readonly ApplicationDeploymentRuntimeAccessTarget[] {
  if (
    provider.interface === 'StructuredGeneration'
    && provider.implementation === 'structured-generation-http'
  ) {
    const inference = optionalObject(optionalObject(context.installationSpec.providers)?.inference);
    const endpoint = optionalString(provider.config?.endpoint) ?? optionalString(inference?.endpoint);
    return [externalHttpRuntimeAccessTarget({
      capabilityId: provider.id,
      endpoint,
      responsibility: 'StructuredGeneration HTTP provider endpoint',
    })];
  }
  if (provider.interface === 'PaymentProvider' && provider.implementation === 'stripe') {
    return [externalHttpRuntimeAccessTarget({
      capabilityId: provider.id,
      endpoint: optionalString(provider.config?.endpoint) ?? 'https://api.stripe.com/v1',
      responsibility: 'Stripe payment API endpoint',
    })];
  }
  if (provider.interface === 'NotificationDelivery' && provider.implementation === 'smtp') {
    const notifications = optionalObject(optionalObject(context.installationSpec.providers)?.notifications);
    const host = optionalString(notifications?.host);
    const configuredPort = notifications?.port;
    const port = typeof configuredPort === 'number'
      && Number.isInteger(configuredPort)
      && configuredPort >= 1
      && configuredPort <= 65_535
      ? configuredPort
      : notifications?.secure === true ? 465 : 587;
    return [{
      capabilityId: provider.id,
      target: 'external',
      protocol: 'TCP',
      port,
      destination: host
        ? { kind: 'dnsName', hostname: host }
        : { kind: 'externalContract', responsibility: 'SMTP delivery endpoint from the selected runtime configuration' },
      fidelity: host ? 'port-only' : 'not-introspectable',
    }];
  }
  if (provider.interface === 'Observability' && provider.implementation === 'otlp') {
    const observability = optionalObject(provider.config?.observability) ?? provider.config;
    return [externalHttpRuntimeAccessTarget({
      capabilityId: provider.id,
      endpoint: optionalString(observability?.endpoint),
      responsibility: 'external OTLP collector endpoint',
    })];
  }
  return [];
}

export function applicationDeploymentRuntimeAccessTargetRecord(
  target: ApplicationDeploymentRuntimeAccessTarget,
): Readonly<Record<string, unknown>> {
  return target.target === 'kubernetes'
    ? {
        networkKind: 'privatePeer',
        networkNamespace: target.namespace,
        networkServiceName: target.serviceName,
        networkPodSelector: target.podSelector,
        networkProtocol: target.protocol,
        networkPort: target.port,
      }
    : {
        networkKind: 'external',
        networkProtocol: target.protocol,
        ...(target.port === undefined ? {} : { networkPort: target.port }),
        networkExternalDestination: target.destination,
        networkExternalFidelity: target.fidelity,
      };
}

function externalHttpRuntimeAccessTarget(options: {
  readonly capabilityId: string;
  readonly endpoint: string | undefined;
  readonly responsibility: string;
}): ApplicationDeploymentRuntimeAccessTarget {
  if (!options.endpoint) {
    return {
      capabilityId: options.capabilityId,
      target: 'external',
      protocol: 'TCP',
      destination: { kind: 'externalContract', responsibility: options.responsibility },
      fidelity: 'not-introspectable',
    };
  }
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new Error(`${options.responsibility} must be an absolute HTTP or HTTPS URL.`);
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error(`${options.responsibility} must use HTTP or HTTPS.`);
  }
  const explicitPort = endpoint.port ? Number(endpoint.port) : undefined;
  const port = explicitPort ?? (endpoint.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${options.responsibility} contains an invalid port.`);
  }
  return {
    capabilityId: options.capabilityId,
    target: 'external',
    protocol: 'TCP',
    port,
    destination: { kind: 'dnsName', hostname: endpoint.hostname },
    fidelity: 'port-only',
  };
}

function providerDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  if (provider.interface === "IndexStore" && provider.implementation === "valkey") {
    return valkeyDirectContribution(provider, context);
  }
  if (
    provider.interface === "EventLog"
    && provider.implementation === "nats-jetstream"
  ) {
    return eventLogDirectContribution(provider, context);
  }
  if (
    provider.interface === "TransactionalDatabase" &&
    provider.implementation === "postgres"
  ) {
    return postgresDirectContribution(provider, context);
  }
  if (provider.interface === "ObjectStorage" && provider.implementation === "s3") {
    return objectStorageDirectContribution(provider, context);
  }
  if (
    (provider.interface === "IdentityProvider" &&
      provider.implementation === "identity-provider") ||
    (provider.interface === "OAuthAuthorizationServer" &&
      provider.implementation === "oauth-authorization-server")
  ) {
    if (
      provider.interface === "OAuthAuthorizationServer" &&
      matchingIdentityInfrastructureOwner(provider, context)
    ) {
      return { nodes: [], edges: [] };
    }
    return identityDirectContribution(provider, context);
  }
  if (
    provider.interface === "WorkflowEngine" &&
    provider.implementation === "hatchet"
  ) {
    return workflowDirectContribution(provider, context);
  }
  if (
    provider.interface === "Scheduler"
    && provider.implementation === "hatchet-scheduler"
  ) {
    const scheduler = nestedObject(provider.config, "scheduler");
    if (scheduler?.kind !== "hatchet-scheduler") {
      throw new Error(
        `Scheduler provider ${provider.id} is classified as hatchet-scheduler but has no matching scheduler configuration.`,
      );
    }
    const explicitWorkflowEngine = optionalObject(scheduler.workflowEngine);
    const sharedWorkflowEngine = context.graph.nodes.find(
      (node): node is ApplicationProviderNode =>
        node.kind === "provider"
        && node.interface === "WorkflowEngine"
        && node.implementation === "hatchet"
        && !node.config?.qualification,
    );
    if (!explicitWorkflowEngine && sharedWorkflowEngine) {
      // The Scheduler consumes the already-owned shared Hatchet installation.
      // A second semantic owner would emit colliding chart resources and make
      // deletion of either provider destructive to the other.
      return { nodes: [], edges: [] };
    }
    const workflowConfig = compactJson({
      kind: "hatchet",
      ...(explicitWorkflowEngine ?? {}),
    });
    if (sharedWorkflowEngine) {
      const sharedNamespace = optionalString(sharedWorkflowEngine.config?.namespace)
        ?? applicationNamespace(context);
      const schedulerNamespace = optionalString(workflowConfig.namespace)
        ?? applicationNamespace(context);
      if (sharedNamespace === schedulerNamespace) {
        throw new Error(
          `Scheduler provider ${provider.id} declares a private Hatchet engine in ${schedulerNamespace}, where shared WorkflowEngine ${sharedWorkflowEngine.id} already owns Hatchet's fixed service identities. Omit scheduler.workflowEngine to share it or choose a separate namespace.`,
        );
      }
    }
    const syntheticWorkflowProvider: ApplicationProviderNode = {
      ...provider,
      name: "WorkflowEngine",
      interface: "WorkflowEngine",
      implementation: "hatchet",
      config: workflowConfig,
    };
    return workflowDirectContribution(syntheticWorkflowProvider, context);
  }
  if (
    provider.interface === "Search" &&
    provider.implementation === "opensearch"
  ) {
    return openSearchDirectContribution(provider, context);
  }
  if (
    provider.interface === "AI"
    && provider.implementation === "envoy-ai-gateway"
  ) {
    return envoyAIGatewayDirectContribution(provider, context);
  }
  if (
    provider.interface === "Observability"
    && provider.implementation === "clickstack"
  ) {
    return clickStackDirectContribution(provider, context);
  }
  if (
    provider.interface === "ActorRuntime"
    && provider.implementation === "celld-actors"
  ) {
    return celldActorRuntimeDirectContribution(provider, context);
  }
  return { nodes: [], edges: [] };
}

function clickStackDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const config = nestedObject(provider.config, "observability") ?? {};
  const namespace = optionalString(config.namespace) ?? applicationNamespace(context);
  // Altinity derives host, label, ConfigMap, and volume names from the
  // installation. Its longest observed suffix is
  // `chi-<installation>-deploy-confd-cluster-0-0`, so bound the provider stem
  // before adding `-clickhouse` and keep every controller-derived identity
  // within Kubernetes' 63-character DNS-label limit.
  const name = clickStackProviderName(context.graph.metadata.name);
  const operatorNodeId = `direct.${provider.id}.clickhouse-operator`;
  const credentialsNodeId = `external.${provider.id}.clickstack-credentials`;
  const clusterNodeId = `direct.${provider.id}.clickhouse`;
  const stackNodeId = `direct.${provider.id}.clickstack`;
  const storageSize = optionalString(config.storageSize) ?? "10Gi";
  const storageClassName = optionalString(config.storageClassName);
  const credentialsName = clickStackCredentialsSecretName(context.graph.metadata.name);
  const clickhouseName = `${name}-clickhouse`;
  const clickhouseHost = `clickhouse-${clickhouseName}.${namespace}.svc.cluster.local`;
  const clickhouseUser = "otelcollector";
  const clickhousePasswordKey = "clickhouse-password";
  const apiKeyKey = "hyperdx-api-key";
  const helmValuesKey = "values.yaml";
  const operator = directNode({
    id: operatorNodeId,
    provider,
    context,
    compositionId: "clickhouse-operator-bootstrap",
    reason: "Install the cluster-scoped Altinity ClickHouse operator as retained shared infrastructure before the observability data plane.",
    namespace: "clickhouse-system",
    configuration: { name: "clickhouse-operator", namespace: "clickhouse-system", shared: true },
    ownership: "shared",
    deletion: "retain",
  });
  const credentials = generatedSecretProviderNode({
    id: credentialsNodeId,
    provider,
    context,
    namespace,
    name: credentialsName,
    values: {
      [clickhousePasswordKey]: {
        kind: "random",
        bytes: 48,
        encoding: "base64url",
      },
      [apiKeyKey]: {
        kind: "random",
        bytes: 48,
        encoding: "base64url",
      },
      [helmValuesKey]: {
        kind: "template",
        segments: [
          {
            kind: "literal",
            value: [
              "hyperdx:",
              "  secrets:",
              "    CLICKHOUSE_PASSWORD: \"",
            ].join("\n"),
          },
          { kind: "value", key: clickhousePasswordKey },
          {
            kind: "literal",
            value: "\"\n    CLICKHOUSE_APP_PASSWORD: \"",
          },
          { kind: "value", key: clickhousePasswordKey },
          {
            kind: "literal",
            value: "\"\n    HYPERDX_API_KEY: \"",
          },
          { kind: "value", key: apiKeyKey },
          {
            kind: "literal",
            value: [
              "\"",
              "  deployment:",
              "    defaultConnections: |-",
              `      [{\"name\":\"Local ClickHouse\",\"host\":\"http://${clickhouseHost}:8123\",\"port\":8123,\"username\":\"${clickhouseUser}\",\"password\":\"`,
            ].join("\n"),
          },
          { kind: "value", key: clickhousePasswordKey },
          { kind: "literal", value: "\"}]\n" },
        ],
      },
    },
    // The provider identity deliberately joins this generated Secret to every
    // semantic execution that consumes Observability. The deployment nodes
    // remain listed because they also consume the same authority during
    // infrastructure reconciliation.
    consumers: [provider.id, clusterNodeId, stackNodeId],
    runtimeKeys: [apiKeyKey],
    deletion: "delete",
  });
  const clusterBase = directNode({
    id: clusterNodeId,
    provider,
    context,
    compositionId: "applik8s-clickstack-clickhouse",
    reason: "Own the single-node ClickHouse authority used exclusively by the maintained ClickStack observability provider.",
    namespace,
    configuration: compactJson({
      name: clickhouseName,
      namespace,
      version: "25.7.6",
      storage: { size: storageSize, ...(storageClassName ? { storageClassName } : {}) },
      users: {
        [clickhouseUser]: {
          passwordSecretRef: {
            name: credentialsName,
            key: clickhousePasswordKey,
          },
        },
      },
    }),
    ownership: "application",
    deletion: "delete",
  });
  const cluster: ApplicationKubernetesDirectDeploymentNode = {
    ...clusterBase,
    outputs: [
      ...clusterBase.outputs,
      { name: "host", type: "string", sensitivity: "public", persistence: "state" },
    ],
  };
  const stackBase = directNode({
    id: stackNodeId,
    provider,
    context,
    compositionId: "applik8s-clickstack",
    reason: "Install ClickStack/HyperDX and its OTLP gateway through TypeKro against the provider-owned ClickHouse authority.",
    namespace,
    configuration: compactJson({
      build: {
        credentials: { source: "secretValues" },
        namespaceOwnership: "external",
        mongo: {
          mode: "internal",
          storage: { size: optionalString(config.metadataStorageSize) ?? "5Gi", ...(storageClassName ? { storageClassName } : {}) },
        },
      },
      instance: {
        name,
        namespace,
        clickhouse: {
          host: clickhouseHost,
          nativePort: 9000,
          httpPort: 8123,
          database: "default",
          username: clickhouseUser,
        },
        credentialsSecret: {
          name: credentialsName,
          valuesKey: helmValuesKey,
        },
      },
    }),
    ownership: "application",
    deletion: "delete",
  });
  const stack: ApplicationKubernetesDirectDeploymentNode = {
    ...stackBase,
    outputs: [
      ...stackBase.outputs,
      { name: "otlpHttpEndpoint", type: "string", sensitivity: "public", persistence: "state" },
      { name: "uiUrl", type: "string", sensitivity: "public", persistence: "state" },
    ],
  };
  return {
    nodes: [operator, credentials, cluster, stack],
    edges: [
      { from: operatorNodeId, to: clusterNodeId, relationship: "requiresReady" },
      { from: credentialsNodeId, to: clusterNodeId, relationship: "requiresReady" },
      { from: credentialsNodeId, to: stackNodeId, relationship: "requiresReady" },
      { from: clusterNodeId, to: stackNodeId, relationship: "requiresReady" },
      { from: stackNodeId, to: "kubernetes.application", relationship: "requiresOutput", output: "otlpHttpEndpoint" },
    ],
  };
}

/**
 * Stable ClickStack installation identity shared by provider lowering and the
 * application workload compiler. Keeping this derivation public prevents a
 * second, almost-equivalent Secret naming algorithm from entering generated
 * runtime manifests.
 */
export function clickStackProviderName(application: string): string {
  return boundedProviderName(
    `${safeProviderNodeId(application)}-observability`,
    23,
  );
}

/** Exact Secret mounted by ClickStack itself and by telemetry producers. */
export function clickStackCredentialsSecretName(application: string): string {
  return `${clickStackProviderName(application)}-credentials`;
}

function celldActorRuntimeDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const config = nestedObject(provider.config, "actorRuntime") ?? {};
  const namespace = optionalString(config.namespace) ?? applicationNamespace(context);
  const stateStoreBinding = optionalObject(config.stateStore);
  const stateStore = optionalObject(stateStoreBinding?.implementation) ?? stateStoreBinding;
  if (!stateStore || stateStore.kind !== "s3") {
    throw new Error("ActorRuntime.celld(...) on Kubernetes requires an S3-compatible stateStore provider.");
  }
  const credentials = optionalObject(stateStore.credentialsSecret);
  if (!credentials || !optionalString(credentials.name)) {
    throw new Error("ActorRuntime.celld(...) on Kubernetes requires stateStore.credentialsSecret so the fleet never receives inline credentials.");
  }
  const name = `${safeProviderNodeId(context.graph.metadata.name)}-actors`;
  const applicationService = kubernetesApplicationService(context);
  const publicRealtime = context.graph.nodes.some((node) =>
    node.kind === "actor"
    && node.publication?.boundary === "entrypoint-export"
    && node.definition.requirements.realtimeConnections
  );
  const exposureProvider = context.graph.nodes.find((node): node is ApplicationProviderNode =>
    node.kind === "provider" && node.interface === "HttpExposure"
  );
  const ingressControllerNamespace = optionalString(
    nestedObject(exposureProvider?.config, "httpExposure")?.controllerNamespace,
  );
  if (publicRealtime && !ingressControllerNamespace) {
    throw new Error(
      "Published realtime actors on Kubernetes require HttpExposure.ingress({ controllerNamespace }) so the actor NetworkPolicy can admit only the selected ingress controller.",
    );
  }
  if (publicRealtime && namespace !== applicationNamespace(context)) {
    throw new Error(
      "Published realtime actors must share the application namespace so the application Ingress can route to the Celld Service without a cross-namespace backend.",
    );
  }
  const nodeId = `direct.${provider.id}.celld`;
  const authorizationId = `external.${provider.id}.celld-authorization`;
  const authorizationName = `${name}-authorization`;
  const authorization = generatedSecretProviderNode({
    id: authorizationId,
    provider,
    context,
    namespace,
    name: authorizationName,
    values: {
      authorization: { kind: "random", bytes: 48, encoding: "base64url" },
      connectionSigningKey: { kind: "random", bytes: 48, encoding: "base64url" },
    },
    consumers: [nodeId, "kubernetes.application"],
    deletion: "delete",
  });
  const base = directNode({
    id: nodeId,
    provider,
    context,
    compositionId: "applik8s-celld-actors",
    reason: "Deploy the compiler-generated Celld Worker, private fleet, conditional-write object-store authority, and ingress as one TypeKro lifecycle boundary.",
    namespace,
    configuration: compactJson({
      name,
      namespace,
      image: applicationDeploymentOutputReference("artifact.celld-runtime", "immutableReference"),
      replicas: optionalInteger(config.replicas) ?? 1,
      bucket: requiredString(stateStore.bucket, "Celld state-store bucket"),
      region: requiredString(stateStore.region, "Celld state-store region"),
      ...(optionalString(stateStore.endpoint) ? { endpoint: optionalString(stateStore.endpoint) } : {}),
      credentialsSecretName: requiredString(credentials.name, "Celld state-store credentials Secret name"),
      accessKeyIdKey: optionalString(stateStore.accessKeyIdKey) ?? "AWS_ACCESS_KEY_ID",
      secretAccessKeyKey: optionalString(stateStore.secretAccessKeyKey) ?? "AWS_SECRET_ACCESS_KEY",
      authorizationSecretName: authorizationName,
      authorizationSecretKey: "authorization",
      connectionSigningSecretKey: "connectionSigningKey",
      ingressControllerNamespace: ingressControllerNamespace ?? namespace,
      applicationEndpoint: applicationService.endpoint,
    }),
    ownership: "application",
    deletion: "delete",
  });
  const fleet: ApplicationKubernetesDirectDeploymentNode = {
    ...base,
    outputs: [...base.outputs, { name: "endpoint", type: "string", sensitivity: "public", persistence: "state" }],
  };
  const stateStoreDependency = celldStateStoreDeploymentDependency(
    stateStore,
    context,
  );
  const endpointReference = applicationDeploymentOutputReference(
    nodeId,
    "endpoint",
  );
  const rootConsumesEndpoint = JSON.stringify(
    context.materializedComposition?.resources ?? [],
  ).includes(endpointReference);
  const stateStoreEndpoint = optionalString(stateStore.endpoint);
  const access = celldProviderRuntimeAccess({
    provider,
    context,
    deploymentNodeId: nodeId,
    name,
    namespace,
    ...(stateStoreEndpoint
      ? { stateStoreEndpoint }
      : {}),
    stateStoreSecret: {
      namespace: optionalString(credentials.namespace) ?? namespace,
      name: requiredString(credentials.name, 'Celld state-store credentials Secret name'),
      keys: [
        optionalString(stateStore.accessKeyIdKey) ?? 'AWS_ACCESS_KEY_ID',
        optionalString(stateStore.secretAccessKeyKey) ?? 'AWS_SECRET_ACCESS_KEY',
      ],
    },
    authorizationSecret: {
      namespace,
      name: authorizationName,
      keys: ['authorization', 'connectionSigningKey'],
    },
    applicationService,
  });
  return {
    nodes: [authorization, fleet],
    edges: [
      ...(stateStoreDependency
        ? [{
            from: stateStoreDependency,
            to: nodeId,
            relationship: "requiresReady" as const,
          }]
        : []),
      { from: "artifact.celld-runtime", to: nodeId, relationship: "requiresOutput", output: "immutableReference" },
      { from: authorizationId, to: nodeId, relationship: "requiresReady" },
      rootConsumesEndpoint
        ? { from: nodeId, to: "kubernetes.application", relationship: "requiresOutput", output: "endpoint" }
        : { from: nodeId, to: "kubernetes.application", relationship: "requiresReady" },
    ],
    runtimeAccessTargets: access.targets,
    runtimeAccessRequirements: access.requirements,
    runtimeAccessWorkloads: access.workloads,
  };
}

/**
 * Recover the lifecycle owner behind ActorRuntime.celld({ stateStore }).
 *
 * Application source may pass either a provider binding or its selected S3
 * implementation. Both intentionally serialize as provider-neutral data in
 * ApplicationGraph, so deployment lowering joins them by the exact storage
 * authority rather than exposing a TypeKro-specific dependency token to user
 * code. Externally owned S3 has no deployment node and therefore needs no
 * ordering edge.
 */
function celldStateStoreDeploymentDependency(
  stateStore: Readonly<Record<string, unknown>>,
  context: ApplicationDeploymentPlanningContext,
): string | undefined {
  const matches = context.graph.nodes.flatMap((candidate) => {
    if (candidate.kind !== "provider" || candidate.interface !== "ObjectStorage") {
      return [];
    }
    const resolved = resolveApplicationProviderForTarget(candidate, context);
    const storage = nestedObject(resolved.config, "objectStorage")
      ?? resolved.config
      ?? {};
    if (!sameCelldStateStore(storage, stateStore)) return [];
    const provisioning = optionalObject(storage.provisioning);
    if (
      storage.kind !== "s3"
      || storage.ownership !== "direct-provisioned"
      || provisioning?.enabled === false
    ) {
      return [];
    }
    if (provisioning?.kind === "local-s3") {
      return [`direct.${candidate.id}.local-s3`];
    }
    return [`direct.${candidate.id}.claim`];
  });
  const unique = [...new Set(matches)];
  if (unique.length > 1) {
    throw new Error(
      `ActorRuntime.celld(...) stateStore matches more than one application-owned ObjectStorage deployment: ${unique.join(", ")}. Bind one exact storage authority.`,
    );
  }
  return unique[0];
}

function sameCelldStateStore(
  candidate: Readonly<Record<string, unknown>>,
  required: Readonly<Record<string, unknown>>,
): boolean {
  if (candidate.kind !== "s3" || required.kind !== "s3") return false;
  const candidateCredentials = optionalObject(candidate.credentialsSecret);
  const requiredCredentials = optionalObject(required.credentialsSecret);
  return optionalString(candidate.bucket) === optionalString(required.bucket)
    && optionalString(candidate.region) === optionalString(required.region)
    && optionalString(candidate.endpoint) === optionalString(required.endpoint)
    && optionalString(candidateCredentials?.name)
      === optionalString(requiredCredentials?.name)
    && optionalString(candidateCredentials?.namespace)
      === optionalString(requiredCredentials?.namespace);
}

function kubernetesApplicationService(
  context: ApplicationDeploymentPlanningContext,
): {
  readonly endpoint: string;
  readonly namespace: string;
  readonly name: string;
  readonly port: number;
  readonly podSelector: Readonly<Record<string, string>>;
} {
  const candidates = (context.materializedComposition?.resources ?? [])
    .map((resource) => optionalObject(resource.template) ?? optionalObject(resource.externalRef))
    .filter((resource): resource is DeploymentJsonObject => resource !== undefined)
    .filter((resource) => {
      if (resource.apiVersion !== "v1" || resource.kind !== "Service") return false;
      const labels = optionalObject(optionalObject(resource.metadata)?.labels);
      return labels?.["app.kubernetes.io/component"] === "typed-http";
    });
  if (candidates.length !== 1) {
    throw new Error(
      `ActorRuntime.celld(...) requires exactly one compiler-generated typed HTTP Service; found ${candidates.length}. `
      + "Expose one application HTTP server before selecting the Kubernetes Celld runtime.",
    );
  }
  const service = candidates[0]!;
  const metadata = optionalObject(service.metadata);
  const serviceName = requiredString(metadata?.name, "Celld application Service name");
  const serviceNamespace = requiredString(
    metadata?.namespace ?? context.graph.metadata.namespace,
    "Celld application Service namespace",
  );
  const serviceSpec = optionalObject(service.spec);
  const ports = Array.isArray(serviceSpec?.ports) ? serviceSpec.ports : [];
  const httpPort = ports
    .map((port) => optionalObject(port))
    .find((port) => port?.name === "http") ?? optionalObject(ports[0]);
  const port = optionalInteger(httpPort?.port);
  if (!port) {
    throw new Error(
      `ActorRuntime.celld(...) could not derive an HTTP port from Service ${serviceNamespace}/${serviceName}.`,
    );
  }
  const podSelector = optionalObject(serviceSpec?.selector);
  if (
    !podSelector
    || Object.keys(podSelector).length === 0
    || Object.values(podSelector).some((value) => typeof value !== 'string' || !value)
  ) {
    throw new Error(
      `ActorRuntime.celld(...) requires Service ${serviceNamespace}/${serviceName} to expose one exact string-valued pod selector.`,
    );
  }
  return {
    endpoint: `http://${serviceName}.${serviceNamespace}.svc.cluster.local:${port}`,
    namespace: serviceNamespace,
    name: serviceName,
    port,
    podSelector: podSelector as Readonly<Record<string, string>>,
  };
}

function eventLogDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = provider.config;
  if (value?.provision === false) return { nodes: [], edges: [] };

  const namespace =
    optionalString(value?.namespace) ?? applicationNamespace(context);
  const name = optionalString(value?.name) ?? "applik8s-events";
  const replicas = optionalInteger(value?.replicas) ?? 1;
  const storageSize = optionalString(value?.storageSize) ?? "10Gi";
  const storageClassName = optionalString(value?.storageClassName);
  const pvcRetentionPolicy =
    value?.pvcRetentionPolicy === "delete" ? "delete" : "retain";
  const configuration = compactJson({
    name,
    namespace,
    namespaceOwnership: "external",
    replicas,
    storageSize,
    pvcRetentionPolicy,
    ...(storageClassName
      ? {
          values: {
            config: {
              jetstream: {
                fileStore: {
                  pvc: { storageClassName },
                },
              },
            },
          },
        }
      : {}),
  });

  return {
    nodes: [
      directNode({
        id: `direct.${provider.id}.nats`,
        provider,
        context,
        compositionId: "nats-bootstrap",
        reason:
          "Install NATS and NACK outside the application KRO ApplySet so Stream and Consumer finalizers drain before their controllers are removed.",
        namespace,
        configuration,
        ownership: "application",
        deletion: "delete",
      }),
    ],
    edges: [],
    runtimeAccessTargets: [{
      capabilityId: provider.id,
      target: "kubernetes",
      namespace,
      serviceName: name,
      podSelector: { "app.kubernetes.io/instance": name },
      protocol: "TCP",
      port: 4222,
    }],
  };
}

function envoyAIGatewayDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "ai");
  if (
    value?.kind !== "envoy-ai-gateway"
    || value.provision === false
  ) {
    return { nodes: [], edges: [] };
  }
  const application = context.graph.metadata.name;
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const requestedName = optionalString(value.name) ?? `${application}-ai`;
  const name = boundedEnvoyAIGatewayName(requestedName, namespace);
  const versions = requiredObject(value.versions, "Envoy AI Gateway versions");
  const platform = optionalObject(value.platform) ?? {};
  const envoyGatewayNamespace =
    optionalString(platform.envoyGatewayNamespace) ?? "envoy-gateway-system";
  const aiGatewayNamespace =
    optionalString(platform.aiGatewayNamespace) ?? "envoy-ai-gateway-system";
  const gatewayClassName =
    optionalString(platform.gatewayClassName) ?? "envoy-ai-gateway";
  const seedReference = optionalObject(
    platform.mcpSessionEncryptionSeedSecret,
  );
  const seedName =
    optionalString(seedReference?.name)
    ?? "envoy-ai-gateway-mcp-seed";
  const seedKey = optionalString(seedReference?.key) ?? "seed";
  const seedNamespace =
    optionalString(seedReference?.namespace) ?? aiGatewayNamespace;
  if (seedNamespace !== aiGatewayNamespace) {
    throw new Error(
      "Envoy AI Gateway MCP session-encryption Secret must be in the AI Gateway controller namespace.",
    );
  }
  const providers = envoyAIProviders(value, namespace);
  const models = envoyAIModels(value);
  const requestPolicy = optionalObject(value.requestPolicy);
  const telemetry = optionalObject(value.telemetry);
  const rateLimit = optionalObject(value.rateLimit);
  const build = compactJson({
    providers,
    models,
    profile: "production",
    retry: optionalInteger(requestPolicy?.retries) === 0
      ? false
      : compactJson({
          retries: optionalInteger(requestPolicy?.retries) ?? providers.length,
          attemptsPerPriority: 1,
          ...(optionalInteger(requestPolicy?.timeoutMs)
            ? {
                perRetryTimeout:
                  `${optionalInteger(requestPolicy?.timeoutMs)}ms`,
              }
            : {}),
        }),
    ...(rateLimit
      ? {
          rateLimit: {
            redisUrl: requiredString(
              rateLimit.redisUrl,
              "Envoy AI Gateway rate-limit Redis URL",
            ),
            rules: requiredArray(
              rateLimit.rules,
              "Envoy AI Gateway rate-limit rules",
            ).map((candidate) => {
              const rule = requiredObject(
                candidate,
                "Envoy AI Gateway rate-limit rule",
              );
              return compactJson({
                ...(optionalString(rule.identityHeader)
                  ? { identityHeader: optionalString(rule.identityHeader) }
                  : {}),
                requests: requiredInteger(
                  rule.requests,
                  "Envoy AI Gateway rate-limit requests",
                ),
                unit: envoyRateLimitUnit(
                  requiredString(
                    rule.unit,
                    "Envoy AI Gateway rate-limit unit",
                  ),
                ),
                cost: optionalString(rule.cost) ?? "total-tokens",
              });
            }),
          },
        }
      : {}),
    telemetry: compactJson({
      environment: compactJson({
        APPLIK8S_AI_USAGE_METRICS:
          telemetry?.usage === false ? "disabled" : "enabled",
        APPLIK8S_AI_COST_METRICS:
          telemetry?.cost === false ? "disabled" : "enabled",
        APPLIK8S_AI_BODY_LOGGING:
          telemetry?.redactBodies === false ? "disabled" : "redacted",
      }),
    }),
    platform: {
      profile: "production",
      // Applik8s establishes these retained lifecycle boundaries before the
      // generated MCP seed and delegates the remaining platform graph to
      // TypeKro.
      namespaceOwnership: "external",
      envoyGatewayNamespace,
      aiGatewayNamespace,
      envoyGatewayVersion: requiredString(
        versions.envoyGateway,
        "Envoy Gateway version",
      ),
      aiGatewayVersion: requiredString(
        versions.aiGateway,
        "Envoy AI Gateway version",
      ),
      gatewayClassName,
      mcpSessionEncryptionSeedSecret: {
        name: seedName,
        key: seedKey,
      },
      ...(rateLimit
        ? {
            rateLimitRedisUrl: requiredString(
              rateLimit.redisUrl,
              "Envoy AI Gateway rate-limit Redis URL",
            ),
          }
        : {}),
    },
  });
  const gatewayNodeId = `direct.${provider.id}.envoy-ai-gateway`;
  const gatewayBase = directNode({
    id: gatewayNodeId,
    provider,
    context,
    compositionId: "envoy-ai-gateway",
    reason:
      "Install provider-neutral logical inference routing through the released TypeKro Envoy AI Gateway composition.",
    namespace,
    configuration: {
      name,
      namespace,
      build,
      instance: {
        name,
        namespace,
        lifecycle: "external",
      },
    },
    ownership: "application",
    deletion: "delete",
  });
  const gatewayNode: ApplicationKubernetesDirectDeploymentNode = {
    ...gatewayBase,
    outputs: [
      ...gatewayBase.outputs,
      {
        name: "endpoint",
        type: "string",
        sensitivity: "public",
        persistence: "state",
      },
    ],
  };
  const namespaceNodes = [
    envoyGatewayNamespace,
    aiGatewayNamespace,
  ].map((platformNamespace) =>
    directNode({
      id: `direct.${provider.id}.namespace.${safeProviderNodeId(platformNamespace)}`,
      provider,
      context,
      compositionId: "applik8s-unowned-namespace",
      reason:
        "Bootstrap the shared Envoy control-plane namespace before its generated production seed and singleton platform owner.",
      namespace: platformNamespace,
      configuration: { name: platformNamespace },
      ownership: "shared",
      deletion: "retain",
    }));
  const nodes: ApplicationDeploymentNode[] = [
    ...namespaceNodes,
    gatewayNode,
  ];
  const edges: ApplicationDeploymentEdge[] = namespaceNodes.map((node) => ({
    from: node.id,
    to: gatewayNodeId,
    relationship: "requiresReady",
  }));
  edges.push({
    from: gatewayNodeId,
    to: "kubernetes.application",
    relationship: "requiresOutput",
    output: "endpoint",
  });
  if (!seedReference) {
    const seedNodeId = `external.${provider.id}.mcp-seed`;
    const seedNode: ApplicationExternalProviderDeploymentNode = {
      id: seedNodeId,
      kind: "externalProvider",
      contractVersion: 1,
      source: { semanticNodeId: provider.id },
      provider: {
        interface: "Secret",
        implementation: "alchemy-kubernetes-generated-secret",
        version: "1",
      },
      scope: {
        connectionDigest: context.connection.digest,
        namespace: seedNamespace,
      },
      capabilities: { strategies: ["direct", "kro"], alchemy: true },
      configurationDigest: digestApplicationDeploymentValue({
        namespace: seedNamespace,
        name: seedName,
        values: {
          [seedKey]: {
            kind: "random",
            bytes: 32,
            encoding: "base64url",
          },
        },
      }),
      inputs: {},
      outputs: [
        {
          name: "reference",
          type: "secretReference",
          sensitivity: "public",
          persistence: "reference",
        },
        {
          name: "name",
          type: "string",
          sensitivity: "public",
          persistence: "reference",
        },
        {
          name: "namespace",
          type: "string",
          sensitivity: "public",
          persistence: "reference",
        },
      ],
      lifecycle: {
        ownership: "shared",
        deletion: "retain",
        adoption: "createOrAdoptExact",
      },
      spec: {
        resourceType: "kubernetesGeneratedSecret",
        controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
        // The generated name is compiler-owned public identity. The gateway
        // needs the Secret to exist, not a runtime-discovered output.
        referenceMode: "staticIdentity",
        configuration: {
          namespace: seedNamespace,
          name: seedName,
          values: {
            [seedKey]: {
              kind: "random",
              bytes: 32,
              encoding: "base64url",
            },
          },
          consumers: [provider.id],
        },
      },
    };
    nodes.push(seedNode);
    const seedNamespaceNode = namespaceNodes.find(
      (node) => node.scope.namespace === seedNamespace,
    );
    if (seedNamespaceNode) {
      edges.push({
        from: seedNamespaceNode.id,
        to: seedNodeId,
        relationship: "requiresReady",
      });
    }
    edges.push({
      from: seedNodeId,
      to: gatewayNodeId,
      relationship: "requiresReady",
    });
  }
  return {
    nodes,
    edges,
  };
}

/**
 * Envoy AI Gateway v0.6 derives an ext-proc Unix-socket volume name as
 * `ai-gateway-${gatewayName}-${gatewayNamespace}`. Kubernetes caps volume
 * names at 63 characters, so two individually valid DNS names can otherwise
 * produce an invalid rollout that leaves the previous Envoy pod serving
 * without the AI extension. Preserve readable names when possible and use a
 * stable internal identity only when the upstream derived name would exceed
 * Kubernetes' limit.
 */
function boundedEnvoyAIGatewayName(
  requestedName: string,
  namespace: string,
): string {
  const maximumNameLength = 63 - "ai-gateway-".length - 1 - namespace.length;
  if (maximumNameLength < 8) {
    throw new Error(
      `Envoy AI Gateway namespace ${namespace} is too long for the v0.6 ext-proc volume identity. `
        + "Use a namespace no longer than 43 characters.",
    );
  }
  if (requestedName.length <= maximumNameLength) return requestedName;
  const digest = digestApplicationDeploymentValue({
    requestedName,
    namespace,
  }).replace(/^sha256:/, "");
  return `aigw-${digest.slice(0, Math.min(12, maximumNameLength - 5))}`;
}

function envoyAIProviders(
  provider: DeploymentJsonObject,
  namespace: string,
): readonly DeploymentJsonObject[] {
  const models = requiredObject(provider.models, "Envoy AI Gateway models");
  const byName = new Map<string, DeploymentJsonObject>();
  for (const routeValue of Object.values(models)) {
    const route = requiredObject(routeValue, "Envoy AI Gateway model route");
    for (const backendValue of requiredArray(
      route.backends,
      "Envoy AI Gateway route backends",
    )) {
      const backend = requiredObject(
        backendValue,
        "Envoy AI Gateway backend",
      );
      const name = requiredString(backend.name, "Envoy AI Gateway backend name");
      const existing = byName.get(name);
      const mapped = envoyAIProvider(backend, namespace);
      if (
        existing
        && digestApplicationDeploymentValue(existing)
          !== digestApplicationDeploymentValue(mapped)
      ) {
        throw new Error(
          `Envoy AI Gateway backend ${name} is declared with incompatible provider configuration.`,
        );
      }
      byName.set(name, mapped);
    }
  }
  return [...byName.values()].sort((left, right) =>
    String(left.name).localeCompare(String(right.name)));
}

function envoyAIProvider(
  backend: DeploymentJsonObject,
  namespace: string,
): DeploymentJsonObject {
  const name = requiredString(backend.name, "Envoy AI Gateway backend name");
  const providerClass = requiredString(
    backend.providerClass,
    `Envoy AI Gateway backend ${name} provider class`,
  );
  const endpoint = optionalString(backend.endpoint);
  const location = endpoint ? new URL(endpoint) : undefined;
  const credentials = optionalObject(backend.credentials);
  if (
    credentials
    && (optionalString(credentials.key) ?? "apiKey") !== "apiKey"
  ) {
    throw new Error(
      `Envoy AI Gateway backend ${name} credential Secret must expose key apiKey for the released TypeKro provider contract.`,
    );
  }
  const credential = credentials
    ? {
        name: requiredString(
          credentials.name,
          `Envoy AI Gateway backend ${name} credential Secret`,
        ),
        namespace:
          optionalString(credentials.namespace) ?? namespace,
      }
    : undefined;
  const connection = location
    ? {
        hostname: location.hostname,
        ...(location.port ? { port: Number(location.port) } : {}),
        tls: location.protocol === "https:",
        ...(location.pathname !== "/"
          ? { prefix: location.pathname.replace(/\/+$/u, "") }
          : {}),
      }
    : {};
  if (providerClass === "openai" || providerClass === "anthropic") {
    if (!credential) {
      throw new Error(
        `Envoy AI Gateway backend ${name} requires a credential Secret.`,
      );
    }
    return { name, kind: providerClass, ...connection, credential };
  }
  if (providerClass === "openai-compatible") {
    if (!location) {
      throw new Error(
        `Envoy AI Gateway openai-compatible backend ${name} requires an endpoint.`,
      );
    }
    return {
      name,
      kind: "openai-compatible",
      ...connection,
      ...(credential ? { credential } : {}),
    };
  }
  if (providerClass === "bedrock") {
    return {
      name,
      kind: "aws-bedrock",
      region: requiredString(
        backend.region,
        `Envoy AI Gateway backend ${name} region`,
      ),
      ...(credential
        ? {
            credential: {
              source: "secret",
              secret: credential,
            },
          }
        : { credential: { source: "workload-identity" } }),
    };
  }
  throw new Error(
    `Envoy AI Gateway backend ${name} has unsupported provider class ${providerClass}.`,
  );
}

function envoyAIModels(
  provider: DeploymentJsonObject,
): readonly DeploymentJsonObject[] {
  const models = requiredObject(provider.models, "Envoy AI Gateway models");
  return Object.entries(models)
    .map(([logicalModel, routeValue]) => {
      const route = requiredObject(
        routeValue,
        `Envoy AI Gateway model ${logicalModel}`,
      );
      const fallback = route.fallback === "ordered";
      return {
        model: logicalModel,
        targets: requiredArray(
          route.backends,
          `Envoy AI Gateway model ${logicalModel} backends`,
        ).map((backendValue, index) => {
          const backend = requiredObject(
            backendValue,
            `Envoy AI Gateway model ${logicalModel} backend`,
          );
          return compactJson({
            provider: requiredString(
              backend.name,
              `Envoy AI Gateway model ${logicalModel} backend name`,
            ),
            model: requiredString(
              backend.model,
              `Envoy AI Gateway model ${logicalModel} concrete model`,
            ),
            priority: fallback ? index : 0,
            ...(optionalInteger(backend.weight)
              ? { weight: optionalInteger(backend.weight) }
              : {}),
          });
        }),
        ...(optionalInteger(optionalObject(provider.requestPolicy)?.timeoutMs)
          ? {
              requestTimeout:
                `${optionalInteger(optionalObject(provider.requestPolicy)?.timeoutMs)}ms`,
            }
          : {}),
      };
    })
    .sort((left, right) => left.model.localeCompare(right.model));
}

function envoyRateLimitUnit(value: string): "Second" | "Minute" | "Hour" | "Day" {
  if (value === "second") return "Second";
  if (value === "minute") return "Minute";
  if (value === "hour") return "Hour";
  if (value === "day") return "Day";
  throw new Error(`Unsupported Envoy AI Gateway rate-limit unit ${value}.`);
}

function matchingIdentityInfrastructureOwner(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ApplicationProviderNode | undefined {
  const infrastructure = nestedObject(provider.config, "identityInfrastructure");
  if (!infrastructure) return undefined;
  const digest = digestApplicationDeploymentValue(infrastructure);
  return context.graph.nodes.find(
    (candidate): candidate is ApplicationProviderNode =>
      candidate.kind === "provider" &&
      candidate.interface === "IdentityProvider" &&
      candidate.implementation === "identity-provider" &&
      candidate.id !== provider.id &&
      (() => {
        const candidateInfrastructure = nestedObject(
          candidate.config,
          "identityInfrastructure",
        );
        return candidateInfrastructure
          ? digestApplicationDeploymentValue(candidateInfrastructure) === digest
          : false;
      })(),
  );
}

function openSearchDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "search");
  if (
    value?.kind !== "opensearch"
    || value.provision === false
  ) {
    return { nodes: [], edges: [] };
  }
  const namespace =
    optionalString(value.namespace) ?? applicationNamespace(context);
  const name =
    optionalString(value.name) ?? `${context.graph.metadata.name}-search`;
  const operator = optionalObject(value.operator);
  const operatorNamespace =
    optionalString(operator?.namespace) ?? "opensearch-operator-system";
  const profile =
    value.profile === "production"
      ? "production"
      : value.profile === "development"
        ? "development"
        : context.profile === "starter" || context.profile === "local"
          ? "development"
          : "production";
  const topology = optionalObject(value.topology);
  const nodes = optionalInteger(topology?.nodes) ?? 3;
  if (nodes < 3) {
    throw new Error(
      "Managed OpenSearch requires at least three cluster-manager-capable nodes.",
    );
  }
  const roles = Array.isArray(topology?.roles)
    ? topology.roles.map((role) => {
        if (role === "clusterManager") return "cluster_manager";
        if (role === "data" || role === "ingest") return role;
        throw new Error(`Unsupported OpenSearch topology role ${String(role)}.`);
      })
    : ["cluster_manager", "data", "ingest"];
  const storage = optionalObject(value.storage);
  const deletionPolicy =
    storage?.deletionPolicy === "delete" ? "delete" : "retain";
  const networkPolicy = optionalObject(value.networkPolicy);
  const snapshots = optionalObject(value.snapshots);
  const tls = optionalObject(value.tls) ?? { source: "generated" };
  const build = compactJson({
    profile,
    nodes,
    roles,
    tls: requiredString(tls.source, "OpenSearch TLS source"),
    snapshots: Boolean(snapshots),
    ...(snapshots
      ? {
          snapshotCredentialKeys: {
            accessKey:
              optionalString(snapshots.accessKeyKey) ?? "accessKey",
            secretKey:
              optionalString(snapshots.secretKeyKey) ?? "secretKey",
          },
        }
      : {}),
    ...(profile === "production" || networkPolicy?.enabled === true
      ? {
          networkPolicy: {
            enabled: networkPolicy?.enabled !== false,
            operatorNamespace:
              optionalString(networkPolicy?.operatorNamespace)
              ?? operatorNamespace,
            ingressNamespaceLabels:
              optionalObject(networkPolicy?.ingressNamespaceLabels)
              ?? { "kubernetes.io/metadata.name": namespace },
            ...(Array.isArray(networkPolicy?.egressNamespaceLabels)
              ? {
                  egressNamespaceLabels:
                    networkPolicy.egressNamespaceLabels,
                }
              : {}),
            ...(Array.isArray(networkPolicy?.egressCidrs)
              ? { egressCidrs: networkPolicy.egressCidrs }
              : {}),
          },
        }
      : {}),
  });
  const adminCredentials = optionalObject(value.adminCredentialsSecret);
  const dashboardCredentials = optionalObject(
    value.dashboardCredentialsSecret,
  );
  const snapshotCredentials = optionalObject(
    snapshots?.credentialsSecret,
  );
  const instance = compactJson({
    name,
    namespace,
    ...(optionalString(value.version)
      ? { version: optionalString(value.version) }
      : {}),
    lifecycle:
      deletionPolicy === "delete"
        ? "external-delete"
        : "external-retain",
    storage: {
      size: optionalString(storage?.size) ?? "20Gi",
      ...(optionalString(storage?.storageClassName)
        ? {
            storageClassName: optionalString(
              storage?.storageClassName,
            ),
          }
        : {}),
    },
    ...(optionalObject(value.resources)
      ? { resources: optionalObject(value.resources) }
      : {}),
    ...(adminCredentials
      ? {
          adminCredentialsSecret: {
            name: requiredString(
              adminCredentials.name,
              "OpenSearch admin credentials Secret",
            ),
          },
        }
      : {}),
    ...(dashboardCredentials
      ? {
          dashboardCredentialsSecret: {
            name: requiredString(
              dashboardCredentials.name,
              "OpenSearch dashboard credentials Secret",
            ),
          },
        }
      : {}),
    tls,
    ...(snapshots && snapshotCredentials
      ? {
          snapshots: {
            repository: requiredString(
              snapshots.repository,
              "OpenSearch snapshot repository",
            ),
            bucket: requiredString(
              snapshots.bucket,
              "OpenSearch snapshot bucket",
            ),
            credentialsSecret: {
              name: requiredString(
                snapshotCredentials.name,
                "OpenSearch snapshot credentials Secret",
              ),
              ...(optionalString(snapshots.accessKeyKey)
                ? { accessKeyKey: optionalString(snapshots.accessKeyKey) }
                : {}),
              ...(optionalString(snapshots.secretKeyKey)
                ? { secretKeyKey: optionalString(snapshots.secretKeyKey) }
                : {}),
            },
            ...(optionalString(snapshots.endpoint)
              ? { endpoint: optionalString(snapshots.endpoint) }
              : {}),
            ...(optionalString(snapshots.region)
              ? { region: optionalString(snapshots.region) }
              : {}),
            ...(optionalString(snapshots.basePath)
              ? { basePath: optionalString(snapshots.basePath) }
              : {}),
          },
        }
      : {}),
    monitoring: value.monitoring === true,
  });
  const nodesToDeploy: ApplicationKubernetesDirectDeploymentNode[] = [];
  const edges: ApplicationDeploymentEdge[] = [];
  const operatorNodeId = `direct.${provider.id}.operator`;
  if (operator?.provision !== false) {
    nodesToDeploy.push(
      directNode({
        id: operatorNodeId,
        provider,
        context,
        compositionId: "opensearch-operator-bootstrap",
        reason:
          "Install the shared OpenSearch operator before application search clusters.",
        namespace: operatorNamespace,
        configuration: compactJson({
          name: optionalString(operator?.name) ?? "opensearch-operator",
          namespace: operatorNamespace,
          shared: true,
          ...(optionalString(operator?.version)
            ? { version: optionalString(operator?.version) }
            : {}),
        }),
        ownership: "shared",
        deletion: "retain",
      }),
    );
  }
  const clusterNodeId = `direct.${provider.id}.cluster`;
  nodesToDeploy.push(
    directNode({
      id: clusterNodeId,
      provider,
      context,
      compositionId: "opensearch-cluster",
      reason:
        "Keep operator-managed OpenSearch data and explicit retention outside the root KRO ApplySet.",
      namespace,
      configuration: compactJson({ name, namespace, build, instance }),
      ownership: "application",
      deletion: deletionPolicy,
    }),
  );
  if (nodesToDeploy.some((node) => node.id === operatorNodeId)) {
    edges.push({
      from: operatorNodeId,
      to: clusterNodeId,
      relationship: "installsApi",
    });
  }
  return { nodes: nodesToDeploy, edges };
}

function workflowDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = provider.config;
  if (
    !value ||
    value.kind !== "hatchet" ||
    value.enabled === false ||
    value.provision === false
  ) {
    return { nodes: [], edges: [] };
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name = optionalString(value.name) ?? "applik8s-hatchet";
  const nodes: ApplicationDeploymentNode[] = [];
  const edges: ApplicationDeploymentEdge[] = [];
  const adminReference = optionalObject(value.adminCredentialsSecret);
  const adminSecretName =
    optionalString(adminReference?.name) ?? `${name}-admin`;
  const adminSecretNamespace =
    optionalString(adminReference?.namespace) ?? namespace;
  if (adminSecretNamespace !== namespace) {
    throw new Error(
      `Hatchet admin credentials Secret must be in workload namespace ${namespace}.`,
    );
  }
  const adminNodeId = `external.${provider.id}.admin-secret`;
  if (!adminReference) {
    nodes.push(workflowGeneratedSecretNode({
      id: adminNodeId,
      provider,
      context,
      namespace,
      name: `${name}-admin`,
      values: {
        ADMIN_EMAIL: {
          kind: "publicLiteral",
          value: "admin@applik8s.local",
        },
        ADMIN_PASSWORD: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
        },
      },
    }));
  }
  const database = optionalObject(value.database);
  const databaseReference = optionalObject(database?.connectionSecret);
  const databaseSecretName =
    optionalString(databaseReference?.name) ?? `${name}-database`;
  const databaseSecretNamespace =
    optionalString(databaseReference?.namespace) ?? namespace;
  if (databaseSecretNamespace !== namespace) {
    throw new Error(
      `Hatchet database connection Secret must be in workload namespace ${namespace}.`,
    );
  }
  const clusterName =
    optionalString(database?.clusterName) ?? `${name}-db`;
  const databaseName =
    optionalString(database?.database) ?? "hatchet";
  const databaseNodeId = `direct.${provider.id}.database`;
  const databaseSecretNodeId = `external.${provider.id}.database-secret`;
  if (
    database?.provision !== false
    && !databaseReference
  ) {
    nodes.push(workflowGeneratedSecretNode({
      id: databaseSecretNodeId,
      provider,
      context,
      namespace,
      name: `${name}-database`,
      secretType: "kubernetes.io/basic-auth",
      values: {
        username: {
          kind: "publicLiteral",
          value: "hatchet",
        },
        password: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
        },
        DATABASE_URL: {
          kind: "template",
          segments: [
            {
              kind: "literal",
              value: "postgresql://hatchet:",
            },
            {
              kind: "value",
              key: "password",
            },
            {
              kind: "literal",
              value:
                `@${clusterName}-rw.${namespace}.svc.cluster.local:5432/${databaseName}?sslmode=require`,
            },
          ],
        },
      },
    }));
  }
  if (database?.provision !== false) {
    const storageClass =
      optionalString(database?.storageClass)
      ?? optionalString(database?.storageClassName);
    nodes.push(directNode({
      id: databaseNodeId,
      provider,
      context,
      compositionId: "applik8s-postgres-cluster-provider",
      reason:
        "Install Hatchet's external PostgreSQL authority before the workflow engine.",
      namespace,
      configuration: compactJson({
        name: clusterName,
        namespace,
        spec: {
          instances:
            optionalInteger(database?.instances)
            ?? (value.mode === "ha" ? 3 : 1),
          storage: {
            size: optionalString(database?.storageSize) ?? "8Gi",
            ...(storageClass ? { storageClass } : {}),
          },
          bootstrap: {
            initdb: {
              database: databaseName,
              owner: "hatchet",
              secret: { name: databaseSecretName },
            },
          },
          postgresql: { parameters: { timezone: "UTC" } },
        },
      }),
      ownership: "application",
      deletion: "delete",
    }));
  }
  const installationNodeId = `direct.${provider.id}.hatchet`;
  nodes.push(directNode({
    id: installationNodeId,
    provider,
    context,
    compositionId: "hatchet-installation",
    reason:
      "Delegate Hatchet chart, source, readiness, and lifecycle to TypeKro's released integration.",
    namespace,
    configuration: compactJson({
      name,
      namespace,
      namespaceOwnership: "external",
      repositoryNamespaceOwnership: "external",
      ...(optionalString(value.chartVersion)
        ? { chartVersion: optionalString(value.chartVersion) }
        : {}),
      ...(optionalString(value.serverVersion)
        ? { serverVersion: optionalString(value.serverVersion) }
        : {}),
      database: {
        connectionSecret: { name: databaseSecretName },
      },
      adminCredentialsSecret: { name: adminSecretName },
      replicas: {
        api: value.mode === "ha" ? 2 : 1,
        engine: value.mode === "ha" ? 2 : 1,
        frontend: value.mode === "ha" ? 2 : 1,
      },
      dashboard: value.dashboard !== "disabled",
      serverUrl:
        optionalString(value.apiUrl)
        ?? `http://hatchet-api.${namespace}.svc:8080`,
      cookieDomain: `hatchet-api.${namespace}.svc`,
      cookieInsecure: value.tls !== true,
      grpcBroadcastAddress:
        optionalString(value.hostPort)
        ?? `hatchet-engine.${namespace}.svc:7070`,
      grpcInsecure: value.tls !== true,
      workerTokenJob: true,
    }),
    ownership: "application",
    deletion: "delete",
  }));
  if (!adminReference) {
    edges.push({
      from: adminNodeId,
      to: installationNodeId,
      relationship: "requiresReady",
    });
  }
  if (!databaseReference && database?.provision !== false) {
    edges.push({
      from: databaseSecretNodeId,
      to: databaseNodeId,
      relationship: "requiresReady",
    });
    edges.push({
      from: databaseSecretNodeId,
      to: installationNodeId,
      relationship: "requiresReady",
    });
  }
  if (database?.provision !== false) {
    edges.push({
      from: databaseNodeId,
      to: installationNodeId,
      relationship: "requiresReady",
    });
  }
  return {
    nodes,
    edges,
    runtimeAccessTargets: [{
      capabilityId: provider.id,
      target: "kubernetes",
      namespace,
      serviceName: "hatchet-engine",
      podSelector: { "app.kubernetes.io/instance": "hatchet" },
      protocol: "TCP",
      port: 7070,
    }],
  };
}

function workflowGeneratedSecretNode(options: {
  readonly id: string;
  readonly provider: ApplicationProviderNode;
  readonly context: ApplicationDeploymentPlanningContext;
  readonly namespace: string;
  readonly name: string;
  readonly secretType?: "Opaque" | "kubernetes.io/basic-auth";
  readonly values: DeploymentJsonObject;
}): ApplicationExternalProviderDeploymentNode {
  const configuration = {
    namespace: options.namespace,
    name: options.name,
    ...(options.secretType ? { secretType: options.secretType } : {}),
    values: options.values,
    consumers: [options.provider.id],
  };
  return {
    id: options.id,
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: options.provider.id },
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: options.context.connection.digest,
      namespace: options.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(configuration),
    inputs: {},
    outputs: [
      {
        name: "reference",
        type: "secretReference",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "name",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "namespace",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
    ],
    lifecycle: {
      ownership: "application",
      deletion: "delete",
      adoption: "createOrAdoptExact",
    },
    spec: {
      resourceType: "kubernetesGeneratedSecret",
      controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
      // The Secret name is compiler-owned public identity. Hatchet needs the
      // object to exist before reconciliation; no generated value crosses the
      // TypeKro artifact boundary.
      referenceMode: "staticIdentity",
      configuration,
    },
  };
}

function valkeyDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "indexStore");
  if (
    value?.kind !== "valkey" ||
    value.provision === false ||
    value.provisioner !== "hyperspike"
  ) {
    return { nodes: [], edges: [] };
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name = optionalString(value.name) ?? `${context.graph.metadata.name}-index`;
  const nodes: ApplicationKubernetesDirectDeploymentNode[] = [];
  const edges: ApplicationDeploymentEdge[] = [];
  const operator = optionalObject(value.operator);
  const operatorNodeId = `direct.${provider.id}.operator`;
  if (operator?.provision !== false) {
    const configuration = compactJson({
      name:
        optionalString(operator?.name) ??
        "applik8s-valkey-operator",
      namespace:
        optionalString(operator?.namespace) ??
        "valkey-operator-system",
      ...(optionalString(operator?.version)
        ? { version: optionalString(operator?.version) }
        : {}),
    });
    nodes.push(
      directNode({
        id: operatorNodeId,
        provider,
        context,
        compositionId: "valkey-bootstrap",
        reason: "Install the shared Hyperspike Valkey API before application clusters.",
        namespace: requiredString(configuration.namespace, "Valkey operator namespace"),
        configuration,
        ownership: "shared",
        deletion: "retain",
      }),
    );
  }
  const topology = optionalObject(value.topology);
  const authentication = optionalObject(value.authentication);
  const storage = optionalObject(value.storage);
  const shards = optionalInteger(topology?.shards) ?? 1;
  const replicas = optionalInteger(topology?.replicas) ?? 0;
  if (shards < 1 || shards > 100) {
    throw new Error("Hyperspike Valkey topology.shards must be between 1 and 100.");
  }
  if (replicas < 0 || replicas > 10) {
    throw new Error("Hyperspike Valkey topology.replicas must be between 0 and 10.");
  }
  const authenticationMode =
    authentication?.mode === "password" ? "password" : "anonymous";
  const authenticationSecret = optionalObject(authentication?.secret);
  if (authenticationMode === "password" && !optionalString(authenticationSecret?.name)) {
    throw new Error("Hyperspike Valkey password authentication requires a named Secret.");
  }
  const customSpec = optionalObject(value.spec);
  const reserved = [
    "shards",
    "nodes",
    "replicas",
    "anonymousAuth",
    "servicePassword",
    "storage",
    "resources",
  ].filter((field) => customSpec && Object.hasOwn(customSpec, field));
  if (reserved.length > 0) {
    throw new Error(
      `Hyperspike Valkey spec cannot override typed provider fields: ${reserved.join(", ")}.`,
    );
  }
  const valkeySpec = compactJson({
    shards,
    replicas,
    anonymousAuth: authenticationMode === "anonymous",
    ...(authenticationMode === "password" && authenticationSecret
      ? {
          servicePassword: {
            name: requiredString(
              authenticationSecret.name,
              "Valkey password Secret name",
            ),
            key: optionalString(authentication?.key) ?? "password",
          },
        }
      : {}),
    ...(storage
      ? {
          storage: {
            spec: {
              resources: {
                requests: {
                  storage: requiredString(
                    storage.size,
                    "Valkey storage size",
                  ),
                },
              },
              accessModes: ["ReadWriteOnce"],
              ...(optionalString(storage.storageClassName)
                ? {
                    storageClassName: optionalString(
                      storage.storageClassName,
                    ),
                  }
                : {}),
            },
          },
        }
      : {}),
    ...(optionalObject(value.resources)
      ? { resources: optionalObject(value.resources) }
      : {}),
    ...(customSpec ?? {}),
  });
  const clusterNodeId = `direct.${provider.id}.cluster`;
  nodes.push(
    directNode({
      id: clusterNodeId,
      provider,
      context,
      compositionId: "applik8s-valkey-cluster-provider",
      reason:
        "Keep operator-managed Valkey children outside the root KRO ApplySet.",
      namespace,
      configuration: compactJson({
        name,
        namespace,
        spec: valkeySpec,
      }),
      ownership: "application",
      deletion: "delete",
    }),
  );
  if (nodes.some((node) => node.id === operatorNodeId)) {
    edges.push({
      from: operatorNodeId,
      to: clusterNodeId,
      relationship: "installsApi",
    });
  }
  return {
    nodes,
    edges,
    runtimeAccessTargets: [{
      capabilityId: provider.id,
      target: "kubernetes",
      namespace,
      serviceName: name,
      podSelector: {
        "app.kubernetes.io/name": "valkey",
        "app.kubernetes.io/instance": name,
      },
      protocol: "TCP",
      port: 6379,
    }],
  };
}

function postgresDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "transactionalDatabase");
  if (
    value?.kind !== "postgres" ||
    value.ownership !== "direct-provisioned"
  ) {
    return { nodes: [], edges: [] };
  }
  if (value.provision === false || value.cluster !== undefined) {
    throw new Error(
      "Direct-provisioned Postgres cannot disable provisioning or reference an external cluster.",
    );
  }
  const lifecycle = optionalObject(value.lifecycle);
  const deletionPolicy =
    lifecycle?.deletionPolicy === "delete"
      ? "delete"
      : lifecycle?.deletionPolicy === "retain"
        ? "retain"
        : undefined;
  if (!deletionPolicy) {
    throw new Error(
      "Direct-provisioned Postgres requires lifecycle.deletionPolicy.",
    );
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name =
    optionalString(value.clusterName) ??
    optionalString(value.name) ??
    `${context.graph.metadata.name}-db`;
  const database = optionalString(value.database) ?? context.graph.metadata.name;
  const configuration = compactJson({
    name,
    namespace,
    spec: postgresClusterSpec(value, database),
  });
  return {
    nodes: [
      directNode({
        id: `direct.${provider.id}.cluster`,
        provider,
        context,
        compositionId: "applik8s-postgres-cluster-provider",
        reason:
          "Give retained CloudNativePG data an explicit lifecycle outside the root KRO ApplySet.",
        namespace,
        configuration,
        ownership: "application",
        deletion: deletionPolicy,
      }),
    ],
    edges: [],
    runtimeAccessTargets: [{
      capabilityId: provider.id,
      target: "kubernetes",
      namespace,
      serviceName: `${name}-rw`,
      podSelector: { "cnpg.io/cluster": name },
      protocol: "TCP",
      port: 5432,
    }],
  };
}

function objectStorageDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "objectStorage");
  const provisioning = optionalObject(value?.provisioning);
  if (
    value?.kind !== "s3" ||
    value.enabled === false ||
    value.ownership !== "direct-provisioned" ||
    provisioning?.enabled === false
  ) {
    return { nodes: [], edges: [] };
  }
  const secret = optionalObject(value.credentialsSecret);
  const namespace = requiredString(
    secret?.namespace,
    "Direct-provisioned S3 credentials Secret namespace",
  );
  const bucket = requiredString(value.bucket, "Direct-provisioned S3 bucket");
  if (provisioning?.kind === "local-s3") {
    const name =
      optionalString(provisioning.name)
      ?? optionalString(value.name)
      ?? bucket;
    const secretName = requiredString(
      secret?.name,
      "Local S3 credentials Secret name",
    );
    const secretConfiguration = {
      namespace,
      name: secretName,
      values: {
        AWS_ACCESS_KEY_ID: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
        },
        AWS_SECRET_ACCESS_KEY: {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
        },
      },
      consumers: [provider.id],
    };
    const secretNodeId = `external.${provider.id}.local-s3-credentials`;
    const localS3NodeId = `direct.${provider.id}.local-s3`;
    const secretNode: ApplicationExternalProviderDeploymentNode = {
      id: secretNodeId,
      kind: "externalProvider",
      contractVersion: 1,
      source: { semanticNodeId: provider.id },
      provider: {
        interface: "Secret",
        implementation: "alchemy-kubernetes-generated-secret",
        version: "1",
      },
      scope: {
        connectionDigest: context.connection.digest,
        namespace,
      },
      capabilities: { strategies: ["direct", "kro"], alchemy: true },
      configurationDigest:
        digestApplicationDeploymentValue(secretConfiguration),
      inputs: {},
      outputs: [
        {
          name: "reference",
          type: "secretReference",
          sensitivity: "public",
          persistence: "reference",
        },
        {
          name: "name",
          type: "string",
          sensitivity: "public",
          persistence: "reference",
        },
        {
          name: "namespace",
          type: "string",
          sensitivity: "public",
          persistence: "reference",
        },
      ],
      lifecycle: {
        ownership: "application",
        deletion: "delete",
        adoption: "createOrAdoptExact",
      },
      spec: {
        resourceType: "kubernetesGeneratedSecret",
        controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
        // The provider configuration already carries the non-secret
        // namespace/name. Only readiness ordering is required; no generated
        // value or provider output may enter the TypeKro artifact surface.
        referenceMode: "staticIdentity",
        configuration: secretConfiguration,
      },
    };
    const localS3Node = directNode({
      id: localS3NodeId,
      provider,
      context,
      compositionId: "applik8s-local-s3",
      reason:
        "Provide a credentialed, persistent S3-compatible service for the maintained Starter profile.",
      namespace,
      configuration: compactJson({
        name,
        namespace,
        bucket,
        credentialsSecretName: secretName,
        image:
          optionalString(provisioning.image)
          ?? "docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d",
        storage: {
          size: optionalString(provisioning.storageSize) ?? "2Gi",
          ...(optionalString(provisioning.storageClassName)
            ? {
                storageClassName: optionalString(
                  provisioning.storageClassName,
                ),
              }
            : {}),
        },
      }),
      ownership: "application",
      deletion: "delete",
    });
    return {
      nodes: [secretNode, localS3Node],
      edges: [
        {
          from: secretNodeId,
          to: localS3NodeId,
          relationship: "requiresReady",
        },
      ],
    };
  }
  const name =
    optionalString(provisioning?.claimName) ??
    optionalString(value.name) ??
    optionalString(secret?.name) ??
    bucket;
  if (optionalString(secret?.name) !== name) {
    throw new Error(
      `Direct-provisioned S3 credentials Secret name ${JSON.stringify(optionalString(secret?.name))} must match provisioning.claimName ${JSON.stringify(name)}.`,
    );
  }
  const platform = optionalObject(provisioning?.platform);
  const managedRookPlatform =
    platform?.kind === "rook-ceph-single-node-development"
      ? platform
      : undefined;
  const rookPlatform =
    managedRookPlatform
      ? {
          name: optionalString(managedRookPlatform.name) ?? "applik8s-rook",
          namespace:
            optionalString(managedRookPlatform.namespace)
            ?? "applik8s-rook-ceph",
          operatorNamespace:
            optionalString(managedRookPlatform.operatorNamespace)
            ?? "applik8s-rook-ceph-operator",
        }
      : undefined;
  const operatorNode =
    rookPlatform
      ? directNode({
          id: `direct.${provider.id}.rook-operator`,
          provider,
          context,
          compositionId: "applik8s-rook-ceph-operator",
          reason:
            "Install one explicitly shared Rook operator before reconciling application Ceph platforms.",
          namespace: rookPlatform.operatorNamespace,
          configuration: compactJson({
            name: "applik8s-rook-operator",
            namespace: rookPlatform.operatorNamespace,
            repositoryName: "rook-release",
            repositoryNamespace: rookPlatform.operatorNamespace,
            repositoryNamespaceOwnership: "owned",
            enableOBCWatchOperatorNamespace: true,
            obcProvisionerNamePrefix: rookPlatform.operatorNamespace,
            resources: { requests: { cpu: "100m", memory: "128Mi" } },
            values: { allowLoopDevices: true },
          }),
          ownership: "shared",
          deletion: "retain",
        })
      : undefined;
  const platformNode =
    rookPlatform
      ? directNode({
          id: `direct.${provider.id}.rook-platform`,
          provider,
          context,
          compositionId:
            "applik8s-rook-ceph-external-operator-single-node-platform",
          reason:
            "Install the explicitly selected shared one-node Ceph development platform through the separately owned Rook operator.",
          namespace: rookPlatform.namespace,
          configuration: compactJson({
            name: rookPlatform.name,
            profile: "single-node-development",
            namespace: rookPlatform.namespace,
            operatorNamespace: rookPlatform.operatorNamespace,
            operatorDeploymentName: "rook-ceph-operator",
            repositoryName: `${rookPlatform.name}-rook-release`,
            repositoryNamespace: rookPlatform.namespace,
            repositoryNamespaceOwnership: "owned",
            bucketProvisionerNamePrefix: rookPlatform.operatorNamespace,
            bucketProvisionerName:
              `${rookPlatform.operatorNamespace}.ceph.rook.io/bucket`,
            storageClassName: requiredString(
              managedRookPlatform?.deviceStorageClassName,
              "Managed Rook/Ceph device StorageClass",
            ),
            allowLoopDevices: managedRookPlatform?.allowLoopDevices,
            storageSize:
              optionalString(managedRookPlatform?.storageSize) ?? "16Gi",
            objectStoreName:
              optionalString(managedRookPlatform?.objectStoreName)
              ?? "applik8s-object-store",
            bucketStorageClassName: requiredString(
              provisioning?.storageClassName,
              "Managed Rook/Ceph bucket StorageClass",
            ),
          }),
          ownership: "shared",
          deletion: "retain",
        })
      : undefined;
  if (platform && !platformNode) {
    throw new Error(
      `Unsupported managed ObjectStorage platform ${JSON.stringify(platform.kind)}.`,
    );
  }
  const claimNode = directNode({
    id: `direct.${provider.id}.claim`,
    provider,
    context,
    compositionId: "rook-object-storage-claim",
    reason:
      "ObjectBucketClaims are controller-mutated and require TypeKro direct mode.",
    namespace,
    configuration: compactJson({
      name,
      namespace,
      storageClassName: requiredString(
        provisioning?.storageClassName,
        "Direct-provisioned S3 StorageClass",
      ),
      bucket: { mode: "fixed", name: bucket },
    }),
    ownership: "application",
    deletion: "delete",
  });
  return {
    nodes: [
      ...(operatorNode ? [operatorNode] : []),
      ...(platformNode ? [platformNode] : []),
      claimNode,
    ],
    edges: platformNode
      ? [
          ...(operatorNode
            ? [{
                from: operatorNode.id,
                to: platformNode.id,
                relationship: "requiresReady" as const,
              }]
            : []),
          {
            from: platformNode.id,
            to: claimNode.id,
            relationship: "requiresReady",
          },
        ]
      : [],
  };
}

function identityDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "identityInfrastructure");
  if (value?.kind !== "ory" || value.provision === false) {
    return { nodes: [], edges: [] };
  }
  const spec = requiredObject(value.spec, "Ory identity infrastructure spec");
  const namespace = requiredString(spec.namespace, "Ory identity namespace");
  const stack =
    value.stack === "platform"
      ? "platform"
      : value.stack === "identity"
        ? "identity"
        : undefined;
  if (!stack) {
    throw new Error("Ory identity infrastructure stack must be identity or platform.");
  }
  const deletion =
    value.deletionPolicy === "delete" ? "delete" as const : "retain" as const;
  const oryNodeId = `direct.${provider.id}.ory-${stack}`;
  const nodes: ApplicationDeploymentNode[] = [];
  const edges: ApplicationDeploymentEdge[] = [];
  let configuration: DeploymentJsonObject = {
    ...spec,
    namespaceOwnership: "external",
  };

  if (stack === "platform") {
    const managed = optionalObject(spec.managed) ?? {};
    const explicitSources = optionalObject(spec.dependencySources) ?? {};
    const hydraSources: Record<string, DeploymentJsonValue> = {
      ...(optionalObject(explicitSources.hydra) ?? {}),
    };
    const kratosSources: Record<string, DeploymentJsonValue> = {
      ...(optionalObject(explicitSources.kratos) ?? {}),
    };
    const ketoSources: Record<string, DeploymentJsonValue> = {
      ...(optionalObject(explicitSources.keto) ?? {}),
    };
    const oathkeeperSources: Record<string, DeploymentJsonValue> = {
      ...(optionalObject(explicitSources.oathkeeper) ?? {}),
    };
    const kratosSecrets: Record<string, DeploymentJsonValue> = {
      ...(optionalObject(kratosSources.secrets) ?? {}),
    };
    kratosSources.secrets = kratosSecrets;
    const manageDatabases = managed.databases !== false;
    const manageSecrets = managed.secrets !== false;
    const databaseStorageClass = optionalString(
      managed.databaseStorageClass,
    );
    const name = requiredString(spec.name, "Ory identity infrastructure name");
    const generatedSources: Record<string, DeploymentJsonValue> = {
      ...explicitSources,
      hydra: hydraSources,
      kratos: kratosSources,
      keto: ketoSources,
      oathkeeper: oathkeeperSources,
    };

    const databaseDependencies = [
      {
        component: "hydra",
        sources: hydraSources,
      },
      {
        component: "kratos",
        sources: kratosSources,
      },
      {
        component: "keto",
        sources: ketoSources,
      },
    ] as const;
    if (manageDatabases) {
      for (const dependency of databaseDependencies) {
        if (optionalObject(dependency.sources.database)?.dsn !== undefined) {
          continue;
        }
        const clusterName = `${name}-${dependency.component}-db`;
        const nodeId =
          `direct.${provider.id}.ory-${dependency.component}-database`;
        nodes.push(
          directNode({
            id: nodeId,
            provider,
            context,
            compositionId: "applik8s-postgres-cluster-provider",
            reason:
              `Provide the ${dependency.component} database through an independent lifecycle boundary without persisting its generated DSN.`,
            namespace,
            configuration: compactJson({
              name: clusterName,
              namespace,
              spec: {
                instances: 1,
                storage: {
                  size: "1Gi",
                  ...(databaseStorageClass
                    ? { storageClass: databaseStorageClass }
                    : {}),
                },
                bootstrap: {
                  initdb: {
                    database: dependency.component,
                    owner: dependency.component,
                  },
                },
              },
            }),
            ownership: "application",
            deletion,
          }),
        );
        dependency.sources.database = {
          dsn: {
            mode: "external",
            value: {
              secretRef: {
                name: `${clusterName}-app`,
                key: "uri",
              },
            },
          },
          databaseName: dependency.component,
        };
        edges.push({
          from: nodeId,
          to: oryNodeId,
          relationship: "requiresReady",
        });
      }
    }

    if (manageSecrets) {
      const addGeneratedSecret = (
        component: "hydra" | "kratos" | "oathkeeper",
        secretName: string,
        values: DeploymentJsonObject,
      ) => {
        const nodeId =
          `external.${provider.id}.ory-${component}-secrets`;
        nodes.push(
          generatedSecretProviderNode({
            id: nodeId,
            provider,
            context,
            namespace,
            name: secretName,
            values,
            consumers: [oryNodeId],
            deletion,
          }),
        );
        edges.push({
          from: nodeId,
          to: oryNodeId,
          relationship: "requiresReady",
        });
      };

      if (hydraSources.systemSecret === undefined) {
        addGeneratedSecret(
          "hydra",
          `${name}-hydra-secrets`,
          {
            system: {
              kind: "random",
              bytes: 48,
              encoding: "base64url",
            },
          },
        );
        hydraSources.systemSecret = {
          mode: "external",
          value: {
            secretRef: {
              name: `${name}-hydra-secrets`,
              key: "system",
            },
          },
        };
      }

      const missingKratosSecretValues: Record<string, DeploymentJsonValue> = {};
      if (kratosSecrets.cookie === undefined) {
        missingKratosSecretValues.cookie = {
          kind: "random",
          // Kratos v26 accepts cookie/cipher entries up to 32 characters.
          // Generate 256 bits and expose 32 base64url characters (192 bits).
          bytes: 32,
          encoding: "base64url",
          characters: 32,
        };
        kratosSecrets.cookie = {
          mode: "external",
          value: {
            secretRef: {
              name: `${name}-kratos-secrets`,
              key: "cookie",
            },
          },
        };
      }
      if (kratosSecrets.cipher === undefined) {
        missingKratosSecretValues.cipher = {
          kind: "random",
          bytes: 32,
          encoding: "base64url",
          characters: 32,
        };
        kratosSecrets.cipher = {
          mode: "external",
          value: {
            secretRef: {
              name: `${name}-kratos-secrets`,
              key: "cipher",
            },
          },
        };
      }
      if (Object.keys(missingKratosSecretValues).length > 0) {
        addGeneratedSecret(
          "kratos",
          `${name}-kratos-secrets`,
          missingKratosSecretValues,
        );
      }

      if (oathkeeperSources.mutatorIdTokenJwks === undefined) {
        addGeneratedSecret(
          "oathkeeper",
          `${name}-oathkeeper-secrets`,
          {
            jwks: {
              kind: "jwkSet",
              algorithm: "RS256",
              modulusLength: 2048,
              keyId: `${safeProviderNodeId(name)}-oathkeeper-id-token-v1`,
            },
          },
        );
        oathkeeperSources.mutatorIdTokenJwks = {
          mode: "external",
          value: {
            secretRef: {
              name: `${name}-oathkeeper-secrets`,
              key: "jwks",
            },
          },
        };
      }
    }

    configuration = compactJson({
      ...spec,
      namespaceOwnership: "external",
      managed: {
        ...managed,
        databases: false,
        secrets: false,
      },
      dependencySources: generatedSources,
    });
  }

  nodes.push(
    directNode({
      id: oryNodeId,
      provider,
      context,
      compositionId:
        stack === "platform" ? "ory-platform-stack" : "ory-identity-stack",
      reason:
        "Managed identity infrastructure has an explicit lifecycle outside runtime request admission.",
      namespace,
      configuration,
      ownership: "application",
      deletion,
    }),
  );
  const workloadNamespace = applicationNamespace(context);
  if (
    namespace !== workloadNamespace
    && !["default", "kube-system", "kube-public", "kube-node-lease"].includes(
      namespace,
    )
  ) {
    const namespaceNode = directNode({
      id: `direct.${provider.id}.ory-namespace`,
      provider,
      context,
      compositionId: "applik8s-namespace",
      reason:
        "Establish the Ory namespace as an explicit lifecycle boundary before identity dependencies.",
      namespace,
      configuration: { name: namespace },
      ownership: "application",
      deletion,
    });
    nodes.unshift(namespaceNode);
    edges.push(
      ...nodes
        .filter((node) => node.id !== namespaceNode.id)
        .map((node) => ({
          from: namespaceNode.id,
          to: node.id,
          relationship: "requiresReady" as const,
        })),
    );
  }
  return {
    nodes,
    edges,
  };
}

function generatedSecretProviderNode(options: {
  readonly id: string;
  readonly provider: ApplicationProviderNode;
  readonly context: ApplicationDeploymentPlanningContext;
  readonly namespace: string;
  readonly name: string;
  readonly values: DeploymentJsonObject;
  readonly consumers: readonly string[];
  /** Exact subset mounted into semantic application runtimes. */
  readonly runtimeKeys?: readonly string[];
  readonly deletion: "delete" | "retain";
}): ApplicationExternalProviderDeploymentNode {
  const configuration = {
    namespace: options.namespace,
    name: options.name,
    values: options.values,
    consumers: [...options.consumers],
    ...(options.runtimeKeys ? { runtimeKeys: [...options.runtimeKeys].sort() } : {}),
  };
  return {
    id: options.id,
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: options.provider.id },
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: options.context.connection.digest,
      namespace: options.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(configuration),
    inputs: {},
    outputs: [
      {
        name: "reference",
        type: "secretReference",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "name",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "namespace",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
    ],
    lifecycle: {
      ownership: "application",
      deletion: options.deletion,
      adoption: "createOrAdoptExact",
    },
    spec: {
      resourceType: "kubernetesGeneratedSecret",
      controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
      referenceMode: "staticIdentity",
      configuration,
    },
  };
}

function directNode(options: {
  readonly id: string;
  readonly provider: ApplicationProviderNode;
  readonly context: ApplicationDeploymentPlanningContext;
  readonly compositionId: string;
  readonly reason: string;
  readonly namespace: string;
  readonly configuration: DeploymentJsonObject;
  readonly ownership: "application" | "shared";
  readonly deletion: "delete" | "retain";
}): ApplicationKubernetesDirectDeploymentNode {
  return {
    id: options.id,
    kind: "kubernetesDirect",
    contractVersion: 1,
    source: { semanticNodeId: options.provider.id },
    provider: {
      interface: options.provider.interface,
      implementation: options.compositionId,
      version: "1",
    },
    scope: {
      connectionDigest: options.context.connection.digest,
      namespace: options.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(
      options.configuration,
    ),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean",
        sensitivity: "public",
        persistence: "state",
      },
    ],
    lifecycle: {
      ownership: options.ownership,
      deletion: options.deletion,
      adoption: "createOrAdoptExact",
    },
    spec: {
      compositionId: options.compositionId,
      reason: options.reason,
      configuration: options.configuration,
    },
  };
}

function postgresClusterSpec(
  provider: DeploymentJsonObject,
  database: string,
): DeploymentJsonObject {
  const storage = optionalObject(provider.storage);
  const resources = optionalObject(provider.resources);
  const backup = optionalObject(provider.backup);
  return compactJson({
    instances: optionalInteger(provider.instances) ?? 1,
    storage: {
      size: optionalString(storage?.size) ?? "1Gi",
      ...(optionalString(storage?.storageClassName)
        ? { storageClass: optionalString(storage?.storageClassName) }
        : {}),
    },
    ...(resources ? { resources } : {}),
    bootstrap: { initdb: { database, owner: "app" } },
    ...(backup && backup.enabled !== false
      ? { backup: postgresBackupSpec(backup) }
      : {}),
  });
}

function postgresBackupSpec(backup: DeploymentJsonObject): DeploymentJsonObject {
  const destination = requiredObject(
    backup.destination,
    "Postgres backup destination",
  );
  const common = {
    retentionPolicy: requiredString(
      backup.retentionPolicy,
      "Postgres backup retentionPolicy",
    ),
    target: backup.target === "primary" ? "primary" : "prefer-standby",
  };
  if (destination.kind === "volume-snapshot") {
    return compactJson({
      ...common,
      volumeSnapshot: {
        ...(optionalString(destination.className)
          ? { className: optionalString(destination.className) }
          : {}),
        online: destination.online !== false,
      },
    });
  }
  if (destination.kind !== "s3") {
    throw new Error("Postgres backup destination must be volume-snapshot or s3.");
  }
  const secret = requiredObject(
    destination.credentialsSecret,
    "Postgres S3 backup credentials Secret",
  );
  const name = requiredString(
    secret.name,
    "Postgres S3 backup credentials Secret name",
  );
  return compactJson({
    ...common,
    barmanObjectStore: {
      destinationPath: requiredString(
        destination.destinationPath,
        "Postgres S3 backup destinationPath",
      ),
      ...(optionalString(destination.endpoint)
        ? { endpointURL: optionalString(destination.endpoint) }
        : {}),
      s3Credentials: {
        accessKeyId: {
          name,
          key: optionalString(destination.accessKeyIdKey) ?? "AWS_ACCESS_KEY_ID",
        },
        secretAccessKey: {
          name,
          key:
            optionalString(destination.secretAccessKeyKey) ??
            "AWS_SECRET_ACCESS_KEY",
        },
        ...(optionalString(destination.regionKey)
          ? {
              region: {
                name,
                key: optionalString(destination.regionKey),
              },
            }
          : {}),
      },
      data: { compression: "gzip", jobs: 2, immediateCheckpoint: true },
      wal: { compression: "gzip", maxParallel: 2 },
    },
  });
}

function applicationNamespace(
  context: ApplicationDeploymentPlanningContext,
): string {
  return (
    context.graph.metadata.namespace ??
    optionalString(context.installationSpec.name) ??
    "default"
  );
}

function nestedObject(
  value: DeploymentJsonObject | undefined,
  key: string,
): DeploymentJsonObject | undefined {
  return optionalObject(value?.[key]);
}

// typecast-boundary: the runtime object/array guard narrows an unknown
// provider value to the deployment JSON object boundary.
function optionalObject(value: unknown): DeploymentJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DeploymentJsonObject)
    : undefined;
}

function requiredObject(value: unknown, label: string): DeploymentJsonObject {
  const result = optionalObject(value);
  if (!result) throw new Error(`${label} must be an object.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function requiredInteger(value: unknown, label: string): number {
  const result = optionalInteger(value);
  if (result === undefined) throw new Error(`${label} must be an integer.`);
  return result;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function safeProviderNodeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function boundedProviderName(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const digest = digestApplicationDeploymentValue(value)
    .slice("sha256:".length, "sha256:".length + 8);
  const prefix = value
    .slice(0, maximumLength - digest.length - 1)
    .replace(/[.-]+$/gu, "");
  if (!prefix) {
    throw new Error(`Provider name ${JSON.stringify(value)} cannot be bounded to ${maximumLength} characters.`);
  }
  return `${prefix}-${digest}`;
}

function compactJson(
  value: Readonly<Record<string, unknown>>,
): DeploymentJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, candidate]) => [key, deploymentJsonValue(candidate, key)]),
  );
}

// typecast-boundary: every nested candidate is recursively validated before
// an object is accepted as portable deployment JSON.
function deploymentJsonValue(
  value: unknown,
  path: string,
): DeploymentJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${path} must be a finite JSON number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((candidate, index) =>
      deploymentJsonValue(candidate, `${path}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return compactJson(value as Readonly<Record<string, unknown>>);
  }
  throw new Error(`${path} is not portable deployment JSON.`);
}

function managedHarborNodes(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): readonly ApplicationExternalProviderDeploymentNode[] {
  const registry = provider.config?.containerRegistry;
  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    Reflect.get(registry, "kind") !== "harbor-container-registry"
  ) {
    return [];
  }
  const management = Reflect.get(registry, "management");
  if (!management || typeof management !== "object" || Array.isArray(management)) {
    return [];
  }
  const secretNamespace = Reflect.get(management, "secretNamespace");
  const projectLifecycle = Reflect.get(management, "projectLifecycle");
  const deletionPolicy =
    projectLifecycle &&
    typeof projectLifecycle === "object" &&
    Reflect.get(projectLifecycle, "deletionPolicy") === "delete"
      ? "delete"
      : "retain";
  if (typeof secretNamespace !== "string" || !secretNamespace.trim()) {
    throw new Error(
      `Managed Harbor provider ${provider.id} requires a concrete management.secretNamespace after installation resolution.`,
    );
  }
  // typecast: ApplicationGraph provider configuration has already crossed the
  // typecast: JSON graph boundary; the compiler preserves it without interpretation.
  const configuration = registry as DeploymentJsonObject;
  return [
    {
      id: `external.${provider.id}.harbor-project`,
      kind: "externalProvider",
      contractVersion: 1,
      source: { semanticNodeId: provider.id },
      provider: {
        interface: "ContainerRegistry",
        implementation: "typekro-harbor-project",
        version: "1",
      },
      scope: {
        connectionDigest: context.connection.digest,
        namespace: secretNamespace,
      },
      capabilities: {
        strategies: ["direct", "kro"],
        alchemy: true,
      },
      configurationDigest: digestApplicationDeploymentValue(configuration),
      inputs: {},
      outputs: [
        {
          name: "ready",
          type: "boolean",
          sensitivity: "public",
          persistence: "state",
        },
        {
          name: "project",
          type: "string",
          sensitivity: "public",
          persistence: "state",
        },
      ],
      lifecycle: {
        ownership: "application",
        deletion: deletionPolicy,
        adoption: "createOrAdoptExact",
      },
      spec: {
        resourceType: "harborProject",
        controller: "typekro-harbor",
        configuration,
      },
    },
  ];
}

function providerFragment(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
  execution: ApplicationProviderExecution,
): ApplicationTypeKroFragmentDescriptor {
  return {
    id: `provider:${provider.id}`,
    sourceNodeId: provider.id,
    providerInterface: provider.interface,
    providerImplementation: provider.implementation,
    contributorVersion: 1,
    execution,
    profile: context.profile,
    configuration: provider.config ?? {},
  };
}
