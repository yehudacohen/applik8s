// typecast-file-boundary: Runtime-access extraction narrows portable graph records after capability and node-kind checks.
import { sha256Hex } from '@applik8s/deployment-contract';
import { type ApplicationGraph, type ApplicationProviderNode, type ApplicationRuntimeAccessRequirement, deriveApplicationGraphFoundation } from '@applik8s/core';

export interface ApplicationRuntimeAccessPlan {
  readonly apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1';
  readonly application: string;
  readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
  readonly digest: `sha256:${string}`;
  readonly executions: readonly ApplicationRuntimeAccessExecutionPlan[];
  readonly diagnostics: readonly ApplicationRuntimeAccessPlanDiagnostic[];
}

export interface ApplicationRuntimeAccessExecutionPlan {
  readonly executionIdentity: string;
  readonly nodeId: string;
  readonly requirementIds: readonly string[];
  readonly local: { readonly grants: readonly ApplicationRuntimeAccessRequirement['target'][] };
  readonly kubernetes?: { readonly serviceAccountName: string; readonly namespace: string; readonly rules: readonly ApplicationRuntimeAccessKubernetesRule[] };
  readonly aws?: { readonly roleName: string; readonly statements: readonly ApplicationRuntimeAccessAwsStatement[]; readonly networkConnections: readonly string[] };
}

export interface ApplicationRuntimeAccessAwsStatement {
  readonly effect: 'Allow';
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly conditions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

export interface ApplicationRuntimeAccessKubernetesRule {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
  readonly resourceNames?: readonly string[];
}

export interface ApplicationRuntimeAccessPlanDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED' | 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN';
  readonly message: string;
  readonly requirementId: string;
}

