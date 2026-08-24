// typecast-file-boundary: Provider profile records are validated as bounded JSON before local target selection.

import {
  type ApplicationGraph,
  type ApplicationGraphNode,
  type ApplicationPlan,
  type ApplicationProviderNode,
  applicationCanonicalIdentity,
  applicationTargetIdentity,
  type JsonObject,
  sourceProvenance,
} from '@applik8s/core';
import type {
  ApplicationAwsDeploymentPlan,
  ApplicationAwsPlanResource,
  ApplicationDeploymentGraph,
  ApplicationDeploymentNode,
  ApplicationFrameworkCredentialDependency,
  ApplicationRuntimeArtifact,
  LocalSupervisorBinding,
  LocalSupervisorContainer,
  LocalSupervisorDiagnostic,
  LocalSupervisorEnvironmentSegment,
  LocalSupervisorPlan,
  LocalSupervisorProcess,
  LocalSupervisorResource,
  LocalSupervisorTarget,
} from '@applik8s/deployment-contract';
import { applicationRuntimeEndpointEnvironmentName, sha256Hex } from '@applik8s/deployment-contract';
import { compileApplicationPlan } from './application-plan.js';
import { compileApplicationAwsDeploymentPlan } from './aws-deployment-plan.js';
import { applicationProviderGuaranteesForGraph, assertApplicationScheduleProviderCompatibility } from './provider-guarantees.js';
import { resolveApplicationProviderForTarget } from './providers.js';
import { compileApplicationRuntimeAccessPlan } from './runtime-access-plan.js';
import type { ApplicationGeneratedSecretRequirement } from './types.js';
import { applicationWorkloadDependencyNodeIds, applicationWorkloadProviderNodeIds } from './workload-provider-references.js';

export interface CompileLocalSupervisorPlanRequest {
  readonly graph: ApplicationGraph;
  readonly target: LocalSupervisorTarget;
  readonly profile: string;
  readonly projectDigest: string;
  readonly projectDirectory?: string;
  readonly installationSpec?: JsonObject;
  /**
   * Compiler-derived credential requirements shared with production targets.
   * Local planning consumes only hostEnvironment sources and never their values.
   */
  readonly generatedSecrets?: readonly ApplicationGeneratedSecretRequirement[];
  readonly webCommand?: { readonly command: string; readonly args: readonly string[] };
  /** Compiler-emitted Node entrypoints that run the graph's background boundaries locally. */
  readonly runtimeArtifacts?: readonly ApplicationLocalRuntimeArtifact[];
  /** Compiler-authored exact framework credentials for the application web host. */
  readonly applicationHostFrameworkCredentials: readonly ApplicationFrameworkCredentialDependency[];
  /** Resolved package entrypoint used for the local CRD/operator authority process. */
  readonly localResourceAuthorityModule?: string;
  /** Explicit trust grant required for MiniStack's real RDS/ECS/ElastiCache data planes. */
  readonly allowDockerSocket?: boolean;
}

export type ApplicationLocalRuntimeArtifact = ApplicationRuntimeArtifact;

