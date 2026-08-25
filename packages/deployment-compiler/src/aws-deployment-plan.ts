// typecast-file-boundary: Portable graph configuration is discriminated and normalized into the target AWS plan here.

import {
  type ApplicationCommandHandlerNode,
  type ApplicationGraph,
  type ApplicationGraphNode,
  type ApplicationLakehousePublicationNode,
  type ApplicationModelNode,
  type ApplicationProcessorNode,
  type ApplicationProviderNode,
  deriveApplicationGraphFoundation,
} from '@applik8s/core';
import {
  type ApplicationAwsDeploymentPlan,
  type ApplicationAwsPlanEdge,
  type ApplicationAwsPlanResource,
  type ApplicationAwsService,
  type ApplicationRuntimeAccessBootstrapEgress,
  type ApplicationRuntimeAccessPlan,
  type ApplicationRuntimeArtifact,
  applicationRuntimeArtifactId,
  applicationRuntimeEndpointEnvironmentName,
  type DeploymentJsonObject,
  type DeploymentJsonValue,
  normalizeApplicationAwsDeploymentPlan,
  sha256Hex,
  validateApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-contract';
import { isAwsRuntimeAccessSecurityGroupQualified, validateAwsRuntimeAccessParity } from './aws-runtime-access-parity.js';
import { assertApplicationScheduleProviderCompatibility } from './provider-guarantees.js';
import {
  applicationDeploymentRuntimeAccessTargetRecord,
  applicationProviderRuntimeAccessTargets,
  resolveApplicationProviderForTarget,
} from './providers.js';
import {
  type ApplicationRuntimeAccessWorkloadPlacement,
  compileApplicationRuntimeAccessPlan,
} from './runtime-access-plan.js';
import { applicationWorkloadProviderNodeIds } from './workload-provider-references.js';

const awsHatchetImage = 'ghcr.io/hatchet-dev/hatchet/hatchet-lite@sha256:5405c7f3991e85b7490b4e9fd7187bf5699f7cdd5b6e0c9a751751164b801aa9';
const awsHatchetTenantId = '707d0855-80ab-4e1f-a156-f1c4546cbf52';

export interface CompileApplicationAwsDeploymentPlanRequest {
  readonly graph: ApplicationGraph;
  readonly environment: string;
  readonly region: string;
  readonly accountId: string;
  readonly availabilityZones?: readonly string[];
  /** Route53 hosted zones keyed by their DNS suffix, for example example.com -> Z123. */
  readonly hostedZones?: Readonly<Record<string, string>>;
  readonly profile?: string;
  /** aws-local starts the application process outside MiniStack. */
  readonly includeApplicationHosts?: boolean;
  readonly target?: 'aws' | 'aws-local';
  readonly installationSpec?: DeploymentJsonObject;
  /** Digest-verified compiler-owned workloads admitted to the AWS target. */
  readonly runtimeArtifacts?: readonly ApplicationRuntimeArtifact[];
  /** Makes authored source provenance workspace-relative in canonical target artifacts. */
  readonly workspaceRoot?: string;
}

/** Pure semantic graph -> reviewable AWS resource planning. Alchemy owns all effects. */
export function compileApplicationAwsDeploymentPlan(request: CompileApplicationAwsDeploymentPlanRequest): ApplicationAwsDeploymentPlan {
	assertApplicationScheduleProviderCompatibility({
		graph: request.graph,
		target: request.target ?? 'aws',
		...(request.profile ? { profile: request.profile } : {}),
	});
  assertAwsSegment(request.environment, 'environment');
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(request.region)) throw new Error(`AWS region ${request.region} is invalid.`);
  if (!/^\d{12}$/u.test(request.accountId)) throw new Error('AWS accountId must contain exactly 12 digits.');
  const resources = new Map<string, ApplicationAwsPlanResource>();
  const edges: ApplicationAwsPlanEdge[] = [];
  const diagnostics: ApplicationAwsDeploymentPlan['diagnostics'][number][] = [];
  const selectedProviders: ApplicationProviderNode[] = [];
  const publishesRealtimeActors = request.graph.nodes.some((node) =>
    node.kind === 'actor'
    && node.publication?.boundary === 'entrypoint-export'
    && node.definition.requirements.realtimeConnections);
  const name = (suffix: string, limit = 63) => boundedAwsName(`${request.graph.metadata.name}-${request.environment}-${suffix}`, limit);
  const add = (entry: ApplicationAwsPlanResource): void => {
    const previous = resources.get(entry.id);
    if (previous && stableJson(previous) !== stableJson(entry)) throw new Error(`AWS plan resource ${entry.id} has conflicting declarations.`);
    resources.set(entry.id, entry);
  };
  const connect = (edge: ApplicationAwsPlanEdge): void => {
    if (!edges.some((candidate) => stableJson(candidate) === stableJson(edge))) edges.push(edge);
  };

  const zones = request.availabilityZones?.length ? [...request.availabilityZones] : [`${request.region}a`, `${request.region}b`];
  if (zones.length < 2) throw new Error('AWS production planning requires at least two availability zones.');
  const requiresNetworkFoundation = request.target !== 'aws-local'
    || request.includeApplicationHosts !== false
    || (request.runtimeArtifacts ?? []).length > 0
    || request.graph.nodes.some((node) => node.kind === 'provider' && [
      'TransactionalDatabase',
      'IndexStore',
      'ActorRuntime',
      'WorkflowEngine',
      'HttpExposure',
    ].includes(node.interface));
  if (requiresNetworkFoundation) {
    add(resource('foundation.network', 'ec2', 'vpc', name('vpc'), { cidrBlock: '10.64.0.0/16', enableDnsSupport: true, enableDnsHostnames: true }, undefined, 'control-plane', ['vpcId']));
    for (const [index, zone] of zones.slice(0, 2).entries()) {
      for (const visibility of ['public', 'private'] as const) {
        const id = `foundation.subnet.${visibility}.${index + 1}`;
        add(resource(id, 'ec2', 'subnet', name(`${visibility}-${index + 1}`), {
          availabilityZone: zone,
          cidrBlock: visibility === 'public' ? `10.64.${index}.0/24` : `10.64.${index + 16}.0/24`,
          mapPublicIpOnLaunch: visibility === 'public',
        }, undefined, visibility, ['subnetId']));
        connect({ from: 'foundation.network', to: id, relationship: 'requiresReady' });
      }
    }
    add(resource('foundation.security-group.application', 'ec2', 'security-group', name('application'), {
      description: 'Unqualified provider-owned and external-transport workloads only.',
      egressMode: 'unqualified-all',
      ingressRules: [],
      egressRules: [],
    }, undefined, 'private', ['securityGroupId']));
    connect({ from: 'foundation.network', to: 'foundation.security-group.application', relationship: 'requiresReady' });
  }
  const requiresServiceDiscovery = request.graph.nodes.some((node) =>
    node.kind === 'provider'
    && ((node.interface === 'ActorRuntime' && node.implementation === 'celld-actors')
      || (node.interface === 'WorkflowEngine' && node.implementation === 'hatchet')))
    || (request.runtimeArtifacts ?? []).some((artifact) => artifact.role !== 'operator' && artifact.role !== 'processor' && artifact.role !== 'lakehouse');
  if (requiresServiceDiscovery) {
    if (!requiresNetworkFoundation) throw new Error('AWS service discovery requires the network foundation.');
    add(resource('foundation.discovery', 'service-discovery', 'private-dns-namespace', name('internal'), {
      namespaceName: `${boundedAwsName(`${request.graph.metadata.name}-${request.environment}`, 40)}.internal`,
      vpcResourceId: 'foundation.network',
    }, undefined, 'private', ['namespaceId', 'namespaceArn']));
    connect({ from: 'foundation.network', to: 'foundation.discovery', relationship: 'requiresReady' });
  }
  const requiresComputeFoundation = request.target !== 'aws-local'
    || request.includeApplicationHosts !== false
    || (request.runtimeArtifacts ?? []).length > 0
    || request.graph.nodes.some((node) => node.kind === 'provider' && [
      'ActorRuntime',
      'WorkflowEngine',
    ].includes(node.interface));
  if (requiresComputeFoundation) {
    add(resource('foundation.registry', 'ecr', 'repository', name('artifacts'), { imageTagMutability: 'IMMUTABLE', scanOnPush: true }, undefined, 'none', ['repositoryUri', 'repositoryArn']));
    add(resource('foundation.compute', 'ecs', 'cluster', name('compute'), { containerInsights: true }, undefined, 'private', ['clusterArn', 'clusterName']));
  }
  if (requiresComputeFoundation || request.graph.nodes.some((node) => node.kind === 'provider' && node.interface === 'Observability')) {
    add(resource('foundation.logs', 'cloudwatch', 'log-group', `/applik8s/${request.graph.metadata.name}/${request.environment}`, { retentionDays: 30 }, undefined, 'none', ['logGroupArn']));
  }

  for (const sourceProvider of request.graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider')) {
    const provider = resolveApplicationProviderForTarget(sourceProvider, {
      graph: request.graph,
      target: request.target ?? 'aws',
      connection: { provider: request.target ?? 'aws', cluster: `${request.accountId}/${request.region}`, digest: `sha256:${'0'.repeat(64)}` },
      instance: request.environment,
      profile: request.profile ?? request.environment,
      strategy: 'direct',
      installationSpec: request.installationSpec ?? {},
    });
    selectedProviders.push(provider);
    const lowered = awsProviderResources(provider, request, name);
    if (!lowered) {
      if (awsRuntimeOnlyProvider(provider)) continue;
      diagnostics.push({ severity: 'error', code: 'AWS_PROVIDER_INCOMPATIBLE', message: `Provider ${provider.interface}/${provider.implementation} has no qualified AWS lowering.`, subjectId: provider.id });
      continue;
    }
    for (const entry of lowered) {
      add(entry);
      if (entry.network === 'private' && requiresNetworkFoundation) {
        connect({ from: 'foundation.network', to: entry.id, relationship: 'requiresReady' });
        connect({ from: 'foundation.security-group.application', to: entry.id, relationship: 'networkAccess' });
      }
    }
    if (provider.interface === 'ActorRuntime' && provider.implementation === 'celld-actors') {
      const base = `provider.${provider.id}`;
      connect({ from: `${base}.state`, to: base, relationship: 'requiresReady' });
      connect({ from: `${base}.authorization`, to: base, relationship: 'requiresReady' });
      connect({ from: `${base}.connection-signing`, to: base, relationship: 'requiresReady' });
      connect({ from: 'foundation.compute', to: base, relationship: 'requiresReady' });
      connect({ from: 'foundation.logs', to: base, relationship: 'requiresReady' });
    }
    if (provider.interface === 'WorkflowEngine' && provider.implementation === 'hatchet') {
      const base = `provider.${provider.id}`;
      connect({ from: `${base}.credentials`, to: `${base}.database`, relationship: 'requiresReady' });
      connect({ from: `${base}.database`, to: base, relationship: 'requiresReady' });
      connect({ from: `${base}.config`, to: base, relationship: 'requiresReady' });
      connect({ from: `${base}.worker-token`, to: base, relationship: 'requiresReady' });
      connect({ from: 'foundation.compute', to: base, relationship: 'requiresReady' });
      connect({ from: 'foundation.discovery', to: base, relationship: 'requiresReady' });
      connect({ from: 'foundation.logs', to: base, relationship: 'requiresReady' });
    }
  }
  lowerAwsExposures(request, resources, diagnostics, add, connect, name);
  const foundation = deriveApplicationGraphFoundation(
    request.graph,
    request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {},
  );
  const generatedSecretIdentities = [...new Set(foundation.runtimeAccess
    .filter(({ target }) => target.operation === 'secret.read' && target.scope.kind === 'resource')
    .map(({ target }) => target.scope.kind === 'resource' ? target.scope.resourceId : ''))]
    .filter(Boolean)
    .sort();
  for (const secretIdentity of generatedSecretIdentities) {
    const id = `runtime-secret.${hash(secretIdentity, 16)}`;
    add(resource(id, 'secrets-manager', 'secret-authority', name(`runtime-secret-${hash(secretIdentity, 8)}`), {
      values: 'generated-random',
      passwordLength: 48,
      environmentName: runtimeSecretEnvironmentName(secretIdentity, request.graph),
    }, secretIdentity, 'none', ['secretArn']));
  }
  if ([...resources.values()].some(({ service, resourceType }) => service === 's3' && resourceType === 'lakehouse-dataset')) {
    add(resource('lakehouse.cursor-signing', 'secrets-manager', 'secret-authority', name('lakehouse-cursor-signing'), {
      values: 'runtime-injected-only', passwordLength: 48, purpose: 'signed-snapshot-cursors',
    }, undefined, 'none', ['secretArn']));
  }
  for (const workgroup of [...resources.values()].filter(({ service, resourceType }) => service === 'athena' && resourceType === 'workgroup')) {
    const catalogId = stringValue(workgroup.configuration.catalogResourceId);
    const resultsId = stringValue(workgroup.configuration.resultBucketResourceId);
    if (catalogId) connect({ from: catalogId, to: workgroup.id, relationship: 'requiresReady' });
    if (resultsId) connect({ from: resultsId, to: workgroup.id, relationship: 'requiresReady' });
  }

  const runtimeArtifacts = (request.runtimeArtifacts ?? []).map((artifact) => portableAwsRuntimeArtifact(artifact, request.workspaceRoot));
  const runtimeServiceResourceIds = new Map<string, string>();
  for (const artifact of runtimeArtifacts) {
    if (artifact.role === 'operator' || runtimeArtifactPlacement(artifact, request.graph).kind !== 'service') continue;
    const resourceId = `runtime-artifact.${hash(applicationRuntimeArtifactId(artifact), 20)}`;
    const previous = runtimeServiceResourceIds.get(artifact.nodeId);
    if (previous && previous !== resourceId) {
      diagnostics.push({
        severity: 'error',
        code: 'AWS_CONFIGURATION_UNRESOLVED',
        message: `Semantic runtime endpoint ${artifact.nodeId} is implemented by more than one service artifact.`,
        subjectId: artifact.nodeId,
      });
    } else {
      runtimeServiceResourceIds.set(artifact.nodeId, resourceId);
    }
  }
  const processorArtifacts = runtimeArtifacts.filter(({ role }) => role === 'processor');
  const lakehousePublisherArtifacts = runtimeArtifacts.filter(({ role }) => role === 'lakehouse');
  if (
    processorArtifacts.length > 0
    || lakehousePublisherArtifacts.length > 0
    || request.graph.nodes.some(({ kind }) => kind === 'processor' || kind === 'lakehousePublication')
  ) {
    const checkpoint = resource(
      'framework.kinesis-checkpoints',
      'dynamodb',
      'kinesis-checkpoint-table',
      name('kinesis-checkpoints', 255),
      {
        partitionKey: 'consumerKey',
        sortKey: 'shardId',
        billingMode: 'PAY_PER_REQUEST',
        pointInTimeRecovery: request.environment === 'production',
        serverSideEncryption: true,
        authority: 'applik8s-kinesis-checkpoints',
      },
      undefined,
      'none',
      ['tableName', 'tableArn'],
    );
    add(request.environment === 'production'
      ? { ...checkpoint, lifecycle: { ...checkpoint.lifecycle, deletion: 'retain' } }
      : checkpoint);
  }

  const schedules = request.graph.nodes.filter((node) => node.kind === 'schedule');
  lowerAwsScheduleFoundation(request, resources, add, connect, name, schedules);
  const runtimeBindings = awsRuntimeBindings(request.graph, resources);
  const managedHosts = selectedProviders.filter(({ interface: providerInterface }) => providerInterface === 'ApplicationHost');
  const serverHosts = managedHosts.length > 0
    ? []
    : request.graph.nodes.filter((candidate): candidate is Extract<ApplicationGraphNode, { kind: 'server' }> =>
      candidate.kind === 'server'
      && !runtimeArtifacts.some((artifact) => artifact.role === 'http' && artifact.nodeId === candidate.id));
  const applicationHosts = request.includeApplicationHosts === false
    ? []
    : [
        ...serverHosts.map((node) => ({ id: node.id, replicas: typeof node.deployment?.replicas === 'number' ? node.deployment.replicas : 1, port: node.deployment?.port ?? 3000 })),
        ...managedHosts.map((provider) => {
          const config = providerConfig(provider);
          return { id: provider.id, replicas: numberValue(config.replicas) ?? 1, port: numberValue(config.port) ?? 3000 };
        }),
      ];
  if (applicationHosts.length > 1) {
    diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS target requires one ApplicationHost; found ${applicationHosts.length}.` });
  }
  const workloadPlacements = awsRuntimeAccessWorkloadPlacements(
    request,
    runtimeArtifacts,
    applicationHosts.map(({ id }) => id),
    schedules.map(({ id }) => id),
    name,
  );
  const includedExecutionNodeIds = request.includeApplicationHosts === false
    ? [...new Set(workloadPlacements.flatMap(({ executionNodeIds }) => executionNodeIds))].sort()
    : undefined;

  const runtimeAccess = compileApplicationRuntimeAccessPlan({
    graph: request.graph,
    target: request.target ?? 'aws',
    profile: request.profile ?? request.environment,
    ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
    targetResources: awsRuntimeAccessBindings(request.graph, resources, request),
    bootstrapEgress: resources.has('foundation.network')
      ? awsDnsBootstrapEgress(request.target ?? 'aws')
      : [],
    workloadPlacements,
    ...(includedExecutionNodeIds ? { includedExecutionNodeIds } : {}),
  });
  for (const diagnostic of runtimeAccess.diagnostics) diagnostics.push({ severity: diagnostic.severity, code: 'AWS_RUNTIME_ACCESS_UNRESOLVED', message: diagnostic.message, subjectId: diagnostic.requirementId });
  const runtimeNetwork = materializeQualifiedAwsRuntimeNetwork({
    runtimeAccess,
    resources,
    target: request.target ?? 'aws',
    name,
  });
  for (const entry of runtimeNetwork.resources) {
    add(entry);
    connect({ from: 'foundation.network', to: entry.id, relationship: 'requiresReady' });
  }
  for (const [targetResourceId, securityGroupResourceId] of runtimeNetwork.targetSecurityGroups) {
    const targetResource = resources.get(targetResourceId);
    if (!targetResource) continue;
    resources.set(targetResourceId, {
      ...targetResource,
      configuration: { ...targetResource.configuration, runtimeAccessSecurityGroupResourceId: securityGroupResourceId },
    });
    connect({ from: securityGroupResourceId, to: targetResourceId, relationship: 'requiresReady' });
  }
  const runtimeRolesByWorkloadResourceId = new Map<string, ApplicationAwsPlanResource>();
  const executionRolesByWorkloadResourceId = new Map<string, ApplicationAwsPlanResource>();
  for (const workload of runtimeAccess.workloads) {
    if (!workload.aws) continue;
    const role = resource(`runtime-role.${hash(workload.workloadIdentity, 16)}`, 'iam', 'role', workload.aws.roleName, {
      assumeService: 'ecs-tasks.amazonaws.com',
      statements: deploymentJson(workload.aws.statements),
      workloadIdentity: workload.workloadIdentity,
      executionIdentities: workload.executionIdentities,
      requirementIds: workload.requirementIds,
      networkConnections: workload.aws.networkConnections,
    }, workload.executionIdentities.length === 1
      ? runtimeAccess.executions.find(({ executionIdentity }) => executionIdentity === workload.executionIdentities[0])?.nodeId
      : undefined, 'control-plane', ['roleArn']);
    add(role);
    runtimeRolesByWorkloadResourceId.set(workload.aws.resourceId, role);
    const executionRole = resource(`runtime-execution-role.${hash(workload.workloadIdentity, 16)}`, 'iam', 'role', workload.aws.executionRoleName ?? name(`bootstrap-${hash(workload.workloadIdentity, 12)}`, 64), {
      assumeService: 'ecs-tasks.amazonaws.com',
      managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
      statements: deploymentJson(workload.aws.executionRoleStatements ?? []),
      rolePurpose: 'ecs-execution',
      workloadIdentity: workload.workloadIdentity,
      executionIdentities: workload.executionIdentities,
      requirementIds: workload.requirementIds,
    }, workload.executionIdentities.length === 1
      ? runtimeAccess.executions.find(({ executionIdentity }) => executionIdentity === workload.executionIdentities[0])?.nodeId
      : undefined, 'control-plane', ['roleArn']);
    add(executionRole);
    executionRolesByWorkloadResourceId.set(workload.aws.resourceId, executionRole);
  }
  for (const workload of runtimeAccess.workloads) {
    if (!workload.aws) continue;
    const runtimeResource = resources.get(workload.aws.resourceId);
    const role = runtimeRolesByWorkloadResourceId.get(workload.aws.resourceId);
    const executionRole = executionRolesByWorkloadResourceId.get(workload.aws.resourceId);
    if (!runtimeResource || !role || !executionRole || runtimeResource.service !== 'ecs') continue;
    resources.set(runtimeResource.id, {
      ...runtimeResource,
      configuration: {
        ...runtimeResource.configuration,
        runtimeRoleResourceId: role.id,
        executionRoleResourceId: executionRole.id,
        ...(runtimeNetwork.workloadSecurityGroups.get(runtimeResource.id)
          ? { runtimeAccessSecurityGroupResourceId: runtimeNetwork.workloadSecurityGroups.get(runtimeResource.id)! }
          : {}),
      },
    });
    connect({ from: role.id, to: runtimeResource.id, relationship: 'assumesRole' });
    connect({ from: executionRole.id, to: runtimeResource.id, relationship: 'assumesRole', output: 'ecs-execution' });
    for (const targetResourceId of workload.aws.networkConnections) {
      if (resources.has(targetResourceId)) connect({ from: targetResourceId, to: runtimeResource.id, relationship: 'networkAccess', output: 'runtime-egress' });
    }
  }

  for (const artifact of runtimeArtifacts) {
    const artifactId = applicationRuntimeArtifactId(artifact);
    if (artifact.role === 'operator') {
      diagnostics.push({
        severity: 'error',
        code: 'AWS_PROVIDER_INCOMPATIBLE',
        message: `AWS execution for CRD operator artifact ${artifactId} requires the durable resource-authority adapter; it cannot be silently run as a Kubernetes operator.`,
        subjectId: artifact.nodeId,
      });
      continue;
    }
    if (!artifact.container) {
      diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: `AWS runtime artifact ${artifactId} has no compiler-owned container recipe.`, subjectId: artifact.nodeId });
      continue;
    }
    const id = `runtime-artifact.${hash(artifactId, 20)}`;
    const placement = runtimeArtifactPlacement(artifact, request.graph);
    const runtimeConfiguration = workloadRuntimeConfiguration(artifact.nodeId, request.graph, resources, request.workspaceRoot);
    const runtimeEndpointBindings = (artifact.runtimeEndpoints ?? []).flatMap((endpoint) => {
      const resourceId = runtimeServiceResourceIds.get(endpoint.nodeId);
      if (!resourceId) {
        diagnostics.push({
          severity: 'error',
          code: 'AWS_RUNTIME_ACCESS_UNRESOLVED',
          message: `AWS runtime artifact ${artifactId} requires endpoint ${endpoint.nodeId}, but no service artifact owns that receiver.`,
          subjectId: artifact.nodeId,
        });
        return [];
      }
      return [{ environmentName: endpoint.environmentName, resourceId }];
    });
    const runtimePhysicalName = name(`${artifact.role}-${hash(artifactId, 10)}`);
    const discoveryNamespaceName = String(resources.get('foundation.discovery')?.configuration.namespaceName ?? 'applik8s.internal');
    const role = runtimeRolesByWorkloadResourceId.get(id);
    const executionRole = executionRolesByWorkloadResourceId.get(id);
    const workloadAccess = runtimeAccess.workloads.find((workload) => workload.aws?.resourceId === id)?.aws;
    const processor = artifact.role === 'processor'
      ? request.graph.nodes.find((node): node is ApplicationProcessorNode => node.id === artifact.nodeId && node.kind === 'processor')
      : undefined;
    const lakehousePublisher = artifact.role === 'lakehouse'
      ? request.graph.nodes.find((node): node is ApplicationLakehousePublicationNode => node.id === artifact.nodeId && node.kind === 'lakehousePublication')
      : undefined;
    const eventLogNodeId = processor?.eventLog?.nodeId ?? lakehousePublisher?.eventLog?.nodeId;
    const stream = eventLogNodeId
      ? [...resources.values()].find(({ service, resourceType, semanticNodeId }) => service === 'kinesis' && resourceType === 'stream' && semanticNodeId === eventLogNodeId)
      : undefined;
    const checkpoint = artifact.role === 'processor' || artifact.role === 'lakehouse' ? resources.get('framework.kinesis-checkpoints') : undefined;
    if (artifact.role === 'processor' && (!processor || !stream || !checkpoint)) {
      diagnostics.push({
        severity: 'error',
        code: 'AWS_RUNTIME_ACCESS_UNRESOLVED',
        message: `AWS processor artifact ${artifactId} requires one exact processor node, Kinesis EventLog, and DynamoDB checkpoint authority.`,
        subjectId: artifact.nodeId,
      });
    }
    if (artifact.role === 'lakehouse' && (!lakehousePublisher || !stream || !checkpoint)) {
      diagnostics.push({
        severity: 'error',
        code: 'AWS_RUNTIME_ACCESS_UNRESOLVED',
        message: `AWS lakehouse publisher artifact ${artifactId} requires one exact publication node, Kinesis EventLog, and DynamoDB checkpoint authority.`,
        subjectId: artifact.nodeId,
      });
    }
    const databaseEnvironmentName = processor ? processorDatabaseEnvironmentName(processor, request.graph) : undefined;
    const databaseEnvironmentNames = [...new Set([
      ...databaseEnvironmentNamesForWorkload(artifact.nodeId, request.graph, request.workspaceRoot),
      ...(runtimeConfiguration.scheduleAccess === true ? ['APPLIK8S_SCHEDULE_DATABASE_URL'] : []),
    ])].sort();
    for (const environmentName of databaseEnvironmentNames) {
      const binding = runtimeBindings.find((candidate) => candidate.environmentName === environmentName);
      if (!binding) {
        diagnostics.push({
          severity: 'error',
          code: 'AWS_RUNTIME_ACCESS_UNRESOLVED',
          message: `AWS runtime artifact ${artifactId} requires database binding ${environmentName}, but no exact RDS authority was planned.`,
          subjectId: artifact.nodeId,
        });
      }
    }
    const desiredCount = runtimeArtifactReplicaCount(artifact.nodeId, request.graph);
    add(resource(id, 'ecs', placement.kind === 'service' ? 'fargate-runtime-service' : 'fargate-worker', runtimePhysicalName, {
      artifactId,
      artifactDigest: artifact.digest,
      artifactSourceDigest: artifact.container.sourceDigest,
      command: [...artifact.container.command],
      desiredCount,
      autoscalingMinCapacity: desiredCount,
      autoscalingMaxCapacity: Math.max(4, desiredCount * 4),
      autoscalingTargetCpuUtilization: 60,
      cluster: 'foundation.compute',
      privateSubnets: ['foundation.subnet.private.1', 'foundation.subnet.private.2'],
      ...(role ? { runtimeRoleResourceId: role.id } : {}),
      ...(executionRole ? { executionRoleResourceId: executionRole.id } : {}),
      ...(runtimeNetwork.workloadSecurityGroups.get(id)
        ? { runtimeAccessSecurityGroupResourceId: runtimeNetwork.workloadSecurityGroups.get(id)! }
        : {}),
      runtimeBindingEnvironmentNames: databaseEnvironmentNames,
      runtimeEndpointBindings,
      ...runtimeConfiguration,
      ...(placement.kind === 'service' ? {
        port: placement.port,
        healthPort: placement.healthPort,
        healthPath: placement.healthPath,
        discoveryNamespaceResourceId: 'foundation.discovery',
        discoveryName: runtimePhysicalName,
        endpoint: `http://${runtimePhysicalName}.${discoveryNamespaceName}:${placement.port}`,
      } : {}),
      ...(stream && checkpoint ? {
        eventTransport: 'kinesis',
        eventStreamResourceId: stream.id,
        checkpointTableResourceId: checkpoint.id,
        consumer: processor?.name ?? lakehousePublisher?.name ?? artifactId,
        processorConcurrency: processor ? numericDeploymentValue(processor.deployment.concurrency, 1) : 1,
        ...(databaseEnvironmentName ? { databaseEnvironmentName } : {}),
      } : {}),
    }, artifact.nodeId, 'private', placement.kind === 'service' ? ['serviceArn', 'endpoint'] : ['serviceArn']));
    connect({ from: 'foundation.registry', to: id, relationship: 'requiresReady' });
    connect({ from: 'foundation.compute', to: id, relationship: 'requiresReady' });
    connect({ from: 'foundation.logs', to: id, relationship: 'requiresReady' });
    for (const targetResourceId of workloadAccess?.networkConnections ?? []) {
      if (!resources.has(targetResourceId)) {
        diagnostics.push({ severity: 'error', code: 'AWS_RUNTIME_ACCESS_UNRESOLVED', message: `AWS workload ${id} requires unresolved network target ${targetResourceId}.`, subjectId: artifact.nodeId });
      } else {
        connect({ from: targetResourceId, to: id, relationship: 'networkAccess', output: 'runtime-egress' });
      }
    }
    if (placement.kind === 'service') connect({ from: 'foundation.discovery', to: id, relationship: 'requiresReady' });
    for (const endpoint of runtimeEndpointBindings) {
      if (String(endpoint.resourceId) !== id) connect({ from: String(endpoint.resourceId), to: id, relationship: 'requiresReady' });
    }
    if (role) connect({ from: role.id, to: id, relationship: 'assumesRole' });
    if (executionRole) connect({ from: executionRole.id, to: id, relationship: 'assumesRole', output: 'ecs-execution' });
    if (stream) connect({ from: stream.id, to: id, relationship: 'requiresReady' });
    if (checkpoint) connect({ from: checkpoint.id, to: id, relationship: 'requiresReady' });
  }

  for (const host of applicationHosts) {
    const id = `application-host.${hash(host.id, 16)}`;
    const runtimeConfiguration = {
      ...workloadRuntimeConfiguration(host.id, request.graph, resources, request.workspaceRoot),
      // The generated ApplicationHost owns schedule admission and occurrence
      // execution; schedule nodes do not become an implicit second worker.
      scheduleAccess: schedules.length > 0,
    } satisfies DeploymentJsonObject;
    const runtimeEndpointBindings = runtimeArtifacts.flatMap((artifact) => {
      const node = request.graph.nodes.find(({ id: nodeId }) => nodeId === artifact.nodeId);
      const exposed = artifact.role === 'agent'
        || artifact.role === 'http'
        || (artifact.role === 'reactive' && node?.kind === 'gateway');
      const resourceId = exposed ? runtimeServiceResourceIds.get(artifact.nodeId) : undefined;
      return resourceId
        ? [{ environmentName: applicationRuntimeEndpointEnvironmentName(artifact.nodeId), resourceId }]
        : [];
    });
    const databaseEnvironmentNames = [...new Set([
      ...databaseEnvironmentNamesForWorkload(host.id, request.graph, request.workspaceRoot),
      ...(runtimeConfiguration.scheduleAccess === true ? ['APPLIK8S_SCHEDULE_DATABASE_URL'] : []),
    ])].sort();
    for (const environmentName of databaseEnvironmentNames) {
      const binding = runtimeBindings.find((candidate) => candidate.environmentName === environmentName);
      if (!binding) throw new Error(`AWS application host ${host.id} requires database binding ${environmentName}, but no exact RDS authority was planned.`);
    }
    const role = runtimeRolesByWorkloadResourceId.get(id);
    const executionRole = executionRolesByWorkloadResourceId.get(id);
    const workloadAccess = runtimeAccess.workloads.find((workload) => workload.aws?.resourceId === id)?.aws;
    add(resource(id, 'ecs', 'fargate-service', name(`service-${hash(host.id, 10)}`), {
      artifactRepository: 'foundation.registry', cluster: 'foundation.compute',
      desiredCount: host.replicas,
      autoscalingMinCapacity: host.replicas,
      autoscalingMaxCapacity: Math.max(4, host.replicas * 4),
      autoscalingTargetCpuUtilization: 60,
      port: host.port, healthPath: '/-/healthz', deploymentCircuitBreaker: true,
      privateSubnets: ['foundation.subnet.private.1', 'foundation.subnet.private.2'],
      ...(role ? { runtimeRoleResourceId: role.id } : {}),
      ...(executionRole ? { executionRoleResourceId: executionRole.id } : {}),
      ...(runtimeNetwork.workloadSecurityGroups.get(id)
        ? { runtimeAccessSecurityGroupResourceId: runtimeNetwork.workloadSecurityGroups.get(id)! }
        : {}),
      runtimeBindingEnvironmentNames: databaseEnvironmentNames,
      runtimeEndpointBindings,
      ...runtimeConfiguration,
    }, host.id, 'private', ['serviceArn', 'endpoint']));
    connect({ from: 'foundation.registry', to: id, relationship: 'requiresReady' });
    connect({ from: 'foundation.compute', to: id, relationship: 'requiresReady' });
    connect({ from: 'foundation.logs', to: id, relationship: 'requiresReady' });
    for (const targetResourceId of workloadAccess?.networkConnections ?? []) {
      if (!resources.has(targetResourceId)) {
        diagnostics.push({ severity: 'error', code: 'AWS_RUNTIME_ACCESS_UNRESOLVED', message: `AWS application host ${host.id} requires unresolved network target ${targetResourceId}.`, subjectId: host.id });
      } else {
        connect({ from: targetResourceId, to: id, relationship: 'networkAccess', output: 'runtime-egress' });
      }
    }
    if (role) connect({ from: role.id, to: id, relationship: 'assumesRole' });
    if (executionRole) connect({ from: executionRole.id, to: id, relationship: 'assumesRole', output: 'ecs-execution' });
    for (const endpoint of runtimeEndpointBindings) connect({ from: String(endpoint.resourceId), to: id, relationship: 'requiresReady' });
  }

  const actorFleet = [...resources.values()].find(({ service, resourceType }) => service === 'ecs' && resourceType === 'celld-fleet');
  const applicationHost = [...resources.values()].find(({ service, resourceType }) => service === 'ecs' && resourceType === 'fargate-service');
  if (actorFleet) {
    if (!applicationHost) {
      diagnostics.push({ severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', message: 'celld actor alarms require a generated ApplicationHost callback endpoint.', subjectId: actorFleet.id });
    } else {
      resources.set(actorFleet.id, {
        ...actorFleet,
        configuration: {
          ...actorFleet.configuration,
          applicationEndpoint: `http://${boundedAwsName(applicationHost.physicalName, 63)}.${String(actorFleet.configuration.internalDnsName)}:${numberValue(applicationHost.configuration.port) ?? 3000}`,
          publicConnectionGateway: publishesRealtimeActors,
        },
      });
      connect({ from: actorFleet.id, to: applicationHost.id, relationship: 'networkAccess' });
    }
    if (publishesRealtimeActors && !selectedProviders.some(({ interface: providerInterface }) => providerInterface === 'HttpExposure')) {
      diagnostics.push({
        severity: 'error',
        code: 'AWS_CONFIGURATION_UNRESOLVED',
        message: 'Exported realtime actors require an HttpExposure provider so signed WebSocket admission can be routed through the application origin.',
        subjectId: actorFleet.id,
      });
    }
  }

  for (const finding of validateAwsRuntimeAccessParity(runtimeAccess, [...resources.values()], edges)) {
    diagnostics.push({ severity: 'error', code: 'AWS_RUNTIME_ACCESS_UNRESOLVED', message: `[${finding.code}] ${finding.message}`, subjectId: finding.workloadIdentity });
  }
  const plan = normalizeApplicationAwsDeploymentPlan({
    apiVersion: 'applik8s.awsPlan/v1alpha1', application: request.graph.metadata.name,
    environment: request.environment, region: request.region, accountId: request.accountId,
    lifecycleAuthority: 'alchemy', runtimeAccess, resources: [...resources.values()], runtimeArtifacts, runtimeBindings, edges, diagnostics,
    digest: `sha256:${'0'.repeat(64)}`,
  });
  const validation = validateApplicationAwsDeploymentPlan(plan);
  if (validation.some(({ severity }) => severity === 'error') && diagnostics.length === 0) throw new Error(validation.map(({ code, message }) => `${code}: ${message}`).join('\n'));
  return plan;
}

function runtimeArtifactPlacement(
  artifact: ApplicationRuntimeArtifact,
  graph: ApplicationGraph,
): { readonly kind: 'worker' } | { readonly kind: 'service'; readonly port: number; readonly healthPort: number; readonly healthPath: string } {
  const node = graph.nodes.find(({ id }) => id === artifact.nodeId);
  if (artifact.role === 'agent' && node?.kind === 'aiAgent') return { kind: 'service', port: node.deployment.port, healthPort: node.deployment.healthPort, healthPath: '/readyz' };
  if (artifact.role === 'http' && node?.kind === 'server') {
    const port = node.deployment?.port ?? 8080;
    return { kind: 'service', port, healthPort: port, healthPath: '/readyz' };
  }
  if (artifact.role === 'mcp' && node?.kind === 'mcpServer') return { kind: 'service', port: 8080, healthPort: 8080, healthPath: '/ready' };
  if (artifact.role === 'reactive' && node?.kind === 'gateway') {
    const port = node.deployment?.port ?? 8080;
    return { kind: 'service', port, healthPort: port, healthPath: '/ready' };
  }
  if (artifact.role === 'workflow' && node?.kind === 'workflowWorker') {
    return { kind: 'service', port: node.deployment.healthPort + 1, healthPort: node.deployment.healthPort, healthPath: '/ready' };
  }
  return { kind: 'worker' };
}

function portableAwsRuntimeArtifact(artifact: ApplicationRuntimeArtifact, workspaceRoot?: string): ApplicationRuntimeArtifact {
  if (!workspaceRoot) return artifact;
  return {
    ...artifact,
    source: portablePath(artifact.source, workspaceRoot),
    ...(artifact.manifest ? { manifest: portablePath(artifact.manifest, workspaceRoot) } : {}),
    ...(artifact.container ? {
      container: {
        ...artifact.container,
        contextPath: portablePath(artifact.container.contextPath, workspaceRoot),
        dockerfilePath: portablePath(artifact.container.dockerfilePath, workspaceRoot),
        entrypoint: portablePath(artifact.container.entrypoint, workspaceRoot),
      },
    } : {}),
  };
}

function portablePath(path: string, workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/u, '');
  return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : path;
}

