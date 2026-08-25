// typecast-file-boundary: Runtime-access extraction narrows portable graph records after capability and node-kind checks.

import {
  type ApplicationGraph,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationProviderNode,
  type ApplicationRuntimeAccessRequirement,
  applicationCanonicalIdentity,
  applicationGraphNodeIdentity,
  applicationProviderIdentity,
  applicationRuntimeAccessRequirement,
  canonicalJsonV1String,
  deriveApplicationGraphFoundation,
  mergeApplicationRuntimeAccessRequirements,
  serializeApplicationGraph,
} from '@applik8s/core';
import {
  type ApplicationRuntimeAccessAwsStatement,
  type ApplicationRuntimeAccessBootstrapEgress,
  type ApplicationRuntimeAccessExecutionPlan,
  type ApplicationRuntimeAccessExternalEgress,
  type ApplicationRuntimeAccessKubernetesBinding,
  type ApplicationRuntimeAccessKubernetesRule,
  type ApplicationRuntimeAccessPlan,
  type ApplicationRuntimeAccessPlanDiagnostic,
  type ApplicationRuntimeAccessPrivatePeer,
  type ApplicationRuntimeAccessRequirementLowering,
  type ApplicationRuntimeAccessWorkloadPlan,
  applicationRuntimeAccessPlanDigest,
  sha256Hex,
} from '@applik8s/deployment-contract';
import { applicationProviderGuaranteesForGraph } from './provider-guarantees.js';

export type {
  ApplicationRuntimeAccessExecutionPlan,
  ApplicationRuntimeAccessKubernetesBinding,
  ApplicationRuntimeAccessKubernetesRule,
  ApplicationRuntimeAccessPlan,
  ApplicationRuntimeAccessPlanDiagnostic,
  ApplicationRuntimeAccessRequirementLowering,
  ApplicationRuntimeAccessWorkloadPlan,
} from '@applik8s/deployment-contract';

export interface ApplicationRuntimeAccessWorkloadPlacement {
  readonly workloadIdentity: string;
  readonly artifactIds: readonly string[];
  readonly executionNodeIds: readonly string[];
  readonly kubernetes?: {
    readonly resource: {
      readonly apiVersion: string;
      readonly kind: 'Deployment' | 'StatefulSet' | 'Job' | 'CronJob';
      readonly namespace: string;
      readonly name: string;
    };
    readonly materialization:
      | { readonly authority: 'application-root' }
      | { readonly authority: 'provider-direct'; readonly deploymentNodeId: string };
    readonly podSelector: Readonly<Record<string, string>>;
    readonly serviceAccountName: string;
  };
  readonly aws?: {
    readonly resourceId: string;
    readonly roleName: string;
    readonly executionRoleName?: string;
  };
}

/** Target-selected credential projection that becomes canonical semantic access before materialization. */
export interface ApplicationRuntimeAccessCredentialRequirement {
  readonly consumerNodeId: string;
  readonly resourceId: string;
  readonly keys: readonly string[];
}

