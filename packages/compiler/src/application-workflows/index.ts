import { mkdir } from 'node:fs/promises';
import type { ApplicationGraph, ApplicationOperationCatalog, ApplicationWorkflowWorkerNode, ApplicationWorkloadAuthorityEnvelope, OperatorManifest } from '@applik8s/core';
import {
  applicationGraphStringValue,
} from '../application-installation-values.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../application-operations/index.js';
import { applicationServerNamespace } from '../application-server-namespace.js';
import { workflowContract } from './contracts.js';
import { emitWorkflowWorker } from './emitter.js';
import type { GeneratedApplicationWorkflowArtifact } from './types.js';
import { kubernetesName, objectConfig } from './utilities.js';

export type { GeneratedApplicationWorkflowArtifact, GeneratedApplicationWorkflowResource } from './types.js';

export async function emitGeneratedApplicationWorkflows(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly workloadAuthority?: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly operatorManifests?: readonly OperatorManifest[];
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationWorkflowArtifact[]> {
  const operationCatalog = options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const workloadAuthority = options.workloadAuthority
    ?? compileApplicationWorkloadAuthority(options.graph, operationCatalog);
  const authorityManifest = applicationStaticAuthorityManifest(options.graph);
  const workers = options.graph.nodes.filter((node): node is ApplicationWorkflowWorkerNode => node.kind === 'workflowWorker');
  if (workers.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationWorkflowArtifact[] = [];
  const provisionedProviders = new Set<string>();
  for (const worker of workers) {
    const gatewayCallers = (options.operatorManifests ?? []).flatMap((manifest) =>
      Object.values(manifest.spec.capabilities ?? {}).flatMap((descriptor) => {
        const gateway = descriptor.workflowGateway;
        if (!gateway || gateway.worker !== worker.name) return [];
        return [{
          operator: gateway.caller.operator,
          namespace: gateway.caller.namespace,
          serviceAccount: gateway.caller.serviceAccount,
          contracts: gateway.contracts,
        }];
      }),
    );
    const httpGatewayCallers = applicationHttpWorkflowGatewayCallers(
      options.graph,
      worker,
    );
    const scheduleGatewayCallers = applicationScheduleWorkflowGatewayCallers(
      options.graph,
      worker,
    );
    const contract = workflowContract(
      options.graph,
      worker,
      operationCatalog,
      workloadAuthority,
      [...gatewayCallers, ...httpGatewayCallers, ...scheduleGatewayCallers],
      authorityManifest,
    );
    const ownsProvider = !provisionedProviders.has(contract.provider.id);
    provisionedProviders.add(contract.provider.id);
    artifacts.push(await emitWorkflowWorker(
      contract,
      options.outDir,
      ownsProvider,
      options.executionTarget ?? 'kubernetes',
    ));
  }
  return artifacts;
}

export function applicationScheduleWorkflowGatewayCallers(
  graph: ApplicationGraph,
  worker: ApplicationWorkflowWorkerNode,
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const workerTargets = new Map<string, string>();
  for (const reference of worker.handlers) {
    const handler = nodes.get(reference.nodeId);
    if (handler?.kind === 'workflowHandler') {
      const workflow = nodes.get(handler.workflow.nodeId);
      if (workflow?.kind === 'workflow') {
        workerTargets.set(
          workflow.id,
          `${workflow.contract.name}.${workflow.contract.version}`,
        );
      }
    } else if (handler?.kind === 'taskHandler') {
      const task = nodes.get(handler.task.nodeId);
      if (task?.kind === 'task') {
        workerTargets.set(
          task.id,
          `${task.contract.name}.${task.contract.version}`,
        );
      }
    }
  }
  const contracts = [...new Set(graph.nodes.flatMap((node) => {
    if (node.kind !== 'schedule' || node.target?.kind !== 'durableStart') return [];
    const contract = workerTargets.get(node.target.durable.nodeId);
    return contract ? [contract] : [];
  }))].sort();
  if (contracts.length === 0) return [];
  const hosts = graph.nodes.filter(
    (node): node is Extract<ApplicationGraph['nodes'][number], { readonly kind: 'provider' }> =>
      node.kind === 'provider'
        && node.interface === 'ApplicationHost'
        && !node.config?.qualification,
  );
  if (hosts.length !== 1) {
    throw new Error(
      `Scheduled workflows require exactly one unqualified ApplicationHost caller; found ${hosts.length}.`,
    );
  }
  const hostConfig = objectConfig(hosts[0]?.config?.host);
  const name = applicationGraphStringValue(hostConfig.name)
    ?? `${graph.metadata.name}-web`;
  const namespace = applicationGraphStringValue(hostConfig.namespace)
    ?? graph.metadata.namespace
    ?? 'default';
  const serviceAccount = applicationGraphStringValue(hostConfig.serviceAccountName)
    ?? name;
  return [{ operator: name, namespace, serviceAccount, contracts }];
}

function applicationHttpWorkflowGatewayCallers(
  graph: ApplicationGraph,
  worker: ApplicationWorkflowWorkerNode,
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const contractsByTarget = new Map<string, string>();
  for (const reference of worker.handlers) {
    const handler = nodes.get(reference.nodeId);
    if (handler?.kind === 'workflowHandler') {
      const target = nodes.get(handler.workflow.nodeId);
      if (target?.kind === 'workflow') {
        contractsByTarget.set(
          target.id,
          `${target.contract.name}.${target.contract.version}`,
        );
      }
    } else if (handler?.kind === 'taskHandler') {
      const target = nodes.get(handler.task.nodeId);
      if (target?.kind === 'task') {
        contractsByTarget.set(
          target.id,
          `${target.contract.name}.${target.contract.version}`,
        );
      }
    }
  }
  if (contractsByTarget.size === 0) return [];
  const provider = nodes.get(worker.workflowEngine.nodeId);
  const providerConfig = provider?.kind === 'provider'
    ? objectConfig(provider.config)
    : {};
  const defaultNamespace = applicationGraphStringValue(providerConfig.namespace)
    ?? graph.metadata.namespace
    ?? 'default';
  return graph.nodes.flatMap((node) => {
    if (node.kind !== 'server') return [];
    const contracts = [...new Set(node.routes.flatMap((route) =>
      (route.functionNative?.workflowBindings ?? []).flatMap((binding) => {
        const contract = contractsByTarget.get(binding.target.nodeId);
        return contract ? [contract] : [];
      })))].sort();
    if (contracts.length === 0) return [];
    return [{
      operator: node.name,
      namespace: applicationServerNamespace(graph, node, defaultNamespace),
      serviceAccount: kubernetesName(node.name),
      contracts,
    }];
  });
}
