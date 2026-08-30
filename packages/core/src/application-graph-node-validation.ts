import type {
  ApplicationGeneratedArtifactKind,
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationModelNode,
  ApplicationObservabilityContract,
  ApplicationProviderNode,
  ApplicationProviderRef,
  ApplicationRouteDiagnosticField,
  ApplicationRouteDiagnosticsContract,
} from './application-graph.js';
import type { Diagnostic } from './common.js';

function applicationGraphStructureDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPATIBILITY_FAILED',
    message,
    recovery: { summary: 'Fix the application graph contract before lowering it to generated artifacts.' },
  };
}

export function validateApplicationRouteDiagnosticsContract(owner: string, contract: ApplicationRouteDiagnosticsContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.routeFailureEvent !== 'applik8s-server-route-failure') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} routeFailureEvent must be applik8s-server-route-failure.`));
  }
  if (contract.actionFailureEvent !== 'applik8s-route-action-failure') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} actionFailureEvent must be applik8s-route-action-failure.`));
  }
  if (contract.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} failurePolicy must fail closed.`));
  }
  if (contract.partialEffects !== 'unknownAfterActionStarted') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must declare unknown partial effects after route actions start.`));
  }
  if (contract.sourceMaps !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must require source maps.`));
  }
  const fields = new Set(contract.includes);
  for (const field of ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'] satisfies readonly ApplicationRouteDiagnosticField[]) {
    if (!fields.has(field)) diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must include ${field}.`));
  }
  return diagnostics;
}

export function applicationModelNodeStructureDiagnostics(node: ApplicationModelNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const runtimeRoles = node.common?.runtimeRoles ?? [];
  if (new Set(runtimeRoles).size !== runtimeRoles.length) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} runtime roles must be unique.`));
  }
  for (const role of runtimeRoles) {
    if (!/^[a-z][a-z0-9.-]*(?:\/[A-Za-z0-9._-]+)+$/u.test(role)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} runtime role ${JSON.stringify(role)} must be a stable namespaced identifier.`));
    }
  }
  if (node.database.interface !== node.materialization.provider.interface || node.database.nodeId !== node.materialization.provider.nodeId) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} has inconsistent TransactionalDatabase refs between database and materialization.provider.`));
  }
  if (node.schema.migrations.strategy === 'generatedJob') {
    const hasMigrationJob = graph.edges.some((edge) => edge.relationship === 'dependsOn' && edge.to.nodeId === node.id && graph.nodes.some((candidate) => candidate.id === edge.from.nodeId && candidate.kind === 'workloadJob' && candidate.task.taskKind === 'migration'));
    if (!hasMigrationJob) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} declares generatedJob migrations but no migration job depends on it.`));
    }
  }
  if (node.schema.retention?.mode === 'ttl' && node.schema.retention.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} uses ttl retention without ttlSeconds.`));
  }
  return diagnostics;
}

export function applicationObservabilityStructureDiagnostics(owner: string, observability: ApplicationObservabilityContract | undefined, diagnosticsArtifactKind: ApplicationGeneratedArtifactKind): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!observability) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} must declare generated observability metadata.`));
    return diagnostics;
  }
  if (observability.health.mode === 'http') {
    if (!observability.health.readinessPath?.startsWith('/')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`${owner} HTTP observability readinessPath must be an absolute path.`));
    }
    if (!observability.health.livenessPath?.startsWith('/')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`${owner} HTTP observability livenessPath must be an absolute path.`));
    }
  }
  if (observability.logs.format !== 'json') {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must use json format.`));
  }
  if (!observability.logs.component || observability.logs.component.trim().length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must declare a runtime component.`));
  }
  if (observability.logs.failureEvents.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must declare failure events.`));
  }
  if (observability.events.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability must declare diagnostic events.`));
  }
  if (observability.metrics.mode === 'declaredHooks' && observability.metrics.names.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability metrics declaredHooks mode must name emitted hooks.`));
  }
  if (observability.sourceMaps === 'required' && observability.replayArtifacts.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability requiring source maps must declare replay artifacts.`));
  }
  if (observability.diagnosticsArtifact.kind !== diagnosticsArtifactKind) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability diagnostics artifact must be ${diagnosticsArtifactKind}.`));
  }
  return diagnostics;
}

export function uniqueApplicationProviderRefs(refs: readonly ApplicationProviderRef[]): readonly ApplicationProviderRef[] {
  const byKey = new Map<string, ApplicationProviderRef>();
  for (const ref of refs) {
    byKey.set(`${ref.interface}:${ref.nodeId}`, ref);
  }
  return [...byKey.values()];
}

export function applicationProviderRefDiagnostics(owner: string, ref: ApplicationProviderRef, providerById: ReadonlyMap<string, ApplicationProviderNode>): readonly Diagnostic[] {
  const provider = providerById.get(ref.nodeId);
  if (!provider) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but that provider node is missing.`)];
  }
  if (provider.interface !== ref.interface) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but the provider node implements ${provider.interface}.`)];
  }
  return [];
}

export function applicationProviderRefsForNode(node: ApplicationGraphNode): readonly ApplicationProviderRef[] {
  switch (node.kind) {
    case 'model':
      return [node.database, node.materialization.provider];
    case 'server':
      return [
        ...(node.exposure ? [node.exposure] : []),
        ...node.routes.flatMap(
          (route) => route.functionNative?.providerBindings?.map(
            ({ provider }) => provider,
          ) ?? [],
        ),
      ];
    case 'index':
      return [node.provider];
    case 'counter':
      return node.provider ? [node.provider] : [];
    case 'processor':
      return node.eventLog ? [node.eventLog] : [];
    case 'taskHandler':
      return [
        node.workflowEngine,
        ...(node.capabilities ?? []),
        ...(node.providerBindings ?? []).map(({ provider }) => provider),
      ];
    case 'workflowHandler':
    case 'workflowWorker':
      return [node.workflowEngine];
    case 'schedule':
      return [
        node.scheduler,
        ...(node.providerBindings ?? []).map(({ provider }) => provider),
      ];
    case 'lakehousePublication':
      return [node.dataset];
    case 'actor':
      return [
        node.runtime,
        ...(node.providerBindings ?? []).map(({ provider }) => provider),
      ];
    case 'aiAgent':
      return [
        node.inference,
        node.state,
        ...(node.providerBindings ?? []).map(({ provider }) => provider),
      ];
    case 'projection':
      return [node.provider];
    case 'objectStore':
      return [node.provider];
    default:
      return [];
  }
}

export function applicationProviderBindingDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPATIBILITY_FAILED',
    message,
    recovery: { summary: 'Bind exactly one matching provider before lowering this application graph.' },
  };
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
