// typecast-file-boundary: Provider guarantee analysis narrows heterogeneous graph configuration by validated node kind.
import {
  type ApplicationDeploymentTargetKind,
  type ApplicationGraph,
  type ApplicationProviderGuarantee,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationProviderNode,
  applicationCanonicalIdentity,
  applicationProviderIdentity,
} from '@applik8s/core';

export interface ApplicationProviderGuaranteeRegistryRequest {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationDeploymentTargetKind;
  readonly profile?: string;
}

/**
 * Produces the baseline guarantee record for every concrete provider selected
 * by an application graph. Provider packages can replace these static claims
 * with stronger target-live manifests; absence never becomes an implicit
 * compatibility promise.
 */
export function applicationProviderGuaranteesForGraph(
  request: ApplicationProviderGuaranteeRegistryRequest,
): readonly ApplicationProviderGuaranteeManifest[] {
  const application = applicationCanonicalIdentity({
    application: request.graph.metadata.name,
    kind: 'application',
    semanticKey: request.graph.metadata.name,
  });
  return request.graph.nodes
    .filter((node): node is ApplicationProviderNode => node.kind === 'provider')
    .map((provider) => {
      const implementation = selectedImplementation(provider, request.profile, request.target);
      const support = providerSupport(provider.interface, implementation, request.target);
      return {
        apiVersion: 'applik8s.providerGuarantees/v1alpha1',
        provider: applicationProviderIdentity({
          application: request.graph.metadata.name,
          capabilityInterface: provider.interface,
          nodeId: provider.id,
          parentId: application.id,
        }),
        capability: {
          interface: provider.interface,
          implementation,
          version: provider.contract?.version ?? 'unversioned',
        },
        targets: [request.target],
        maturity: support ? providerMaturity(request.target, provider.stability) : 'experimental',
        guarantees: baselineGuarantees(provider, request.target, support),
        limitations: support ? targetLimitations(request.target) : [`${provider.interface}/${implementation} has no qualified ${request.target} lowering.`],
        evidenceLevel: request.target === 'local' && support ? 'static' : 'none',
      } satisfies ApplicationProviderGuaranteeManifest;
    });
}

function selectedImplementation(provider: ApplicationProviderNode, profile: string | undefined, target: ApplicationDeploymentTargetKind): string {
  if (provider.interface === 'Scheduler' && provider.implementation === 'target-selected') {
    return target === 'local'
      ? 'local-scheduler'
      : target === 'aws' || target === 'aws-local'
        ? 'eventbridge-scheduler'
        : 'kubernetes-cronjob-scheduler';
  }
  if (provider.interface === 'ActorRuntime' && provider.implementation === 'target-selected') {
    return target === 'local' || target === 'aws-local'
      ? 'deterministic-local-actors'
      : target === 'kubernetes' || target === 'aws' || target === 'aws-local'
        ? 'celld-actors'
        : 'unsupported-target-selected-actors';
  }
  const targetAlias = targetImplementationAliases[target]?.[provider.interface]?.[provider.implementation];
  if (targetAlias) return targetAlias;
  if (provider.implementation !== 'application-provider-selection' || !profile) return provider.implementation;
  const profileConfig = objectValue(provider.config?.profile);
  const branch = (Array.isArray(profileConfig?.branches) ? profileConfig.branches : [])
    .map(objectValue)
    .find((candidate) => candidate?.variant === profile);
  return typeof branch?.implementation === 'string' ? branch.implementation.split('/')[0] ?? branch.implementation : provider.implementation;
}