export function compileLocalSupervisorPlan(request: CompileLocalSupervisorPlanRequest): LocalSupervisorPlan {
	assertApplicationScheduleProviderCompatibility({
		graph: request.graph,
		target: request.target,
		...(request.profile ? { profile: request.profile } : {}),
	});
  const resources: LocalSupervisorResource[] = [];
  const bindings: LocalSupervisorBinding[] = [];
  const diagnostics: LocalSupervisorDiagnostic[] = [];
  const containers: string[] = [];
  const selectedProviders: ApplicationProviderNode[] = [];
  let awsLocalPlan: ApplicationAwsDeploymentPlan | undefined;

  if (request.target === 'aws-local') {
    const ministack = miniStackResource(request);
    resources.push(ministack.resource);
    containers.push(ministack.resource.id);
    bindings.push(...ministack.bindings);
    const awsPlan = compileApplicationAwsDeploymentPlan({
      graph: request.graph,
      environment: request.profile,
      profile: request.profile,
      region: 'us-east-1',
      accountId: '000000000001',
      target: 'aws-local',
      includeApplicationHosts: false,
    });
    awsLocalPlan = awsPlan;
    const runtimeOutputResourceIds = new Set([
      ...awsPlan.resources.filter(({ semanticNodeId }) => semanticNodeId).map(({ id }) => id),
      'framework.kinesis-checkpoints',
      'scheduler.admission',
      'scheduler.dead-letter',
      'scheduler.execution-role',
      'scheduler.group',
    ]);
    for (const resource of awsPlan.resources.filter(({ id }) => runtimeOutputResourceIds.has(id))) {
      for (const output of resource.outputs) {
        bindings.push({
          id: awsLocalOutputBindingId(resource.id, output.name),
          owner: ministack.resource.id,
          kind: 'targetOutput',
          sensitivity: output.sensitivity,
        });
      }
    }
    for (const binding of awsPlan.runtimeBindings) {
      bindings.push({ id: awsLocalRuntimeBindingId(binding.id), owner: ministack.resource.id, kind: 'targetOutput', sensitivity: 'sensitive' });
    }
    if (!request.allowDockerSocket && request.graph.nodes.some((node) => node.kind === 'provider' && ['TransactionalDatabase', 'IndexStore'].includes(node.interface))) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCAL_TARGET_INCOMPATIBLE',
        message: 'aws-local selected a real database/cache data plane. Re-run with --allow-docker-socket after reviewing the host-access grant; Applik8s will not mount /var/run/docker.sock implicitly.',
        subjectId: 'target:ministack',
      });
    }
  }

  for (const source of request.graph.nodes) {
    if (source.kind !== 'provider') continue;
    const provider = selectedProvider(source, request, diagnostics);
    if (!provider) continue;
    selectedProviders.push(provider);
    const lowered = localProviderResource(
      provider,
      request.target,
      request.projectDirectory ?? '.',
      request.graph,
    );
    if (lowered.diagnostic) diagnostics.push(lowered.diagnostic);
    const loweredResources = lowered.resources ?? (lowered.resource ? [lowered.resource] : []);
    if (loweredResources.length === 0) continue;
    resources.push(...loweredResources);
    containers.push(...loweredResources.filter(({ kind }) => kind === 'container').map(({ id: resourceId }) => resourceId));
    bindings.push(...lowered.bindings);
  }

  const hostEnvironmentCredentials = localHostEnvironmentCredentialAuthority(
    request.generatedSecrets ?? [],
  );
  if (hostEnvironmentCredentials) {
    resources.push(hostEnvironmentCredentials.resource);
    bindings.push(...hostEnvironmentCredentials.bindings);
  }

  const frameworkCredentials = localFrameworkCredentialAuthority(
    request.runtimeArtifacts ?? [],
    request.applicationHostFrameworkCredentials,
  );
  if (frameworkCredentials) {
    resources.push(frameworkCredentials.resource);
    bindings.push(...frameworkCredentials.bindings);
  }
  const operatorArtifacts = (request.runtimeArtifacts ?? []).filter((artifact) => artifact.role === 'operator');
  if (operatorArtifacts.length > 0) {
    const authorityId = 'runtime:local-resource-authority';
    const portBinding = `port:${authorityId}:http`;
    const endpointBinding = `endpoint:${authorityId}:http`;
    if (!request.localResourceAuthorityModule) {
      diagnostics.push({ severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: 'Local CRD models require the @applik8s/server local resource authority entrypoint.', subjectId: authorityId });
    } else {
      resources.push({
        id: authorityId,
        kind: 'process',
        command: 'node',
        args: [request.localResourceAuthorityModule],
        cwd: request.projectDirectory ?? '.',
        environment: [
          { name: 'PORT', binding: portBinding },
          { name: 'APPLIK8S_LOCAL_RESOURCE_TOKEN', binding: 'credential:framework:local-resource' },
          { name: 'APPLIK8S_LOCAL_RESOURCE_STATE_PATH', binding: `literal:${request.projectDirectory ?? '.'}/.applik8s/state/${request.profile}/resources.json` },
          { name: 'APPLIK8S_LOCAL_OPERATOR_ARTIFACTS', binding: `literal:${stableJson(operatorArtifacts.map(({ name, manifest, source, digest }) => ({ name, manifest, source, digest })))}` },
        ],
        watch: [],
        reloadGroup: authorityId,
        dependsOn: [...containers],
        lifecycle: { ownership: 'application', retention: 'retained' },
        health: { kind: 'http', path: '/healthz', portBinding, timeoutMs: 30_000 },
        provenance: { graphNodeId: 'framework.localResources', source: request.localResourceAuthorityModule },
      });
      bindings.push(
        { id: portBinding, owner: authorityId, kind: 'port', sensitivity: 'public' },
        { id: endpointBinding, owner: authorityId, kind: 'endpoint', sensitivity: 'public' },
      );
    }
  }
  const localRuntimeDependencies = operatorArtifacts.length > 0 && request.localResourceAuthorityModule
    ? ['runtime:local-resource-authority']
    : [];
  const executableArtifacts = (request.runtimeArtifacts ?? []).filter(({ role }) => role !== 'operator');
  const localApplicationHostId = selectedProviders.find(({ interface: providerInterface }) => providerInterface === 'ApplicationHost')?.id
    ?? request.graph.nodes.find(({ kind }) => kind === 'server')?.id;
  const runtimeEndpointBindings = new Map<string, { readonly binding: string; readonly owner: string }>();
  for (const artifact of executableArtifacts) {
    const artifactId = `runtime:${artifact.role}:${artifact.nodeId}`;
    const binding = `endpoint:${artifactId}:http`;
    const existing = runtimeEndpointBindings.get(artifact.nodeId);
    if (existing) {
      diagnostics.push({
        severity: 'error',
        code: 'LOCAL_LIFECYCLE_COLLISION',
        message: `Local runtime node ${artifact.nodeId} is emitted by both ${existing.owner} and ${artifactId}; one semantic endpoint cannot have two owners.`,
        subjectId: artifact.nodeId,
      });
      continue;
    }
    runtimeEndpointBindings.set(artifact.nodeId, { binding, owner: artifactId });
    bindings.push(
      { id: `port:${artifactId}:http`, owner: artifactId, kind: 'port', sensitivity: 'public' },
      { id: binding, owner: artifactId, kind: 'endpoint', sensitivity: 'public' },
    );
  }
  for (const artifact of executableArtifacts) {
    if (artifact.role === 'operator') continue;
    const artifactId = `runtime:${artifact.role}:${artifact.nodeId}`;
    const workloadProviders = localProvidersForWorkload(artifact.nodeId, request.graph, selectedProviders);
    const actorAccess = workloadProviders.some(({ interface: providerInterface }) => providerInterface === 'ActorRuntime');
    const runtimeEnvironment = localRuntimeEnvironment(
      request,
      workloadProviders,
      bindings,
      diagnostics,
      artifact.frameworkCredentials ?? [],
    );
    const portBinding = `port:${artifactId}:http`;
    const process: LocalSupervisorProcess = {
      id: artifactId,
      kind: 'process',
      command: 'node',
      args: [artifact.source],
      cwd: request.projectDirectory ?? '.',
      environment: [
        ...runtimeEnvironment,
        ...(awsLocalPlan ? awsLocalRuntimeEnvironment(awsLocalPlan, artifact.nodeId, {
          providerNodeIds: localProvidersForWorkload(artifact.nodeId, request.graph, selectedProviders).map(({ id }) => id),
          ...((artifact.role === 'processor' || artifact.role === 'lakehouse') ? { eventConsumer: artifact.name } : {}),
        }) : []),
        ...(artifact.runtimeEndpoints ?? []).flatMap((endpoint) => {
          const receiver = runtimeEndpointBindings.get(endpoint.nodeId);
          if (!receiver) {
            diagnostics.push({
              severity: 'error',
              code: 'LOCAL_PROVIDER_UNRESOLVED',
              message: `Runtime ${artifactId} requires generated endpoint ${endpoint.nodeId}, but that receiver has no local runtime artifact.`,
              subjectId: artifact.nodeId,
            });
            return [];
          }
          return [{ name: endpoint.environmentName, binding: receiver.binding }];
        }),
        { name: 'APPLIK8S_DEPLOYMENT_TARGET', binding: `literal:${request.target}` },
        { name: 'PORT', binding: portBinding },
        { name: 'APPLIK8S_HTTP_PORT', binding: portBinding },
        { name: 'APPLIK8S_HEALTH_PORT', binding: portBinding },
        ...(actorAccess && localApplicationHostId ? [{ name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT', binding: `endpoint:${localApplicationHostId}:http` }] : []),
      ],
      watch: [],
      reloadGroup: artifactId,
      dependsOn: [
        ...containers,
        ...localRuntimeDependencies,
        ...(actorAccess && localApplicationHostId ? [`process:${localApplicationHostId}`] : []),
        ...(artifact.runtimeEndpoints ?? []).flatMap((endpoint) => {
          const receiver = runtimeEndpointBindings.get(endpoint.nodeId);
          return receiver && receiver.owner !== artifactId ? [receiver.owner] : [];
        }),
      ],
      lifecycle: { ownership: 'application', retention: 'ephemeral' },
      health: { kind: 'process', timeoutMs: 30_000 },
      provenance: { graphNodeId: artifact.nodeId, source: artifact.source },
    };
    resources.push(process);
  }

  const servers = request.graph.nodes.filter(({ kind }) => kind === 'server');
  const managedHosts = selectedProviders.filter(({ interface: providerInterface }) => providerInterface === 'ApplicationHost');
  // A managed ApplicationHost is the one public lifecycle owner. Individual
  // HTTP server nodes are compiler-owned runtime endpoints behind that host,
  // not additional copies of the web process. This mirrors AWS lowering and
  // permits an application to expose several typed HTTP boundaries.
  if (managedHosts.length === 0 && servers.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'LOCAL_LIFECYCLE_COLLISION',
      message: `Local target currently requires one ApplicationHost process; found ${servers.length}.`,
    });
  }
  if (managedHosts.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'LOCAL_LIFECYCLE_COLLISION',
      message: `Local target currently requires one ApplicationHost provider; found ${managedHosts.length}.`,
    });
  }
  const server = managedHosts.length === 0 ? servers[0] : undefined;
  const managedHost = managedHosts[0];
  if (server || managedHost) {
    const hostId = server?.id ?? managedHost!.id;
    const workloadProviders = localProvidersForWorkload(hostId, request.graph, selectedProviders);
    const runtimeEnvironment = localRuntimeEnvironment(
      request,
      workloadProviders,
      bindings,
      diagnostics,
      [
        ...request.applicationHostFrameworkCredentials,
        ...(operatorArtifacts.length > 0
          ? [{ kind: 'local-resource' as const, environmentName: 'APPLIK8S_LOCAL_RESOURCE_TOKEN' }]
          : []),
      ],
    );
    const sourceFile = server?.sourceLocation?.file ?? managedHost?.sourceLocation?.file;
    const observabilityProvider = workloadProviders.find(({ interface: providerInterface }) => providerInterface === 'Observability');
    const otlpBinding = observabilityProvider
      ? bindings.find(({ id }) => id === `endpoint:${observabilityProvider.id}:otlp`)
      : undefined;
    const process: LocalSupervisorProcess = {
      id: `process:${hostId}`,
      kind: 'process',
      command: request.webCommand?.command ?? 'bun',
      args: request.webCommand?.args ?? (request.target === 'aws-local' && bindings.some(({ id }) => id.startsWith('aws-runtime:')) ? ['--preload', '@applik8s/runtime-aws/bootstrap', 'run', 'dev'] : ['run', 'dev']),
      cwd: request.projectDirectory ?? '.',
      environment: [
        ...runtimeEnvironment,
        ...(awsLocalPlan ? awsLocalRuntimeEnvironment(awsLocalPlan, hostId, {
          providerNodeIds: workloadProviders.map(({ id }) => id),
          scheduleAccess: request.graph.nodes.some(({ kind }) => kind === 'schedule'),
        }) : []),
        ...executableArtifacts.flatMap((artifact) => {
          const node = request.graph.nodes.find(({ id }) => id === artifact.nodeId);
          if (artifact.role !== 'agent' && artifact.role !== 'http' && !(artifact.role === 'reactive' && node?.kind === 'gateway')) return [];
          const endpoint = runtimeEndpointBindings.get(artifact.nodeId);
          return endpoint ? [{ name: applicationRuntimeEndpointEnvironmentName(artifact.nodeId), binding: endpoint.binding }] : [];
        }),
        ...(otlpBinding ? [{ name: 'OTEL_EXPORTER_OTLP_ENDPOINT', binding: otlpBinding.id }] : []),
        { name: 'APPLIK8S_DEPLOYMENT_TARGET', binding: `literal:${request.target}` },
        { name: 'APPLIK8S_APPLICATION_NAME', binding: `literal:${request.graph.metadata.name}` },
        { name: 'APPLIK8S_ENVIRONMENT_ID', binding: `literal:${request.profile}` },
        { name: 'APPLIK8S_ACTOR_STATE_PATH', binding: `literal:${request.projectDirectory ?? '.'}/.applik8s/state/${request.profile}/actors.json` },
        { name: 'PORT', binding: `port:${hostId}:http` },
        { name: 'APPLIK8S_LOCAL_URL', binding: `endpoint:${hostId}:http` },
      ],
      watch: ['src', 'package.json'],
      reloadGroup: hostId,
      dependsOn: [
        ...containers,
        ...localRuntimeDependencies,
        ...executableArtifacts.flatMap((artifact) => {
          const node = request.graph.nodes.find(({ id }) => id === artifact.nodeId);
          return artifact.role === 'agent' || artifact.role === 'http' || (artifact.role === 'reactive' && node?.kind === 'gateway')
            ? [`runtime:${artifact.role}:${artifact.nodeId}`]
            : [];
        }),
      ],
      lifecycle: { ownership: 'application', retention: 'ephemeral' },
      health: { kind: 'http', path: '/-/healthz', portBinding: `port:${hostId}:http`, timeoutMs: 30_000 },
      provenance: { graphNodeId: hostId, ...(sourceFile ? { source: sourceFile } : {}) },
    };
    resources.push(process);
    bindings.push(
      { id: `port:${hostId}:http`, owner: process.id, kind: 'port', sensitivity: 'public' },
      { id: `endpoint:${hostId}:http`, owner: process.id, kind: 'endpoint', sensitivity: 'public' },
    );
  }

  return {
    apiVersion: 'applik8s.localSupervisor/v1alpha1',
    application: request.graph.metadata.name,
    target: request.target,
    profile: request.profile,
    projectDigest: request.projectDigest,
    resources,
    bindings,
    diagnostics,
  };
}