function runtimeArtifactReplicaCount(nodeId: string, graph: ApplicationGraph): number {
  const node = graph.nodes.find(({ id }) => id === nodeId);
  if (!node || !('deployment' in node) || !node.deployment || typeof node.deployment !== 'object') return 1;
  const replicas = Reflect.get(node.deployment, 'replicas');
  return typeof replicas === 'number' && Number.isInteger(replicas) && replicas > 0 ? replicas : 1;
}

function processorDatabaseEnvironmentName(
  processor: Extract<ApplicationGraphNode, { kind: 'processor' }>,
  graph: ApplicationGraph,
): string {
  const environments = new Set(processor.handlers.flatMap(({ nodeId }) => {
    const handler = graph.nodes.find((node): node is ApplicationCommandHandlerNode => node.id === nodeId && node.kind === 'commandHandler');
    const model = handler ? graph.nodes.find((node): node is ApplicationModelNode => node.id === handler.model.nodeId && node.kind === 'model') : undefined;
    return model?.runtime?.connectionEnvName ? [model.runtime.connectionEnvName] : [];
  }));
  if (environments.size !== 1) throw new Error(`AWS processor ${processor.id} requires exactly one PostgreSQL runtime environment; found ${environments.size}.`);
  return [...environments][0]!;
}

