// typecast-file-boundary: Workflow contract resolution narrows graph nodes and provider configuration into a validated compiler contract.
import type {
  ApplicationCommandHandlerNode,
  ApplicationCommandNode,
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationModelNode,
  ApplicationObjectStoreNode,
  ApplicationProjectionNode,
  ApplicationProviderNode,
  ApplicationQueryNode,
  ApplicationStreamNode,
  ApplicationTaskHandlerNode,
  ApplicationTaskNode,
  ApplicationWorkflowHandlerNode,
  ApplicationWorkflowNode,
  ApplicationWorkflowWorkerNode,
} from '@applik8s/core';
import { applicationGraphStringValue } from '../application-installation-values.js';
import { kubernetesName, objectConfig, stringConfig } from './utilities.js';

const DEFAULT_WORKER_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';

export interface WorkflowContract {
  readonly graphName: string;
  readonly worker: ApplicationWorkflowWorkerNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[];
  readonly workflows: readonly { readonly handler: ApplicationWorkflowHandlerNode; readonly workflow: ApplicationWorkflowNode }[];
  readonly capabilities: readonly ApplicationProviderNode[];
  readonly operationEffects?: WorkflowOperationEffectsContract;
  readonly queryEffects?: WorkflowQueryEffectsContract;
  readonly projectionEffects?: WorkflowProjectionEffectsContract;
	readonly objectEffects?: WorkflowObjectEffectsContract;
  readonly namespace: string;
  readonly engineName: string;
  readonly adminCredentialsSecret: string;
  readonly workerTokenSecret: string;
  readonly tokenKey: string;
  readonly image: string;
  readonly contractNames: Readonly<Record<string, string>>;
}

interface WorkflowTaskOperationContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly handler: ApplicationCommandHandlerNode;
  readonly command: ApplicationCommandNode;
  readonly model: ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
}

interface WorkflowOperationEffectsContract {
  readonly operations: readonly WorkflowTaskOperationContract[];
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly eventLog: ApplicationProviderNode;
  readonly cursorSecret: { readonly name: string; readonly key: string };
}

interface WorkflowTaskQueryContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly query: ApplicationQueryNode;
  readonly gateway: ApplicationGatewayNode & { readonly deployment: NonNullable<ApplicationGatewayNode['deployment']>; readonly cursorSecret: NonNullable<ApplicationGatewayNode['cursorSecret']> };
  readonly endpoint: string;
}

interface WorkflowQueryEffectsContract {
  readonly queries: readonly WorkflowTaskQueryContract[];
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly cursorSecret: { readonly name: string; readonly key: string };
}

export interface WorkflowTaskProjectionContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly projection: ApplicationProjectionNode & { readonly online: NonNullable<ApplicationProjectionNode['online']> };
  readonly stream: ApplicationStreamNode;
  readonly indexProvider: ApplicationProviderNode;
  readonly indexConfig: Readonly<Record<string, unknown>>;
  readonly artifacts: ApplicationObjectStoreNode;
  readonly objectProvider: ApplicationProviderNode;
  readonly objectConfig: Readonly<Record<string, unknown>>;
  readonly rebuildModel?: ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
  readonly bounds: NonNullable<ApplicationTaskHandlerNode['projections']>[number]['bounds'];
}

