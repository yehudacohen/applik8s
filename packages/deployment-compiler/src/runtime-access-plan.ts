// typecast-file-boundary: Runtime-access extraction narrows portable graph records after capability and node-kind checks.
import { sha256Hex } from '@applik8s/deployment-contract';
import {
  type ApplicationGraph,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationProviderNode,
  type ApplicationRuntimeAccessRequirement,
  applicationCanonicalIdentity,
  applicationProviderIdentity,
  canonicalJsonV1String,
  deriveApplicationGraphFoundation,
  serializeApplicationGraph,
} from '@applik8s/core';
import { applicationProviderGuaranteesForGraph } from './provider-guarantees.js';

export interface ApplicationRuntimeAccessPlan {
  readonly apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1';
  readonly application: string;
  readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
  readonly sourceGraphDigest: `sha256:${string}`;
  readonly digest: `sha256:${string}`;
  readonly executions: readonly ApplicationRuntimeAccessExecutionPlan[];
  readonly diagnostics: readonly ApplicationRuntimeAccessPlanDiagnostic[];
}

export interface ApplicationRuntimeAccessExecutionPlan {
  readonly executionIdentity: string;
  readonly nodeId: string;
  readonly requirementIds: readonly string[];
  readonly requirements: readonly ApplicationRuntimeAccessRequirement[];
  readonly policyDigest: `sha256:${string}`;
  readonly lowerings: readonly ApplicationRuntimeAccessRequirementLowering[];
  readonly local: { readonly grants: readonly ApplicationRuntimeAccessRequirement['target'][] };
  readonly kubernetes?: {
    readonly serviceAccountName: string;
    readonly bindings: readonly ApplicationRuntimeAccessKubernetesBinding[];
    readonly networkConnections: readonly string[];
    readonly credentialResources: readonly string[];
  };
  readonly aws?: { readonly roleName: string; readonly statements: readonly ApplicationRuntimeAccessAwsStatement[]; readonly networkConnections: readonly string[] };
}

export interface ApplicationRuntimeAccessRequirementLowering {
  readonly requirementId: string;
  readonly operation: ApplicationRuntimeAccessRequirement['target']['operation'];
  readonly capabilityId: string;
  readonly origin: ApplicationRuntimeAccessRequirement['origin'];
  readonly fidelity: 'exact' | 'capability' | 'application-only' | 'external' | 'unsupported';
  readonly mechanisms: readonly ('local-binding' | 'kubernetes-rbac' | 'kubernetes-network' | 'kubernetes-secret-projection' | 'aws-iam' | 'aws-network' | 'external-contract' | 'application-authorization')[];
  readonly provenanceIds: readonly string[];
  readonly providerGuarantee?: {
    readonly providerId: string;
    readonly disposition: 'guaranteed' | 'bounded' | 'unsupported' | 'external' | 'unresolved';
    readonly evidenceLevel: ApplicationProviderGuaranteeManifest['evidenceLevel'] | 'none';
  };
}

export interface ApplicationRuntimeAccessKubernetesBinding {
  readonly kind: 'Role' | 'ClusterRole';
  readonly namespace?: string;
  readonly rules: readonly ApplicationRuntimeAccessKubernetesRule[];
  readonly requirementIds: readonly string[];
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
  readonly code:
    | 'RUNTIME_ACCESS_EXPLICIT_REDUNDANT'
    | 'RUNTIME_ACCESS_EXPLICIT_UNUSED'
    | 'RUNTIME_ACCESS_EXPLICIT_WIDENING'
    | 'RUNTIME_ACCESS_PROVIDER_GUARANTEE_UNSUPPORTED'
    | 'RUNTIME_ACCESS_TARGET_UNRESOLVED'
    | 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN';
  readonly message: string;
  readonly requirementId: string;
}