/** Pure lowering from source-attributed semantic requirements to exact target grants. */
export function compileApplicationRuntimeAccessPlan(options: {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationRuntimeAccessPlan['target'];
  readonly namespace?: string;
  readonly workspaceRoot?: string;
  /** Exact planned target identities keyed by semantic provider node id. */
  readonly targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}): ApplicationRuntimeAccessPlan {
  const foundation = deriveApplicationGraphFoundation(options.graph, options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {});
  const diagnostics: ApplicationRuntimeAccessPlanDiagnostic[] = [];
  const byExecution = new Map<string, ApplicationRuntimeAccessRequirement[]>();
  for (const requirement of foundation.runtimeAccess) {
    if (containsWildcard(requirement)) {
      diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN', message: `Runtime-access requirement ${requirement.id} contains a wildcard scope.`, requirementId: requirement.id });
      continue;
    }
    const values = byExecution.get(requirement.consumer.executionIdentity) ?? [];
    values.push(requirement);
    byExecution.set(requirement.consumer.executionIdentity, values);
  }
  const namespace = options.namespace ?? stringValue(options.graph.metadata.namespace) ?? 'default';
  const executions = [...byExecution.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([executionIdentity, requirements]) => {
    const nodeId = requirements[0]?.consumer.nodeId ?? 'unknown';
    const rules = options.target === 'kubernetes' ? requirements.flatMap((requirement) => {
      const rule = kubernetesRule(requirement, options.graph);
      if (!rule && requiresKubernetesRule(requirement)) diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED', message: `Runtime-access requirement ${requirement.id} cannot be lowered to an exact Kubernetes rule.`, requirementId: requirement.id });
      return rule ? [rule] : [];
    }) : [];
    const awsStatements = options.target === 'aws' || options.target === 'aws-local' ? requirements.flatMap((requirement) => {
      const statement = awsStatement(requirement, options.graph, options.targetResources);
      if (!statement && requiresAwsStatement(requirement, options.graph)) diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED', message: `Runtime-access requirement ${requirement.id} cannot be lowered to an exact AWS policy resource.`, requirementId: requirement.id });
      return statement ? [statement] : [];
    }) : [];
    const networkConnections = requirements
      .filter(({ target }) => target.operation === 'network.connect' || target.operation === 'connection.use')
      .map(({ target }) => target.capabilityId)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    return {
      executionIdentity,
      nodeId,
      requirementIds: requirements.map(({ id }) => id).sort(),
      local: { grants: requirements.map(({ target }) => target).sort((left, right) => stableJson(left).localeCompare(stableJson(right))) },
      ...(options.target === 'kubernetes' ? { kubernetes: { serviceAccountName: boundedKubernetesName(`${options.graph.metadata.name}-${nodeId}`), namespace, rules: mergeKubernetesRules(rules) } } : {}),
      ...(options.target === 'aws' || options.target === 'aws-local' ? { aws: { roleName: boundedAwsRoleName(`${options.graph.metadata.name}-${nodeId}`), statements: mergeAwsStatements(awsStatements), networkConnections } } : {}),
    };
  });
  const content = { application: options.graph.metadata.name, target: options.target, executions, diagnostics };
  return { apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1', ...content, digest: `sha256:${sha256Hex(stableJson(content))}` };
}

function awsStatement(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): ApplicationRuntimeAccessAwsStatement | undefined {
  const provider = providerForRequirement(requirement, graph);
  const scopedTarget = targetResources?.[requirement.target.capabilityId]
    ?? (requirement.target.scope.kind === 'resource' ? targetResources?.[requirement.target.scope.resourceId] : undefined);
  const config = provider
    ? { ...(provider.config ?? {}), ...(targetResources?.[provider.id] ?? {}), ...(scopedTarget ?? {}) }
    : scopedTarget;
  const operation = requirement.target.operation;
  if ((operation === 'object.list' || operation === 'object.read' || operation === 'object.write' || operation === 'object.delete') && provider?.interface === 'ObjectStorage') {
    // Physical target bindings must win over semantic nested configuration.
    // This lets a target planner allocate the bucket while preserving an
    // authored prefix without teaching the application about AWS identity.
    const storage = { ...(objectValue(config?.objectStorage) ?? {}), ...(config ?? {}) };
    const bucket = stringValue(storage?.bucket);
    if (!bucket) return undefined;
    const prefix = requirement.target.scope.kind === 'prefix' ? requirement.target.scope.prefix.replace(/^\/+|\/+$/gu, '') : stringValue(storage?.prefix)?.replace(/^\/+|\/+$/gu, '');
    const bucketArn = `arn:aws:s3:::${bucket}`;
    const objectArn = `${bucketArn}/${prefix ? `${prefix}/` : ''}*`;
    const actions = operation === 'object.list'
      ? ['s3:ListBucket']
      : operation === 'object.read'
        ? ['s3:GetObject']
        : operation === 'object.delete'
          ? ['s3:DeleteObject']
          : ['s3:AbortMultipartUpload', 's3:PutObject'];
    return {
      effect: 'Allow',
      actions,
      resources: operation === 'object.list' ? [bucketArn] : [objectArn],
      ...(operation === 'object.list' && prefix ? {
        conditions: { StringLike: { 's3:prefix': [`${prefix}/*`, prefix] } },
      } : {}),
    };
  }
  if ((operation === 'queue.consume' || operation === 'queue.publish') && provider?.interface === 'Queue') {
    const arn = exactArn(config, ['queueArn', 'arn']);
    if (!arn) return undefined;
    return { effect: 'Allow', actions: operation === 'queue.consume' ? ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'] : ['sqs:SendMessage'], resources: [arn] };
  }
  if ((operation === 'event.publish' || operation === 'event.subscribe') && (provider?.interface === 'EventSource' || provider?.interface === 'EventLog')) {
    const arn = exactArn(config, ['streamArn', 'arn']);
    if (!arn) return undefined;
    return { effect: 'Allow', actions: operation === 'event.publish' ? ['kinesis:PutRecord', 'kinesis:PutRecords'] : ['kinesis:DescribeStreamSummary', 'kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:ListShards'], resources: [arn] };
  }
  if (operation === 'secret.read') {
    const arn = exactArn(config, ['secretArn', 'arn']) ?? exactArn(graphNodeConfig(requirement, graph), ['secretArn', 'arn']);
    return arn ? { effect: 'Allow', actions: ['secretsmanager:GetSecretValue'], resources: [arn] } : undefined;
  }
  const observability = operation === 'telemetry.write'
    ? graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'Observability')
    : provider;
  if (operation === 'telemetry.write' && observability?.interface === 'Observability' && observability.implementation === 'cloudwatch') {
    const observabilityConfig = { ...(observability.config ?? {}), ...(targetResources?.[observability.id] ?? {}) };
    const logGroupArn = exactArn(observabilityConfig, ['logGroupArn']);
    const traceDestinationArn = exactArn(observabilityConfig, ['traceDestinationArn']);
    if (!logGroupArn && !traceDestinationArn) return undefined;
    return { effect: 'Allow', actions: [...(logGroupArn ? ['logs:CreateLogStream', 'logs:PutLogEvents'] : []), ...(traceDestinationArn ? ['xray:PutTelemetryRecords', 'xray:PutTraceSegments'] : [])].sort(), resources: [logGroupArn, traceDestinationArn].filter((value): value is string => Boolean(value)).sort() };
  }
  return undefined;
}

function providerForRequirement(requirement: ApplicationRuntimeAccessRequirement, graph: ApplicationGraph): ApplicationProviderNode | undefined {
  const target = graph.nodes.find(({ id }) => id === requirement.target.capabilityId || id === resourceId(requirement));
  if (target?.kind === 'provider') return target;
  const targetProvider = target && 'provider' in target ? target.provider : undefined;
  if (targetProvider && typeof targetProvider === 'object' && 'nodeId' in targetProvider) {
    const provider = graph.nodes.find(({ id }) => id === targetProvider.nodeId);
    return provider?.kind === 'provider' ? provider : undefined;
  }
  const relatedConsumers = owningExecutionNodeIds(requirement.consumer.nodeId, graph);
  const providerIds = new Set(
    graph.providerRequirements
      .filter((candidate) => relatedConsumers.has(candidate.consumer.nodeId))
      .filter((candidate) => providerInterfaceForOperation(requirement.target.operation) === candidate.interface)
      .map((candidate) => graph.providerBindings.find(({ requirement: bindingRequirement }) => bindingRequirement === candidate.id)?.provider.nodeId ?? candidate.provider?.nodeId)
      .filter((providerId): providerId is string => Boolean(providerId)),
  );
  if (providerIds.size === 1) {
    const provider = graph.nodes.find(({ id }) => id === [...providerIds][0]);
    return provider?.kind === 'provider' ? provider : undefined;
  }
  if (providerIds.size > 1) return undefined;
  return graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === requirement.target.capabilityId);
}