interface WorkflowProjectionEffectsContract {
  readonly projections: readonly WorkflowTaskProjectionContract[];
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface WorkflowTaskObjectContract {
	readonly taskHandlerId: string;
	readonly alias: string;
	readonly store: ApplicationObjectStoreNode;
	readonly provider: ApplicationProviderNode;
	readonly config: Readonly<Record<string, unknown>>;
}

interface WorkflowObjectEffectsContract {
	readonly objects: readonly WorkflowTaskObjectContract[];
	readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface StructuredGenerationSelectionConfig {
  readonly selector: string;
  readonly cases: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly default: Readonly<Record<string, unknown>>;
}

export function workflowContract(graph: ApplicationGraph, worker: ApplicationWorkflowWorkerNode): WorkflowContract {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const provider = nodes.get(worker.workflowEngine.nodeId);
  if (provider?.kind !== 'provider' || provider.interface !== 'WorkflowEngine' || provider.implementation !== 'hatchet') {
    throw new Error(`Generated workflow worker ${worker.id} requires one resolved Hatchet WorkflowEngine provider.`);
  }
  const tasks: { handler: ApplicationTaskHandlerNode; task: ApplicationTaskNode }[] = [];
  const workflows: { handler: ApplicationWorkflowHandlerNode; workflow: ApplicationWorkflowNode }[] = [];
  const capabilities = new Map<string, ApplicationProviderNode>();
  for (const reference of worker.handlers) {
    const handler = nodes.get(reference.nodeId);
    if (handler?.kind === 'taskHandler') {
      const task = nodes.get(handler.task.nodeId);
      if (task?.kind !== 'task') throw new Error(`Workflow task handler ${handler.id} references missing task ${handler.task.nodeId}.`);
      for (const reference of handler.capabilities ?? []) {
        const capability = nodes.get(reference.nodeId);
        if (capability?.kind !== 'provider' || capability.interface !== reference.interface) throw new Error(`Workflow task handler ${handler.id} references missing capability provider ${reference.nodeId}.`);
        capabilities.set(capability.id, capability);
      }
      tasks.push({ handler, task });
    } else if (handler?.kind === 'workflowHandler') {
      const workflow = nodes.get(handler.workflow.nodeId);
      if (workflow?.kind !== 'workflow') throw new Error(`Workflow handler ${handler.id} references missing workflow ${handler.workflow.nodeId}.`);
      workflows.push({ handler, workflow });
    } else {
      throw new Error(`Generated workflow worker ${worker.id} references invalid handler ${reference.nodeId}.`);
    }
  }
  const config = provider.config ?? {};
  const namespace = applicationGraphStringValue(config.namespace) || 'default';
  const engineName = kubernetesName(stringConfig(config.name) || 'applik8s-hatchet');
  const legacyCredentials = objectConfig(config.credentialsSecret);
  const adminCredentials = objectConfig(config.adminCredentialsSecret);
  const workerToken = objectConfig(config.workerTokenSecret);
  for (const credentials of [legacyCredentials, adminCredentials, workerToken]) {
    const credentialNamespace = applicationGraphStringValue(credentials.namespace);
    if (credentialNamespace && credentialNamespace !== namespace) {
      throw new Error(`Generated workflow worker ${worker.id} cannot read Hatchet Secret ${credentialNamespace}/${stringConfig(credentials.name)} from namespace ${namespace}.`);
    }
  }
  for (const capability of capabilities.values()) validateWorkflowCapability(capability, namespace, worker);
  const operationEffects = workflowOperationEffects(graph, nodes, tasks, namespace, worker);
  const queryEffects = workflowQueryEffects(graph, nodes, tasks, namespace, worker);
  const projectionEffects = workflowProjectionEffects(nodes, tasks, namespace, worker);
	const objectEffects = workflowObjectEffects(nodes, tasks, namespace, worker);
  if (operationEffects && queryEffects && (operationEffects.cursorSecret.name !== queryEffects.cursorSecret.name || operationEffects.cursorSecret.key !== queryEffects.cursorSecret.key)) {
    throw new Error(`Workflow worker ${worker.id} operations and queries must use one service-principal context authority.`);
  }
  if (worker.deployment.scaling.mode === 'kedaHatchetSlots' && !stringConfig(config.tenantId)) {
    throw new Error(`Generated workflow worker ${worker.id} uses KEDA Hatchet task-stat scaling but its WorkflowEngine provider has no tenantId.`);
  }
  return {
    graphName: graph.metadata.name,
    worker,
    provider,
    providerConfig: config,
    tasks,
    workflows,
    capabilities: [...capabilities.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(operationEffects ? { operationEffects } : {}),
    ...(queryEffects ? { queryEffects } : {}),
    ...(projectionEffects ? { projectionEffects } : {}),
		...(objectEffects ? { objectEffects } : {}),
    namespace,
    engineName,
    adminCredentialsSecret: stringConfig(adminCredentials.name) || stringConfig(legacyCredentials.name) || `${engineName}-admin`,
    workerTokenSecret: stringConfig(workerToken.name) || stringConfig(legacyCredentials.name) || (config.provision === false ? `${engineName}-worker` : 'hatchet-client-config'),
    tokenKey: stringConfig(config.tokenKey) || (stringConfig(workerToken.name) || (!stringConfig(legacyCredentials.name) && config.provision !== false) ? 'HATCHET_CLIENT_TOKEN' : 'token'),
    image: stringConfig(objectConfig(config.worker).image) || DEFAULT_WORKER_IMAGE,
    contractNames: Object.fromEntries(graph.nodes.flatMap((node) => node.kind === 'task' || node.kind === 'workflow' ? [[node.id, node.name]] : [])),
  };
}

function workflowObjectEffects(
	nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
	tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
	namespace: string,
	worker: ApplicationWorkflowWorkerNode,
): WorkflowObjectEffectsContract | undefined {
	const objects: WorkflowTaskObjectContract[] = [];
	const aliases: Record<string, Record<string, string>> = {};
	for (const { handler } of tasks) {
		if ((handler.objects?.length ?? 0) === 0) continue;
		const taskAliases: Record<string, string> = {};
		for (const reference of handler.objects ?? []) {
			const store = nodes.get(reference.store.nodeId);
			if (store?.kind !== 'objectStore') throw new Error(`Workflow task ${handler.id} object ${reference.alias} references missing store ${reference.store.nodeId}.`);
			const provider = nodes.get(store.provider.nodeId);
			if (provider?.kind !== 'provider' || provider.interface !== 'ObjectStorage') throw new Error(`Workflow task ${handler.id} object ${reference.alias} references missing ObjectStorage provider ${store.provider.nodeId}.`);
			const config = objectConfig(provider.config?.objectStorage);
			if (stringConfig(config.kind) !== 's3') throw new Error(`Workflow task ${handler.id} object ${reference.alias} requires an S3-compatible ObjectStorage provider.`);
			const secret = objectConfig(config.credentialsSecret);
			assertWorkflowSecretNamespace(secret.namespace, namespace, `Workflow task ${handler.id} object ${reference.alias} ObjectStorage Secret`);
			objects.push({ taskHandlerId: handler.id, alias: reference.alias, store, provider, config });
			taskAliases[reference.alias] = store.id;
		}
		aliases[handler.id] = taskAliases;
	}
	if (objects.length === 0) return undefined;
	const providers = new Set(objects.map((effect) => effect.provider.id));
	if (providers.size !== 1) throw new Error(`Workflow worker ${worker.id} task object stores require one ObjectStorage provider.`);
	return { objects, aliases };
}

function workflowProjectionEffects(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
  namespace: string,
  _worker: ApplicationWorkflowWorkerNode,
): WorkflowProjectionEffectsContract | undefined {
  const projections: WorkflowTaskProjectionContract[] = [];
  const aliases: Record<string, Record<string, string>> = {};
  for (const { handler } of tasks) {
    if ((handler.projections?.length ?? 0) === 0) continue;
    const taskAliases: Record<string, string> = {};
    for (const reference of handler.projections ?? []) {
      const candidate = nodes.get(reference.projection.nodeId);
      if (candidate?.kind !== 'projection' || candidate.storage !== 'online' || !candidate.online) throw new Error(`Workflow task ${handler.id} projection ${reference.alias} is not a generation-scoped online projection.`);
      const projection = candidate as ApplicationProjectionNode & { readonly online: NonNullable<ApplicationProjectionNode['online']> };
      const stream = nodes.get(projection.source.nodeId);
      if (stream?.kind !== 'stream') throw new Error(`Workflow task ${handler.id} projection ${reference.alias} references missing source stream ${candidate.source.nodeId}.`);
      assertWorkflowSecretNamespace(stream.database.secretNamespace, namespace, `Workflow task ${handler.id} projection ${reference.alias} database Secret`);
      const indexProvider = nodes.get(projection.provider.nodeId);
      if (indexProvider?.kind !== 'provider' || indexProvider.interface !== 'IndexStore' || indexProvider.implementation !== 'valkey') throw new Error(`Workflow task ${handler.id} projection ${reference.alias} requires a Valkey-compatible IndexStore provider.`);
      const indexConfig = objectConfig(indexProvider.config?.indexStore);
      const indexNamespace = applicationGraphStringValue(indexConfig.namespace) || namespace;
      if (indexNamespace !== namespace) throw new Error(`Workflow task ${handler.id} projection ${reference.alias} IndexStore is in ${indexNamespace}, but the worker is in ${namespace}.`);
      const indexSecret = objectConfig(objectConfig(indexConfig.authentication).secret);
      assertWorkflowSecretNamespace(indexSecret.namespace, namespace, `Workflow task ${handler.id} projection ${reference.alias} IndexStore Secret`);
      const artifacts = nodes.get(reference.artifacts.nodeId);
      if (artifacts?.kind !== 'objectStore') throw new Error(`Workflow task ${handler.id} projection ${reference.alias} references missing artifact store ${reference.artifacts.nodeId}.`);
      if (!artifacts.contentTypes.includes('application/vnd.applik8s.projection-segment+json') || !artifacts.contentTypes.includes('application/vnd.applik8s.projection-rebuild+json')) {
        throw new Error(`Workflow task ${handler.id} projection ${reference.alias} artifact store must allow the Applik8s projection segment and manifest content types.`);
      }
      const objectProvider = nodes.get(artifacts.provider.nodeId);
      if (objectProvider?.kind !== 'provider' || objectProvider.interface !== 'ObjectStorage') throw new Error(`Workflow task ${handler.id} projection ${reference.alias} references missing ObjectStorage provider ${artifacts.provider.nodeId}.`);
      const objectConfigValue = objectConfig(objectProvider.config?.objectStorage);
      if (stringConfig(objectConfigValue.kind) !== 's3') throw new Error(`Workflow task ${handler.id} projection ${reference.alias} requires an S3-compatible ObjectStorage provider.`);
      const objectSecret = objectConfig(objectConfigValue.credentialsSecret);
      assertWorkflowSecretNamespace(objectSecret.namespace, namespace, `Workflow task ${handler.id} projection ${reference.alias} ObjectStorage Secret`);
      const rebuildCandidate = projection.online.rebuild.source ? nodes.get(projection.online.rebuild.source.nodeId) : undefined;
      const rebuildModel = rebuildCandidate?.kind === 'model' && rebuildCandidate.runtime?.provider === 'postgres' && rebuildCandidate.runtime.nativeRelational
        ? rebuildCandidate as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> }
        : undefined;
      if (projection.online.rebuild.source && !rebuildModel) throw new Error(`Workflow task ${handler.id} projection ${reference.alias} authoritative rebuild source must be a promoted native PostgreSQL model.`);
      if (rebuildModel && rebuildModel.runtime.connectionEnvName !== stream.database.connectionEnvName) {
        throw new Error(`Workflow task ${handler.id} projection ${reference.alias} authoritative model and catch-up stream must share one PostgreSQL authority.`);
      }
      if (rebuildModel && !projection.online.rebuild.mapSource) throw new Error(`Workflow task ${handler.id} projection ${reference.alias} authoritative rebuild source has no snapshot mapper.`);
      for (const [role, unresolved] of [
        ['map', projection.handlerUnresolved], ['partition', projection.online.partitionUnresolved], ['key', projection.online.keyUnresolved],
        ['score', projection.online.scoreUnresolved], ['value', projection.online.valueUnresolved], ['remove', projection.online.removeUnresolved],
        ['snapshot', projection.online.rebuild.mapUnresolved], ['stream partition', rebuildModel ? stream.partitionUnresolved : undefined],
      ] as const) if (unresolved?.length) throw new Error(`Workflow task ${handler.id} projection ${reference.alias} ${role} callback contains unresolved identifiers: ${unresolved.join(', ')}.`);
      projections.push({ taskHandlerId: handler.id, alias: reference.alias, projection, stream, indexProvider, indexConfig, artifacts, objectProvider, objectConfig: objectConfigValue, ...(rebuildModel ? { rebuildModel } : {}), bounds: reference.bounds });
      taskAliases[reference.alias] = projection.id;
    }
    aliases[handler.id] = taskAliases;
  }
  if (projections.length === 0) return undefined;
  return { projections, aliases };
}

function workflowQueryEffects(
  graph: ApplicationGraph,
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
): WorkflowQueryEffectsContract | undefined {
  const queries: WorkflowTaskQueryContract[] = [];
  const aliases: Record<string, Record<string, string>> = {};
  const cursorSecrets = new Map<string, { readonly name: string; readonly key: string }>();
  for (const { handler } of tasks) {
    if ((handler.queries?.length ?? 0) === 0) continue;
    if (!handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} declares queries without a service-principal derivation.`);
    if ((handler.operationPrincipalUnresolved?.length ?? 0) > 0) throw new Error(`Workflow task ${handler.id} service principal contains unresolved identifiers: ${handler.operationPrincipalUnresolved?.join(', ')}.`);
    const taskAliases: Record<string, string> = {};
    for (const reference of handler.queries ?? []) {
      const query = nodes.get(reference.query.nodeId);
      if (query?.kind !== 'query') throw new Error(`Workflow task ${handler.id} query ${reference.alias} references missing query ${reference.query.nodeId}.`);
      const gateways = [...nodes.values()].filter((candidate): candidate is ApplicationGatewayNode => candidate.kind === 'gateway'
        && candidate.materialization === 'generatedDeployment'
        && candidate.queries.some((entry) => entry.nodeId === query.id));
      if (gateways.length !== 1) throw new Error(`Workflow task ${handler.id} query ${reference.alias} must be exposed by exactly one generated gateway; found ${gateways.length}.`);
      const candidate = gateways[0] as ApplicationGatewayNode;
      if (!candidate.deployment || !candidate.cursorSecret) throw new Error(`Workflow task ${handler.id} query ${reference.alias} gateway ${candidate.id} has no deployment cursor Secret.`);
      const gatewayNamespace = applicationGraphStringValue(candidate.deployment.namespace) || namespace;
      if (gatewayNamespace !== namespace) throw new Error(`Workflow task ${handler.id} query ${reference.alias} gateway ${candidate.id} is in ${gatewayNamespace}, but the worker is in ${namespace}.`);
      assertWorkflowSecretNamespace(candidate.cursorSecret.namespace, namespace, `Workflow task ${handler.id} query ${reference.alias} cursor Secret`);
      const secretName = applicationGraphStringValue(candidate.cursorSecret.name);
      if (!secretName || !candidate.cursorSecret.key) throw new Error(`Workflow task ${handler.id} query ${reference.alias} gateway cursor Secret is not concrete.`);
      cursorSecrets.set(`${secretName}\0${candidate.cursorSecret.key}`, { name: secretName, key: candidate.cursorSecret.key });
      const publicId = query.publicId ?? `${query.name}.${query.version}`;
      const route = candidate.routes.snapshots.replace(':query', encodeURIComponent(publicId));
      const serviceName = kubernetesName(`${graph.metadata.name}-${candidate.name}`);
      const gateway = candidate as ApplicationGatewayNode & { readonly deployment: NonNullable<ApplicationGatewayNode['deployment']>; readonly cursorSecret: NonNullable<ApplicationGatewayNode['cursorSecret']> };
      // Generated task workers and query gateways are required to share a
      // namespace, so the short service name also works when that namespace is
      // an installation-time expression rather than a compiler-time literal.
      queries.push({ taskHandlerId: handler.id, alias: reference.alias, query, gateway, endpoint: `http://${serviceName}:${candidate.deployment.port}${route}` });
      taskAliases[reference.alias] = publicId;
    }
    aliases[handler.id] = taskAliases;
  }
  if (queries.length === 0) return undefined;
  if (cursorSecrets.size !== 1) throw new Error(`Workflow worker ${worker.id} declared task queries backed by ${cursorSecrets.size} cursor Secrets. Use one application query context authority per worker group.`);
  return { queries, aliases, cursorSecret: [...cursorSecrets.values()][0] as { readonly name: string; readonly key: string } };
}

function workflowOperationEffects(
  _graph: ApplicationGraph,
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
): WorkflowOperationEffectsContract | undefined {
  const operations: WorkflowTaskOperationContract[] = [];
  const aliases: Record<string, Record<string, string>> = {};
  const cursorSecrets = new Map<string, { readonly name: string; readonly key: string }>();
  for (const { handler } of tasks) {
    if ((handler.operations?.length ?? 0) === 0) continue;
    if (!handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} declares operations without a service-principal derivation.`);
    if ((handler.operationPrincipalUnresolved?.length ?? 0) > 0) throw new Error(`Workflow task ${handler.id} operation principal contains unresolved identifiers: ${handler.operationPrincipalUnresolved?.join(', ')}.`);
    const taskAliases: Record<string, string> = {};
    for (const operation of handler.operations ?? []) {
      const command = nodes.get(operation.command.nodeId);
      const commandHandler = nodes.get(operation.handler.nodeId);
      if (command?.kind !== 'command' || commandHandler?.kind !== 'commandHandler' || commandHandler.command.nodeId !== command.id) {
        throw new Error(`Workflow task ${handler.id} operation ${operation.alias} has an invalid command binding.`);
      }
      const model = nodes.get(commandHandler.model.nodeId);
      if (model?.kind !== 'model' || !model.runtime) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} has no relational model runtime.`);
      assertWorkflowSecretNamespace(model.runtime.secretNamespace, namespace, `Workflow task ${handler.id} operation ${operation.alias} database Secret`);
      const gateways = [...nodes.values()].filter((candidate): candidate is ApplicationGatewayNode => candidate.kind === 'gateway'
        && candidate.materialization === 'generatedDeployment'
        && candidate.commands.some((entry) => entry.command.nodeId === command.id));
      if (gateways.length !== 1) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} must be exposed by exactly one generated gateway so its stable context Secret has an explicit owner; found ${gateways.length}.`);
      const gateway = gateways[0] as ApplicationGatewayNode;
      if (!gateway.deployment || !gateway.cursorSecret) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} gateway ${gateway.id} has no deployment cursor Secret.`);
      const gatewayNamespace = applicationGraphStringValue(gateway.deployment.namespace);
      if (gatewayNamespace && gatewayNamespace !== namespace) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} gateway ${gateway.id} is in ${gatewayNamespace}, but the worker is in ${namespace}.`);
      assertWorkflowSecretNamespace(gateway.cursorSecret.namespace, namespace, `Workflow task ${handler.id} operation ${operation.alias} cursor Secret`);
      const secretName = applicationGraphStringValue(gateway.cursorSecret.name);
      if (!secretName || !gateway.cursorSecret.key) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} gateway cursor Secret is not concrete.`);
      cursorSecrets.set(`${secretName}\0${gateway.cursorSecret.key}`, { name: secretName, key: gateway.cursorSecret.key });
      operations.push({ taskHandlerId: handler.id, alias: operation.alias, handler: commandHandler, command, model: model as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> } });
      taskAliases[operation.alias] = `${command.contract.name}.${command.contract.version}`;
    }
    aliases[handler.id] = taskAliases;
  }
  if (operations.length === 0) return undefined;
  if (cursorSecrets.size !== 1) throw new Error(`Workflow worker ${worker.id} declared task operations backed by ${cursorSecrets.size} cursor Secrets. Use one application command context authority per worker group.`);
  const eventLogs = [...nodes.values()].filter((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'EventLog');
  if (eventLogs.length !== 1) throw new Error(`Workflow worker ${worker.id} task operations require exactly one EventLog provider.`);
  const eventLog = eventLogs[0] as ApplicationProviderNode;
  const connectionSecret = objectConfig(eventLog.config?.connectionSecret);
  assertWorkflowSecretNamespace(connectionSecret.namespace, namespace, `Workflow worker ${worker.id} EventLog Secret`);
  return {
    operations,
    aliases,
    eventLog,
    cursorSecret: [...cursorSecrets.values()][0] as { readonly name: string; readonly key: string },
  };
}