function numericDeploymentValue(value: number | `\${${string}}`, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function databaseEnvironmentNamesForWorkload(nodeId: string, graph: ApplicationGraph, workspaceRoot?: string): readonly string[] {
  const reachable = workloadNodeIds(nodeId, graph, workspaceRoot);
  const root = graph.nodes.find(({ id }) => id === nodeId);
  if (root?.kind === 'server') {
    for (const route of root.routes) {
      for (const binding of route.functionNative?.operationBindings ?? []) reachable.add(binding.handler.nodeId);
      for (const model of route.functionNative?.transaction?.models ?? []) reachable.add(model.nodeId);
    }
  }
  const foundation = deriveApplicationGraphFoundation(graph, workspaceRoot ? { workspaceRoot } : {});
  for (const requirement of foundation.runtimeAccess) {
    if (reachable.has(requirement.consumer.nodeId)) reachable.add(requirement.target.capabilityId);
  }
  const environments = new Set<string>();
  const visit = (id: string): void => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    if (node.kind === 'model' && node.runtime?.provider === 'postgres') environments.add(node.runtime.connectionEnvName);
    if (node.kind === 'commandHandler') visit(node.model.nodeId);
    if (node.kind === 'command') {
      for (const handler of graph.nodes.filter((candidate): candidate is ApplicationCommandHandlerNode => candidate.kind === 'commandHandler' && candidate.command.nodeId === node.id)) visit(handler.model.nodeId);
    }
    if (node.kind === 'query') for (const read of node.reads) visit(read.model.nodeId);
    if (node.kind === 'stream' && node.database?.connectionEnvName) environments.add(node.database.connectionEnvName);
  };
  for (const id of reachable) visit(id);
  return [...environments].sort();
}