const targetImplementationAliases: Readonly<Record<ApplicationDeploymentTargetKind, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  local: {
    ApplicationHost: {
      'managed-application-host': 'local-process',
      'kubernetes-application-host': 'local-process',
    },
    Observability: { clickstack: 'local-otel', cloudwatch: 'local-otel' },
    LakehouseDataset: { 's3-dataset': 'duckdb-dataset' },
    LakehouseQuery: { 'athena-queries': 'duckdb-queries' },
  },
  'aws-local': {
    TransactionalDatabase: { postgres: 'rds-postgresql' },
    IndexStore: { valkey: 'elasticache-valkey' },
    EventLog: { 'nats-jetstream': 'kinesis' },
    EventSource: { 'nats-jetstream': 'kinesis' },
    Queue: { 'kubernetes-configmap-queue': 'sqs' },
    ApplicationHost: {
      'managed-application-host': 'ecs-fargate',
      'kubernetes-application-host': 'ecs-fargate',
    },
    HttpExposure: { ingress: 'alb', 'node-port': 'alb' },
    DnsPublication: { 'external-dns': 'route53' },
    Certificate: { 'cert-manager': 'acm' },
    Observability: { 'local-otel': 'cloudwatch', clickstack: 'cloudwatch' },
    LakehouseDataset: { 'duckdb-dataset': 's3-dataset' },
    LakehouseQuery: { 'duckdb-queries': 'athena-queries' },
  },
  aws: {
    TransactionalDatabase: { postgres: 'rds-postgresql' },
    IndexStore: { valkey: 'elasticache-valkey' },
    EventLog: { 'nats-jetstream': 'kinesis' },
    EventSource: { 'nats-jetstream': 'kinesis' },
    Queue: { 'kubernetes-configmap-queue': 'sqs' },
    ApplicationHost: {
      'managed-application-host': 'ecs-fargate',
      'kubernetes-application-host': 'ecs-fargate',
    },
    HttpExposure: { ingress: 'alb', 'node-port': 'alb' },
    DnsPublication: { 'external-dns': 'route53' },
    Certificate: { 'cert-manager': 'acm' },
    Observability: { 'local-otel': 'cloudwatch', clickstack: 'cloudwatch' },
    LakehouseDataset: { 'duckdb-dataset': 's3-dataset' },
    LakehouseQuery: { 'duckdb-queries': 'athena-queries' },
  },
  kubernetes: {},
};

function providerSupport(capability: string, implementation: string, target: ApplicationDeploymentTargetKind): boolean {
  if (target === 'local') return Boolean(localProviders[capability]?.includes(implementation));
  if (target === 'aws-local' || target === 'aws') return Boolean(awsProviders[capability]?.includes(implementation));
  if (target === 'kubernetes' && kubernetesProviders[capability]) {
    return kubernetesProviders[capability]?.includes(implementation) ?? false;
  }
  // Absence from the maintained registry is not evidence of target support.
  // Provider packages may supply a stronger live-backed manifest, but this
  // compiler baseline must fail closed rather than inventing compatibility.
  return false;
}

const localProviders: Readonly<Record<string, readonly string[]>> = {
  TransactionalDatabase: ['postgres'],
  IndexStore: ['valkey'],
  EventLog: ['nats-jetstream'],
  EventSource: ['nats-jetstream'],
  ObjectStorage: ['s3'],
  AnalyticalDatabase: ['clickhouse'],
  ApplicationHost: ['local-process'],
  Scheduler: ['local-scheduler'],
  Observability: ['local-otel', 'otlp'],
  LakehouseDataset: ['duckdb-dataset'],
  LakehouseQuery: ['duckdb-queries'],
  ActorRuntime: ['deterministic-local-actors'],
};

const awsProviders: Readonly<Record<string, readonly string[]>> = {
  TransactionalDatabase: ['rds-postgresql'],
  IndexStore: ['elasticache-valkey'],
  EventSource: ['kinesis'],
  EventLog: ['kinesis'],
  Queue: ['sqs'],
  ObjectStorage: ['s3'],
  ApplicationHost: ['ecs-fargate'],
  Scheduler: ['eventbridge-scheduler'],
  HttpExposure: ['alb'],
  DnsPublication: ['route53'],
  Certificate: ['acm'],
  Observability: ['cloudwatch', 'otlp'],
  LakehouseDataset: ['s3-dataset'],
  LakehouseQuery: ['athena-queries'],
  ActorRuntime: ['celld-actors', 'deterministic-local-actors'],
};

const kubernetesProviders: Readonly<Record<string, readonly string[]>> = {
  TransactionalDatabase: ['postgres'],
  IndexStore: ['valkey'],
  EventLog: ['nats-jetstream'],
  EventSource: ['nats-jetstream', 'kubernetes-watch'],
  Queue: ['kubernetes-configmap-queue'],
  ObjectStorage: ['s3', 'kubernetes-configmap-objects'],
  ApplicationHost: ['managed-application-host', 'kubernetes-application-host'],
  HttpExposure: ['ingress', 'node-port'],
  DnsPublication: ['external-dns'],
  Certificate: ['cert-manager'],
  Scheduler: ['kubernetes-cronjob-scheduler', 'hatchet-scheduler'],
  Observability: ['clickstack', 'otlp'],
  ActorRuntime: ['celld-actors'],
};