function assertWorkflowSecretNamespace(value: unknown, namespace: string, owner: string): void {
  const secretNamespace = applicationGraphStringValue(value);
  if (secretNamespace && secretNamespace !== namespace) throw new Error(`${owner} is in namespace ${secretNamespace}, but its generated worker is in ${namespace}.`);
}

function validateWorkflowCapability(provider: ApplicationProviderNode, namespace: string, worker: ApplicationWorkflowWorkerNode): void {
  if (provider.interface !== 'StructuredGeneration') throw new Error(`Workflow worker ${worker.id} has no runtime adapter for capability ${provider.interface}.`);
  const config = provider.config ?? {};
  const selection = structuredGenerationSelection(config);
  if (selection) {
    for (const [branch, candidate] of [...Object.entries(selection.cases), ['default', selection.default] as const]) {
      validateStructuredGenerationCandidate(provider, candidate, namespace, worker, branch);
    }
    return;
  }
  validateStructuredGenerationCandidate(provider, config, namespace, worker);
}

function validateStructuredGenerationCandidate(
  provider: ApplicationProviderNode,
  config: Readonly<Record<string, unknown>>,
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
  branch?: string,
): void {
  const implementation = stringConfig(config.kind) || provider.implementation;
  const label = branch ? `${provider.id} branch ${branch}` : provider.id;
  if (implementation === 'structured-generation-deterministic') return;
  if (implementation !== 'structured-generation-http') throw new Error(`StructuredGeneration provider ${label} has unsupported implementation ${implementation}.`);
  const secret = objectConfig(config.credentialSecret);
  const secretNamespace = applicationGraphStringValue(secret.namespace);
  if (secretNamespace && secretNamespace !== namespace) throw new Error(`Workflow worker ${worker.id} cannot read StructuredGeneration Secret ${secretNamespace}/${stringConfig(secret.name)} from namespace ${namespace}.`);
  const endpoint = applicationGraphStringValue(config.endpoint);
  if (!endpoint) throw new Error(`StructuredGeneration provider ${label} requires an endpoint.`);
  if (worker.deployment.egress === 'sameNamespace' && !endpoint.startsWith('${')) {
    const hostname = new URL(endpoint).hostname;
    if (!hostname.endsWith('.svc') && !hostname.endsWith('.svc.cluster.local')) {
      throw new Error(`Workflow worker ${worker.id} uses sameNamespace egress but StructuredGeneration endpoint ${hostname} is outside the namespace.`);
    }
  }
}