export function awsLocalOutputBindingId(resourceId: string, outputName: string): string {
  return `aws-output:${resourceId}:${outputName}`;
}

export function awsLocalRuntimeBindingId(bindingId: string): string {
  return `aws-runtime:${bindingId}`;
}

export function awsLocalOutputEnvironmentName(bindingId: string): string {
  const match = /^aws-output:(.+):([^:]+)$/u.exec(bindingId);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid AWS-local output binding ${bindingId}.`);
  const semantic = match[1].replace(/^provider\./u, '');
  return `APPLIK8S_${semantic.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}_${match[2].replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}

export function compileLocalApplicationPlan(input: {
  readonly graph: ApplicationGraph;
  readonly supervisor: LocalSupervisorPlan;
  readonly workspaceRoot?: string;
}): ApplicationPlan {
  const runtimeAccess = compileApplicationRuntimeAccessPlan({
    graph: input.graph,
    target: input.supervisor.target,
    profile: input.supervisor.profile,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
  });
  const sourceDigest = runtimeAccess.sourceGraphDigest;
  const connectionDigest = sha256(`${input.supervisor.target}\0${input.supervisor.projectDigest}`);
  const deploymentNodes = input.supervisor.resources.map((resource): ApplicationDeploymentNode => {
    const outputs = input.supervisor.bindings
      .filter(({ owner }) => owner === resource.id)
      .map((binding) => ({
        name: binding.id,
        type: binding.kind === 'credential' ? 'secretReference' as const : binding.kind === 'port' ? 'number' as const : 'string' as const,
        sensitivity: binding.sensitivity,
        persistence: binding.sensitivity === 'sensitive' ? 'redacted' as const : 'state' as const,
      }));
    return {
      id: resource.id,
      kind: 'externalProvider',
      contractVersion: 1,
      source: {
        semanticNodeId: resource.provenance.graphNodeId,
        ...(resource.provenance.source ? { file: resource.provenance.source } : {}),
      },
      provider: {
        interface: 'LocalSupervisor',
        implementation: resource.kind,
        version: 'v1alpha1',
      },
      scope: { connectionDigest },
      capabilities: { strategies: ['direct'], alchemy: true },
      configurationDigest: sha256(stableJson(resource)),
      inputs: {},
      outputs,
      lifecycle: {
        ownership: resource.lifecycle.ownership,
        deletion: resource.lifecycle.retention === 'retained' ? 'retain' : resource.lifecycle.ownership === 'external' ? 'none' : 'delete',
        adoption: resource.lifecycle.ownership === 'external' ? 'externalOnly' : 'createOrAdoptExact',
      },
      spec: {
        resourceType: `local:${resource.kind}`,
        controller: 'local-supervisor',
        configuration: {
          health: resource.health.kind,
          retention: resource.lifecycle.retention,
        },
      },
    };
  });
  const deploymentEdges = input.supervisor.resources.flatMap((resource) =>
    resource.dependsOn.map((dependency) => ({
      from: resource.id,
      to: dependency,
      relationship: 'requiresReady' as const,
    })),
  );
  const deployment: ApplicationDeploymentGraph = {
    apiVersion: 'applik8s.deploymentGraph/v1alpha1',
    kind: 'ApplicationDeploymentGraph',
    metadata: {
      identity: {
        connection: { provider: input.supervisor.target, cluster: 'local', digest: connectionDigest },
        application: input.graph.metadata.name,
        controlPlaneNamespace: 'local',
        instance: input.graph.metadata.name,
        profile: input.supervisor.profile,
      },
      mode: 'fresh',
      strategy: 'direct',
      sourceGraphDigest: sourceDigest,
      compilerVersion: '0.8.0',
    },
    runtimeAccess,
    nodes: deploymentNodes,
    edges: deploymentEdges,
  };
  const application = applicationCanonicalIdentity({ application: input.graph.metadata.name, kind: 'application', semanticKey: input.graph.metadata.name });
  const target = applicationTargetIdentity({
    application: input.graph.metadata.name,
    target: input.supervisor.target,
    connectionDigest,
    instance: input.graph.metadata.name,
    parentId: application.id,
  });
  const provenance = sourceProvenance({ origin: 'provider-plan', generatedBy: 'local-supervisor/v1alpha1', symbol: input.graph.metadata.name });
  return compileApplicationPlan({
    graph: input.graph,
    deployment,
    target: input.supervisor.target,
    lifecycleAuthority: 'local-supervisor',
    generatedAt: new Date(0).toISOString(),
    providerGuarantees: applicationProviderGuaranteesForGraph({ graph: input.graph, target: input.supervisor.target, profile: input.supervisor.profile }),
    nativePlans: [{
      apiVersion: 'applik8s.nativePlan/v1alpha1',
      id: `native-plan:local-supervisor:${target.id}`,
      authority: 'local-supervisor',
      adapterVersion: 'v1alpha1',
      target: target.id,
      contentDigest: sha256(stableJson(input.supervisor)),
      resourceIds: input.supervisor.resources.map(({ id }) => id).sort(),
      actions: ['create'],
      provenance: [provenance],
      summary: {
        resourceCount: input.supervisor.resources.length,
        processCount: input.supervisor.resources.filter(({ kind }) => kind === 'process').length,
        containerCount: input.supervisor.resources.filter(({ kind }) => kind === 'container').length,
        target: input.supervisor.target,
      },
    }],
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
  });
}

function selectedProvider(
  provider: ApplicationProviderNode,
  request: CompileLocalSupervisorPlanRequest,
  diagnostics: LocalSupervisorDiagnostic[],
): ApplicationProviderNode | undefined {
  try {
    return resolveApplicationProviderForTarget(provider, {
      graph: request.graph,
      target: request.target,
      connection: {
        provider: request.target,
        cluster: request.target,
        digest: `sha256:${'0'.repeat(64)}`,
      },
      instance: request.profile,
      profile: request.profile,
      strategy: 'direct',
      installationSpec: request.installationSpec ?? {},
    });
  } catch (cause) {
    diagnostics.push({
      severity: 'error',
      code: 'LOCAL_PROVIDER_UNRESOLVED',
      message: cause instanceof Error
        ? cause.message
        : `Provider ${provider.id} could not be resolved for ${request.target}/${request.profile}.`,
      subjectId: provider.id,
    });
    return undefined;
  }
}

function localProviderResource(
  provider: ApplicationProviderNode,
  target: LocalSupervisorTarget,
  cwd: string,
  graph: ApplicationGraph,
): { readonly resource?: LocalSupervisorResource; readonly resources?: readonly LocalSupervisorResource[]; readonly bindings: readonly LocalSupervisorBinding[]; readonly diagnostic?: LocalSupervisorDiagnostic } {
  const id = `provider:${provider.id}`;
  const common = {
    id,
    dependsOn: [] as const,
    lifecycle: { ownership: 'application' as const, retention: 'retained' as const },
    provenance: { graphNodeId: provider.id, ...(provider.sourceLocation ? { source: provider.sourceLocation.file } : {}) },
  };
  const credential = (name: string): LocalSupervisorBinding => ({ id: `credential:${provider.id}:${name}`, owner: id, kind: 'credential', sensitivity: 'sensitive' });
  const endpoint = (name: string, format: LocalSupervisorBinding['format'] = 'url'): LocalSupervisorBinding => ({ id: `endpoint:${provider.id}:${name}`, owner: id, kind: 'endpoint', sensitivity: 'public', value: `applik8s-local://${provider.id}/${name}`, format });
  const container = (input: Omit<LocalSupervisorContainer, keyof typeof common | 'id' | 'kind' | 'dependsOn' | 'lifecycle' | 'provenance'>): LocalSupervisorContainer => ({ ...common, kind: 'container', ...input });

  // aws-local exercises the AWS target adapters against MiniStack. It must
  // not quietly replace those providers with the faster ordinary-local
  // containers below.
  if (target === 'aws-local' && awsCompatibleInterface(provider.interface)) return { bindings: [] };

  if (provider.interface === 'TransactionalDatabase' && provider.implementation === 'postgres') {
    const password = credential('password');
    const port = endpoint('postgres');
    return { resource: container({ image: 'postgres:17-alpine', ports: [{ name: 'postgres', containerPort: 5432, protocol: 'tcp' }], environment: [{ name: 'POSTGRES_PASSWORD', binding: password.id }, { name: 'POSTGRES_USER', binding: 'literal:applik8s' }, { name: 'POSTGRES_DB', binding: 'literal:applik8s' }], volumes: [{ name: `${provider.id}-data`, mountPath: '/var/lib/postgresql/data', retained: true }], health: { kind: 'tcp', portBinding: port.id, timeoutMs: 60_000 } }), bindings: [password, port] };
  }
  if (provider.interface === 'IndexStore' && provider.implementation === 'valkey') {
    const port = endpoint('valkey');
    return { resource: container({ image: 'valkey/valkey:8.1-alpine', ports: [{ name: 'valkey', containerPort: 6379, protocol: 'tcp' }], environment: [], volumes: [{ name: `${provider.id}-data`, mountPath: '/data', retained: true }], health: { kind: 'tcp', portBinding: port.id, timeoutMs: 30_000 } }), bindings: [port] };
  }
  if (provider.interface === 'EventLog' && provider.implementation === 'nats-jetstream') {
    const client = endpoint('client');
    return { resource: container({ image: 'nats:2.11-alpine', command: ['-js', '-sd', '/data'], ports: [{ name: 'client', containerPort: 4222, protocol: 'tcp' }], environment: [], volumes: [{ name: `${provider.id}-data`, mountPath: '/data', retained: true }], health: { kind: 'tcp', portBinding: client.id, timeoutMs: 30_000 } }), bindings: [client] };
  }
  if (provider.interface === 'ObjectStorage' && provider.implementation === 's3') {
    const accessKey = credential('access-key');
    const secretKey = credential('secret-key');
    const api = endpoint('api');
    return { resource: container({ image: 'minio/minio:RELEASE.2025-07-23T15-54-02Z', command: ['server', '/data', '--address', ':9000'], ports: [{ name: 'api', containerPort: 9000, protocol: 'http' }], environment: [{ name: 'MINIO_ROOT_USER', binding: accessKey.id }, { name: 'MINIO_ROOT_PASSWORD', binding: secretKey.id }], volumes: [{ name: `${provider.id}-data`, mountPath: '/data', retained: true }], health: { kind: 'http', path: '/minio/health/ready', portBinding: api.id, timeoutMs: 60_000 } }), bindings: [accessKey, secretKey, api] };
  }
  if (provider.interface === 'AnalyticalDatabase' && provider.implementation === 'clickhouse') {
    const http = endpoint('http');
    const password = credential('password');
    return { resource: container({ image: 'clickhouse/clickhouse-server:25.7-alpine', ports: [{ name: 'http', containerPort: 8123, protocol: 'http' }], environment: [{ name: 'CLICKHOUSE_USER', binding: 'literal:applik8s' }, { name: 'CLICKHOUSE_PASSWORD', binding: password.id }, { name: 'CLICKHOUSE_DB', binding: 'literal:applik8s' }, { name: 'CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT', binding: 'literal:1' }], volumes: [{ name: `${provider.id}-data`, mountPath: '/var/lib/clickhouse', retained: true }], health: { kind: 'http', path: '/ping', portBinding: http.id, timeoutMs: 60_000 } }), bindings: [http, password] };
  }
  if (provider.interface === 'Observability' && ['local-otel', 'clickstack', 'cloudwatch'].includes(provider.implementation)) {
    const otlp = endpoint('otlp');
    const ui = endpoint('ui');
    return {
      resource: container({
        image: 'grafana/otel-lgtm:0.30.0',
        ports: [
          { name: 'otlp', containerPort: 4318, protocol: 'http' },
          { name: 'ui', containerPort: 3000, protocol: 'http' },
        ],
        environment: [],
        volumes: [{ name: `${provider.id}-data`, mountPath: '/data', retained: true }],
        health: { kind: 'tcp', portBinding: otlp.id, timeoutMs: 90_000 },
      }),
      bindings: [otlp, ui],
    };
  }
  if (provider.interface === 'Observability' && provider.implementation === 'otlp') {
    const configuredEndpoint = typeof provider.config?.endpoint === 'string' ? provider.config.endpoint : undefined;
    if (!configuredEndpoint) return { bindings: [], diagnostic: { severity: 'error', code: 'LOCAL_PROVIDER_UNRESOLVED', message: 'External OTLP observability requires an endpoint.', subjectId: provider.id } };
    const otlp: LocalSupervisorBinding = { id: `endpoint:${provider.id}:otlp`, owner: id, kind: 'endpoint', sensitivity: 'public', value: configuredEndpoint };
    return {
      resource: { ...common, kind: 'external', provider: 'otlp', responsibility: 'The caller owns availability, authentication, retention, and deletion of the OTLP endpoint.', health: { kind: 'external', timeoutMs: 30_000 } },
      bindings: [otlp],
    };
  }
  if (provider.interface === 'Scheduler' && provider.implementation === 'hatchet-scheduler') {
    const scheduler = jsonObject(provider.config?.scheduler);
    if (scheduler?.kind !== 'hatchet-scheduler') {
      return {
        bindings: [],
        diagnostic: {
          severity: 'error',
          code: 'LOCAL_PROVIDER_UNRESOLVED',
          message: `Scheduler provider ${provider.id} has no Hatchet scheduler configuration.`,
          subjectId: provider.id,
        },
      };
    }
    const explicitWorkflowEngine = jsonObject(scheduler.workflowEngine);
    const sharedWorkflowEngine = graph.nodes.find(
      (node): node is ApplicationProviderNode =>
        node.kind === 'provider'
        && node.interface === 'WorkflowEngine'
        && node.implementation === 'hatchet'
        && !node.config?.qualification,
    );
    if (!explicitWorkflowEngine && sharedWorkflowEngine) return { bindings: [] };
    return localProviderResource({
      ...provider,
      name: 'WorkflowEngine',
      interface: 'WorkflowEngine',
      implementation: 'hatchet',
      config: { kind: 'hatchet', ...(explicitWorkflowEngine ?? {}) },
    }, target, cwd, graph);
  }
  if (provider.interface === 'WorkflowEngine' && provider.implementation === 'hatchet') {
    const databaseId = `${id}.database`;
    const databaseEndpoint: LocalSupervisorBinding = {
      id: `endpoint:${provider.id}:database`, owner: databaseId, kind: 'endpoint', sensitivity: 'public',
      value: `applik8s-local://${provider.id}/database`, format: 'url',
    };
    const api = endpoint('api');
    const grpc = endpoint('grpc', 'authority');
    const workerToken: LocalSupervisorBinding = {
      id: `workflow:${provider.id}:worker-token`, owner: id, kind: 'targetOutput', sensitivity: 'sensitive',
    };
    const config = localProviderConfig(provider);
    const serverVersion = typeof config.serverVersion === 'string' && /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(config.serverVersion)
      ? config.serverVersion
      : 'v0.94.10';
    const database: LocalSupervisorContainer = {
      id: databaseId,
      kind: 'container',
      image: 'postgres:17-alpine',
      command: ['postgres', '-c', 'max_connections=200'],
      ports: [{ name: 'database', containerPort: 5432, protocol: 'tcp' }],
      environment: [
        { name: 'POSTGRES_USER', binding: 'literal:hatchet' },
        { name: 'POSTGRES_PASSWORD', binding: 'literal:hatchet' },
        { name: 'POSTGRES_DB', binding: 'literal:hatchet' },
      ],
      volumes: [{ name: `${provider.id}-database`, mountPath: '/var/lib/postgresql/data', retained: true }],
      dependsOn: [],
      lifecycle: common.lifecycle,
      health: { kind: 'tcp', portBinding: databaseEndpoint.id, timeoutMs: 60_000 },
      provenance: common.provenance,
    };
    const workflowEngine: LocalSupervisorContainer = {
      ...common,
      kind: 'container',
      image: `ghcr.io/hatchet-dev/hatchet/hatchet-lite:${serverVersion}`,
      ports: [
        { name: 'api', containerPort: 8888, protocol: 'http' },
        { name: 'grpc', containerPort: 7077, protocol: 'tcp' },
      ],
      environment: [
        {
          name: 'DATABASE_URL',
          template: [
            { kind: 'literal', value: 'postgresql://hatchet:hatchet@' },
            { kind: 'binding', binding: databaseEndpoint.id, transform: 'authority' },
            { kind: 'literal', value: '/hatchet?sslmode=disable' },
          ],
        },
        { name: 'SERVER_AUTH_COOKIE_DOMAIN', binding: 'literal:localhost' },
        { name: 'SERVER_AUTH_COOKIE_INSECURE', binding: 'literal:t' },
        { name: 'SERVER_AUTH_SET_EMAIL_VERIFIED', binding: 'literal:t' },
        { name: 'SERVER_GRPC_BIND_ADDRESS', binding: 'literal:0.0.0.0' },
        { name: 'SERVER_GRPC_INSECURE', binding: 'literal:t' },
        { name: 'SERVER_GRPC_BROADCAST_ADDRESS', binding: grpc.id },
        { name: 'SERVER_GRPC_PORT', binding: 'literal:7077' },
        { name: 'SERVER_INTERNAL_CLIENT_INTERNAL_GRPC_BROADCAST_ADDRESS', binding: 'literal:localhost:7077' },
        { name: 'SERVER_URL', binding: api.id },
      ],
      volumes: [{ name: `${provider.id}-config`, mountPath: '/config', retained: true }],
      dependsOn: [databaseId],
      health: { kind: 'tcp', portBinding: grpc.id, timeoutMs: 120_000 },
      readyOutputs: [{
        binding: workerToken.id,
        command: [
          './hatchet-admin', 'token', 'create', '--config', './config',
          '--tenant-id', '707d0855-80ab-4e1f-a156-f1c4546cbf52',
          '--expiresIn', '24h',
        ],
        encoding: 'trimmed-stdout',
      }],
    };
    return { resources: [database, workflowEngine], bindings: [databaseEndpoint, api, grpc, workerToken] };
  }
  if (target === 'aws-local' && awsCompatibleInterface(provider.interface)) {
    return { bindings: [], diagnostic: { severity: 'error', code: 'LOCAL_TARGET_INCOMPATIBLE', message: `${provider.interface}/${provider.implementation} has no pinned MiniStack lowering.`, subjectId: provider.id } };
  }
  return { bindings: [] };
}

function miniStackResource(request: CompileLocalSupervisorPlanRequest): {
  readonly resource: LocalSupervisorContainer;
  readonly bindings: readonly LocalSupervisorBinding[];
} {
  if (!request.allowDockerSocket) {
    return {
      resource: {
        id: 'target:ministack', kind: 'container',
        image: 'ministackorg/ministack:1.4.20-full@sha256:42bd7575bb0be3710e5196a32b6adeb9c96b049e6cf6114c8ae8de90fc8e3e89',
        ports: [{ name: 'aws', containerPort: 4566, protocol: 'http' }],
        environment: [], volumes: [], dependsOn: [],
        lifecycle: { ownership: 'application', retention: 'retained' },
        health: { kind: 'http', path: '/_ministack/health', portBinding: 'endpoint:target:ministack:aws', timeoutMs: 60_000 },
        provenance: { graphNodeId: 'target.aws-local' },
      },
      bindings: [
        { id: 'endpoint:target:ministack:aws', owner: 'target:ministack', kind: 'endpoint', sensitivity: 'public', value: 'applik8s-local://target:ministack/aws' },
        { id: 'credential:target:ministack:access-key', owner: 'target:ministack', kind: 'credential', sensitivity: 'sensitive' },
        { id: 'credential:target:ministack:secret-key', owner: 'target:ministack', kind: 'credential', sensitivity: 'sensitive' },
      ],
    };
  }
  const base = miniStackResource({ ...request, allowDockerSocket: false });
  return {
    ...base,
    resource: {
      ...base.resource,
      environment: [
        { name: 'PERSIST_STATE', binding: 'literal:1' },
        { name: 'RDS_PERSIST', binding: 'literal:1' },
        { name: 'S3_PERSIST', binding: 'literal:1' },
        { name: 'AWS_DEFAULT_REGION', binding: 'literal:us-east-1' },
      ],
      volumes: [
        { name: 'state', mountPath: '/tmp/ministack-state', retained: true },
        { name: 's3', mountPath: '/tmp/ministack-data/s3', retained: true },
        { name: 'docker-socket', mountPath: '/var/run/docker.sock', retained: false, hostPath: '/var/run/docker.sock' },
      ],
    },
  };
}

function awsCompatibleInterface(value: string): boolean {
  return ['TransactionalDatabase', 'IndexStore', 'ObjectStorage', 'EventLog', 'Queue', 'Scheduler', 'ApplicationHost'].includes(value);
}

function localFrameworkCredentialAuthority(
  artifacts: readonly ApplicationLocalRuntimeArtifact[],
  applicationHostCredentials: readonly ApplicationFrameworkCredentialDependency[],
): { readonly resource: LocalSupervisorResource; readonly bindings: readonly LocalSupervisorBinding[] } | undefined {
  const credentials = new Map<string, ApplicationFrameworkCredentialDependency>();
  for (const credential of artifacts.flatMap(({ frameworkCredentials }) => frameworkCredentials ?? [])) {
    credentials.set(credential.kind, credential);
  }
  for (const credential of applicationHostCredentials) credentials.set(credential.kind, credential);
  if (artifacts.some(({ role }) => role === 'operator')) {
    credentials.set('local-resource', {
      kind: 'local-resource',
      environmentName: 'APPLIK8S_LOCAL_RESOURCE_TOKEN',
    });
  }
  if (credentials.size === 0) return undefined;
  const id = 'authority:framework-credentials';
  return {
    resource: {
      id,
      kind: 'external',
      provider: 'local-credential-authority',
      responsibility: 'The local supervisor generates isolated credentials and persists them only in its mode-0600 credential store.',
      dependsOn: [],
      lifecycle: { ownership: 'application', retention: 'retained' },
      health: { kind: 'external', timeoutMs: 1_000 },
      provenance: { graphNodeId: 'framework.credentials' },
    },
    bindings: [...credentials.keys()].sort().map((name) => ({ id: `credential:framework:${name}`, owner: id, kind: 'credential' as const, sensitivity: 'sensitive' as const })),
  };
}

interface LocalHostEnvironmentCredential {
  readonly secretName: string;
  readonly key: string;
  readonly sourceEnvironment: string;
  readonly binding: string;
}

function localHostEnvironmentCredentialAuthority(
  generatedSecrets: readonly ApplicationGeneratedSecretRequirement[],
): {
  readonly resource: LocalSupervisorResource;
  readonly bindings: readonly LocalSupervisorBinding[];
} | undefined {
  const sources = localHostEnvironmentCredentials(generatedSecrets);
  if (sources.length === 0) return undefined;
  const id = 'authority:host-environment';
  return {
    resource: {
      id,
      kind: 'external',
      provider: 'operation-host-environment',
      responsibility: 'The operation host supplies only explicitly declared variable names. Values never enter the local plan, state, logs, or generated credential store.',
      dependsOn: [],
      lifecycle: { ownership: 'external', retention: 'external' },
      health: { kind: 'external', timeoutMs: 1_000 },
      provenance: { graphNodeId: 'framework.hostEnvironment' },
    },
    bindings: sources.map((source) => ({
      id: source.binding,
      owner: id,
      kind: 'hostEnvironment',
      sensitivity: 'sensitive',
      sourceEnvironment: source.sourceEnvironment,
    })),
  };
}

function localHostEnvironmentCredentials(
  generatedSecrets: readonly ApplicationGeneratedSecretRequirement[],
): readonly LocalHostEnvironmentCredential[] {
  const candidates: Array<Omit<LocalHostEnvironmentCredential, 'binding'>> = [];
  for (const requirement of generatedSecrets) {
    for (const [key, value] of Object.entries(requirement.values)) {
      if (value.kind !== 'hostEnvironment') continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.name)) {
        throw new Error(`Generated Secret ${requirement.namespace}/${requirement.name}/${key} has invalid host environment variable ${value.name}.`);
      }
      candidates.push({
        secretName: requirement.name,
        key,
        sourceEnvironment: value.name,
      });
    }
  }
  const bySecretKey = new Map<string, Omit<LocalHostEnvironmentCredential, 'binding'>>();
  for (const candidate of candidates) {
    const key = localSecretKey(candidate.secretName, candidate.key);
    const prior = bySecretKey.get(key);
    if (prior && prior.sourceEnvironment !== candidate.sourceEnvironment) {
      throw new Error(`Local host environment maps Secret ${candidate.secretName}/${candidate.key} to both ${prior.sourceEnvironment} and ${candidate.sourceEnvironment}.`);
    }
    bySecretKey.set(key, candidate);
  }
  return [...bySecretKey.values()]
    .map((candidate) => ({
      ...candidate,
      binding: `host-environment:${sha256Hex(`${candidate.secretName}\0${candidate.key}\0${candidate.sourceEnvironment}`).slice(0, 24)}`,
    }))
    .sort((left, right) => left.binding.localeCompare(right.binding));
}