/** Pure lowering from source-attributed semantic requirements to exact target grants. */
export function compileApplicationRuntimeAccessPlan(options: {
  readonly graph: ApplicationGraph;
  readonly target: ApplicationRuntimeAccessPlan['target'];
  /**
   * Digest of the compiler-owned source graph artifact when this plan is
   * embedded in another portable deployment artifact. Installation-value
   * resolution may produce a concrete graph whose bytes differ from that
   * source artifact, so callers at that boundary must preserve the source
   * artifact identity rather than silently inventing a second one.
   */
  readonly sourceGraphDigest?: `sha256:${string}`;
  readonly namespace?: string;
  readonly profile?: string;
  readonly workspaceRoot?: string;
  /** Exact planned target identities keyed by semantic provider node id. */
  readonly targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Target-owned bootstrap transports, such as the selected environment's DNS resolver. */
  readonly bootstrapEgress?: readonly ApplicationRuntimeAccessBootstrapEgress[];
  /** Stronger target-live manifests may replace the compiler baseline. */
  readonly providerGuarantees?: readonly ApplicationProviderGuaranteeManifest[];
  /** Compiler-proven placement of executable semantic nodes into target workloads. */
  readonly workloadPlacements?: readonly ApplicationRuntimeAccessWorkloadPlacement[];
  /**
   * Exact execution-node subset owned by a composed physical subplan. This is
   * intentionally narrower than a target compatibility filter: callers may use
   * it only when another plan (for example the local supervisor around an
   * AWS-local provider plane) owns the omitted execution boundaries.
   */
  readonly includedExecutionNodeIds?: readonly string[];
  /** Provider/profile-selected credentials required by exact semantic consumers. */
  readonly credentialRequirements?: readonly ApplicationRuntimeAccessCredentialRequirement[];
  /** Provider-authored execution requirements with canonical identities and provenance. */
  readonly additionalRequirements?: readonly ApplicationRuntimeAccessRequirement[];
}): ApplicationRuntimeAccessPlan {
  const foundation = deriveApplicationGraphFoundation(options.graph, options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {});
  const includedExecutionNodeIds = options.includedExecutionNodeIds
    ? new Set(options.includedExecutionNodeIds)
    : undefined;
  const runtimeRequirements = mergeApplicationRuntimeAccessRequirements([
    ...foundation.runtimeAccess.filter(({ consumer }) =>
      !includedExecutionNodeIds || includedExecutionNodeIds.has(consumer.nodeId)),
    ...(options.additionalRequirements ?? []).filter(({ consumer }) =>
      !includedExecutionNodeIds || includedExecutionNodeIds.has(consumer.nodeId)),
    ...(options.credentialRequirements ?? [])
      .filter(({ consumerNodeId }) =>
        !includedExecutionNodeIds || includedExecutionNodeIds.has(consumerNodeId))
      .map((credential) => {
        const consumerNode = options.graph.nodes.find(({ id }) => id === credential.consumerNodeId);
        const nodeIdentity = consumerNode
          ? applicationGraphNodeIdentity({
              application: options.graph.metadata.name,
              nodeKind: consumerNode.kind,
              nodeId: consumerNode.id,
            })
          : undefined;
        const executionIdentity = nodeIdentity
          ? foundation.identities.find((identity) => identity.kind === 'execution-boundary' && identity.parentId === nodeIdentity.id)
          : undefined;
        const sourceRequirement = foundation.runtimeAccess.find(({ consumer }) => consumer.nodeId === credential.consumerNodeId);
        if (!executionIdentity || !sourceRequirement) {
          throw new Error(`Credential ${credential.resourceId} names non-executable consumer ${credential.consumerNodeId}.`);
        }
        return applicationRuntimeAccessRequirement({
          consumer: { nodeId: credential.consumerNodeId, executionIdentity: executionIdentity.id },
          target: {
            capabilityId: 'Secret',
            operation: 'secret.read',
            scope: { kind: 'resource', resourceId: credential.resourceId, keys: [...credential.keys].sort() },
          },
          origin: 'provider-required',
          provenance: sourceRequirement.provenance,
          sensitivity: 'credential',
          enforcement: 'required',
        });
      }),
  ]);
  const diagnostics: ApplicationRuntimeAccessPlanDiagnostic[] = [];
  const byExecution = new Map<string, ApplicationRuntimeAccessRequirement[]>();
  for (const requirement of runtimeRequirements) {
    if (containsWildcard(requirement)) {
      diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_WILDCARD_FORBIDDEN', message: `Runtime-access requirement ${requirement.id} contains a wildcard scope.`, requirementId: requirement.id });
      continue;
    }
    const values = byExecution.get(requirement.consumer.executionIdentity) ?? [];
    values.push(requirement);
    byExecution.set(requirement.consumer.executionIdentity, values);
  }
  diagnostics.push(...explicitAccessDiagnostics(runtimeRequirements));
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
    const allAwsStatements = options.target === 'aws' || options.target === 'aws-local' ? requirements.flatMap((requirement) => {
      const statements = awsStatementsForRequirement(requirement, options.graph, options.targetResources);
      if (statements.length === 0 && requiresAwsStatement(requirement, options.graph, options.targetResources)) diagnostics.push({ severity: 'error', code: 'RUNTIME_ACCESS_TARGET_UNRESOLVED', message: `Runtime-access requirement ${requirement.id} cannot be lowered to an exact AWS policy resource.`, requirementId: requirement.id });
      return statements;
    }) : [];
    const awsStatements = allAwsStatements.flatMap((statement) => runtimeRoleStatement(statement));
    const awsExecutionRoleStatements = allAwsStatements.flatMap((statement) => executionRoleStatement(statement));
    const privatePeers = mergePrivatePeers(requirements.flatMap((requirement) =>
      runtimePrivatePeer(requirement, options.target, options.graph, options.targetResources)));
    // Non-private egress is consumed only from explicit provider-adapter
    // records. Arbitrary provider config is intentionally not inspected here.
    const externalEgress = mergeExternalEgress(requirements.flatMap((requirement) =>
      runtimeExternalEgress(requirement, options.graph, options.targetResources)));
    const bootstrapEgress = privatePeers.length > 0 || externalEgress.length > 0
      ? mergeBootstrapEgress(options.bootstrapEgress ?? [])
      : [];
    const networkConnections = privatePeerConnections(privatePeers);
    const credentialProjections = mergeCredentialProjections(requirements
      .filter(({ target }) => target.operation === 'secret.read')
      .map(({ target }) => target.scope.kind === 'resource'
        ? { resourceId: target.scope.resourceId, keys: target.scope.keys ?? [] }
        : { resourceId: target.capabilityId, keys: [] }));
    const kubernetes = options.target === 'kubernetes'
      ? {
          serviceAccountName: collisionResistantKubernetesName(`${options.graph.metadata.name}-${nodeId}`, executionIdentity),
          bindings: mergeKubernetesBindings(kubernetesEntries),
          privatePeers,
          bootstrapEgress,
          externalEgress,
          networkConnections,
          credentialProjections,
        }
      : undefined;
    const aws = options.target === 'aws' || options.target === 'aws-local'
      ? {
          roleName: collisionResistantAwsRoleName(`${options.graph.metadata.name}-${nodeId}`, executionIdentity),
          executionRoleName: collisionResistantAwsRoleName(`${options.graph.metadata.name}-${nodeId}-bootstrap`, executionIdentity),
          statements: mergeAwsStatements(awsStatements),
          executionRoleStatements: mergeAwsStatements(awsExecutionRoleStatements),
          privatePeers,
          bootstrapEgress,
          externalEgress,
          networkConnections,
        }
      : undefined;
    const lowerings = requirements.map((requirement) => requirementLowering(
      requirement,
      options.target,
      Boolean(kubernetesEntries.some(({ requirementId }) => requirementId === requirement.id)),
      awsStatementsForRequirement(requirement, options.graph, options.targetResources).length > 0,
      privatePeers.some((peer) => peer.requirementIds.includes(requirement.id)),
      externalEgress.some((egress) => egress.requirementIds.includes(requirement.id)),
      requiresKubernetesRule(requirement),
      requiresAwsStatement(requirement, options.graph, options.targetResources),
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
  const workloads = compileWorkloadPlans(options.workloadPlacements ?? [], executions, options.target);
  const sourceGraphDigest = options.sourceGraphDigest
    ?? (`sha256:${sha256Hex(serializeApplicationGraph(options.graph))}` as const);
  const content = { application: options.graph.metadata.name, target: options.target, sourceGraphDigest, executions, workloads, diagnostics };
  return { apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1', ...content, digest: applicationRuntimeAccessPlanDigest({ apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1', ...content }) };
}