export function structuredGenerationSelection(config: Readonly<Record<string, unknown>>): StructuredGenerationSelectionConfig | undefined {
  if (config.kind !== 'application-provider-selection') return undefined;
  const selector = stringConfig(config.selector);
  const cases = objectConfig(config.cases);
  const fallback = objectConfig(config.default);
  if (!/^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(selector) || Object.keys(fallback).length === 0) {
    throw new Error('StructuredGeneration provider selection must use a direct schema.spec discriminator and declare a default provider.');
  }
  const normalizedCases = Object.fromEntries(Object.entries(cases).map(([name, candidate]) => {
    const value = objectConfig(candidate);
    if (Object.keys(value).length === 0) throw new Error(`StructuredGeneration provider selection branch ${name} must be an object provider.`);
    return [name, value];
  }));
  return { selector, cases: normalizedCases, default: fallback };
}

export function structuredGenerationSelectedScalar(
  selection: StructuredGenerationSelectionConfig,
  select: (candidate: Readonly<Record<string, unknown>>) => unknown,
  fallback: string | number | boolean,
): string {
  const otherwise = applicationGraphScalarExpression(select(selection.default) ?? fallback);
  const expression = Object.entries(selection.cases).reduceRight(
    (current, [name, candidate]) => `${selection.selector} == ${JSON.stringify(name)} ? ${applicationGraphScalarExpression(select(candidate) ?? fallback)} : (${current})`,
    otherwise,
  );
  return `\${${expression}}`;
}

function applicationGraphScalarExpression(value: unknown): string {
  if (typeof value === 'string') {
    const expression = /^\$\{(.+)\}$/.exec(value)?.[1];
    return expression ?? JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error('StructuredGeneration selected runtime fields must be scalar installation values.');
}