function providerMaturity(target: ApplicationDeploymentTargetKind, stability: ApplicationProviderNode['stability']): ApplicationProviderGuaranteeManifest['maturity'] {
  if (stability !== 'stable') return 'experimental';
  return target === 'local' || target === 'kubernetes' ? 'stable' : 'experimental';
}

function baselineGuarantees(
  provider: ApplicationProviderNode,
  target: ApplicationDeploymentTargetKind,
  supported: boolean,
): readonly ApplicationProviderGuarantee[] {
  const disposition = supported ? 'bounded' as const : 'unsupported' as const;
  const evidence = supported ? [`static:${target}:${provider.interface}:${provider.implementation}`] : [];
  const guarantee = (id: string, category: ApplicationProviderGuarantee['category'], statement: string): ApplicationProviderGuarantee => ({ id, category, statement, disposition, evidence });
  return [
    guarantee('ordering', 'ordering-partitioning', 'Ordering is limited to the selected provider contract and declared partition key.'),
    guarantee('delivery', 'replay-retention-acknowledgement-duplicates', 'Delivery, replay, retention, acknowledgement, and duplicate behavior remain provider-explicit.'),
    guarantee('transaction-boundary', 'transaction-outbox', 'Transaction and outbox atomicity are guaranteed only where the capability contract declares them.'),
    guarantee('consistency', 'consistency', 'Read/write consistency is bounded by the selected provider implementation.'),
    guarantee('limits', 'limits', 'Payload, batch, connection, and duration limits are provider-visible plan facts.'),
    guarantee('runtime-access', 'runtime-access-enforcement', 'Runtime access is issued from source-attributed graph requirements and never widened implicitly.'),
    guarantee('readiness', 'readiness-output-authority', 'Readiness and outputs come from the lifecycle-owning provider adapter.'),
    guarantee('lifecycle', 'lifecycle', 'Create, update, recovery, drift, retention, and deletion use one declared lifecycle owner.'),
    guarantee('target-limitations', 'target-limitation', `This record applies only to the ${target} target.`),
    ...(provider.interface === 'ActorRuntime'
      ? actorGuarantees(provider, target, supported)
      : []),
  ];
}

function actorGuarantees(
  provider: ApplicationProviderNode,
  target: ApplicationDeploymentTargetKind,
  supported: boolean,
): readonly ApplicationProviderGuarantee[] {
  const implementation = selectedImplementation(provider, undefined, target);
  const capabilities = implementation === 'celld-actors'
    // The celld Worker owns hibernatable WebSockets, connection leases,
    // typed messages, broadcasts, and disconnect recovery in addition to the
    // durable turn/state/outbox/alarm boundary.
    ? ['durableState', 'serializedTurns', 'transactionalOutbox', 'durableAlarms', 'realtimeConnections', 'connectionLeases', 'realtimeMessages', 'realtimeBroadcast']
    : implementation === 'deterministic-local-actors'
      ? ['durableState', 'serializedTurns', 'transactionalOutbox', 'durableAlarms']
      : [];
  const names = ['durableState', 'serializedTurns', 'transactionalOutbox', 'durableAlarms', 'realtimeConnections', 'connectionLeases', 'realtimeMessages', 'realtimeBroadcast'] as const;
  return names.map((name) => ({
    id: `actor-${name}`,
    category: name === 'serializedTurns' ? 'ordering-partitioning' : name === 'transactionalOutbox' ? 'transaction-outbox' : name.startsWith('realtime') || name === 'connectionLeases' ? 'limits' : 'consistency',
    statement: `Actor provider ${implementation} ${capabilities.includes(name) ? 'satisfies' : 'does not satisfy'} ${name}.`,
    disposition: supported && capabilities.includes(name) ? 'bounded' : 'unsupported',
    evidence: supported && capabilities.includes(name) ? [`static:${target}:ActorRuntime:${implementation}:${name}`] : [],
  }));
}

function targetLimitations(target: ApplicationDeploymentTargetKind): readonly string[] {
  if (target === 'local') return ['Local evidence does not prove remote IAM, availability, quotas, managed upgrades, or cost.'];
  if (target === 'aws-local') return ['AWS-local proves pinned API fidelity only; real AWS remains authoritative.'];
  return [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