function compileWorkloadPlans(
  placements: readonly ApplicationRuntimeAccessWorkloadPlacement[],
  executions: readonly ApplicationRuntimeAccessExecutionPlan[],
  target: ApplicationRuntimeAccessPlan['target'],
): readonly ApplicationRuntimeAccessWorkloadPlan[] {
  const executionsByNode = new Map<string, ApplicationRuntimeAccessExecutionPlan[]>();
  for (const execution of executions) {
    const values = executionsByNode.get(execution.nodeId) ?? [];
    values.push(execution);
    executionsByNode.set(execution.nodeId, values);
  }
  return placements.map((placement): ApplicationRuntimeAccessWorkloadPlan => {
    const members = placement.executionNodeIds
      .flatMap((nodeId) => executionsByNode.get(nodeId) ?? [])
      .sort((left, right) => left.executionIdentity.localeCompare(right.executionIdentity));
    const executionIdentities = [...new Set(members.map(({ executionIdentity }) => executionIdentity))].sort();
    const requirementIds = [...new Set(members.flatMap(({ requirementIds }) => requirementIds))].sort();
    const kubernetes = target === 'kubernetes' && placement.kubernetes
      ? (() => {
          const privatePeers = mergePrivatePeers(members.flatMap((member) => member.kubernetes?.privatePeers ?? []));
          const externalEgress = mergeExternalEgress(members.flatMap((member) => member.kubernetes?.externalEgress ?? []));
          return {
          resource: placement.kubernetes.resource,
          materialization: placement.kubernetes.materialization,
          podSelector: placement.kubernetes.podSelector,
          serviceAccountName: placement.kubernetes.serviceAccountName,
          bindings: mergePlannedKubernetesBindings(members.flatMap((member) => member.kubernetes?.bindings ?? [])),
          privatePeers,
          bootstrapEgress: mergeBootstrapEgress(members.flatMap((member) => member.kubernetes?.bootstrapEgress ?? [])),
          externalEgress,
          networkConnections: privatePeerConnections(privatePeers),
          credentialProjections: mergeCredentialProjections(members.flatMap((member) => member.kubernetes?.credentialProjections ?? [])),
          };
        })()
      : undefined;
    const aws = (target === 'aws' || target === 'aws-local') && placement.aws
      ? (() => {
          const privatePeers = mergePrivatePeers(members
            .flatMap((member) => member.aws?.privatePeers ?? [])
            .filter(({ endpoint }) => endpoint.target === 'kubernetes' || endpoint.resourceId !== placement.aws?.resourceId));
          return {
          resourceId: placement.aws.resourceId,
          roleName: placement.aws.roleName,
          ...(placement.aws.executionRoleName ? { executionRoleName: placement.aws.executionRoleName } : {}),
          statements: mergeAwsStatements(members.flatMap((member) => member.aws?.statements ?? [])),
          executionRoleStatements: mergeAwsStatements(members.flatMap((member) => member.aws?.executionRoleStatements ?? [])),
          privatePeers,
          bootstrapEgress: mergeBootstrapEgress(members.flatMap((member) => member.aws?.bootstrapEgress ?? [])),
          externalEgress: mergeExternalEgress(members.flatMap((member) => member.aws?.externalEgress ?? [])),
          networkConnections: privatePeerConnections(privatePeers),
          };
        })()
      : undefined;
    const policy = {
      ...(kubernetes ? { kubernetes } : {}),
      ...(aws ? { aws } : {}),
    };
    return {
      workloadIdentity: placement.workloadIdentity,
      artifactIds: uniqueStrings(placement.artifactIds),
      executionIdentities,
      requirementIds,
      policyDigest: `sha256:${sha256Hex(canonicalJsonV1String(policy))}`,
      ...(kubernetes ? { kubernetes } : {}),
      ...(aws ? { aws } : {}),
    };
  }).sort((left, right) => left.workloadIdentity.localeCompare(right.workloadIdentity));
}