/** Pure lowering from source-attributed semantic requirements to exact target grants. */
export function compileApplicationRuntimeAccessPlan(options: {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationRuntimeAccessPlan['target'];
  readonly namespace?: string;
  readonly profile?: string;
  readonly workspaceRoot?: string;
  /** Exact planned target identities keyed by semantic provider node id. */
  readonly targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Stronger target-live manifests may replace the compiler baseline. */
  readonly providerGuarantees?: readonly ApplicationProviderGuaranteeManifest[];
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
  diagnostics.push(...explicitAccessDiagnostics(foundation.runtimeAccess));
  const providerGuarantees = options.providerGuarantees ?? applicationProviderGuaranteesForGraph({
    graph: options.graph,
    target: options.target,
    ...(options.profile ? { profile: options.profile } : {}),
  });
  const namespace = options.namespace ?? stringValue(options.graph.metadata.namespace) ?? 'default';
  const executions = [...byExecution.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([executionIdentity, requirements]) => {
    const nodeId = requirements[0]?.consumer.nodeId ?? 'unknown';
    const kubernetesEntries = options.target === 'kubernetes' ? requirements.flatMap((requirement) => {
      const entries = kubernetesBindings(requirement, options.graph, namespace);
      if (entries.length === 0 && requiresKubernetesRule(requirement)) diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED', message: `Runtime-access requirement ${requirement.id} cannot be lowered to an exact Kubernetes rule.`, requirementId: requirement.id });
      return entries;
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
    const credentialResources = requirements
      .filter(({ target }) => target.operation === 'secret.read')
      .map(({ target }) => target.scope.kind === 'resource' ? target.scope.resourceId : target.capabilityId)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    const kubernetes = options.target === 'kubernetes'
      ? {
          serviceAccountName: collisionResistantKubernetesName(`${options.graph.metadata.name}-${nodeId}`, executionIdentity),
          bindings: mergeKubernetesBindings(kubernetesEntries),
          networkConnections,
          credentialResources,
        }
      : undefined;
    const aws = options.target === 'aws' || options.target === 'aws-local'
      ? {
          roleName: collisionResistantAwsRoleName(`${options.graph.metadata.name}-${nodeId}`, executionIdentity),
          statements: mergeAwsStatements(awsStatements),
          networkConnections,
        }
      : undefined;
    const lowerings = requirements.map((requirement) => requirementLowering(
      requirement,
      options.target,
      Boolean(kubernetesEntries.some(({ requirementId }) => requirementId === requirement.id)),
      Boolean(awsStatement(requirement, options.graph, options.targetResources)),
      requiresKubernetesRule(requirement),
      requiresAwsStatement(requirement, options.graph),
      providerAccessGuarantee(requirement, options.graph, providerGuarantees),
    ));
    for (const lowering of lowerings) {
      if (lowering.providerGuarantee?.disposition === 'unsupported' || lowering.providerGuarantee?.disposition === 'unresolved') {
        diagnostics.push({
          severity: 'error',
          code: 'RUNTIME_ACCESS_PROVIDER_GUARANTEE_UNSUPPORTED',
          message: `Runtime-access requirement ${lowering.requirementId} is not backed by a ${options.target} runtime-access guarantee for provider ${lowering.providerGuarantee.providerId}.`,
          requirementId: lowering.requirementId,
        });
      }
    }
    const policy = {
      local: { grants: requirements.map(({ target }) => target).sort(compareCanonical) },
      ...(kubernetes ? { kubernetes } : {}),
      ...(aws ? { aws } : {}),
    };
    return {
      executionIdentity,
      nodeId,
      requirementIds: requirements.map(({ id }) => id).sort(),
      requirements: [...requirements].sort((left, right) => left.id.localeCompare(right.id)),
      policyDigest: `sha256:${sha256Hex(canonicalJsonV1String(policy))}` as const,
      lowerings,
      ...policy,
    };
  });
  const sourceGraphDigest = `sha256:${sha256Hex(serializeApplicationGraph(options.graph))}` as const;
  const content = { application: options.graph.metadata.name, target: options.target, sourceGraphDigest, executions, diagnostics };
  return { apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1', ...content, digest: `sha256:${sha256Hex(canonicalJsonV1String(content))}` };
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
    const key = canonicalJsonV1String({
      resources: statement.resources,
      ...(statement.conditions ? { conditions: statement.conditions } : {}),
    });
    const actions = merged.get(key) ?? new Set<string>();
    for (const action of statement.actions) actions.add(action);
    merged.set(key, actions);
  }
  return [...merged].map(([key, actions]) => {
    const parsed = JSON.parse(key) as { resources: string[]; conditions?: ApplicationRuntimeAccessAwsStatement['conditions'] };
    return { effect: 'Allow' as const, actions: [...actions].sort(), resources: parsed.resources, ...(parsed.conditions ? { conditions: parsed.conditions } : {}) };
  }).sort(compareCanonical);
}

interface KubernetesBindingEntry {
  readonly kind: ApplicationRuntimeAccessKubernetesBinding['kind'];
  readonly namespace?: string;
  readonly rule: ApplicationRuntimeAccessKubernetesRule;
  readonly requirementId: string;
}

function kubernetesBindings(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  defaultNamespace: string,
): readonly KubernetesBindingEntry[] {
  const target = graph.nodes.find(({ id }) => id === requirement.target.capabilityId || id === resourceId(requirement));
  if (requirement.target.scope.kind === 'kubernetes') {
    const scope = requirement.target.scope;
    const rule = {
      apiGroups: [scope.apiGroup],
      resources: [scope.resource],
      verbs: verbs(requirement.target.operation),
      ...(scope.resourceNames ? { resourceNames: [...scope.resourceNames].sort() } : {}),
    };
    if (scope.scope === 'Cluster') return [{ kind: 'ClusterRole', rule, requirementId: requirement.id }];
    const namespaces = scope.namespaces && scope.namespaces.length > 0 ? scope.namespaces : [defaultNamespace];
    return [...new Set(namespaces)].sort().map((namespace) => ({ kind: 'Role', namespace, rule, requirementId: requirement.id }));
  }
  if (target?.kind === 'crd') {
    const rule = { apiGroups: [apiGroup(target.resource.apiVersion)], resources: [target.resource.plural], verbs: verbs(requirement.target.operation) };
    return target.resource.scope === 'Cluster'
      ? [{ kind: 'ClusterRole', rule, requirementId: requirement.id }]
      : [{ kind: 'Role', namespace: defaultNamespace, rule, requirementId: requirement.id }];
  }
  if (target?.kind === 'secret' && requirement.target.operation === 'secret.read') {
    const resource = target.generatedResources.find(({ role }) => role === 'secret')?.resource;
    const name = resource?.name ?? target.name;
    const namespace = resource?.namespace ?? defaultNamespace;
    return [{
      kind: 'Role',
      namespace,
      requirementId: requirement.id,
      rule: { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [name] },
    }];
  }
  const secret = secretIdentity(requirement);
  if (secret && requirement.target.operation === 'secret.read') {
    return [{
      kind: 'Role',
      namespace: secret.namespace ?? defaultNamespace,
      requirementId: requirement.id,
      rule: { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [secret.name] },
    }];
  }
  return [];
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

function mergeKubernetesBindings(entries: readonly KubernetesBindingEntry[]): readonly ApplicationRuntimeAccessKubernetesBinding[] {
  const bindings = new Map<string, { rules: Map<string, ApplicationRuntimeAccessKubernetesRule>; requirementIds: Set<string> }>();
  for (const entry of entries) {
    const bindingKey = canonicalJsonV1String({ kind: entry.kind, ...(entry.namespace ? { namespace: entry.namespace } : {}) });
    const binding = bindings.get(bindingKey) ?? { rules: new Map(), requirementIds: new Set<string>() };
    const ruleKey = canonicalJsonV1String({ apiGroups: entry.rule.apiGroups, resources: entry.rule.resources, resourceNames: entry.rule.resourceNames ?? [] });
    const previous = binding.rules.get(ruleKey);
    binding.rules.set(ruleKey, { ...entry.rule, verbs: [...new Set([...(previous?.verbs ?? []), ...entry.rule.verbs])].sort() });
    binding.requirementIds.add(entry.requirementId);
    bindings.set(bindingKey, binding);
  }
  return [...bindings.entries()].map(([key, binding]) => {
    const identity = JSON.parse(key) as { kind: ApplicationRuntimeAccessKubernetesBinding['kind']; namespace?: string };
    return {
      ...identity,
      rules: [...binding.rules.values()].sort(compareCanonical),
      requirementIds: [...binding.requirementIds].sort(),
    };
  }).sort(compareCanonical);
}

function explicitAccessDiagnostics(
  requirements: readonly ApplicationRuntimeAccessRequirement[],
): readonly ApplicationRuntimeAccessPlanDiagnostic[] {
  const inferred = requirements.filter(({ origin }) => origin !== 'explicit');
  return requirements
    .filter(({ origin }) => origin === 'explicit')
    .map((requirement): ApplicationRuntimeAccessPlanDiagnostic => {
      const sameOperation = inferred.filter((candidate) =>
        candidate.consumer.executionIdentity === requirement.consumer.executionIdentity
        && candidate.target.operation === requirement.target.operation
        && candidate.target.capabilityId === requirement.target.capabilityId);
      const exact = sameOperation.some((candidate) => canonicalJsonV1String(candidate.target.scope) === canonicalJsonV1String(requirement.target.scope));
      if (exact) {
        return {
          severity: 'warning',
          code: 'RUNTIME_ACCESS_EXPLICIT_REDUNDANT',
          message: `Explicit runtime-access requirement ${requirement.id} duplicates inferred access.`,
          requirementId: requirement.id,
        };
      }
      if (sameOperation.length > 0) {
        return {
          severity: 'warning',
          code: 'RUNTIME_ACCESS_EXPLICIT_WIDENING',
          message: `Explicit runtime-access requirement ${requirement.id} changes the inferred scope and requires review.`,
          requirementId: requirement.id,
        };
      }
      return {
        severity: 'warning',
        code: 'RUNTIME_ACCESS_EXPLICIT_UNUSED',
        message: `Explicit runtime-access requirement ${requirement.id} has no matching inferred consumer operation.`,
        requirementId: requirement.id,
      };
    })
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
}

function requirementLowering(
  requirement: ApplicationRuntimeAccessRequirement,
  target: ApplicationRuntimeAccessPlan['target'],
  hasKubernetesRule: boolean,
  hasAwsStatement: boolean,
  requiresKubernetesEnforcement: boolean,
  requiresAwsEnforcement: boolean,
  providerGuarantee: ApplicationRuntimeAccessRequirementLowering['providerGuarantee'],
): ApplicationRuntimeAccessRequirementLowering {
  if (providerGuarantee?.disposition === 'unsupported' || providerGuarantee?.disposition === 'unresolved') {
    return lowering(requirement, 'unsupported', [], providerGuarantee);
  }
  if (requirement.enforcement === 'application-only') {
    return lowering(requirement, 'application-only', ['application-authorization'], providerGuarantee);
  }
  if (requirement.target.scope.kind === 'external') {
    return lowering(requirement, 'external', ['external-contract'], providerGuarantee);
  }
  if (target === 'local') return lowering(requirement, 'capability', ['local-binding'], providerGuarantee);
  if (target === 'kubernetes') {
    if (hasKubernetesRule) {
      return lowering(requirement, 'exact', requirement.target.operation === 'secret.read'
        ? ['kubernetes-rbac', 'kubernetes-secret-projection']
        : ['kubernetes-rbac'], providerGuarantee);
    }
    if (requirement.target.operation === 'network.connect' || requirement.target.operation === 'connection.use') {
      return lowering(requirement, 'capability', ['kubernetes-network'], providerGuarantee);
    }
    return lowering(requirement, requiresKubernetesEnforcement ? 'unsupported' : 'capability', [], providerGuarantee);
  }
  if (hasAwsStatement) return lowering(requirement, 'exact', ['aws-iam'], providerGuarantee);
  if (requirement.target.operation === 'network.connect' || requirement.target.operation === 'connection.use') {
    return lowering(requirement, 'capability', ['aws-network'], providerGuarantee);
  }
  return lowering(requirement, requiresAwsEnforcement ? 'unsupported' : 'capability', [], providerGuarantee);
}

function lowering(
  requirement: ApplicationRuntimeAccessRequirement,
  fidelity: ApplicationRuntimeAccessRequirementLowering['fidelity'],
  mechanisms: ApplicationRuntimeAccessRequirementLowering['mechanisms'],
  providerGuarantee?: ApplicationRuntimeAccessRequirementLowering['providerGuarantee'],
): ApplicationRuntimeAccessRequirementLowering {
  return {
    requirementId: requirement.id,
    operation: requirement.target.operation,
    capabilityId: requirement.target.capabilityId,
    origin: requirement.origin,
    fidelity,
    mechanisms,
    provenanceIds: requirement.provenance.map(({ id }) => id).sort(),
    ...(providerGuarantee ? { providerGuarantee } : {}),
  };
}

function providerAccessGuarantee(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  manifests: readonly ApplicationProviderGuaranteeManifest[],
): ApplicationRuntimeAccessRequirementLowering['providerGuarantee'] {
  const provider = providerForRequirement(requirement, graph);
  if (!provider) return undefined;
  const application = applicationCanonicalIdentity({
    application: graph.metadata.name,
    kind: 'application',
    semanticKey: graph.metadata.name,
  });
  const identity = applicationProviderIdentity({
    application: graph.metadata.name,
    capabilityInterface: provider.interface,
    nodeId: provider.id,
    parentId: application.id,
  });
  const manifest = manifests.find(({ provider: candidate }) => candidate.id === identity.id);
  const guarantee = manifest?.guarantees.find(({ id }) => id === 'runtime-access');
  return {
    providerId: provider.id,
    disposition: guarantee?.disposition ?? 'unresolved',
    evidenceLevel: manifest?.evidenceLevel ?? 'none',
  };
}

function secretIdentity(requirement: ApplicationRuntimeAccessRequirement): { readonly namespace?: string; readonly name: string } | undefined {
  const identity = resourceId(requirement);
  if (!identity) return undefined;
  const parts = identity.split('/');
  const secretIndex = parts.lastIndexOf('Secret');
  if (secretIndex < 0) return undefined;
  const name = parts[parts.length - 1];
  if (!name || secretIndex === parts.length - 1) return undefined;
  const namespace = parts.length - secretIndex >= 3 ? parts[parts.length - 2] : undefined;
  return { name, ...(namespace ? { namespace } : {}) };
}

function containsWildcard(requirement: ApplicationRuntimeAccessRequirement): boolean {
  const scope = requirement.target.scope;
  return scope.kind === 'prefix' && scope.prefix.includes('*')
    || scope.kind === 'namespace' && (scope.namespace.includes('*') || scope.resourceKinds?.some((kind) => kind.includes('*')) === true)
    || scope.kind === 'selector' && Object.entries(scope.labels).some(([key, value]) => key.includes('*') || value.includes('*'))
    || scope.kind === 'kubernetes' && (
      scope.apiGroup.includes('*')
      || scope.resource.includes('*')
      || scope.namespaces?.some((namespace) => namespace.includes('*')) === true
      || scope.resourceNames?.some((name) => name.includes('*')) === true
    );
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
function collisionResistantKubernetesName(value: string, identity: string): string {
  const suffix = sha256Hex(identity).slice(0, 10);
  return boundedKubernetesName(`${value}-${suffix}`);
}
function collisionResistantAwsRoleName(value: string, identity: string): string {
  const suffix = sha256Hex(identity).slice(0, 10);
  return boundedAwsRoleName(`${value}-${suffix}`);
}
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}
function compareCanonical(left: unknown, right: unknown): number {
  return canonicalJsonV1String(left).localeCompare(canonicalJsonV1String(right));
}
