// typecast-file-boundary: Workflow contract resolution narrows graph nodes and provider configuration into a validated compiler contract.
import type {
  ApplicationCommandHandlerNode,
  ApplicationCommandNode,
  ApplicationEventNode,
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationModelNode,
  ApplicationObjectStoreNode,
  ApplicationOperationCatalog,
  ApplicationProcessorNode,
  ApplicationProjectionNode,
  ApplicationProviderNode,
  ApplicationQueryNode,
  ApplicationStaticAuthorityManifest,
  ApplicationStreamNode,
  ApplicationTaskHandlerNode,
  ApplicationTaskNode,
  ApplicationWorkflowHandlerNode,
  ApplicationWorkflowNode,
  ApplicationWorkflowWorkerNode,
  ApplicationWorkloadAuthorityEnvelope,
} from '@applik8s/core';
import { applicationRuntimeEndpointEnvironmentName } from '@applik8s/deployment-contract';
import ts from 'typescript';
import { applicationGraphStringValue } from '../application-installation-values.js';
import { applicationGraphHasObservabilityRuntime } from '../application-observability-runtime-source.js';
import { kubernetesName, numberConfig, objectConfig, stringConfig } from './utilities.js';

const DEFAULT_WORKER_IMAGE = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';
const APPLICATION_RUNTIME_NAMESPACE_MARKER = '__APPLIK8S_RUNTIME_NAMESPACE__';

export interface WorkflowContract {
  readonly graphName: string;
  readonly observability: boolean;
  readonly worker: ApplicationWorkflowWorkerNode;
  readonly provider: ApplicationProviderNode;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[];
  readonly workflows: readonly { readonly handler: ApplicationWorkflowHandlerNode; readonly workflow: ApplicationWorkflowNode }[];
  readonly capabilities: readonly ApplicationProviderNode[];
  readonly callableProviders?: readonly ApplicationProviderNode[];
  readonly operationEffects?: WorkflowOperationEffectsContract;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly authorityManifest?: ApplicationStaticAuthorityManifest;
  readonly queryEffects?: WorkflowQueryEffectsContract;
  readonly projectionEffects?: WorkflowProjectionEffectsContract;
  readonly objectEffects?: WorkflowObjectEffectsContract;
  readonly actorEffects?: WorkflowActorEffectsContract;
  readonly signalEffects?: WorkflowSignalEffectsContract;
  readonly functionNativeTransactions?: readonly WorkflowFunctionNativeTransactionContract[];
  readonly namespace: string;
  readonly engineName: string;
  readonly adminCredentialsSecret: string;
  readonly workerTokenSecret: string;
  readonly tokenKey: string;
  readonly image: string;
  readonly contractNames: Readonly<Record<string, string>>;
  readonly gatewayCallers: readonly WorkflowGatewayCallerContract[];
  readonly gatewayAdmission: {
    readonly replayWindowSeconds: number;
    readonly cleanupIntervalSeconds: number;
    readonly cleanupBatchSize: number;
  };
}

export interface WorkflowFunctionNativeTransactionContract {
  readonly taskHandlerId: string;
  readonly mode: 'read' | 'write';
  readonly primaryModel: ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
  };
  readonly models: readonly (ApplicationModelNode & {
    readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
  })[];
  readonly modelBindings: readonly {
    readonly identifier: string;
    readonly model: ApplicationModelNode & {
      readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
    };
  }[];
  readonly eventBindings: readonly {
    readonly identifier: string;
    readonly event: ApplicationEventNode;
  }[];
  readonly outbox: readonly ApplicationEventNode[];
}

export interface WorkflowGatewayCallerContract {
  readonly operator: string;
  readonly namespace: string;
  readonly serviceAccount: string;
  readonly contracts: readonly string[];
}

interface WorkflowTaskOperationContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly authority: NonNullable<ApplicationTaskHandlerNode['operations']>[number]['authority'];
  readonly handler: ApplicationCommandHandlerNode;
  readonly command: ApplicationCommandNode;
  readonly model: ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> };
}