function mergePlannedKubernetesBindings(
  bindings: readonly ApplicationRuntimeAccessKubernetesBinding[],
): readonly ApplicationRuntimeAccessKubernetesBinding[] {
  const values = new Map<string, {
    readonly kind: ApplicationRuntimeAccessKubernetesBinding['kind'];
    readonly namespace?: string;
    readonly rules: Map<string, ApplicationRuntimeAccessKubernetesRule>;
    readonly requirementIds: Set<string>;
  }>();
  for (const binding of bindings) {
    const key = canonicalJsonV1String({ kind: binding.kind, ...(binding.namespace ? { namespace: binding.namespace } : {}) });
    const current = values.get(key) ?? {
      kind: binding.kind,
      ...(binding.namespace ? { namespace: binding.namespace } : {}),
      rules: new Map<string, ApplicationRuntimeAccessKubernetesRule>(),
      requirementIds: new Set<string>(),
    };
    for (const rule of binding.rules) {
      const ruleKey = canonicalJsonV1String({
        apiGroups: rule.apiGroups,
        resources: rule.resources,
        resourceNames: rule.resourceNames ?? [],
      });
      const previous = current.rules.get(ruleKey);
      current.rules.set(ruleKey, {
        ...rule,
        verbs: uniqueStrings([...(previous?.verbs ?? []), ...rule.verbs]),
      });
    }
    for (const requirementId of binding.requirementIds) current.requirementIds.add(requirementId);
    values.set(key, current);
  }
  return [...values.values()].map((binding) => ({
    kind: binding.kind,
    ...(binding.namespace ? { namespace: binding.namespace } : {}),
    rules: [...binding.rules.values()].sort(compareCanonical),
    requirementIds: [...binding.requirementIds].sort(),
  })).sort(compareCanonical);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function mergeCredentialProjections(
  projections: readonly { readonly resourceId: string; readonly keys: readonly string[] }[],
): readonly { readonly resourceId: string; readonly keys: readonly string[] }[] {
  const values = new Map<string, { readonly keys: Set<string>; whole: boolean }>();
  for (const projection of projections) {
    const current = values.get(projection.resourceId) ?? { keys: new Set<string>(), whole: false };
    if (projection.keys.length === 0) current.whole = true;
    for (const key of projection.keys) current.keys.add(key);
    values.set(projection.resourceId, current);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, value]) => ({
      resourceId,
      keys: value.whole ? [] : [...value.keys].sort(),
    }));
}