function owningExecutionNodeIds(nodeId: string, graph: ApplicationGraph): ReadonlySet<string> {
  const related = new Set([nodeId]);
  const pending = [nodeId];
  while (pending.length > 0) {
    const child = pending.pop()!;
    for (const edge of graph.edges) {
      if (edge.relationship !== 'owns' || edge.to.nodeId !== child || related.has(edge.from.nodeId)) continue;
      related.add(edge.from.nodeId);
      pending.push(edge.from.nodeId);
    }
  }
  return related;
}

function providerInterfaceForOperation(operation: ApplicationRuntimeAccessRequirement['target']['operation']): string | undefined {
  if (operation === 'event.publish' || operation === 'event.subscribe') return 'EventLog';
  if (operation === 'queue.publish' || operation === 'queue.consume') return 'Queue';
  if (operation.startsWith('object.')) return 'ObjectStorage';
  return undefined;
}

function graphNodeConfig(requirement: ApplicationRuntimeAccessRequirement, graph: ApplicationGraph): Readonly<Record<string, unknown>> | undefined {
  const node = graph.nodes.find(({ id }) => id === requirement.target.capabilityId || id === resourceId(requirement));
  return node && typeof node === 'object' ? node as unknown as Readonly<Record<string, unknown>> : undefined;
}

function exactArn(config: Readonly<Record<string, unknown>> | undefined, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = stringValue(config?.[field]);
    if (value?.startsWith('arn:') || value?.startsWith('output://')) return value;
    for (const nested of Object.values(config ?? {}).map(objectValue).filter((value): value is Readonly<Record<string, unknown>> => Boolean(value))) {
      const candidate = stringValue(nested[field]);
      if (candidate?.startsWith('arn:') || candidate?.startsWith('output://')) return candidate;
    }
  }
  return undefined;
}

function requiresAwsStatement(requirement: ApplicationRuntimeAccessRequirement, graph: ApplicationGraph): boolean {
  if (requirement.target.operation === 'event.subscribe' || requirement.target.operation === 'event.publish') {
    // An event capability may be a database/outbox-backed application stream.
    // Only an explicitly bound EventLog maps to a target IAM data plane. An
    // ambiguous explicit binding must still fail closed rather than looking
    // indistinguishable from a database/outbox stream.
    return providerForRequirement(requirement, graph)?.interface === 'EventLog'
      || owningProviderRequirements(requirement, graph).some(({ interface: providerInterface }) => providerInterface === 'EventLog');
  }
  return ['object.list', 'object.read', 'object.write', 'object.delete', 'queue.consume', 'queue.publish', 'secret.read'].includes(requirement.target.operation);
}