function workloadNodeIds(nodeId: string, graph: ApplicationGraph, workspaceRoot?: string): Set<string> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  if (!nodes.has(nodeId)) return reachable;
  reachable.add(nodeId);
  const pending = [nodeId];
  while (pending.length > 0) {
    const source = pending.pop()!;
    for (const edge of graph.edges) {
      if (edge.from.nodeId !== source || reachable.has(edge.to.nodeId)) continue;
      const target = nodes.get(edge.to.nodeId);
      if (!target || target.kind === 'provider') continue;
      reachable.add(target.id);
      pending.push(target.id);
    }
    const sourceNode = nodes.get(source);
    for (const referencedId of sourceNode ? workloadSemanticDependencies(sourceNode) : []) {
      const target = nodes.get(referencedId);
      if (!target || target.kind === 'provider' || reachable.has(target.id)) continue;
      reachable.add(target.id);
      pending.push(target.id);
    }
  }
  const root = nodes.get(nodeId);
  if (root?.kind === 'server') {
    for (const route of root.routes) {
      for (const binding of route.functionNative?.operationBindings ?? []) reachable.add(binding.handler.nodeId);
      for (const model of route.functionNative?.transaction?.models ?? []) reachable.add(model.nodeId);
    }
  }
  const foundation = deriveApplicationGraphFoundation(graph, workspaceRoot ? { workspaceRoot } : {});
  for (const requirement of foundation.runtimeAccess) {
    if (reachable.has(requirement.consumer.nodeId)) reachable.add(requirement.target.capabilityId);
  }
  return reachable;
}

function workloadSemanticDependencies(node: ApplicationGraphNode): readonly string[] {
  switch (node.kind) {
    case 'processor': return node.handlers.map(({ nodeId }) => nodeId);
    case 'commandHandler': return [node.model.nodeId, node.command.nodeId, ...node.transaction.models.map(({ nodeId }) => nodeId), ...node.transaction.history.map(({ nodeId }) => nodeId), ...node.transaction.outbox.map(({ nodeId }) => nodeId)];
    case 'query': return node.reads.map(({ model }) => model.nodeId);
    case 'gateway': return [...node.queries.map(({ nodeId }) => nodeId), ...node.commands.flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...node.subscriptions.map(({ nodeId }) => nodeId)];
    case 'workflowWorker': return node.handlers.map(({ nodeId }) => nodeId);
    case 'workflowHandler': return [node.workflow.nodeId, ...node.tasks.map(({ nodeId }) => nodeId), ...node.childWorkflows.map(({ nodeId }) => nodeId)];
    case 'taskHandler': return [node.task.nodeId, ...(node.operations ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queries ?? []).map(({ query }) => query.nodeId), ...(node.projections ?? []).flatMap(({ projection, artifacts }) => [projection.nodeId, artifacts.nodeId]), ...(node.objects ?? []).map(({ store }) => store.nodeId), ...(node.actors ?? []).map(({ actor }) => actor.nodeId)];
    case 'aiAgent': return [...node.tools.flatMap(({ graphNode }) => graphNode ? [graphNode.nodeId] : []), ...(node.operations ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queries ?? []).map(({ query }) => query.nodeId)];
    case 'streamProcessor': return [node.source.nodeId, ...(node.functionNativeTransaction?.models ?? []).map(({ nodeId }) => nodeId), ...(node.operationBindings ?? []).flatMap(({ command, handler }) => [command.nodeId, handler.nodeId]), ...(node.queryBindings ?? []).map(({ query }) => query.nodeId), ...(node.schedules ?? []).map(({ target }) => target.nodeId), ...(node.tasks ?? []).map(({ target }) => target.nodeId)];
    case 'projection': return [node.source.nodeId, ...(node.online?.rebuild.source ? [node.online.rebuild.source.nodeId] : [])];
    case 'subscription': return [node.source.nodeId];
    default: return [];
  }
}