function awsStatementsForRequirement(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): readonly ApplicationRuntimeAccessAwsStatement[] {
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
    if (!bucket) return [];
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
    return [{
      effect: 'Allow',
      actions,
      resources: operation === 'object.list' ? [bucketArn] : [objectArn],
      ...(operation === 'object.list' && prefix ? {
        conditions: { StringLike: { 's3:prefix': [`${prefix}/*`, prefix] } },
      } : {}),
    }];
  }
  if ((operation === 'queue.consume' || operation === 'queue.publish') && provider?.interface === 'Queue') {
    const arn = exactArn(config, ['queueArn', 'arn']);
    if (!arn) return [];
    return [{ effect: 'Allow', actions: operation === 'queue.consume' ? ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'] : ['sqs:SendMessage'], resources: [arn] }];
  }
  if ((operation === 'event.publish' || operation === 'event.subscribe') && (provider?.interface === 'EventSource' || provider?.interface === 'EventLog')) {
    const arn = exactArn(config, ['streamArn', 'arn']);
    if (!arn) return [];
    return [{ effect: 'Allow', actions: operation === 'event.publish' ? ['kinesis:PutRecord', 'kinesis:PutRecords'] : ['kinesis:DescribeStreamSummary', 'kinesis:GetRecords', 'kinesis:GetShardIterator', 'kinesis:ListShards'], resources: [arn] }];
  }
  if (operation === 'secret.read') {
    const arn = exactArn(config, ['secretArn', 'arn']) ?? exactArn(graphNodeConfig(requirement, graph), ['secretArn', 'arn']);
    return arn ? [{ effect: 'Allow', actions: ['secretsmanager:GetSecretValue'], resources: [arn] }] : [];
  }
  if (
    (operation === 'model.read' || operation === 'model.write' || operation === 'model.delete' || operation === 'connection.use')
    && (provider?.interface === 'TransactionalDatabase' || exactArn(config, ['secretArn']))
  ) {
    const arn = exactArn(config, ['secretArn']);
    return arn ? [{ effect: 'Allow', actions: ['secretsmanager:GetSecretValue'], resources: [arn] }] : [];
  }
  if (operation === 'connection.use' && stringValue(config?.runtimeKind) === 'celld-actors') {
    const stateBucketArn = exactArn(config, ['stateBucketArn']);
    const authorizationSecretArn = exactArn(config, ['authorizationSecretArn']);
    const connectionSigningSecretArn = exactArn(config, ['connectionSigningSecretArn']);
    if (!stateBucketArn || !authorizationSecretArn || !connectionSigningSecretArn) return [];
    return [
      {
        effect: 'Allow',
        actions: ['s3:DeleteObject', 's3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'],
        resources: [stateBucketArn, `${stateBucketArn}/*`],
      },
      {
        effect: 'Allow',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [authorizationSecretArn, connectionSigningSecretArn],
      },
    ];
  }
  if (operation === 'checkpoint.use') {
    const tableArn = exactArn(config, ['tableArn']);
    return tableArn ? [{
      effect: 'Allow',
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],
      resources: [tableArn],
    }] : [];
  }
  if (operation === 'schedule.admit') {
    const queueArn = exactArn(config, ['queueArn']);
    const scheduleArn = exactArn(config, ['scheduleArn']);
    const executionRoleArn = exactArn(config, ['executionRoleArn']);
    if (!queueArn || !scheduleArn || !executionRoleArn) return [];
    return [
      {
        effect: 'Allow',
        actions: ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'],
        resources: [queueArn],
      },
      {
        effect: 'Allow',
        actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule', 'scheduler:GetSchedule', 'scheduler:UpdateSchedule'],
        resources: [scheduleArn],
      },
      {
        effect: 'Allow',
        actions: ['iam:PassRole'],
        resources: [executionRoleArn],
        conditions: { StringEquals: { 'iam:PassedToService': ['scheduler.amazonaws.com'] } },
      },
    ];
  }
  const observability = operation === 'telemetry.write'
    ? graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'Observability')
    : provider;
  if (operation === 'telemetry.write' && observability?.interface === 'Observability' && observability.implementation === 'cloudwatch') {
    const observabilityConfig = { ...(observability.config ?? {}), ...(targetResources?.[observability.id] ?? {}) };
    const logGroupArn = exactArn(observabilityConfig, ['logGroupArn']);
    const traceDestinationArn = exactArn(observabilityConfig, ['traceDestinationArn']);
    if (!logGroupArn && !traceDestinationArn) return [];
    return [{ effect: 'Allow', actions: [...(logGroupArn ? ['logs:CreateLogStream', 'logs:PutLogEvents'] : []), ...(traceDestinationArn ? ['xray:PutTelemetryRecords', 'xray:PutTraceSegments'] : [])].sort(), resources: [logGroupArn, traceDestinationArn].filter((value): value is string => Boolean(value)).sort() }];
  }
  return [];
}