interface WorkflowOperationEffectsContract {
  readonly operations: readonly WorkflowTaskOperationContract[];
  readonly aliases: Readonly<Record<string, Readonly<Record<string, WorkflowOperationAliasContract>>>>;
  readonly eventLog: ApplicationProviderNode;
  readonly contextSecret: { readonly name: string; readonly key: string };
}

export interface WorkflowOperationAliasContract {
  readonly commandId: string;
  readonly operationId: string;
  readonly boundKeys: readonly string[];
  readonly projectionSource?: string;
  readonly envelope: ApplicationWorkloadAuthorityEnvelope;
}

interface WorkflowTaskQueryContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly query: ApplicationQueryNode;
  readonly gateway: ApplicationGatewayNode & { readonly deployment: NonNullable<ApplicationGatewayNode['deployment']>; readonly cursorSecret: NonNullable<ApplicationGatewayNode['cursorSecret']> };
  readonly endpoint: string;
  readonly endpointBaseUrl: string;
  readonly endpointPath: string;
  readonly endpointEnvironmentName: string;
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

export interface WorkflowTaskActorContract {
  readonly taskHandlerId: string;
  readonly alias: string;
  readonly actor: Extract<ApplicationGraph['nodes'][number], { readonly kind: 'actor' }>;
  readonly member: string;
  readonly memberKind: 'command' | 'message' | 'alarm';
  readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
}

interface WorkflowActorEffectsContract {
  readonly actors: readonly WorkflowTaskActorContract[];
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly applicationEndpoint: string;
}

export interface WorkflowSignalContract {
  readonly handlerId: string;
  readonly binding: NonNullable<
    ApplicationWorkflowHandlerNode['signalBindings']
  >[number];
  readonly stream: ApplicationStreamNode;
}

interface WorkflowSignalEffectsContract {
  readonly signals: readonly WorkflowSignalContract[];
  readonly database: ApplicationStreamNode['database'];
}

export interface StructuredGenerationSelectionConfig {
  readonly selector: string;
  readonly cases: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly default: Readonly<Record<string, unknown>>;
}