function localSecretKey(secretName: string, key: string): string {
  return `${secretName}\0${key}`;
}

function awsLocalRuntimeEnvironment(
  plan: ApplicationAwsDeploymentPlan,
  workloadNodeId: string,
  options: {
    readonly providerNodeIds?: readonly string[];
    readonly scheduleAccess?: boolean;
    readonly eventConsumer?: string;
  } = {},
): readonly LocalSupervisorProcess['environment'][number][] {
  const workload = plan.resources.find(({ semanticNodeId, service, resourceType }) =>
    semanticNodeId === workloadNodeId
    && service === 'ecs'
    && ['fargate-service', 'fargate-runtime-service', 'fargate-worker'].includes(resourceType));
  const providerIds = new Set(options.providerNodeIds ?? []);
  const configuredResourceIds = new Set([
    ...awsPlanStringArray(workload, 'runtimePublicOutputResourceIds'),
    ...awsPlanStringArray(workload, 'eventStreamResourceIds'),
    ...awsPlanStringArray(workload, 'actorRuntimeResourceIds'),
    ...awsPlanStringArray(workload, 'lakehouseResourceIds'),
    ...awsPlanStringArray(workload, 'observabilityResourceIds'),
    ...awsPlanStringArray(workload, 'runtimeSecretResourceIds'),
  ]);
  if (!workload) {
    for (const resource of plan.resources) {
      if (resource.semanticNodeId && providerIds.has(resource.semanticNodeId)) configuredResourceIds.add(resource.id);
    }
  }
  const exactResources = plan.resources.filter(({ id }) => configuredResourceIds.has(id));
  const runtimeBindingNames = new Set(awsPlanStringArray(workload, 'runtimeBindingEnvironmentNames'));
  if (!workload) {
    const providerResourceIds = new Set(exactResources.map(({ id }) => id));
    for (const binding of plan.runtimeBindings) if (providerResourceIds.has(binding.resourceId)) runtimeBindingNames.add(binding.environmentName);
  }
  const scheduleAccess = options.scheduleAccess === true || workload?.configuration.scheduleAccess === true;
  const environment: LocalSupervisorProcess['environment'][number][] = [];
  const add = (name: string, binding: string): void => {
    if (!environment.some((entry) => entry.name === name)) environment.push({ name, binding });
  };
  const output = (resourceId: string, name: string): string => awsLocalOutputBindingId(resourceId, name);
  const exactRuntimeBindings = plan.runtimeBindings.filter(({ environmentName }) => runtimeBindingNames.has(environmentName));
  const requiresAws = exactResources.length > 0 || exactRuntimeBindings.length > 0 || scheduleAccess;
  if (requiresAws) {
    add('AWS_ENDPOINT_URL', 'endpoint:target:ministack:aws');
    add('APPLIK8S_AWS_ENDPOINT', 'endpoint:target:ministack:aws');
    add('AWS_ACCESS_KEY_ID', 'credential:target:ministack:access-key');
    add('AWS_SECRET_ACCESS_KEY', 'credential:target:ministack:secret-key');
    add('AWS_REGION', 'literal:us-east-1');
    add('AWS_DEFAULT_REGION', 'literal:us-east-1');
    add('APPLIK8S_AWS_ACCOUNT_ID', 'literal:000000000001');
  }
  for (const binding of exactRuntimeBindings) {
    const index = plan.runtimeBindings.findIndex(({ id }) => id === binding.id);
    if (index < 0) throw new Error(`AWS-local runtime binding ${binding.id} is absent from its canonical plan.`);
    add(`APPLIK8S_AWS_RUNTIME_BINDING_${index}`, awsLocalRuntimeBindingId(binding.id));
  }
  if (exactRuntimeBindings.length > 0) add('NODE_OPTIONS', 'literal:--import=@applik8s/runtime-aws/bootstrap');

  for (const resource of exactResources) {
    if (!resource.semanticNodeId) continue;
    for (const declared of resource.outputs.filter(({ sensitivity }) => sensitivity === 'public')) {
      add(awsLocalOutputEnvironmentName(output(resource.id, declared.name)), output(resource.id, declared.name));
    }
  }

  const streamIds = new Set([
    ...awsPlanStringArray(workload, 'eventStreamResourceIds'),
    ...(typeof workload?.configuration.eventStreamResourceId === 'string' ? [workload.configuration.eventStreamResourceId] : []),
    ...(options.eventConsumer ? exactResources.filter(({ service, resourceType }) => service === 'kinesis' && resourceType === 'stream').map(({ id }) => id) : []),
  ]);
  const streams = plan.resources.filter(({ id, service, resourceType }) => streamIds.has(id) && service === 'kinesis' && resourceType === 'stream');
  if (streams.length === 1) {
    add('APPLIK8S_EVENT_TRANSPORT', 'literal:kinesis');
    add('APPLIK8S_EVENT_LOG_PROVIDER', 'literal:kinesis');
    add('APPLIK8S_KINESIS_STREAM', output(streams[0]!.id, 'streamName'));
  }
  if (workload?.configuration.eventTransport === 'kinesis') {
    const checkpointId = typeof workload.configuration.checkpointTableResourceId === 'string'
      ? workload.configuration.checkpointTableResourceId
      : undefined;
    if (checkpointId) add('APPLIK8S_KINESIS_CHECKPOINT_TABLE', output(checkpointId, 'tableName'));
    if (typeof workload.configuration.consumer === 'string') add('APPLIK8S_KINESIS_CONSUMER', `literal:${workload.configuration.consumer}`);
    if (typeof workload.configuration.processorConcurrency === 'number') add('APPLIK8S_PROCESSOR_CONCURRENCY', `literal:${workload.configuration.processorConcurrency}`);
    if (typeof workload.configuration.databaseEnvironmentName === 'string') add('APPLIK8S_DATABASE_URL_BINDING', `literal:${workload.configuration.databaseEnvironmentName}`);
  }
  if (!workload && options.eventConsumer && streams.length === 1) {
    const checkpoint = plan.resources.find(({ id }) => id === 'framework.kinesis-checkpoints');
    if (!checkpoint) throw new Error(`AWS-local event consumer ${options.eventConsumer} has no DynamoDB checkpoint authority.`);
    add('APPLIK8S_KINESIS_CHECKPOINT_TABLE', output(checkpoint.id, 'tableName'));
    add('APPLIK8S_KINESIS_CONSUMER', `literal:${options.eventConsumer}`);
  }

  const objectStores = exactResources.filter(({ service, resourceType, configuration }) =>
    service === 's3'
    && resourceType === 'bucket'
    && configuration.purpose !== 'athena-query-results'
    && configuration.authority !== 'celld-fleet');
  if (objectStores.length === 1) {
    const store = objectStores[0]!;
    add('APPLIK8S_OBJECT_STORAGE_ENABLED', 'literal:true');
    add('APPLIK8S_OBJECT_STORAGE_BUCKET', output(store.id, 'bucketName'));
    add('APPLIK8S_OBJECT_STORAGE_REGION', `literal:${plan.region}`);
    add('APPLIK8S_OBJECT_STORAGE_PREFIX', `literal:${typeof store.configuration.prefix === 'string' ? store.configuration.prefix : ''}`);
    add('APPLIK8S_OBJECT_STORAGE_ENDPOINT', 'endpoint:target:ministack:aws');
    add('APPLIK8S_OBJECT_STORAGE_FORCE_PATH_STYLE', 'literal:true');
  }
  for (const binding of awsPlanObjectArray(workload, 'objectStorageBindings')) {
    const purpose = typeof binding.purpose === 'string' ? binding.purpose : undefined;
    const resourceId = typeof binding.resourceId === 'string' ? binding.resourceId : undefined;
    const store = resourceId ? plan.resources.find(({ id, service, resourceType }) => id === resourceId && service === 's3' && resourceType === 'bucket') : undefined;
    if (!store || (purpose !== 'task' && purpose !== 'rebuild')) throw new Error(`AWS-local object binding ${stableJson(binding)} is invalid.`);
    const prefix = purpose === 'task' ? 'APPLIK8S_TASK_OBJECT' : 'APPLIK8S_REBUILD_OBJECT';
    add(`${prefix}_BUCKET`, output(store.id, 'bucketName'));
    add(`${prefix}_REGION`, `literal:${plan.region}`);
    add(`${prefix}_PREFIX`, `literal:${typeof store.configuration.prefix === 'string' ? store.configuration.prefix : ''}`);
    add(`${prefix}_ENDPOINT`, 'endpoint:target:ministack:aws');
    add(`${prefix}_FORCE_PATH_STYLE`, 'literal:true');
  }

  if (scheduleAccess) {
    add('APPLIK8S_AWS_SCHEDULE_QUEUE_URL', output('scheduler.admission', 'queueUrl'));
    add('APPLIK8S_AWS_SCHEDULE_QUEUE_ARN', output('scheduler.admission', 'queueArn'));
    add('APPLIK8S_AWS_SCHEDULE_DLQ_ARN', output('scheduler.dead-letter', 'queueArn'));
    const scheduleGroup = plan.resources.find(({ id }) => id === 'scheduler.group');
    if (!scheduleGroup) throw new Error('AWS-local schedule access has no schedule group authority.');
    add('APPLIK8S_AWS_SCHEDULE_GROUP', `literal:${scheduleGroup.physicalName}`);
    add('APPLIK8S_AWS_SCHEDULE_ROLE_ARN', output('scheduler.execution-role', 'roleArn'));
  }
  const actor = exactResources.find(({ service, resourceType }) => service === 'ecs' && resourceType === 'celld-fleet');
  if (actor) add('APPLIK8S_ACTOR_ENDPOINT', output(actor.id, 'endpoint'));

  const lakehouse = awsLocalLakehouseBindings(plan, exactResources);
  if (lakehouse) add('APPLIK8S_AWS_LAKEHOUSE_BINDINGS', `literal:${stableJson(lakehouse)}`);
  return environment;
}