function owningProviderRequirements(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
): ApplicationGraph['providerRequirements'] {
  const consumers = owningExecutionNodeIds(requirement.consumer.nodeId, graph);
  return graph.providerRequirements.filter(({ consumer }) => consumers.has(consumer.nodeId));
}

function mergeAwsStatements(statements: readonly ApplicationRuntimeAccessAwsStatement[]): readonly ApplicationRuntimeAccessAwsStatement[] {
  const merged = new Map<string, Set<string>>();
  for (const statement of statements) {
    const key = stableJson({ resources: statement.resources, conditions: statement.conditions });
    const actions = merged.get(key) ?? new Set<string>();
    for (const action of statement.actions) actions.add(action);
    merged.set(key, actions);
  }
  return [...merged].map(([key, actions]) => {
    const parsed = JSON.parse(key) as { resources: string[]; conditions?: ApplicationRuntimeAccessAwsStatement['conditions'] };
    return { effect: 'Allow' as const, actions: [...actions].sort(), resources: parsed.resources, ...(parsed.conditions ? { conditions: parsed.conditions } : {}) };
  }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function kubernetesRule(requirement: ApplicationRuntimeAccessRequirement, graph: ApplicationGraph): ApplicationRuntimeAccessKubernetesRule | undefined {
  const target = graph.nodes.find(({ id }) => id === requirement.target.capabilityId || id === resourceId(requirement));
  if (target?.kind === 'crd') return { apiGroups: [apiGroup(target.resource.apiVersion)], resources: [target.resource.plural], verbs: verbs(requirement.target.operation) };
  if (target?.kind === 'secret' && requirement.target.operation === 'secret.read') return { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [target.name] };
  return undefined;
}

function requiresKubernetesRule(requirement: ApplicationRuntimeAccessRequirement): boolean {
  return requirement.target.operation.startsWith('kubernetes.') || requirement.target.operation === 'secret.read';
}

function verbs(operation: ApplicationRuntimeAccessRequirement['target']['operation']): readonly string[] {
  if (operation === 'model.read' || operation === 'kubernetes.get') return ['get'];
  if (operation === 'kubernetes.list') return ['get', 'list'];
  if (operation === 'kubernetes.watch') return ['get', 'list', 'watch'];
  if (operation === 'model.write') return ['create', 'get', 'patch', 'update'];
  if (operation === 'model.delete' || operation === 'kubernetes.delete') return ['delete', 'get'];
  if (operation === 'kubernetes.create') return ['create'];
  if (operation === 'kubernetes.patch' || operation === 'kubernetes.status' || operation === 'kubernetes.finalize') return ['get', 'patch', 'update'];
  return [];
}

function mergeKubernetesRules(rules: readonly ApplicationRuntimeAccessKubernetesRule[]): readonly ApplicationRuntimeAccessKubernetesRule[] {
  const merged = new Map<string, ApplicationRuntimeAccessKubernetesRule>();
  for (const rule of rules) {
    const key = stableJson({ apiGroups: rule.apiGroups, resources: rule.resources, resourceNames: rule.resourceNames ?? [] });
    const previous = merged.get(key);
    merged.set(key, { ...rule, verbs: [...new Set([...(previous?.verbs ?? []), ...rule.verbs])].sort() });
  }
  return [...merged.values()].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function containsWildcard(requirement: ApplicationRuntimeAccessRequirement): boolean {
  const scope = requirement.target.scope;
  return scope.kind === 'prefix' && scope.prefix.includes('*')
    || scope.kind === 'namespace' && (scope.namespace.includes('*') || scope.resourceKinds?.some((kind) => kind.includes('*')) === true)
    || scope.kind === 'selector' && Object.entries(scope.labels).some(([key, value]) => key.includes('*') || value.includes('*'));
}

function resourceId(requirement: ApplicationRuntimeAccessRequirement): string | undefined { const scope = requirement.target.scope; return 'resourceId' in scope ? scope.resourceId : undefined; }
function apiGroup(apiVersion: string): string { return apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : ''; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function boundedKubernetesName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'applik8s-runtime';
  if (normalized.length <= 63) return normalized;
  const digest = sha256Hex(normalized).slice(0, 10);
  return `${normalized.slice(0, 52).replace(/-+$/g, '')}-${digest}`;
}
function boundedAwsRoleName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9+=,.@_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'applik8s-runtime';
  if (normalized.length <= 64) return normalized;
  const digest = sha256Hex(normalized).slice(0, 10);
  return `${normalized.slice(0, 53).replace(/-+$/gu, '')}-${digest}`;
}
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}
function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