export function workflowContract(
  graph: ApplicationGraph,
  worker: ApplicationWorkflowWorkerNode,
  operationCatalog?: ApplicationOperationCatalog,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[] = [],
  gatewayCallers: readonly WorkflowGatewayCallerContract[] = [],
  authorityManifest?: ApplicationStaticAuthorityManifest,
): WorkflowContract {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const provider = nodes.get(worker.workflowEngine.nodeId);
  if (provider?.kind !== 'provider' || provider.interface !== 'WorkflowEngine' || provider.implementation !== 'hatchet') {
    throw new Error(`Generated workflow worker ${worker.id} requires one resolved Hatchet WorkflowEngine provider.`);
  }
  const tasks: { handler: ApplicationTaskHandlerNode; task: ApplicationTaskNode }[] = [];
  const workflows: { handler: ApplicationWorkflowHandlerNode; workflow: ApplicationWorkflowNode }[] = [];
  const capabilities = new Map<string, ApplicationProviderNode>();
  const callableProviders = new Map<string, ApplicationProviderNode>();
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
      for (const binding of handler.providerBindings ?? []) {
        const callableProvider = nodes.get(binding.provider.nodeId);
        if (
          callableProvider?.kind !== 'provider'
          || callableProvider.interface !== binding.provider.interface
        ) {
          throw new Error(
            `Workflow task handler ${handler.id} references missing callable provider ${binding.provider.nodeId}.`,
          );
        }
        callableProviders.set(callableProvider.id, callableProvider);
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
  const admissionConfig = objectConfig(config.admission);
  const gatewayAdmission = {
    replayWindowSeconds: admissionConfig.replayWindowSeconds === undefined
      ? 7 * 24 * 60 * 60
      : numberConfig(admissionConfig.replayWindowSeconds),
    cleanupIntervalSeconds: admissionConfig.cleanupIntervalSeconds === undefined
      ? 5 * 60
      : numberConfig(admissionConfig.cleanupIntervalSeconds),
    cleanupBatchSize: admissionConfig.cleanupBatchSize === undefined
      ? 1_000
      : numberConfig(admissionConfig.cleanupBatchSize),
  };
  if (!Number.isSafeInteger(gatewayAdmission.replayWindowSeconds) || gatewayAdmission.replayWindowSeconds < 60) {
    throw new Error(`Generated workflow worker ${worker.id} admission replayWindowSeconds must be a safe integer of at least 60 seconds.`);
  }
  if (!Number.isSafeInteger(gatewayAdmission.cleanupIntervalSeconds) || gatewayAdmission.cleanupIntervalSeconds < 10) {
    throw new Error(`Generated workflow worker ${worker.id} admission cleanupIntervalSeconds must be a safe integer of at least 10 seconds.`);
  }
  if (!Number.isSafeInteger(gatewayAdmission.cleanupBatchSize) || gatewayAdmission.cleanupBatchSize < 1 || gatewayAdmission.cleanupBatchSize > 10_000) {
    throw new Error(`Generated workflow worker ${worker.id} admission cleanupBatchSize must be a safe integer between 1 and 10000.`);
  }
  const namespace = applicationGraphStringValue(config.namespace) || 'default';
  const engineName = kubernetesName(stringConfig(config.name) || 'applik8s-hatchet');
  const adminCredentials = objectConfig(config.adminCredentialsSecret);
  const workerToken = objectConfig(config.workerTokenSecret);
  for (const credentials of [adminCredentials, workerToken]) {
    const credentialNamespace = applicationGraphStringValue(credentials.namespace);
    if (credentialNamespace && credentialNamespace !== namespace) {
      throw new Error(`Generated workflow worker ${worker.id} cannot read Hatchet Secret ${credentialNamespace}/${stringConfig(credentials.name)} from namespace ${namespace}.`);
    }
  }
  for (const capability of capabilities.values()) validateWorkflowCapability(capability, namespace, worker);
  const queryEffects = workflowQueryEffects(graph, nodes, tasks, namespace, worker);
  const operationEffects = workflowOperationEffects(
    graph,
    nodes,
    tasks,
    namespace,
    worker,
    workloadAuthority,
  );
  const projectionEffects = workflowProjectionEffects(nodes, tasks, namespace, worker);
	const objectEffects = workflowObjectEffects(nodes, tasks, namespace, worker);
  const actorEffects = workflowActorEffects(
    graph,
    nodes,
    tasks,
    namespace,
    worker,
    workloadAuthority,
  );
  const signalEffects = workflowSignalEffects(
    nodes,
    [
      ...tasks.map(({ handler }) => handler),
      ...workflows.map(({ handler }) => handler),
    ],
    namespace,
    worker,
  );
  const functionNativeTransactions = workflowFunctionNativeTransactions(
    nodes,
    tasks,
    worker,
  );
  if (worker.deployment.scaling.mode === 'kedaHatchetSlots' && !stringConfig(config.tenantId)) {
    throw new Error(`Generated workflow worker ${worker.id} uses KEDA Hatchet task-stat scaling but its WorkflowEngine provider has no tenantId.`);
  }
  const declaredContracts = new Set([
    ...tasks.map(({ task }) => task.name),
    ...workflows.map(({ workflow }) => workflow.name),
  ]);
  const normalizedGatewayCallers = gatewayCallers.map((caller) => ({
    ...caller,
    namespace: caller.namespace === APPLICATION_RUNTIME_NAMESPACE_MARKER
      ? namespace
      : applicationGraphStringValue(caller.namespace) ?? caller.namespace,
  }));
  for (const caller of normalizedGatewayCallers) {
    if (caller.namespace !== namespace) {
      throw new Error(
        `Workflow worker ${worker.id} gateway caller ${caller.operator} is in namespace ${caller.namespace}; private workflow gateways require a shared namespace.`,
      );
    }
    for (const contract of caller.contracts) {
      if (!declaredContracts.has(contract)) {
        throw new Error(
          `Workflow worker ${worker.id} gateway caller ${caller.operator} references undeclared contract ${contract}.`,
        );
      }
    }
  }
  return {
    graphName: graph.metadata.name,
    observability: applicationGraphHasObservabilityRuntime(graph),
    worker,
    provider,
    providerConfig: config,
    tasks,
    workflows,
    capabilities: [...capabilities.values()].sort((left, right) => left.id.localeCompare(right.id)),
    callableProviders: [...callableProviders.values()].sort((left, right) =>
      left.id.localeCompare(right.id)),
    ...(operationEffects ? { operationEffects } : {}),
    ...(operationCatalog ? { operationCatalog } : {}),
    ...(authorityManifest ? { authorityManifest } : {}),
    ...(queryEffects ? { queryEffects } : {}),
    ...(projectionEffects ? { projectionEffects } : {}),
		...(objectEffects ? { objectEffects } : {}),
    ...(actorEffects ? { actorEffects } : {}),
    ...(signalEffects ? { signalEffects } : {}),
    ...(functionNativeTransactions.length > 0
      ? { functionNativeTransactions }
      : {}),
    namespace,
    engineName,
    adminCredentialsSecret: stringConfig(adminCredentials.name) || `${engineName}-admin`,
    workerTokenSecret: stringConfig(workerToken.name) || (config.provision === false ? `${engineName}-worker` : 'hatchet-client-config'),
    tokenKey: stringConfig(config.tokenKey) || (stringConfig(workerToken.name) || config.provision !== false ? 'HATCHET_CLIENT_TOKEN' : 'token'),
    image: stringConfig(objectConfig(config.worker).image) || DEFAULT_WORKER_IMAGE,
    contractNames: Object.fromEntries(graph.nodes.flatMap((node) => node.kind === 'task' || node.kind === 'workflow' ? [[node.id, node.name]] : [])),
    gatewayCallers: normalizedGatewayCallers.sort((left, right) =>
      `${left.namespace}/${left.serviceAccount}/${left.operator}`.localeCompare(
        `${right.namespace}/${right.serviceAccount}/${right.operator}`,
      )),
    gatewayAdmission,
  };
}

function workflowActorEffects(
  graph: ApplicationGraph,
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): WorkflowActorEffectsContract | undefined {
  const actors: WorkflowTaskActorContract[] = [];
  const aliases: Record<string, Record<string, string>> = {};
  for (const { handler } of tasks) {
    const taskAliases: Record<string, string> = {};
    for (const reference of handler.actors ?? []) {
      const actor = nodes.get(reference.actor.nodeId);
      if (actor?.kind !== 'actor') throw new Error(`Workflow task ${handler.id} actor ${reference.alias} references missing actor ${reference.actor.nodeId}.`);
      const member = actor.definition.protocol.find((candidate) => candidate.name === reference.member);
      if (!member || member.kind !== reference.memberKind) throw new Error(`Workflow task ${handler.id} actor ${reference.alias} references incompatible member ${actor.definition.id}.${reference.member}.`);
      const operationId = `applik8s://actors/${actor.definition.id}/operations/${reference.member}`;
      const envelope = workloadAuthority.find((candidate) =>
        candidate.workloadIdentity.subject === handler.id
        && candidate.operationId === operationId);
      if (!envelope) throw new Error(`Workflow task ${handler.id} actor ${reference.alias} has no workload-authority envelope for ${operationId}.`);
      actors.push({
        taskHandlerId: handler.id,
        alias: reference.alias,
        actor,
        member: reference.member,
        memberKind: reference.memberKind,
        workloadAuthority: envelope,
      });
      taskAliases[reference.alias] = `${actor.definition.id}\0${reference.member}\0${reference.memberKind}`;
    }
    if (Object.keys(taskAliases).length > 0) aliases[handler.id] = taskAliases;
  }
  if (actors.length === 0) return undefined;
  const host = graph.nodes.find((node): node is ApplicationProviderNode<'ApplicationHost'> => node.kind === 'provider' && node.interface === 'ApplicationHost');
  if (!host) throw new Error(`Workflow worker ${worker.id} calls actors but the application has no ApplicationHost for the authenticated actor invocation boundary.`);
  const config = objectConfig(host.config?.host);
  const hostNamespace = applicationGraphStringValue(config.namespace) || namespace;
  if (hostNamespace !== namespace) throw new Error(`Workflow worker ${worker.id} actor invocation host is in ${hostNamespace}, but the worker is in ${namespace}.`);
  const name = kubernetesName(stringConfig(config.name) || `${graph.metadata.name}-app`);
  const port = typeof config.port === 'number' && Number.isInteger(config.port) && config.port > 0 ? config.port : 3000;
  return { actors, aliases, applicationEndpoint: `http://${name}.${namespace}.svc:${port}` };
}

function workflowFunctionNativeTransactions(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly {
    readonly handler: ApplicationTaskHandlerNode;
    readonly task: ApplicationTaskNode;
  }[],
  worker: ApplicationWorkflowWorkerNode,
): readonly WorkflowFunctionNativeTransactionContract[] {
  return tasks.flatMap(({ handler }) => {
    const transaction = handler.functionNativeTransaction;
    if (!transaction) return [];
    const primary = nodes.get(transaction.primaryModel.nodeId);
    if (primary?.kind !== 'model' || !primary.runtime) {
      throw new Error(
        `Workflow worker ${worker.id} function-native task ${handler.id} requires one PostgreSQL primary model runtime.`,
      );
    }
    const models = transaction.models.map((reference) => {
      const model = nodes.get(reference.nodeId);
      if (model?.kind !== 'model' || !model.runtime) {
        throw new Error(
          `Workflow worker ${worker.id} function-native task ${handler.id} participant ${reference.nodeId} has no PostgreSQL runtime.`,
        );
      }
      return model as ApplicationModelNode & {
        readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
      };
    });
    const connectionEnvironments = new Set(
      models.map((model) => model.runtime.connectionEnvName),
    );
    if (
      connectionEnvironments.size !== 1
      || !connectionEnvironments.has(primary.runtime.connectionEnvName)
    ) {
      throw new Error(
        `Workflow worker ${worker.id} function-native task ${handler.id} spans multiple transactional databases. One Model.edit closure must remain inside one PostgreSQL authority.`,
      );
    }
    const outbox = transaction.outbox.map((reference) => {
      const event = nodes.get(reference.nodeId);
      if (event?.kind !== 'event') {
        throw new Error(
          `Workflow worker ${worker.id} function-native task ${handler.id} outbox ${reference.nodeId} is not a declared event.`,
        );
      }
      return event;
    });
    const modelBindings = transaction.modelBindings.map((binding) => {
      const model = nodes.get(binding.model.nodeId);
      if (model?.kind !== 'model' || !model.runtime) {
        throw new Error(
          `Workflow worker ${worker.id} function-native task ${handler.id} callback binding ${binding.identifier} has no PostgreSQL model runtime.`,
        );
      }
      return {
        identifier: binding.identifier,
        model: model as ApplicationModelNode & {
          readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
        },
      };
    });
    const eventBindings = (transaction.eventBindings ?? []).map((binding) => {
      const event = nodes.get(binding.event.nodeId);
      if (event?.kind !== 'event') {
        throw new Error(
          `Workflow worker ${worker.id} function-native task ${handler.id} callback binding ${binding.identifier} does not reference a declared event.`,
        );
      }
      return { identifier: binding.identifier, event };
    });
    return [{
      taskHandlerId: handler.id,
      mode: transaction.mode ?? 'write',
      primaryModel: primary as ApplicationModelNode & {
        readonly runtime: NonNullable<ApplicationModelNode['runtime']>;
      },
      models,
      modelBindings,
      eventBindings,
      outbox,
    }];
  });
}

function workflowSignalEffects(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  handlers: readonly (
    | ApplicationTaskHandlerNode
    | ApplicationWorkflowHandlerNode
  )[],
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
): WorkflowSignalEffectsContract | undefined {
  const signals: WorkflowSignalContract[] = [];
  for (const handler of handlers) {
    for (const binding of handler.signalBindings ?? []) {
      const stream = nodes.get(`stream.${kubernetesName(binding.id)}`);
      if (stream?.kind !== 'stream') {
        throw new Error(
          `Workflow ${handler.id} signal ${binding.alias} references missing issuance stream ${binding.id}.`,
        );
      }
      assertWorkflowSecretNamespace(
        stream.database.secretNamespace,
        namespace,
        `Workflow ${handler.id} signal ${binding.alias} database Secret`,
      );
      signals.push({ handlerId: handler.id, binding, stream });
    }
  }
  if (signals.length === 0) return undefined;
  const databases = new Map(
    signals.map(({ stream }) => [
      `${stream.database.connectionEnvName}\0${stream.database.secretName}\0${stream.database.secretKey}`,
      stream.database,
    ]),
  );
  if (databases.size !== 1) {
    throw new Error(
      `Workflow worker ${worker.id} signals span ${databases.size} transactional databases; SignalStore must use one canonical primary PostgreSQL authority.`,
    );
  }
  return {
    signals,
    database: [...databases.values()][0] as ApplicationStreamNode['database'],
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
      const indexConfig =
        indexProvider?.kind === 'provider'
          ? objectConfig(indexProvider.config?.indexStore)
          : {};
      if (
        indexProvider?.kind !== 'provider'
        || indexProvider.interface !== 'IndexStore'
        || stringConfig(indexConfig.kind) !== 'valkey'
      ) {
        const observed =
          indexProvider?.kind === 'provider'
            ? `${indexProvider.interface}/${indexProvider.implementation} (${stringConfig(indexConfig.kind) || 'missing config.indexStore.kind'})`
            : indexProvider?.kind ?? 'missing';
        throw new Error(
          `Workflow task ${handler.id} projection ${reference.alias} requires a Valkey-compatible IndexStore provider; observed ${observed}.`,
        );
      }
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
    if (!handler.serviceIdentity && !handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} declares queries without a service-principal derivation.`);
    if (handler.operationPrincipalSource && (handler.operationPrincipalUnresolved?.length ?? 0) > 0) throw new Error(`Workflow task ${handler.id} service principal contains unresolved identifiers: ${handler.operationPrincipalUnresolved?.join(', ')}.`);
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
      queries.push({
        taskHandlerId: handler.id,
        alias: reference.alias,
        query,
        gateway,
        endpoint: `http://${serviceName}:${candidate.deployment.port}${route}`,
        endpointBaseUrl: `http://${serviceName}:${candidate.deployment.port}`,
        endpointPath: route,
        endpointEnvironmentName: applicationRuntimeEndpointEnvironmentName(gateway.id),
      });
      taskAliases[reference.alias] = publicId;
    }
    aliases[handler.id] = taskAliases;
  }
  if (queries.length === 0) return undefined;
  if (cursorSecrets.size !== 1) throw new Error(`Workflow worker ${worker.id} declared task queries backed by ${cursorSecrets.size} cursor Secrets. Use one application query context authority per worker group.`);
  return { queries, aliases, cursorSecret: [...cursorSecrets.values()][0] as { readonly name: string; readonly key: string } };
}

