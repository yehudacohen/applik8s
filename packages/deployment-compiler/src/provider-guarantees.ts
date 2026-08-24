// typecast-file-boundary: Provider guarantee analysis narrows heterogeneous graph configuration by validated node kind.
import {
  type ApplicationDeploymentTargetKind,
  type ApplicationGraph,
  type ApplicationProviderGuarantee,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationProviderNode,
  type ApplicationScheduleNode,
  applicationCanonicalIdentity,
  applicationProviderIdentity,
  exactFiveFieldCronForInterval,
} from '@applik8s/core';

export interface ApplicationProviderGuaranteeRegistryRequest {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationDeploymentTargetKind;
  readonly profile?: string;
}

export interface ApplicationScheduleProviderCompatibilityFinding {
  readonly code:
    | 'SCHEDULE_CARDINALITY_UNSUPPORTED'
    | 'SCHEDULE_CADENCE_UNREPRESENTABLE'
    | 'SCHEDULE_LATENESS_UNSUPPORTED'
    | 'SCHEDULE_MISFIRE_UNSUPPORTED'
    | 'SCHEDULE_PRECISION_UNSUPPORTED'
    | 'SCHEDULE_PROVIDER_UNIMPLEMENTED'
    | 'SCHEDULE_PROVIDER_UNRESOLVED'
    | 'SCHEDULE_TIMEZONE_UNSUPPORTED';
  readonly scheduleId: string;
  readonly providerId: string;
  readonly implementation: string;
  readonly target: ApplicationDeploymentTargetKind;
  readonly message: string;
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
      const implementation = selectedImplementation(provider, request.profile, request.target, request.graph);
      const support = providerSupport(provider.interface, implementation, request.target);
			const scheduleFindings = provider.interface === 'Scheduler'
				? scheduleProviderFindings(request.graph, provider, implementation, request.target)
				: [];
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
        guarantees: baselineGuarantees(provider, request.target, implementation, support, request.graph),
        limitations: support
					? [...targetLimitations(request.target), ...scheduleFindings.map(({ message }) => message)]
					: [`${provider.interface}/${implementation} has no qualified ${request.target} lowering.`],
        evidenceLevel: request.target === 'local' && support ? 'static' : 'none',
      } satisfies ApplicationProviderGuaranteeManifest;
    });
}

/**
 * Returns exact schedule/provider semantic mismatches before a target plan can
 * accidentally inherit a provider default. The same function feeds plan
 * diagnostics and provider-guarantee records.
 */
export function applicationScheduleProviderCompatibilityFindings(
  request: ApplicationProviderGuaranteeRegistryRequest,
): readonly ApplicationScheduleProviderCompatibilityFinding[] {
  const providers = new Map(request.graph.nodes
    .filter((node): node is ApplicationProviderNode => node.kind === 'provider')
    .map((provider) => [provider.id, provider] as const));
  return request.graph.nodes
    .filter((node): node is ApplicationScheduleNode => node.kind === 'schedule')
    .flatMap((schedule) => {
      const provider = providers.get(schedule.scheduler.nodeId);
      if (!provider) {
        return [{
          code: 'SCHEDULE_PROVIDER_UNRESOLVED' as const,
          scheduleId: schedule.definition.id,
          providerId: schedule.scheduler.nodeId,
          implementation: 'unresolved',
          target: request.target,
          message: `Schedule ${schedule.definition.id} references missing Scheduler provider ${schedule.scheduler.nodeId}.`,
        }];
      }
      const implementation = selectedImplementation(provider, request.profile, request.target);
      return scheduleProviderFindings(schedule, provider, implementation, request.target);
    });
}

export function assertApplicationScheduleProviderCompatibility(
  request: ApplicationProviderGuaranteeRegistryRequest,
): void {
  const findings = applicationScheduleProviderCompatibilityFindings(request);
  if (findings.length === 0) return;
  throw new Error(`Application schedules are incompatible with the ${request.target} target:\n${findings
    .map(({ code, message }) => `- [${code}] ${message}`)
    .join('\n')}`);
}