function awsPlanStringArray(resource: ApplicationAwsPlanResource | undefined, key: string): readonly string[] {
  const value = resource?.configuration[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function awsPlanObjectArray(resource: ApplicationAwsPlanResource | undefined, key: string): readonly JsonObject[] {
  const value = resource?.configuration[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is JsonObject => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

function awsLocalLakehouseBindings(
  plan: ApplicationAwsDeploymentPlan,
  resources: readonly ApplicationAwsPlanResource[],
): Readonly<Record<string, unknown>> | undefined {
  const datasets = resources.filter(({ service, resourceType }) => service === 's3' && resourceType === 'lakehouse-dataset');
  const catalogs = resources.filter(({ service, resourceType }) => service === 'glue' && resourceType === 'catalog-database');
  const queries = resources.filter(({ service, resourceType }) => service === 'athena' && resourceType === 'workgroup');
  if (datasets.length === 0 && queries.length === 0) return undefined;
  return {
    datasets: Object.fromEntries(datasets.map((dataset) => {
      const qualification = typeof dataset.configuration.qualification === 'string' ? dataset.configuration.qualification : dataset.semanticNodeId ?? dataset.id;
      const catalogId = typeof dataset.configuration.catalogResourceId === 'string' ? dataset.configuration.catalogResourceId : undefined;
      const catalog = catalogs.find(({ id }) => id === catalogId);
      if (!catalog) throw new Error(`AWS-local lakehouse dataset ${dataset.id} has no exact catalog binding.`);
      return [qualification, {
        bucket: dataset.physicalName,
        prefix: typeof dataset.configuration.prefix === 'string' ? dataset.configuration.prefix : 'lakehouse',
        region: typeof dataset.configuration.region === 'string' ? dataset.configuration.region : plan.region,
        catalogDatabase: catalog.physicalName,
      }];
    })),
    queries: Object.fromEntries(queries.map((query) => {
      const qualification = typeof query.configuration.qualification === 'string' ? query.configuration.qualification : query.semanticNodeId ?? query.id;
      return [qualification, { workgroup: query.physicalName, region: typeof query.configuration.region === 'string' ? query.configuration.region : plan.region }];
    })),
  };
}

function localRuntimeEnvironment(
  request: CompileLocalSupervisorPlanRequest,
  providers: readonly ApplicationProviderNode[],
  declaredBindings: readonly LocalSupervisorBinding[],
  diagnostics: LocalSupervisorDiagnostic[],
  frameworkCredentials: readonly ApplicationFrameworkCredentialDependency[],
): readonly LocalSupervisorProcess['environment'][number][] {
  const environment: LocalSupervisorProcess['environment'][number][] = [];
  const add = (name: string, entry: { readonly binding: string } | { readonly template: readonly LocalSupervisorEnvironmentSegment[] }): void => {
    if (!environment.some((candidate) => candidate.name === name)) environment.push({ name, ...entry });
  };
  const provider = (providerInterface: string, preferredNodeId?: string): ApplicationProviderNode | undefined =>
    providers.find((candidate) => candidate.id === preferredNodeId)
    ?? providers.find((candidate) => candidate.interface === providerInterface);
  const bindingExists = (id: string): boolean => declaredBindings.some((candidate) => candidate.id === id);
  const providerIds = new Set(providers.map(({ id }) => id));
  const hostCredentials = new Map(
    localHostEnvironmentCredentials(request.generatedSecrets ?? [])
      .map((credential) => [localSecretKey(credential.secretName, credential.key), credential]),
  );
  for (const binding of request.graph.providerBindings.filter(({ provider: providerRef }) => providerIds.has(providerRef.nodeId))) {
    for (const [name, value] of Object.entries(binding.runtime.env ?? {})) {
      if (typeof value === 'string' && !value.includes('${')) add(name, { binding: `literal:${value}` });
    }
    for (const [name, secretBinding] of Object.entries(binding.runtime.secretEnv ?? {})) {
      const secretName = secretBinding.secret.name;
      const key = secretBinding.key;
      if (typeof secretName !== 'string' || typeof key !== 'string') {
        diagnostics.push({
          severity: 'error',
          code: 'LOCAL_PROVIDER_UNRESOLVED',
          message: `Local callable provider ${binding.provider.nodeId} has a non-concrete Secret binding for ${name}.`,
          subjectId: binding.provider.nodeId,
        });
        continue;
      }
      const hostCredential = hostCredentials.get(localSecretKey(secretName, key));
      if (hostCredential && bindingExists(hostCredential.binding)) {
        add(name, { binding: hostCredential.binding });
      }
    }
  }
  const databaseProviders = new Map<string, ApplicationProviderNode>();
  const postgresModels = request.graph.nodes.filter((node): node is Extract<ApplicationGraphNode, { kind: 'model' }> => node.kind === 'model' && node.runtime?.provider === 'postgres');
  for (const model of postgresModels) {
    const selected = provider('TransactionalDatabase', model.database.nodeId);
    if (!selected) continue;
    databaseProviders.set(selected.id, selected);
    const password = `credential:${selected.id}:password`;
    const endpoint = `endpoint:${selected.id}:postgres`;
    if (!bindingExists(password) || !bindingExists(endpoint)) continue;
    const runtime = model.runtime;
    if (!runtime) continue;
    add(runtime.connectionEnvName, { template: [
      { kind: 'literal', value: 'postgresql://applik8s:' },
      { kind: 'binding', binding: password },
      { kind: 'literal', value: '@' },
      { kind: 'binding', binding: endpoint, transform: 'authority' },
      { kind: 'literal', value: `/${runtime.database}` },
    ] });
  }
  const primaryDatabase = [...databaseProviders.values()][0] ?? provider('TransactionalDatabase');
  if (primaryDatabase) {
    const model = postgresModels.find((candidate) => candidate.database.nodeId === primaryDatabase.id);
    const existing = model?.runtime?.connectionEnvName ? environment.find(({ name }) => name === model.runtime?.connectionEnvName) : undefined;
    const password = `credential:${primaryDatabase.id}:password`;
    const endpoint = `endpoint:${primaryDatabase.id}:postgres`;
    const databaseTemplate = existing && 'template' in existing
      ? existing.template
      : bindingExists(password) && bindingExists(endpoint)
        ? [
            { kind: 'literal' as const, value: 'postgresql://applik8s:' },
            { kind: 'binding' as const, binding: password },
            { kind: 'literal' as const, value: '@' },
            { kind: 'binding' as const, binding: endpoint, transform: 'authority' as const },
            { kind: 'literal' as const, value: '/applik8s' },
          ]
        : undefined;
    if (databaseTemplate) {
      add('DATABASE_URL', { template: databaseTemplate });
      add('APPLIK8S_SIGNAL_DATABASE_URL', { template: databaseTemplate });
      if (providers.some(({ interface: providerInterface }) => providerInterface === 'Scheduler')) {
        add('APPLIK8S_SCHEDULE_DATABASE_URL', { template: databaseTemplate });
      }
    }
  }
  const processor = request.graph.nodes.find((node): node is Extract<ApplicationGraphNode, { kind: 'processor' }> => node.kind === 'processor');
  const eventProviderId = processor?.eventLog?.nodeId;
  const events = provider('EventLog', eventProviderId);
  if (events && bindingExists(`endpoint:${events.id}:client`)) {
    const config = localProviderConfig(events);
    add('APPLIK8S_EVENT_LOG_PROVIDER', { binding: 'literal:nats-jetstream' });
    add('APPLIK8S_NATS_SERVERS', { template: [{ kind: 'literal', value: '["' }, { kind: 'binding', binding: `endpoint:${events.id}:client` }, { kind: 'literal', value: '"]' }] });
    add('APPLIK8S_NATS_STREAM', { binding: `literal:${typeof config.stream === 'string' ? config.stream : 'APPLIK8S_EVENTS'}` });
    add('APPLIK8S_NATS_SUBJECT_PREFIX', { binding: `literal:${typeof config.subjectPrefix === 'string' ? config.subjectPrefix : 'applik8s'}` });
  }
  const workflows = provider('WorkflowEngine');
  if (workflows && bindingExists(`workflow:${workflows.id}:worker-token`)) {
    add('HATCHET_CLIENT_TOKEN', { binding: `workflow:${workflows.id}:worker-token` });
    add('HATCHET_CLIENT_HOST_PORT', { binding: `endpoint:${workflows.id}:grpc` });
    add('HATCHET_CLIENT_API_URL', { binding: `endpoint:${workflows.id}:api` });
    add('HATCHET_CLIENT_TLS_STRATEGY', { binding: 'literal:none' });
  }
  const qualifiedHatchetSchedulers = providers.filter((candidate) =>
    candidate.interface === 'Scheduler'
    && candidate.implementation === 'hatchet-scheduler');
  for (const scheduler of qualifiedHatchetSchedulers) {
    const schedulerConfig = jsonObject(scheduler.config?.scheduler) ?? {};
    const explicitWorkflowEngine = jsonObject(schedulerConfig.workflowEngine);
    const owner = !explicitWorkflowEngine && workflows ? workflows : scheduler;
    if (!bindingExists(`workflow:${owner.id}:worker-token`)) continue;
    const suffix = sha256Hex(scheduler.id).slice(0, 12).toUpperCase();
    add(`APPLIK8S_HATCHET_SCHEDULER_TOKEN_${suffix}`, {
      binding: `workflow:${owner.id}:worker-token`,
    });
    add(`APPLIK8S_HATCHET_SCHEDULER_HOST_${suffix}`, {
      binding: `endpoint:${owner.id}:grpc`,
    });
    add(`APPLIK8S_HATCHET_SCHEDULER_API_${suffix}`, {
      binding: `endpoint:${owner.id}:api`,
    });
    add(`APPLIK8S_HATCHET_SCHEDULER_TLS_${suffix}`, {
      binding: 'literal:none',
    });
  }
  const index = provider('IndexStore');
  if (index && bindingExists(`endpoint:${index.id}:valkey`)) {
    add('APPLIK8S_VALKEY_HOST', { template: [{ kind: 'binding', binding: `endpoint:${index.id}:valkey`, transform: 'hostname' }] });
    add('APPLIK8S_VALKEY_PORT', { template: [{ kind: 'binding', binding: `endpoint:${index.id}:valkey`, transform: 'port' }] });
    add('APPLIK8S_REBUILD_VALKEY_HOST', { template: [{ kind: 'binding', binding: `endpoint:${index.id}:valkey`, transform: 'hostname' }] });
    add('APPLIK8S_REBUILD_VALKEY_PORT', { template: [{ kind: 'binding', binding: `endpoint:${index.id}:valkey`, transform: 'port' }] });
  }
  const analytics = provider('AnalyticalDatabase');
  if (analytics && bindingExists(`endpoint:${analytics.id}:http`)) {
    add('APPLIK8S_CLICKHOUSE_ENDPOINT', { binding: `endpoint:${analytics.id}:http` });
    add('APPLIK8S_CLICKHOUSE_DATABASE', { binding: 'literal:applik8s' });
    add('APPLIK8S_CLICKHOUSE_USERNAME', { binding: 'literal:applik8s' });
    add('APPLIK8S_CLICKHOUSE_PASSWORD', { binding: `credential:${analytics.id}:password` });
  }
  const objects = provider('ObjectStorage');
  if (objects && bindingExists(`endpoint:${objects.id}:api`)) {
    const config = localProviderConfig(objects);
    add('APPLIK8S_OBJECT_STORAGE_ENABLED', { binding: 'literal:true' });
    add('APPLIK8S_OBJECT_STORAGE_ENDPOINT', { binding: `endpoint:${objects.id}:api` });
    add('APPLIK8S_OBJECT_STORAGE_BUCKET', { binding: `literal:${typeof config.bucket === 'string' ? config.bucket : `${request.graph.metadata.name}-objects`}` });
    add('APPLIK8S_OBJECT_STORAGE_PREFIX', { binding: `literal:${typeof config.prefix === 'string' ? config.prefix : ''}` });
    add('APPLIK8S_OBJECT_STORAGE_REGION', { binding: 'literal:us-east-1' });
    add('APPLIK8S_OBJECT_STORAGE_FORCE_PATH_STYLE', { binding: 'literal:true' });
    add('AWS_ACCESS_KEY_ID', { binding: `credential:${objects.id}:access-key` });
    add('AWS_SECRET_ACCESS_KEY', { binding: `credential:${objects.id}:secret-key` });
  }
  for (const { environmentName, kind } of frameworkCredentials) {
    if (bindingExists(`credential:framework:${kind}`)) add(environmentName, { binding: `credential:framework:${kind}` });
  }
  if (bindingExists('endpoint:runtime:local-resource-authority:http')) add('APPLIK8S_LOCAL_RESOURCE_URL', { binding: 'endpoint:runtime:local-resource-authority:http' });
  add('APPLIK8S_INSTALLATION_SPEC', { binding: `literal:${stableJson(request.installationSpec ?? { name: request.graph.metadata.name, profile: request.profile })}` });
  add('APPLIK8S_PROFILE_VARIANT', { binding: `literal:${request.profile}` });
  add('APPLIK8S_NAMESPACE', { binding: `literal:${typeof request.installationSpec?.name === 'string' ? request.installationSpec.name : request.graph.metadata.name}` });
  add('APPLIK8S_PROCESSOR_CONCURRENCY', { binding: 'literal:16' });
  add('APPLIK8S_PROCESSOR_MAX_ACK_PENDING', { binding: 'literal:16' });
  return environment;
}

/**
 * Returns only providers reachable from one executable semantic boundary.
 *
 * Provider edges point toward their consumers while workload dependency edges
 * point away from the executable node, so both shapes are resolved explicitly.
 * This keeps local execution faithful to production authority: adding an
 * unrelated database, object store, or workflow engine does not place its
 * credentials in every process.
 */
function localProvidersForWorkload(
  workloadNodeId: string,
  graph: ApplicationGraph,
  providers: readonly ApplicationProviderNode[],
): readonly ApplicationProviderNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(workloadNodeId)) return [];
  const closure = new Set<string>([workloadNodeId]);
  const queue = [workloadNodeId];
  const workload = nodes.get(workloadNodeId);
  const hostsApplicationSchedules = workload?.kind === 'server'
    || (workload?.kind === 'provider' && workload.interface === 'ApplicationHost');
  if (hostsApplicationSchedules) {
    for (const node of graph.nodes) {
      if (node.kind !== 'schedule' || closure.has(node.id)) continue;
      closure.add(node.id);
      queue.push(node.id);
    }
  }
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.from.nodeId !== source || closure.has(edge.to.nodeId)) continue;
      const target = nodes.get(edge.to.nodeId);
      if (!target || target.kind === 'provider') continue;
      closure.add(target.id);
      queue.push(target.id);
    }
    for (const dependencyId of applicationWorkloadDependencyNodeIds(nodes.get(source))) {
      if (closure.has(dependencyId) || !nodes.has(dependencyId)) continue;
      closure.add(dependencyId);
      queue.push(dependencyId);
    }
  }

  const providerIds = new Set<string>();
  const availableProviderIds = new Set(providers.map(({ id }) => id));
  for (const edge of graph.edges) {
    if (closure.has(edge.from.nodeId) && availableProviderIds.has(edge.to.nodeId)) providerIds.add(edge.to.nodeId);
    if (closure.has(edge.to.nodeId) && availableProviderIds.has(edge.from.nodeId)) providerIds.add(edge.from.nodeId);
  }
  for (const requirement of graph.providerRequirements) {
    if (!closure.has(requirement.consumer.nodeId)) continue;
    const providerId = requirement.provider?.nodeId;
    if (providerId && availableProviderIds.has(providerId)) providerIds.add(providerId);
  }
  for (const nodeId of closure) {
    for (const providerId of applicationWorkloadProviderNodeIds(nodes.get(nodeId))) {
      if (availableProviderIds.has(providerId)) providerIds.add(providerId);
    }
  }
  return providers.filter(({ id }) => providerIds.has(id));
}

function jsonObject(value: unknown): JsonObject | undefined {
  // typecast: Provider profile data is already constrained to JsonValue by ApplicationProviderNode.config.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function localProviderConfig(provider: ApplicationProviderNode): JsonObject {
  const config = jsonObject(provider.config) ?? {};
  return Object.values(config)
    .map(jsonObject)
    .find((candidate) => candidate?.kind === provider.implementation)
    ?? config;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${sha256Hex(value)}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}