function workflowOperationEffects(
  graph: ApplicationGraph,
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  tasks: readonly { readonly handler: ApplicationTaskHandlerNode; readonly task: ApplicationTaskNode }[],
  namespace: string,
  worker: ApplicationWorkflowWorkerNode,
  workloadAuthority: readonly ApplicationWorkloadAuthorityEnvelope[],
): WorkflowOperationEffectsContract | undefined {
  const operations: WorkflowTaskOperationContract[] = [];
  const aliases: Record<string, Record<string, WorkflowOperationAliasContract>> = {};
  const eventLogs = new Map<string, ApplicationProviderNode>();
  for (const { handler } of tasks) {
    if ((handler.operations?.length ?? 0) === 0) continue;
    if (!handler.serviceIdentity && !handler.operationPrincipalSource) throw new Error(`Workflow task ${handler.id} declares operations without a service-principal derivation.`);
    if (handler.operationPrincipalSource && (handler.operationPrincipalUnresolved?.length ?? 0) > 0) throw new Error(`Workflow task ${handler.id} operation principal contains unresolved identifiers: ${handler.operationPrincipalUnresolved?.join(', ')}.`);
    const taskAliases: Record<string, WorkflowOperationAliasContract> = {};
    for (const operation of handler.operations ?? []) {
      validateWorkflowExecutionBinding(handler.id, operation.alias, operation.authority.binding);
      const command = nodes.get(operation.command.nodeId);
      const commandHandler = nodes.get(operation.handler.nodeId);
      if (command?.kind !== 'command' || commandHandler?.kind !== 'commandHandler' || commandHandler.command.nodeId !== command.id) {
        throw new Error(`Workflow task ${handler.id} operation ${operation.alias} has an invalid command binding.`);
      }
      const model = nodes.get(commandHandler.model.nodeId);
      if (model?.kind !== 'model' || !model.runtime) throw new Error(`Workflow task ${handler.id} operation ${operation.alias} has no relational model runtime.`);
      const processors = [...nodes.values()].filter(
        (candidate): candidate is ApplicationProcessorNode =>
          candidate.kind === 'processor'
          && candidate.handlers.some(
            (reference) => reference.nodeId === commandHandler.id,
          ),
      );
      if (processors.length !== 1 || !processors[0]?.eventLog) {
        throw new Error(`Workflow task ${handler.id} operation ${operation.alias} must resolve exactly one generated command processor EventLog binding; found ${processors.length}.`);
      }
      const eventLog = nodes.get(processors[0].eventLog.nodeId);
      if (eventLog?.kind !== 'provider' || eventLog.interface !== 'EventLog') {
        throw new Error(`Workflow task ${handler.id} operation ${operation.alias} references missing EventLog provider ${processors[0].eventLog.nodeId}.`);
      }
      eventLogs.set(eventLog.id, eventLog);
      const envelope = workloadAuthority.find((candidate) =>
        candidate.operationId === operation.authority.operationId
        && candidate.workloadIdentity.subject === handler.id);
      if (!envelope) {
        throw new Error(`Workflow task ${handler.id} operation ${operation.alias} has no compiled workload authority envelope.`);
      }
      assertWorkflowSecretNamespace(model.runtime.secretNamespace, namespace, `Workflow task ${handler.id} operation ${operation.alias} database Secret`);
      operations.push({
        taskHandlerId: handler.id,
        alias: operation.alias,
        authority: operation.authority,
        handler: commandHandler,
        command,
        model: model as ApplicationModelNode & { readonly runtime: NonNullable<ApplicationModelNode['runtime']> },
      });
      taskAliases[operation.alias] = {
        commandId: `${command.contract.name}.${command.contract.version}`,
        operationId: operation.authority.operationId,
        boundKeys: operation.authority.binding?.boundKeys ?? [],
        ...(operation.authority.binding
          ? { projectionSource: operation.authority.binding.projectionSource }
          : {}),
        envelope,
      };
    }
    aliases[handler.id] = taskAliases;
  }
  if (operations.length === 0) return undefined;
  if (eventLogs.size !== 1) throw new Error(`Workflow worker ${worker.id} task operations require exactly one EventLog provider.`);
  const eventLog = [...eventLogs.values()][0] as ApplicationProviderNode;
  const connectionSecret = objectConfig(eventLog.config?.connectionSecret);
  assertWorkflowSecretNamespace(connectionSecret.namespace, namespace, `Workflow worker ${worker.id} EventLog Secret`);
  return {
    operations,
    aliases,
    eventLog,
    contextSecret: {
      name: kubernetesName(`${graph.metadata.name}-context`),
      key: 'key',
    },
  };
}