function providerIdsForWorkload(nodeId: string, graph: ApplicationGraph, workspaceRoot?: string): Set<string> {
  const reachable = workloadNodeIds(nodeId, graph, workspaceRoot);
  const providerIds = new Set(graph.nodes.filter(({ kind }) => kind === 'provider').map(({ id }) => id));
  const selected = new Set<string>();
  for (const edge of graph.edges) {
    if (reachable.has(edge.from.nodeId) && providerIds.has(edge.to.nodeId)) selected.add(edge.to.nodeId);
    if (reachable.has(edge.to.nodeId) && providerIds.has(edge.from.nodeId)) selected.add(edge.from.nodeId);
  }
  for (const requirement of graph.providerRequirements) {
    if (reachable.has(requirement.consumer.nodeId) && requirement.provider?.nodeId) selected.add(requirement.provider.nodeId);
  }
  for (const id of reachable) {
    for (const providerId of applicationWorkloadProviderNodeIds(graph.nodes.find((node) => node.id === id))) {
      if (providerIds.has(providerId)) selected.add(providerId);
    }
  }
  return selected;
}

function workloadRuntimeConfiguration(
  nodeId: string,
  graph: ApplicationGraph,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
  workspaceRoot?: string,
): DeploymentJsonObject {
  const reachable = workloadNodeIds(nodeId, graph, workspaceRoot);
  const providerIds = providerIdsForWorkload(nodeId, graph, workspaceRoot);
  const exactResources = [...resources.values()].filter(({ semanticNodeId }) => semanticNodeId && providerIds.has(semanticNodeId));
  const resourceIds = (predicate: (resource: ApplicationAwsPlanResource) => boolean): string[] => exactResources.filter(predicate).map(({ id }) => id).sort();
  const eventStreamResourceIds = resourceIds(({ service, resourceType }) => service === 'kinesis' && resourceType === 'stream');
  const actorRuntimeResourceIds = resourceIds(({ service, resourceType }) => service === 'ecs' && resourceType === 'celld-fleet');
  const lakehouseResourceIds = resourceIds(({ service, resourceType }) => (service === 's3' && resourceType === 'lakehouse-dataset') || service === 'athena' || service === 'glue');
  const observabilityResourceIds = resourceIds(({ service, resourceType }) => service === 'cloudwatch' && resourceType === 'otel-collector');
  const workflowEngineResourceIds = resourceIds(({ service, resourceType }) => service === 'ecs' && resourceType === 'hatchet-service');
  const objectStorageBindings = workloadObjectStorageBindings(reachable, graph, resources);
  const foundation = deriveApplicationGraphFoundation(graph, workspaceRoot ? { workspaceRoot } : {});
  const runtimeSecretResourceIds = [...new Set(foundation.runtimeAccess.flatMap((requirement) => {
    if (!reachable.has(requirement.consumer.nodeId) || requirement.target.operation !== 'secret.read' || requirement.target.scope.kind !== 'resource') return [];
    return [`runtime-secret.${hash(requirement.target.scope.resourceId, 16)}`];
  }))].filter((id) => resources.has(id)).sort();
  return {
    runtimePublicOutputResourceIds: exactResources.map(({ id }) => id).sort(),
    eventStreamResourceIds,
    actorRuntimeResourceIds,
    lakehouseResourceIds,
    observabilityResourceIds,
    workflowEngineResourceIds,
    runtimeSecretResourceIds,
    objectStorageBindings,
    scheduleAccess: [...reachable].some((id) => graph.nodes.some((node) => node.id === id && node.kind === 'schedule')),
  };
}

function workloadObjectStorageBindings(
  reachable: ReadonlySet<string>,
  graph: ApplicationGraph,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
): readonly DeploymentJsonObject[] {
  const bindings = new Map<string, string>();
  const resolveStore = (storeNodeId: string, purpose: 'task' | 'rebuild'): void => {
    const store = graph.nodes.find((node) => node.id === storeNodeId);
    if (!store || store.kind !== 'objectStore') throw new Error(`AWS ${purpose} object binding ${storeNodeId} is not an object store.`);
    const resource = [...resources.values()].find(({ semanticNodeId, service, resourceType }) =>
      semanticNodeId === store.provider.nodeId && service === 's3' && resourceType === 'bucket');
    if (!resource) throw new Error(`AWS ${purpose} object binding ${storeNodeId} has no exact S3 provider resource.`);
    const existing = bindings.get(purpose);
    if (existing && existing !== resource.id) throw new Error(`AWS workload requires multiple ${purpose} object stores; the generated runtime exposes one exact ${purpose} authority.`);
    bindings.set(purpose, resource.id);
  };
  for (const nodeId of reachable) {
    const node = graph.nodes.find(({ id }) => id === nodeId);
    if (node?.kind !== 'taskHandler') continue;
    for (const object of node.objects ?? []) resolveStore(object.store.nodeId, 'task');
    for (const projection of node.projections ?? []) resolveStore(projection.artifacts.nodeId, 'rebuild');
  }
  return [...bindings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([purpose, resourceId]) => ({ purpose, resourceId }));
}

function lowerAwsScheduleFoundation(
  request: CompileApplicationAwsDeploymentPlanRequest,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
  add: (entry: ApplicationAwsPlanResource) => void,
  connect: (edge: ApplicationAwsPlanEdge) => void,
  name: (suffix: string, limit?: number) => string,
  schedules: readonly Extract<ApplicationGraphNode, { kind: 'schedule' }>[],
): void {
  if (schedules.length === 0) return;
  const existingPostgres = [...resources.values()].find(({ service, resourceType }) => service === 'rds' && resourceType === 'postgresql-instance');
  if (!existingPostgres) {
    add(resource('scheduler.receipts', 'rds', 'postgresql-instance', name('schedule-receipts'), {
      engineVersion: '17', storageGiB: 20, multiAz: request.environment === 'production', encrypted: true,
      deletionProtection: request.environment === 'production',
    }, undefined, 'private', ['endpoint', 'port', 'secretArn']));
    connect({ from: 'foundation.subnet.private.1', to: 'scheduler.receipts', relationship: 'networkAccess' });
    connect({ from: 'foundation.subnet.private.2', to: 'scheduler.receipts', relationship: 'networkAccess' });
    connect({ from: 'foundation.security-group.application', to: 'scheduler.receipts', relationship: 'networkAccess' });
  }
  add(resource('scheduler.group', 'eventbridge-scheduler', 'schedule-group', name('schedules'), {}, undefined, 'none', ['groupArn']));
  add(resource('scheduler.admission', 'sqs', 'queue', name('schedule-admission'), { visibilityTimeoutSeconds: 300, receiveWaitTimeSeconds: 20, encrypted: true }, undefined, 'private', ['queueArn', 'queueUrl']));
  add(resource('scheduler.dead-letter', 'sqs', 'queue', name('schedule-dlq'), { encrypted: true, retentionSeconds: 1_209_600 }, undefined, 'private', ['queueArn', 'queueUrl']));
  add(resource('scheduler.execution-role', 'iam', 'role', name('scheduler-execution'), {
    assumeService: 'scheduler.amazonaws.com',
    statements: [{
      effect: 'Allow', actions: ['sqs:SendMessage'], resources: [
        `arn:aws:sqs:${request.region}:${request.accountId}:${resources.get('scheduler.admission')!.physicalName}`,
        `arn:aws:sqs:${request.region}:${request.accountId}:${resources.get('scheduler.dead-letter')!.physicalName}`,
      ],
    }],
  }, undefined, 'control-plane', ['roleArn']));
  connect({ from: 'scheduler.dead-letter', to: 'scheduler.admission', relationship: 'requiresReady' });
  connect({ from: 'scheduler.admission', to: 'scheduler.execution-role', relationship: 'requiresReady' });
  connect({ from: 'scheduler.dead-letter', to: 'scheduler.execution-role', relationship: 'requiresReady' });
  for (const schedule of schedules.filter(({ definition }) => definition.configuration === 'fixed')) {
    const id = `schedule.${hash(schedule.definition.id, 20)}`;
    add(resource(id, 'eventbridge-scheduler', 'schedule', name(`schedule-${hash(schedule.definition.id, 10)}`), {
      definitionId: schedule.definition.id,
      overlap: schedule.definition.overlap,
      expression: awsScheduleExpression(schedule.definition),
      timezone: schedule.definition.timezone,
      misfires: schedule.definition.misfires,
      maximumLatenessSeconds: schedule.definition.maximumLatenessSeconds,
      ...(schedule.definition.maximumCatchUp !== undefined
        ? { maximumCatchUp: schedule.definition.maximumCatchUp }
        : {}),
      maximumRetryAttempts: Math.min(185, Math.max(0, schedule.definition.retry.maxAttempts - 1)),
      maximumEventAgeSeconds: Math.min(86_400, Math.max(60, schedule.definition.retry.maximumAgeSeconds)),
      targetQueue: 'scheduler.admission', deadLetterQueue: 'scheduler.dead-letter',
    }, schedule.id, 'none', ['scheduleArn']));
    connect({ from: 'scheduler.group', to: id, relationship: 'requiresReady' });
    connect({ from: 'scheduler.admission', to: id, relationship: 'requiresOutput', output: 'queueArn' });
    connect({ from: 'scheduler.dead-letter', to: id, relationship: 'requiresOutput', output: 'queueArn' });
  }
}