function selectedImplementation(
  provider: ApplicationProviderNode,
  profile: string | undefined,
  target: ApplicationDeploymentTargetKind,
  graph?: ApplicationGraph,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (seen.has(provider.id)) throw new Error(`Application provider alias cycle includes ${provider.id}.`);
  const nextSeen = new Set(seen).add(provider.id);
  const aliasOf = objectValue(provider.config)?.aliasOf;
  if (typeof aliasOf === 'string' && graph) {
    const aliased = graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.id === aliasOf);
    if (!aliased) throw new Error(`Application provider ${provider.id} aliases missing provider ${aliasOf}.`);
    return selectedImplementation(aliased, profile, target, graph, nextSeen);
  }
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
  if (provider.implementation === 'application-target-provider-selection') {
    return selectedTargetImplementation(provider.config, target) ?? provider.implementation;
  }
  if (provider.implementation !== 'application-provider-selection' || !profile) return provider.implementation;
  const directSelection = objectValue(provider.config);
  if (directSelection?.kind === 'application-provider-selection') {
    const cases = objectValue(directSelection.cases);
    const selected = objectValue(cases?.[profile] ?? directSelection.default);
    if (selected?.kind === 'application-target-provider-selection') {
      return selectedTargetImplementation(selected, target) ?? provider.implementation;
    }
    if (typeof selected?.kind === 'string') return selected.kind;
  }
  const profileConfig = objectValue(provider.config?.profile);
  const branch = (Array.isArray(profileConfig?.branches) ? profileConfig.branches : [])
    .map(objectValue)
    .find((candidate) => candidate?.variant === profile);
  if (!branch || typeof branch.implementation !== 'string') return provider.implementation;
  const implementation = branch.implementation.split('/')[0] ?? branch.implementation;
  return implementation === 'application-target-provider-selection'
    ? selectedTargetImplementation(objectValue(branch.config), target) ?? implementation
    : implementation;
}

function selectedTargetImplementation(
  config: Readonly<Record<string, unknown>> | undefined,
  target: ApplicationDeploymentTargetKind,
): string | undefined {
  if (!config) return undefined;
  const selection = config.kind === 'application-target-provider-selection'
    ? config
    : Object.values(config)
        .map(objectValue)
        .find((candidate) => candidate?.kind === 'application-target-provider-selection');
  const targets = objectValue(selection?.targets);
  const selected = objectValue(targets?.[target] ?? (target === 'aws-local' ? targets?.aws : undefined));
  return typeof selected?.kind === 'string' ? selected.kind : undefined;
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
  AI: ['ai-deterministic', 'envoy-ai-gateway'],
  Authorization: ['application-authorization'],
  IdentityProvider: ['identity-provider'],
  NotificationDelivery: ['local-inspectable', 'smtp'],
  OAuthAuthorizationServer: ['oauth-authorization-server'],
  PaymentProvider: ['local-simulated', 'stripe'],
  Search: ['opensearch', 'postgres-search'],
  StructuredGeneration: ['structured-generation-deterministic', 'structured-generation-http'],
  WorkflowEngine: ['hatchet'],
  ApplicationHost: ['local-process'],
  Scheduler: ['local-scheduler', 'hatchet-scheduler'],
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
  implementation: string,
  supported: boolean,
  graph: ApplicationGraph,
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
		...(provider.interface === 'Scheduler'
			? scheduleGuarantees(graph, provider, implementation, target, supported)
			: []),
  ];
}

function scheduleGuarantees(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode,
  implementation: string,
  target: ApplicationDeploymentTargetKind,
  supported: boolean,
): readonly ApplicationProviderGuarantee[] {
  const schedules = graph.nodes.filter((node): node is ApplicationScheduleNode =>
    node.kind === 'schedule' && node.scheduler.nodeId === provider.id);
  if (schedules.length === 0) return [];
  const findings = schedules.flatMap((schedule) =>
    scheduleProviderFindings(schedule, provider, implementation, target));
  const findingCodes = new Set(findings.map(({ code }) => code));
  const bounded = (id: string, category: ApplicationProviderGuarantee['category'], statement: string, incompatible = false): ApplicationProviderGuarantee => ({
    id,
    category,
    statement,
    disposition: supported && !incompatible ? 'bounded' : 'unsupported',
    evidence: supported && !incompatible ? [`static:${target}:Scheduler:${implementation}:${id}`] : [],
  });
  return [
    bounded('schedule-occurrence-identity', 'consistency', 'Logical occurrence identity is independent of provider delivery identifiers.'),
    bounded('schedule-overlap', 'ordering-partitioning', 'Overlap is enforced by the framework occurrence authority.', findingCodes.has('SCHEDULE_PROVIDER_UNIMPLEMENTED')),
    bounded('schedule-misfire', 'replay-retention-acknowledgement-duplicates', 'Misfire and catch-up behavior matches the authored schedule policy.', findingCodes.has('SCHEDULE_MISFIRE_UNSUPPORTED')),
    bounded('schedule-lateness', 'limits', 'The provider preserves the authored maximum lateness window.', findingCodes.has('SCHEDULE_LATENESS_UNSUPPORTED')),
    bounded('schedule-precision', 'limits', 'Cadence precision and timezone semantics are preserved by the selected provider.', findingCodes.has('SCHEDULE_PRECISION_UNSUPPORTED') || findingCodes.has('SCHEDULE_CADENCE_UNREPRESENTABLE') || findingCodes.has('SCHEDULE_TIMEZONE_UNSUPPORTED')),
    bounded('schedule-cardinality', 'limits', 'Configured schedule cardinality fits the selected provider topology.', findingCodes.has('SCHEDULE_CARDINALITY_UNSUPPORTED')),
    bounded('schedule-retry-dead-letter', 'replay-retention-acknowledgement-duplicates', 'Retries retain occurrence identity and terminal failures reach a declared dead-letter authority.'),
    bounded('schedule-lifecycle', 'lifecycle', 'Schedule create, update, pause, removal, and drift use one lifecycle owner.', findingCodes.has('SCHEDULE_PROVIDER_UNIMPLEMENTED')),
  ];
}