function validateWorkflowExecutionBinding(
  handlerId: string,
  alias: string,
  binding: NonNullable<ApplicationTaskHandlerNode['operations']>[number]['authority']['binding'] | undefined,
): void {
  if (!binding) return;
  const sourceFile = ts.createSourceFile(
    `${handlerId}.${alias}.binding.ts`,
    `const __applik8sProjection = (${binding.projectionSource});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements[0];
  const initializer = declaration && ts.isVariableStatement(declaration)
    ? declaration.declarationList.declarations[0]?.initializer
    : undefined;
  const expression = initializer && ts.isParenthesizedExpression(initializer)
    ? initializer.expression
    : initializer;
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding must be one serializable projection function.`);
  }
  const parameter = expression.parameters[0];
  if (expression.parameters.length !== 1 || !parameter || !ts.isIdentifier(parameter.name)) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding must declare exactly one source parameter.`);
  }
  const sourceName = parameter.name.text;
  if (ts.isBlock(expression.body)) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding must use an expression body so its complete returned key set is statically provable.`);
  }
  const returned = executionBindingObjectBranches(expression.body);
  if (returned.length === 0) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding does not return a statically provable object.`);
  }
  const expected = [...binding.boundKeys].sort();
  for (const branch of returned) {
    const keys = executionBindingObjectKeys(branch, handlerId, alias);
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding must return exactly ${expected.join(', ')} on every branch; received ${keys.join(', ')}.`);
    }
    for (const property of branch.properties) {
      if (ts.isPropertyAssignment(property)) assertPureExecutionBindingValue(property.initializer, sourceName, handlerId, alias);
      else if (ts.isShorthandPropertyAssignment(property) && property.name.text !== sourceName) {
        throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding shorthand ${property.name.text} is not derived from its source parameter.`);
      }
    }
  }
}

function executionBindingObjectBranches(expression: ts.Expression): readonly ts.ObjectLiteralExpression[] {
  if (ts.isParenthesizedExpression(expression)) return executionBindingObjectBranches(expression.expression);
  if (ts.isObjectLiteralExpression(expression)) return [expression];
  if (ts.isConditionalExpression(expression)) {
    return [
      ...executionBindingObjectBranches(expression.whenTrue),
      ...executionBindingObjectBranches(expression.whenFalse),
    ];
  }
  return [];
}

function executionBindingObjectKeys(
  value: ts.ObjectLiteralExpression,
  handlerId: string,
  alias: string,
): readonly string[] {
  const keys = value.properties.map((property) => {
    if (ts.isSpreadAssignment(property)
      || !('name' in property)
      || !property.name
      || ts.isComputedPropertyName(property.name)
      || (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) {
      throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding cannot use spreads, computed keys, methods, or accessors.`);
    }
    return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
      ? property.name.text
      : undefined;
  });
  if (keys.some((key) => key === undefined)) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding contains an unsupported property name.`);
  }
  const normalized = keys as string[];
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding contains duplicate keys.`);
  }
  return normalized.sort();
}

function assertPureExecutionBindingValue(
  expression: ts.Expression,
  sourceName: string,
  handlerId: string,
  alias: string,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      || ts.isNewExpression(node)
      || ts.isAwaitExpression(node)
      || ts.isYieldExpression(node)
      || ts.isDeleteExpression(node)
      || ts.isPostfixUnaryExpression(node)
      || (ts.isPrefixUnaryExpression(node)
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))
      || ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding must be deterministic and side-effect free.`);
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isShorthandPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName && node.text !== sourceName && node.text !== 'undefined') {
        throw new Error(`Workflow task ${handlerId} operation ${alias} execution binding references undeclared identifier ${node.text}; inline a source-derived expression.`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
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