function awsRuntimeAccessWorkloadPlacements(
  request: CompileApplicationAwsDeploymentPlanRequest,
  runtimeArtifacts: readonly ApplicationRuntimeArtifact[],
  applicationHostNodeIds: readonly string[],
  scheduleNodeIds: readonly string[],
  name: (suffix: string, limit?: number) => string,
): readonly ApplicationRuntimeAccessWorkloadPlacement[] {
  const artifactPlacements = runtimeArtifacts.flatMap((artifact): readonly ApplicationRuntimeAccessWorkloadPlacement[] => {
    if (artifact.role === 'operator') return [];
    const artifactId = applicationRuntimeArtifactId(artifact);
    const resourceId = `runtime-artifact.${hash(artifactId, 20)}`;
    const executionNodeIds = artifact.executionNodeIds?.length
      ? [...artifact.executionNodeIds].sort()
      : [...workloadNodeIds(artifact.nodeId, request.graph, request.workspaceRoot)].sort();
    return [{
      workloadIdentity: `aws:ecs:${resourceId}`,
      artifactIds: [artifactId],
      executionNodeIds,
      aws: {
        resourceId,
        roleName: name(`runtime-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
        executionRoleName: name(`bootstrap-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
      },
    }];
  });
  const hostPlacements = applicationHostNodeIds.map((nodeId): ApplicationRuntimeAccessWorkloadPlacement => {
    const resourceId = `application-host.${hash(nodeId, 16)}`;
    const executionNodeIds = new Set(workloadNodeIds(nodeId, request.graph, request.workspaceRoot));
    for (const scheduleNodeId of scheduleNodeIds) executionNodeIds.add(scheduleNodeId);
    return {
      workloadIdentity: `aws:ecs:${resourceId}`,
      artifactIds: ['application-host'],
      executionNodeIds: [...executionNodeIds].sort(),
      aws: {
        resourceId,
        roleName: name(`runtime-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
        executionRoleName: name(`bootstrap-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
      },
    };
  });
  const actorPlacements = request.graph.nodes
    .filter((node): node is Extract<ApplicationGraphNode, { kind: 'actor' }> => node.kind === 'actor')
    .reduce((placements, actor) => {
      const resourceId = `provider.${actor.runtime.nodeId}`;
      const existing = placements.get(resourceId) ?? new Set<string>();
      existing.add(actor.id);
      placements.set(resourceId, existing);
      return placements;
    }, new Map<string, Set<string>>());
  const providerPlacements = [...actorPlacements].map(([resourceId, executionNodeIds]): ApplicationRuntimeAccessWorkloadPlacement => ({
    workloadIdentity: `aws:ecs:${resourceId}`,
    artifactIds: [`provider-runtime:${resourceId}`],
    executionNodeIds: [...executionNodeIds].sort(),
    aws: {
      resourceId,
      roleName: name(`runtime-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
      executionRoleName: name(`bootstrap-${hash(`aws:ecs:${resourceId}`, 12)}`, 64),
    },
  }));
  return [...artifactPlacements, ...hostPlacements, ...providerPlacements].sort((left, right) => left.workloadIdentity.localeCompare(right.workloadIdentity));
}

function awsRuntimeBindings(
  graph: ApplicationGraph,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
): ApplicationAwsDeploymentPlan['runtimeBindings'] {
  const bindings = new Map<string, ApplicationAwsDeploymentPlan['runtimeBindings'][number]>();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' || node.runtime?.provider !== 'postgres') continue;
    const binding = {
      id: `postgres-url.${hash(node.runtime.connectionEnvName, 20)}`,
      kind: 'postgresUrl' as const,
      environmentName: node.runtime.connectionEnvName,
      resourceId: `provider.${node.database.nodeId}`,
      database: node.runtime.database,
      sensitivity: 'sensitive' as const,
    };
    const previous = bindings.get(binding.environmentName);
    if (previous && stableJson(previous) !== stableJson(binding)) throw new Error(`Database environment ${binding.environmentName} resolves to multiple AWS runtime authorities.`);
    bindings.set(binding.environmentName, binding);
  }
  if (graph.nodes.some(({ kind }) => kind === 'schedule')) {
    const resourceId = [...resources.values()].find(({ service, resourceType }) => service === 'rds' && resourceType === 'postgresql-instance')?.id;
    if (!resourceId) throw new Error('AWS Scheduler requires a PostgreSQL occurrence authority, but no RDS resource was planned.');
    bindings.set('APPLIK8S_SCHEDULE_DATABASE_URL', {
      id: 'postgres-url.schedule-receipts',
      kind: 'postgresUrl',
      environmentName: 'APPLIK8S_SCHEDULE_DATABASE_URL',
      resourceId,
      database: 'postgres',
      sensitivity: 'sensitive',
    });
  }
  return [...bindings.values()];
}

function lowerAwsExposures(
  request: CompileApplicationAwsDeploymentPlanRequest,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
  diagnostics: ApplicationAwsDeploymentPlan['diagnostics'][number][],
  add: (entry: ApplicationAwsPlanResource) => void,
  connect: (edge: ApplicationAwsPlanEdge) => void,
  name: (suffix: string, limit?: number) => string,
): void {
  const loadBalancer = resources.get('provider.provider.HttpExposure')
    ?? [...resources.values()].find(({ service, resourceType }) => service === 'elastic-load-balancing' && resourceType === 'application-load-balancer');
  for (const exposure of request.graph.nodes.filter((node) => node.kind === 'exposure')) {
    if (exposure.enabled === false) continue;
    if (!loadBalancer) {
      diagnostics.push({
        severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: exposure.id,
        message: `Exposure ${exposure.name} requires an AWS HttpExposure load balancer.`,
      });
      continue;
    }
    const hostnames = [...new Set(exposure.hostnames.map(normalizeHostname))].filter(Boolean);
    if (hostnames.length === 0 || hostnames.length !== exposure.hostnames.length) {
      diagnostics.push({
        severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: exposure.id,
        message: `Exposure ${exposure.name} must contain concrete DNS hostnames for AWS lowering.`,
      });
      continue;
    }
    const zones = hostnames.map((hostname) => resolveAwsHostedZone(hostname, request.hostedZones));
    const missingZones = hostnames.filter((_, index) => !zones[index]);
    const needsHostedZone = exposure.tlsIntent.mode === 'managed' || exposure.dnsIntent?.mode === 'managed';
    if (needsHostedZone && missingZones.length > 0) {
      diagnostics.push({
        severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: exposure.id,
        message: `Exposure ${exposure.name} requires an AWS hosted-zone binding for ${missingZones.join(', ')}. Supply --hosted-zone <suffix=zone-id> or APPLIK8S_AWS_HOSTED_ZONES.`,
      });
      continue;
    }
    if (exposure.tlsIntent.mode === 'external') {
      diagnostics.push({
        severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: exposure.id,
        message: `Exposure ${exposure.name} uses a Kubernetes TLS Secret. The AWS target requires managed ACM TLS; select tls: { mode: "managed" } or a future explicit external ACM binding.`,
      });
      continue;
    }
    if (request.environment === 'production' && exposure.tlsIntent.mode !== 'managed') {
      diagnostics.push({
        severity: 'error', code: 'AWS_CONFIGURATION_UNRESOLVED', subjectId: exposure.id,
        message: `Production exposure ${exposure.name} must use managed TLS.`,
      });
      continue;
    }
    if (exposure.tlsIntent.mode === 'managed') {
      const certificateId = `exposure.${exposure.id}.certificate`;
      add(resource(certificateId, 'acm', 'certificate', name(`certificate-${hash(exposure.id, 8)}`), {
        validation: 'DNS',
        domainName: hostnames[0]!,
        subjectAlternativeNames: hostnames.slice(1),
        domainValidationOptions: hostnames.map((domainName, index) => ({ domainName, hostedZoneId: zones[index]! })),
      }, exposure.id, 'public', ['certificateArn', 'validationRecords']));
      connect({ from: certificateId, to: loadBalancer.id, relationship: 'requiresReady' });
    }
    if (exposure.dnsIntent?.mode === 'managed') {
      for (const [index, hostname] of hostnames.entries()) {
        const recordId = `exposure.${exposure.id}.dns.${hash(hostname, 12)}`;
        add(resource(recordId, 'route53', 'record-publication', name(`dns-${hash(`${exposure.id}:${hostname}`, 8)}`), {
          recordName: hostname,
          hostedZoneId: zones[index]!,
          recordType: 'A',
          alias: true,
          loadBalancerResourceId: loadBalancer.id,
          ...(exposure.dnsIntent.ttlSeconds === undefined ? {} : { ttlSeconds: exposure.dnsIntent.ttlSeconds }),
        }, exposure.id, 'public', ['fqdn']));
        connect({ from: loadBalancer.id, to: recordId, relationship: 'requiresOutput', output: 'dnsName' });
      }
    }
  }
}

function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/u, '');
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname)
    ? hostname
    : '';
}

function resolveAwsHostedZone(hostname: string, hostedZones: Readonly<Record<string, string>> | undefined): string | undefined {
  const matches = Object.entries(hostedZones ?? {})
    .map(([suffix, zoneId]) => [normalizeHostname(suffix), zoneId.trim()] as const)
    .filter(([suffix, zoneId]) => suffix && /^Z[A-Z0-9]+$/u.test(zoneId) && (hostname === suffix || hostname.endsWith(`.${suffix}`)))
    .sort(([left], [right]) => right.length - left.length);
  return matches[0]?.[1];
}

function awsProviderResources(provider: ApplicationProviderNode, request: CompileApplicationAwsDeploymentPlanRequest, name: (suffix: string, limit?: number) => string): readonly ApplicationAwsPlanResource[] | undefined {
  const config = providerConfig(provider);
  const semantic = provider.id;
  if (provider.interface === 'TransactionalDatabase' && ['postgres', 'rds-postgresql'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 'rds', 'postgresql-instance', name(`postgres-${hash(semantic, 8)}`), { engineVersion: stringValue(config.engineVersion) ?? '17', port: 5432, storageGiB: numberValue(config.storageGiB) ?? 20, multiAz: request.environment === 'production', encrypted: true, deletionProtection: request.environment === 'production' }, semantic, 'private', ['endpoint', 'port', 'secretArn'])];
  if (provider.interface === 'AnalyticalDatabase' && provider.implementation === 'postgres-analytics') return [];
  if (provider.interface === 'IndexStore' && ['valkey', 'elasticache-valkey'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 'elasticache', 'valkey-replication-group', name(`valkey-${hash(semantic, 8)}`), { engine: 'valkey', port: 6379, encryptedAtRest: true, encryptedInTransit: true, replicas: request.environment === 'production' ? 2 : 1 }, semantic, 'private', ['endpoint', 'port', 'secretArn'])];
  if (provider.interface === 'ObjectStorage' && ['s3', 'kubernetes-configmap-objects'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 's3', 'bucket', bucketName(request, semantic), { versioning: true, publicAccessBlock: true, encryption: 'AES256', forceDestroy: false, prefix: stringValue(config.prefix) ?? '' }, semantic, 'none', ['bucketName', 'bucketArn'])];
  if (provider.interface === 'Queue' && ['sqs', 'kubernetes-configmap-queue'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 'sqs', 'queue', name(`queue-${hash(semantic, 8)}`), { encrypted: true, visibilityTimeoutSeconds: 300 }, semantic, 'private', ['queueArn', 'queueUrl'])];
  if ((provider.interface === 'EventSource' || provider.interface === 'EventLog') && ['kinesis', 'kubernetes-watch', 'nats-jetstream'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 'kinesis', 'stream', name(`stream-${hash(semantic, 8)}`), { mode: 'ON_DEMAND', retentionHours: 24, encrypted: true }, semantic, 'private', ['streamArn', 'streamName'])];
  if (provider.interface === 'Scheduler' && ['target-selected', 'eventbridge-scheduler'].includes(provider.implementation)) return [];
  if (provider.interface === 'Observability' && ['cloudwatch', 'local-otel', 'clickstack'].includes(provider.implementation)) return [resource(`provider.${semantic}`, 'cloudwatch', 'otel-collector', name(`telemetry-${hash(semantic, 8)}`), { logGroup: 'foundation.logs', traces: true, metrics: true, policy: deploymentJson(config.policy ?? {}) }, semantic, 'private', ['logGroupArn', 'traceDestinationArn'])];
  if (provider.interface === 'LakehouseDataset' && ['s3-dataset', 'duckdb-dataset'].includes(provider.implementation)) {
    const catalogId = `provider.${semantic}.catalog`;
    const qualification = providerQualification(provider);
    return [
      resource(`provider.${semantic}`, 's3', 'lakehouse-dataset', bucketName(request, semantic), {
        versioning: true,
        immutableManifests: true,
        prefix: stringValue(config.prefix) ?? `lakehouse/${hash(semantic, 12)}`,
        qualification,
        schemaRevision: stringValue(config.schemaRevision) ?? 'v1',
        region: stringValue(config.region) ?? request.region,
        catalogResourceId: catalogId,
      }, semantic, 'none', ['bucketName', 'bucketArn', 'prefix']),
      resource(catalogId, 'glue', 'catalog-database', name(`catalog-${hash(semantic, 8)}`), { qualification }, semantic, 'none', ['databaseName', 'databaseArn']),
    ];
  }
  if (provider.interface === 'LakehouseQuery' && ['athena-queries', 'duckdb-queries'].includes(provider.implementation)) {
    const resultsId = `provider.${semantic}.results`;
    const qualification = providerQualification(provider);
    return [
      resource(resultsId, 's3', 'bucket', bucketName(request, `${semantic}-query-results`), { versioning: true, publicAccessBlock: true, encryption: 'AES256', forceDestroy: false, purpose: 'athena-query-results' }, semantic, 'none', ['bucketName', 'bucketArn']),
      resource(`provider.${semantic}.query`, 'athena', 'workgroup', name(`athena-${hash(semantic, 8)}`), {
        qualification, region: stringValue(config.region) ?? request.region, enforceConfiguration: true, publishMetrics: true,
        maximumConcurrentQueries: numberValue(config.maximumConcurrentQueries) ?? 4,
        bytesScannedCutoffPerQuery: numberValue(config.maximumScannedBytes) ?? 10_000_000_000,
        resultBucketResourceId: resultsId,
      }, semantic, 'none', ['workgroupName', 'workgroupArn']),
    ];
  }
  if (provider.interface === 'Secret' || provider.interface === 'CredentialStore') return [resource(`provider.${semantic}`, 'secrets-manager', 'secret-authority', name(`secrets-${hash(semantic, 8)}`), { values: 'runtime-injected-only' }, semantic, 'none', ['secretArn'])];
  if (provider.interface === 'ApplicationHost') return [];
  if (provider.interface === 'ContainerRegistry') return [resource(`provider.${semantic}`, 'ecr', 'repository', name(`registry-${hash(semantic, 8)}`), { imageTagMutability: 'IMMUTABLE', scanOnPush: true }, semantic, 'none', ['repositoryUri', 'repositoryArn'])];
  if (provider.interface === 'HttpExposure') return [resource(`provider.${semantic}`, 'elastic-load-balancing', 'application-load-balancer', name(`alb-${hash(semantic, 8)}`), {
    publicSubnets: ['foundation.subnet.public.1', 'foundation.subnet.public.2'],
    tlsRequired: request.graph.nodes.some((node) => node.kind === 'exposure' && node.enabled !== false && node.tlsIntent.mode === 'managed'),
  }, semantic, 'public', ['dnsName', 'zoneId', 'loadBalancerArn'])];
  // Certificate and DNS declarations are exposure-scoped. A provider records
  // capability selection; it is not itself a deployable certificate/record.
  if (provider.interface === 'Certificate' || provider.interface === 'DnsPublication') return [];
  if (provider.interface === 'ActorRuntime' && provider.implementation === 'celld-actors') {
    const base = `provider.${semantic}`;
    const state = resource(`${base}.state`, 's3', 'bucket', bucketName(request, `${semantic}-actor-state`), {
      versioning: true, publicAccessBlock: true, encryption: 'AES256', forceDestroy: false,
      authority: 'celld-fleet', conditionalWritesRequired: true,
    }, semantic, 'none', ['bucketName', 'bucketArn']);
    const authorization = resource(`${base}.authorization`, 'secrets-manager', 'secret-authority', name(`actor-auth-${hash(semantic, 8)}`), {
      values: 'runtime-injected-only', passwordLength: 48,
    }, semantic, 'none', ['secretArn']);
    const connectionSigning = resource(`${base}.connection-signing`, 'secrets-manager', 'secret-authority', name(`actor-ticket-${hash(semantic, 8)}`), {
      values: 'runtime-injected-only', passwordLength: 48, purpose: 'actor-connection-ticket-signing',
    }, semantic, 'none', ['secretArn']);
    return [
      { ...state, lifecycle: { ownership: 'application', deletion: 'retain', adoption: 'createOrAdoptExact' } },
      authorization,
      connectionSigning,
      resource(base, 'ecs', 'celld-fleet', name(`actors-${hash(semantic, 8)}`), {
        image: 'ghcr.io/denoland/celld@sha256:7a4380721b6400073f2a26afe70a828410169f658d31b5ef61383e648ca0c530',
        stateBucketResourceId: `${base}.state`, authorizationResourceId: `${base}.authorization`,
        connectionSigningResourceId: `${base}.connection-signing`,
        internalDnsName: `${boundedAwsName(`${request.graph.metadata.name}-${request.environment}`, 50)}.actors.internal`,
        workerPackage: '@applik8s/runtime-celld/worker', workerProtocol: 'applik8s.actorAuthority/v1alpha1',
        desiredCount: 1, port: 8080, peerPort: 8081, conditionalObjectStateRequired: true,
        privateSubnets: ['foundation.subnet.private.1', 'foundation.subnet.private.2'],
      }, semantic, 'private', ['endpoint', 'deploymentId', 'deploymentTaskDefinitionArn', 'deploymentSecurityGroupId']),
    ];
  }
  if (provider.interface === 'WorkflowEngine' && provider.implementation === 'hatchet') {
    const base = `provider.${semantic}`;
    const credentialsId = `${base}.credentials`;
    const databaseId = `${base}.database`;
    const configId = `${base}.config`;
    const workerTokenId = `${base}.worker-token`;
    const discoveryName = name(`workflows-${hash(semantic, 8)}`);
    return [
      resource(credentialsId, 'secrets-manager', 'database-credentials', name(`workflow-db-${hash(semantic, 8)}`), {
        username: 'hatchet', passwordLength: 48, urlSafe: true,
      }, semantic, 'none', ['secretArn']),
      resource(databaseId, 'rds', 'postgresql-instance', name(`workflow-db-${hash(semantic, 8)}`), {
        engineVersion: '17', storageGiB: 20, multiAz: request.environment === 'production', encrypted: true,
        deletionProtection: request.environment === 'production', databaseName: 'hatchet', masterUsername: 'hatchet',
        credentialsResourceId: credentialsId, purpose: 'workflow-engine', workflowEngineResourceId: base,
      }, semantic, 'private', ['endpoint', 'port']),
      {
        ...resource(configId, 'efs', 'shared-filesystem', name(`workflow-config-${hash(semantic, 8)}`), {
          encrypted: true, accessPointPath: '/hatchet-config', workflowEngineResourceId: base,
        }, semantic, 'private', ['fileSystemId', 'accessPointArn']),
        lifecycle: { ownership: 'application', deletion: 'retain', adoption: 'createOrAdoptExact' },
      },
      resource(workerTokenId, 'secrets-manager', 'workflow-token', name(`workflow-token-${hash(semantic, 8)}`), {
        authority: 'hatchet-worker-token', issuance: 'deployment-bootstrap',
      }, semantic, 'none', ['secretArn']),
      resource(base, 'ecs', 'hatchet-service', discoveryName, {
        image: awsHatchetImage,
        tenantId: awsHatchetTenantId,
        databaseResourceId: databaseId,
        credentialsResourceId: credentialsId,
        configFilesystemResourceId: configId,
        workerTokenResourceId: workerTokenId,
        discoveryNamespaceResourceId: 'foundation.discovery',
        discoveryName,
        apiPort: 8888,
        grpcPort: 7077,
        desiredCount: 1,
        privateSubnets: ['foundation.subnet.private.1', 'foundation.subnet.private.2'],
      }, semantic, 'private', ['endpoint', 'grpcEndpoint', 'workerTokenTaskDefinitionArn', 'workerTokenSecurityGroupId']),
    ];
  }
  return undefined;
}

function awsRuntimeOnlyProvider(provider: ApplicationProviderNode): boolean {
  if (provider.interface === 'ActorRuntime' && provider.implementation === 'deterministic-local-actors') return true;
  if (provider.interface === 'AI' && provider.implementation === 'envoy-ai-gateway') {
    return providerConfig(provider).provision === false;
  }
  return ['Authorization', 'IdentityProvider', 'OAuthAuthorizationServer', 'StructuredGeneration', 'Search', 'AnalyticalDatabase', 'NotificationDelivery', 'PaymentProvider'].includes(provider.interface)
    && !['opensearch', 'clickhouse'].includes(provider.implementation);
}

function resource(id: string, service: ApplicationAwsService, resourceType: string, physicalName: string, configuration: ApplicationAwsPlanResource['configuration'], semanticNodeId: string | undefined, network: ApplicationAwsPlanResource['network'], outputNames: readonly string[]): ApplicationAwsPlanResource {
  return {
    id, service, resourceType, ...(semanticNodeId ? { semanticNodeId } : {}), physicalName,
    lifecycle: { ownership: 'application', deletion: 'delete', adoption: 'createOrAdoptExact' }, network, configuration,
    outputs: outputNames.map((outputName) => ({ name: outputName, sensitivity: outputName.toLowerCase().includes('secret') ? 'sensitive' as const : 'public' as const, persistence: outputName.toLowerCase().includes('secret') ? 'reference' as const : 'state' as const })),
    provenance: { ...(semanticNodeId ? { graphNodeId: semanticNodeId } : {}) },
  };
}

function providerConfig(provider: ApplicationProviderNode): Record<string, unknown> {
  const config = objectValue(provider.config) ?? {};
  const nested = Object.values(config).map(objectValue).find((value) => value?.kind === provider.implementation);
  return nested ?? config;
}

function providerQualification(provider: ApplicationProviderNode): string {
  const qualification = objectValue(objectValue(provider.config)?.qualification)?.name;
  if (typeof qualification !== 'string' || !qualification.trim()) throw new Error(`AWS provider ${provider.id} requires a stable qualification.`);
  return qualification;
}

function awsScheduleExpression(definition: {
  readonly id: string;
  readonly cron?: string;
  readonly every?: string;
  readonly at?: string;
  readonly requirements?: { readonly precision?: 'minute' | 'second' };
}): string {
  if (definition.requirements?.precision === 'second') {
    throw new Error(
      `AWS Scheduler cannot satisfy second-precision schedule ${definition.id}; select a minute-precision cadence or a provider with second-level guarantees.`,
    );
  }
  if (definition.cron) return `cron(${definition.cron})`;
  if (definition.every) {
    const match = /^(\d+)(s|m|h|d)$/u.exec(definition.every.trim());
    if (!match) throw new Error(`AWS schedule ${definition.id} has an invalid interval ${definition.every}.`);
    const amount = Number(match[1]);
    if (match[2] === 's' && amount % 60 !== 0) {
      throw new Error(`AWS Scheduler cannot preserve interval ${definition.every} for ${definition.id}; second intervals must be exact multiples of 60 seconds.`);
    }
    const normalized = match[2] === 's' ? amount / 60 : amount;
    const unit = match[2] === 'h' ? 'hour' : match[2] === 'd' ? 'day' : 'minute';
    return `rate(${normalized} ${unit}${normalized === 1 ? '' : 's'})`;
  }
  if (definition.at) {
    const value = new Date(definition.at);
    if (!Number.isFinite(value.getTime())) throw new Error(`AWS schedule ${definition.id} has an invalid one-time timestamp.`);
    return `at(${value.toISOString().replace(/\.\d{3}Z$/u, '')})`;
  }
  throw new Error(`Fixed AWS schedule ${definition.id} has no cadence.`);
}
function awsRuntimeAccessBindings(
  graph: ApplicationGraph,
  resources: ReadonlyMap<string, ApplicationAwsPlanResource>,
  request: CompileApplicationAwsDeploymentPlanRequest,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const bindings: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const sourceProvider of graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider')) {
    const provider = resolveApplicationProviderForTarget(sourceProvider, {
      graph,
      target: request.target ?? 'aws',
      connection: { provider: request.target ?? 'aws', cluster: `${request.accountId}/${request.region}`, digest: `sha256:${'0'.repeat(64)}` },
      instance: request.environment,
      profile: request.profile ?? request.environment,
      strategy: 'direct',
      installationSpec: request.installationSpec ?? {},
    });
    const candidates = [...resources.values()].filter(({ semanticNodeId }) => semanticNodeId === provider.id);
    const primary = candidates.find(({ resourceType }) => ['bucket', 'lakehouse-dataset', 'queue', 'stream'].includes(resourceType));
    if ((provider.interface === 'ObjectStorage' || provider.interface === 'LakehouseDataset') && (primary?.resourceType === 'bucket' || primary?.resourceType === 'lakehouse-dataset')) bindings[provider.id] = { bucket: primary.physicalName, prefix: primary.configuration.prefix };
    else if (provider.interface === 'Queue' && primary?.resourceType === 'queue') bindings[provider.id] = { queueArn: `arn:aws:sqs:${request.region}:${request.accountId}:${primary.physicalName}` };
    else if ((provider.interface === 'EventLog' || provider.interface === 'EventSource') && primary?.resourceType === 'stream') bindings[provider.id] = { streamArn: `arn:aws:kinesis:${request.region}:${request.accountId}:stream/${primary.physicalName}` };
    else if (provider.interface === 'TransactionalDatabase') {
      const database = candidates.find(({ service, resourceType }) => service === 'rds' && resourceType === 'postgresql-instance');
      if (database) bindings[provider.id] = {
        secretArn: `output://${database.id}/secretArn`,
        networkResourceId: database.id,
        networkProtocol: 'TCP',
        networkPort: numberValue(database.configuration.port) ?? 5432,
      };
    }
    else if (provider.interface === 'IndexStore') {
      const indexStore = candidates.find(({ service, resourceType }) => service === 'elasticache' && resourceType === 'valkey-replication-group');
      if (indexStore) bindings[provider.id] = {
        networkResourceId: indexStore.id,
        networkProtocol: 'TCP',
        networkPort: numberValue(indexStore.configuration.port) ?? 6379,
      };
    }
    else if (provider.interface === 'Scheduler') {
      const queue = resources.get('scheduler.admission');
      const group = resources.get('scheduler.group');
      const executionRole = resources.get('scheduler.execution-role');
      if (queue && group && executionRole) bindings[provider.id] = {
        queueArn: `arn:aws:sqs:${request.region}:${request.accountId}:${queue.physicalName}`,
        scheduleArn: `arn:aws:scheduler:${request.region}:${request.accountId}:schedule/${group.physicalName}/*`,
        executionRoleArn: `output://${executionRole.id}/roleArn`,
      };
    }
    else if (provider.interface === 'ActorRuntime' && provider.implementation === 'celld-actors') {
      const base = `provider.${provider.id}`;
      const state = resources.get(`${base}.state`);
      const authorization = resources.get(`${base}.authorization`);
      const connectionSigning = resources.get(`${base}.connection-signing`);
      const runtime = resources.get(base);
      if (state && authorization && connectionSigning && runtime) bindings[provider.id] = {
        runtimeKind: 'celld-actors',
        networkResourceId: runtime.id,
        networkProtocol: 'TCP',
        networkPort: numberValue(runtime.configuration.port) ?? 8080,
        stateBucketArn: `arn:aws:s3:::${state.physicalName}`,
        authorizationSecretArn: `output://${authorization.id}/secretArn`,
        connectionSigningSecretArn: `output://${connectionSigning.id}/secretArn`,
      };
    }
    else if (provider.interface === 'WorkflowEngine' && provider.implementation === 'hatchet') {
      const runtime = resources.get(`provider.${provider.id}`);
      if (runtime) bindings[provider.id] = {
        networkResourceId: runtime.id,
        networkProtocol: 'TCP',
        networkPort: numberValue(runtime.configuration.grpcPort) ?? 7077,
      };
    }
    else if (provider.interface === 'Secret' || provider.interface === 'CredentialStore') bindings[provider.id] = { secretArn: `output://provider.${provider.id}/secretArn` };
    else if (provider.interface === 'Observability') bindings[provider.id] = { logGroupArn: `arn:aws:logs:${request.region}:${request.accountId}:log-group:/applik8s/${graph.metadata.name}/${request.environment}:*`, traceDestinationArn: `arn:aws:xray:${request.region}:${request.accountId}:group/Default` };
    for (const target of applicationProviderRuntimeAccessTargets(provider, {
      graph,
      target: request.target ?? 'aws',
      connection: { provider: request.target ?? 'aws', cluster: `${request.accountId}/${request.region}`, digest: `sha256:${'0'.repeat(64)}` },
      instance: request.environment,
      profile: request.profile ?? request.environment,
      strategy: 'direct',
      installationSpec: request.installationSpec ?? {},
    })) {
      bindings[provider.id] = {
        ...(bindings[provider.id] ?? {}),
        ...applicationDeploymentRuntimeAccessTargetRecord(target),
      };
    }
  }
  for (const secret of [...resources.values()].filter(({ service, resourceType, semanticNodeId }) => service === 'secrets-manager' && resourceType === 'secret-authority' && semanticNodeId)) {
    if (!bindings[secret.semanticNodeId!]) bindings[secret.semanticNodeId!] = { secretArn: `output://${secret.id}/secretArn` };
  }
  const checkpoint = resources.get('framework.kinesis-checkpoints');
  if (checkpoint) bindings['framework.processor-checkpoints'] = {
    tableArn: `arn:aws:dynamodb:${request.region}:${request.accountId}:table/${checkpoint.physicalName}`,
  };
  return bindings;
}

function awsDnsBootstrapEgress(
  target: 'aws' | 'aws-local',
): readonly ApplicationRuntimeAccessBootstrapEgress[] {
  const endpoint = { target, cidr: '10.64.0.2/32' };
  return (['TCP', 'UDP'] as const).map((protocol) => ({
    egressIdentity: `bootstrap.aws.dns.${protocol.toLowerCase()}`,
    purpose: 'dns' as const,
    protocol,
    port: 53,
    endpoint,
  }));
}

interface MaterializedAwsRuntimeNetwork {
  readonly resources: readonly ApplicationAwsPlanResource[];
  readonly workloadSecurityGroups: ReadonlyMap<string, string>;
  readonly targetSecurityGroups: ReadonlyMap<string, string>;
}

/**
 * Materializes only network envelopes that AWS Security Groups can enforce
 * exactly. AWS API calls and public/FQDN transports remain on the explicitly
 * unqualified legacy boundary until a VPC-endpoint or FQDN-capable extension
 * owns their destination identity.
 */
function materializeQualifiedAwsRuntimeNetwork(options: {
  readonly runtimeAccess: ApplicationRuntimeAccessPlan;
  readonly resources: ReadonlyMap<string, ApplicationAwsPlanResource>;
  readonly target: 'aws' | 'aws-local';
  readonly name: (suffix: string, limit?: number) => string;
}): MaterializedAwsRuntimeNetwork {
  const workloadSecurityGroups = new Map<string, string>();
  const targetSecurityGroups = new Map<string, string>();
  const targetIngress = new Map<string, DeploymentJsonObject[]>();
  const workloadResources: ApplicationAwsPlanResource[] = [];

  for (const workload of options.runtimeAccess.workloads) {
    if (!workload.aws || !isAwsRuntimeAccessSecurityGroupQualified(workload.aws, options.resources, options.target)) continue;
    const workloadSecurityGroupId = `runtime-network.workload.${hash(workload.workloadIdentity, 16)}`;
    workloadSecurityGroups.set(workload.aws.resourceId, workloadSecurityGroupId);
    const egressRules: DeploymentJsonObject[] = [];
    for (const peer of workload.aws.privatePeers) {
      if (peer.endpoint.target !== options.target) continue;
      const targetSecurityGroupId = targetSecurityGroups.get(peer.endpoint.resourceId)
        ?? `runtime-network.target.${hash(peer.endpoint.resourceId, 16)}`;
      targetSecurityGroups.set(peer.endpoint.resourceId, targetSecurityGroupId);
      egressRules.push({
        kind: 'securityGroup',
        protocol: peer.protocol.toLowerCase(),
        port: peer.port,
        targetResourceId: peer.endpoint.resourceId,
        targetSecurityGroupResourceId: targetSecurityGroupId,
        peerIdentity: peer.peerIdentity,
        requirementIds: [...peer.requirementIds],
      });
      const ingress = targetIngress.get(peer.endpoint.resourceId) ?? [];
      ingress.push({
        kind: 'securityGroup',
        protocol: peer.protocol.toLowerCase(),
        port: peer.port,
        sourceWorkloadIdentity: workload.workloadIdentity,
        sourceSecurityGroupResourceId: workloadSecurityGroupId,
        peerIdentity: peer.peerIdentity,
        requirementIds: [...peer.requirementIds],
      });
      targetIngress.set(peer.endpoint.resourceId, ingress);
    }
    for (const bootstrap of workload.aws.bootstrapEgress) {
      if (bootstrap.endpoint.target !== options.target) continue;
      egressRules.push({
        kind: 'cidr',
        protocol: bootstrap.protocol.toLowerCase(),
        port: bootstrap.port,
        cidr: bootstrap.endpoint.cidr,
        egressIdentity: bootstrap.egressIdentity,
        purpose: bootstrap.purpose,
      });
    }
    workloadResources.push(resource(
      workloadSecurityGroupId,
      'ec2',
      'security-group',
      options.name(`runtime-${hash(workload.workloadIdentity, 10)}`),
      {
        description: `Exact runtime egress for ${workload.workloadIdentity}`,
        runtimeAccessKind: 'workload',
        workloadIdentity: workload.workloadIdentity,
        workloadResourceId: workload.aws.resourceId,
        policyDigest: workload.policyDigest,
        egressMode: 'explicit',
        egressRules,
        ingressRules: [],
      },
      undefined,
      'private',
      ['securityGroupId'],
    ));
  }

  const targetResources = [...targetSecurityGroups.entries()].map(([targetResourceId, securityGroupId]) => resource(
    securityGroupId,
    'ec2',
    'security-group',
    options.name(`target-${hash(targetResourceId, 10)}`),
    {
      description: `Exact runtime ingress for ${targetResourceId}`,
      runtimeAccessKind: 'target',
      targetResourceId,
      egressMode: 'explicit',
      egressRules: [],
      ingressRules: deploymentJson(targetIngress.get(targetResourceId) ?? []),
    },
    options.resources.get(targetResourceId)?.semanticNodeId,
    'private',
    ['securityGroupId'],
  ));
  return {
    resources: [...workloadResources, ...targetResources],
    workloadSecurityGroups,
    targetSecurityGroups,
  };
}

function runtimeSecretEnvironmentName(secretIdentity: string, graph: ApplicationGraph): string {
  const gateway = graph.nodes.find((node) => node.kind === 'gateway' && node.cursorSecret
    && [node.cursorSecret.apiVersion, node.cursorSecret.kind, node.cursorSecret.namespace ?? '', node.cursorSecret.name ?? ''].join('/') === secretIdentity);
  if (gateway) return 'APPLIK8S_CURSOR_SECRET';
  return `APPLIK8S_SECRET_${hash(secretIdentity, 12).toUpperCase()}`;
}

function bucketName(request: CompileApplicationAwsDeploymentPlanRequest, semantic: string): string { return boundedAwsName(`${request.graph.metadata.name}-${request.environment}-${request.accountId}-${hash(semantic, 12)}`.toLowerCase(), 63); }
function boundedAwsName(value: string, limit: number): string { const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'applik8s'; return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 13).replace(/-+$/gu, '')}-${hash(normalized, 12)}`; }
function assertAwsSegment(value: string, field: string): void { if (!/^[a-z][a-z0-9-]{0,62}$/u.test(value)) throw new Error(`AWS ${field} ${value} must be a lowercase DNS-style identifier.`); }
function hash(value: string, length: number): string { return sha256Hex(value).slice(0, length); }
function objectValue(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
// typecast-file-boundary: provider/runtime-access records are serialized and
// parsed through JSON before entering the closed deployment-plan contract.
function deploymentJson(value: unknown): DeploymentJsonValue { return JSON.parse(stableJson(value)) as DeploymentJsonValue; }
function stableJson(value: unknown): string { if (value === undefined) return 'null'; if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`; }