function scheduleProviderFindings(
  graph: ApplicationGraph,
  provider: ApplicationProviderNode,
  implementation: string,
  target: ApplicationDeploymentTargetKind,
): readonly ApplicationScheduleProviderCompatibilityFinding[];
function scheduleProviderFindings(
  schedule: ApplicationScheduleNode,
  provider: ApplicationProviderNode,
  implementation: string,
  target: ApplicationDeploymentTargetKind,
): readonly ApplicationScheduleProviderCompatibilityFinding[];
function scheduleProviderFindings(
  source: ApplicationGraph | ApplicationScheduleNode,
  provider: ApplicationProviderNode,
  implementation: string,
  target: ApplicationDeploymentTargetKind,
): readonly ApplicationScheduleProviderCompatibilityFinding[] {
  const schedules = 'nodes' in source
    ? source.nodes.filter((node): node is ApplicationScheduleNode =>
      node.kind === 'schedule' && node.scheduler.nodeId === provider.id)
    : [source];
  return schedules.flatMap((schedule) => {
    const details = {
      scheduleId: schedule.definition.id,
      providerId: provider.id,
      implementation,
      target,
    } as const;
    if (implementation === 'hatchet-scheduler' && (target === 'aws' || target === 'aws-local')) {
      return [{
        ...details,
        code: 'SCHEDULE_PROVIDER_UNIMPLEMENTED' as const,
        message: `Schedule ${schedule.definition.id} selects hatchet-scheduler, whose maintained provider projection is qualified only for local and Kubernetes targets.`,
      }];
    }
    if (!['local-scheduler', 'eventbridge-scheduler', 'kubernetes-cronjob-scheduler', 'hatchet-scheduler'].includes(implementation)) {
      return [{
        ...details,
        code: 'SCHEDULE_PROVIDER_UNIMPLEMENTED' as const,
        message: `Schedule ${schedule.definition.id} selects unsupported Scheduler implementation ${implementation}.`,
      }];
    }
    const findings: ApplicationScheduleProviderCompatibilityFinding[] = [];
    if ((implementation === 'kubernetes-cronjob-scheduler' || implementation === 'hatchet-scheduler')
      && schedule.definition.every) {
      try {
        exactFiveFieldCronForInterval(schedule.definition.every);
      } catch {
        findings.push({
          ...details,
          code: 'SCHEDULE_CADENCE_UNREPRESENTABLE',
          message: `Schedule ${schedule.definition.id} uses fixed interval ${schedule.definition.every}, which ${implementation} cannot preserve with one five-field cron expression. Use an explicit calendar cron or select a fixed-interval provider.`,
        });
      }
    }
    if (implementation === 'hatchet-scheduler'
      && schedule.definition.cron
      && schedule.definition.timezone !== 'UTC') {
      findings.push({
        ...details,
        code: 'SCHEDULE_TIMEZONE_UNSUPPORTED',
        message: `Schedule ${schedule.definition.id} uses calendar timezone ${schedule.definition.timezone}, but the maintained Hatchet cron API accepts no timezone. Select UTC or a timezone-capable provider.`,
      });
    }
    if (implementation !== 'local-scheduler' && schedule.definition.requirements.precision === 'second') {
      findings.push({
        ...details,
        code: 'SCHEDULE_PRECISION_UNSUPPORTED',
        message: `Schedule ${schedule.definition.id} requires second precision, but ${implementation} preserves only minute-or-coarser cadence.`,
      });
    }
    if (implementation === 'kubernetes-cronjob-scheduler'
      && schedule.definition.requirements.cardinality === 'high') {
      findings.push({
        ...details,
        code: 'SCHEDULE_CARDINALITY_UNSUPPORTED',
        message: `Schedule ${schedule.definition.id} requires high-cardinality dynamic instances, but Kubernetes CronJobs are the bounded-topology provider.`,
      });
    }
    if (implementation === 'kubernetes-cronjob-scheduler'
      && schedule.definition.misfires === 'skip'
      && schedule.definition.maximumLatenessSeconds < 10) {
      findings.push({
        ...details,
        code: 'SCHEDULE_LATENESS_UNSUPPORTED',
        message: `Schedule ${schedule.definition.id} permits ${schedule.definition.maximumLatenessSeconds}s lateness, but Kubernetes CronJob reconciliation cannot reliably preserve a starting deadline below 10 seconds.`,
      });
    }
    if (implementation !== 'local-scheduler' && schedule.definition.misfires === 'all-bounded') {
      findings.push({
        ...details,
        code: 'SCHEDULE_MISFIRE_UNSUPPORTED',
        message: `Schedule ${schedule.definition.id} requires all-bounded catch-up, which ${implementation} cannot preserve without a shared catch-up planner.`,
      });
    }
    return findings;
  });
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