function runtimePrivatePeer(
  requirement: ApplicationRuntimeAccessRequirement,
  targetKind: ApplicationRuntimeAccessPlan['target'],
  graph: ApplicationGraph,
  targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): readonly ApplicationRuntimeAccessPrivatePeer[] {
  const provider = providerForRequirement(requirement, graph);
  const target = targetResources?.[requirement.target.capabilityId]
    ?? (provider ? targetResources?.[provider.id] : undefined);
  if (target?.networkMode === 'embedded') return [];
  const needsConnection = requirement.target.operation === 'network.connect'
    || requirement.target.operation === 'connection.use'
    || ((requirement.target.operation === 'model.read'
      || requirement.target.operation === 'model.write'
      || requirement.target.operation === 'model.delete')
      && provider?.interface === 'TransactionalDatabase');
  if (!needsConnection || targetKind === 'local' || !target) return [];
  const port = numberValue(target.networkPort);
  const protocol = target.networkProtocol === 'UDP' ? 'UDP' : target.networkProtocol === 'TCP' || target.networkProtocol === undefined ? 'TCP' : undefined;
  if (!port || !Number.isInteger(port) || port < 1 || port > 65_535 || !protocol) return [];
  const capabilityId = provider?.id ?? requirement.target.capabilityId;
  const endpoint = targetKind === 'kubernetes'
    ? (() => {
        const namespace = stringValue(target.networkNamespace);
        const serviceName = stringValue(target.networkServiceName);
        const podSelector = stringRecord(target.networkPodSelector);
        return namespace && serviceName && podSelector && Object.keys(podSelector).length > 0
          ? { target: 'kubernetes' as const, namespace, serviceName, podSelector }
          : undefined;
      })()
    : targetKind === 'aws' || targetKind === 'aws-local'
      ? (() => {
          const resourceId = stringValue(target.networkResourceId);
          return resourceId ? { target: targetKind, resourceId } as const : undefined;
        })()
      : undefined;
  if (!endpoint) return [];
  const identityContent = { capabilityId, protocol, port, endpoint };
  return [{
    peerIdentity: `peer.${sha256Hex(canonicalJsonV1String(identityContent)).slice(0, 24)}`,
    capabilityId,
    requirementIds: [requirement.id],
    protocol,
    port,
    endpoint,
  }];
}

function runtimeExternalEgress(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): readonly ApplicationRuntimeAccessExternalEgress[] {
  const provider = providerForRequirement(requirement, graph);
  const target = targetResources?.[requirement.target.capabilityId]
    ?? (provider ? targetResources?.[provider.id] : undefined);
  if (target?.networkKind !== 'external') return [];
  if (requirement.target.operation !== 'network.connect' && requirement.target.operation !== 'connection.use') return [];
  const protocol = target.networkProtocol === 'UDP'
    ? 'UDP'
    : target.networkProtocol === 'TCP' ? 'TCP' : undefined;
  const port = target.networkPort === undefined ? undefined : numberValue(target.networkPort);
  const fidelity = target.networkExternalFidelity === 'port-only'
    ? 'port-only'
    : target.networkExternalFidelity === 'not-introspectable'
      ? 'not-introspectable'
      : undefined;
  const rawDestination = objectValue(target.networkExternalDestination);
  const destination = rawDestination?.kind === 'dnsName' && typeof rawDestination.hostname === 'string' && rawDestination.hostname.length > 0
    ? { kind: 'dnsName' as const, hostname: rawDestination.hostname }
    : rawDestination?.kind === 'externalContract' && typeof rawDestination.responsibility === 'string' && rawDestination.responsibility.length > 0
      ? { kind: 'externalContract' as const, responsibility: rawDestination.responsibility }
      : undefined;
  if (!protocol || !fidelity || !destination) return [];
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) return [];
  const capabilityId = provider?.id ?? requirement.target.capabilityId;
  const identityContent = { capabilityId, protocol, ...(port === undefined ? {} : { port }), destination, fidelity };
  return [{
    egressIdentity: `external.${sha256Hex(canonicalJsonV1String(identityContent)).slice(0, 24)}`,
    capabilityId,
    requirementIds: [requirement.id],
    protocol,
    ...(port === undefined ? {} : { port }),
    destination,
    fidelity,
  }];
}

function mergePrivatePeers(
  peers: readonly ApplicationRuntimeAccessPrivatePeer[],
): readonly ApplicationRuntimeAccessPrivatePeer[] {
  const merged = new Map<string, ApplicationRuntimeAccessPrivatePeer>();
  for (const peer of peers) {
    const identity = canonicalJsonV1String({
      peerIdentity: peer.peerIdentity,
      capabilityId: peer.capabilityId,
      protocol: peer.protocol,
      port: peer.port,
      endpoint: peer.endpoint,
    });
    const current = merged.get(identity);
    merged.set(identity, {
      ...peer,
      requirementIds: uniqueStrings([...(current?.requirementIds ?? []), ...peer.requirementIds]),
    });
  }
  return [...merged.values()].sort(compareCanonical);
}

function privatePeerConnections(peers: readonly ApplicationRuntimeAccessPrivatePeer[]): readonly string[] {
  return uniqueStrings(peers.map(({ endpoint }) => endpoint.target === 'kubernetes'
    ? `${endpoint.namespace}/${endpoint.serviceName}`
    : endpoint.resourceId));
}

function mergeExternalEgress(
  entries: readonly ApplicationRuntimeAccessExternalEgress[],
): readonly ApplicationRuntimeAccessExternalEgress[] {
  const merged = new Map<string, ApplicationRuntimeAccessExternalEgress>();
  for (const entry of entries) {
    const current = merged.get(entry.egressIdentity);
    merged.set(entry.egressIdentity, {
      ...entry,
      requirementIds: uniqueStrings([...(current?.requirementIds ?? []), ...entry.requirementIds]),
    });
  }
  return [...merged.values()].sort(compareCanonical);
}

function mergeBootstrapEgress(
  entries: readonly ApplicationRuntimeAccessBootstrapEgress[],
): readonly ApplicationRuntimeAccessBootstrapEgress[] {
  return [...new Map(entries.map((entry) => [entry.egressIdentity, entry])).values()].sort(compareCanonical);
}

function providerForRequirement(requirement: ApplicationRuntimeAccessRequirement, graph: ApplicationGraph): ApplicationProviderNode | undefined {
  const target = graph.nodes.find(({ id }) => id === requirement.target.capabilityId || id === resourceId(requirement));
  if (target?.kind === 'provider') return target;
  const targetProvider = target && 'provider' in target
    ? target.provider
    : target?.kind === 'model'
      ? target.database
      : undefined;
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

function requiresAwsStatement(
  requirement: ApplicationRuntimeAccessRequirement,
  graph: ApplicationGraph,
  targetResources?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): boolean {
  if (requirement.target.operation === 'event.subscribe' || requirement.target.operation === 'event.publish') {
    // An event capability may be a database/outbox-backed application stream.
    // Only an explicitly bound EventLog maps to a target IAM data plane. An
    // ambiguous explicit binding must still fail closed rather than looking
    // indistinguishable from a database/outbox stream.
    return providerForRequirement(requirement, graph)?.interface === 'EventLog'
      || owningProviderRequirements(requirement, graph).some(({ interface: providerInterface }) => providerInterface === 'EventLog');
  }
  if (requirement.target.operation === 'connection.use') {
    const provider = providerForRequirement(requirement, graph);
    const config = targetResources?.[requirement.target.capabilityId]
      ?? (provider ? targetResources?.[provider.id] : undefined);
    return provider?.interface === 'TransactionalDatabase'
      || config?.runtimeKind === 'celld-actors'
      || Boolean(exactArn(config, ['secretArn', 'tableArn']));
  }
  if (requirement.target.operation === 'model.read' || requirement.target.operation === 'model.write' || requirement.target.operation === 'model.delete') {
    return providerForRequirement(requirement, graph)?.interface === 'TransactionalDatabase';
  }
  return [
    'object.list', 'object.read', 'object.write', 'object.delete',
    'queue.consume', 'queue.publish', 'secret.read',
    'checkpoint.use', 'schedule.admit',
  ].includes(requirement.target.operation);
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

function runtimeRoleStatement(
  statement: ApplicationRuntimeAccessAwsStatement,
): readonly ApplicationRuntimeAccessAwsStatement[] {
  const actions = statement.actions.filter((action) => action !== 'secretsmanager:GetSecretValue');
  return actions.length > 0 ? [{ ...statement, actions }] : [];
}

function executionRoleStatement(
  statement: ApplicationRuntimeAccessAwsStatement,
): readonly ApplicationRuntimeAccessAwsStatement[] {
  return statement.actions.includes('secretsmanager:GetSecretValue')
    ? [{ ...statement, actions: ['secretsmanager:GetSecretValue'] }]
    : [];
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
      verbs: scope.verbs ?? verbs(requirement.target.operation),
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
  return [];
}

function requiresKubernetesRule(requirement: ApplicationRuntimeAccessRequirement): boolean {
  return requirement.target.operation.startsWith('kubernetes.');
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
  hasPrivatePeer: boolean,
  hasExternalEgress: boolean,
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
      return lowering(requirement, 'exact', [
        'kubernetes-rbac',
        ...(requirement.target.operation === 'secret.read' ? ['kubernetes-secret-projection' as const] : []),
        ...(hasPrivatePeer ? ['kubernetes-network' as const] : []),
      ], providerGuarantee);
    }
    if (hasPrivatePeer) {
      return lowering(requirement, 'exact', ['kubernetes-network'], providerGuarantee);
    }
    if (hasExternalEgress) {
      return lowering(requirement, 'external', ['external-contract'], providerGuarantee);
    }
    if (requirement.target.operation === 'network.connect' || requirement.target.operation === 'connection.use') {
      return lowering(requirement, 'unsupported', [], providerGuarantee);
    }
    return lowering(requirement, requiresKubernetesEnforcement ? 'unsupported' : 'capability', [], providerGuarantee);
  }
  if (hasAwsStatement || hasPrivatePeer) return lowering(requirement, 'exact', [
    ...(hasAwsStatement ? ['aws-iam' as const] : []),
    ...(hasPrivatePeer ? ['aws-network' as const] : []),
  ], providerGuarantee);
  if (hasExternalEgress) return lowering(requirement, 'external', ['external-contract'], providerGuarantee);
  if (requirement.target.operation === 'network.connect' || requirement.target.operation === 'connection.use') {
    return lowering(requirement, 'unsupported', [], providerGuarantee);
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
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  return entries.every(([, entry]) => typeof entry === 'string')
    ? Object.fromEntries(entries) as Readonly<Record<string, string>>
    : undefined;
}
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
