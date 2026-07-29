import type { Diagnostic } from './common.js';
import type {
  ApplicationCompatibilityLabel,
  ApplicationCompatibilitySurface,
  ApplicationGraph,
  ApplicationGraphNode,
  ApplicationGraphNodeKind,
} from './application-graph.js';

/** Compatibility policy is a separate pass so graph construction stays independent from release-surface classification. */
export function validateApplicationGraphCompatibility(graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const labelsByName = new Map(graph.compatibility.labels.map((label) => [label.name, label]));
  for (const duplicate of duplicateApplicationCompatibilityLabels(graph.compatibility.labels)) {
    diagnostics.push(compatibilityDiagnostic(`Application graph compatibility label ${duplicate} is declared more than once.`));
  }
  for (const api of graph.compatibility.stablePublicApis) {
    const label = labelsByName.get(api);
    if (label?.surface !== 'stablePublicApi') {
      diagnostics.push(compatibilityDiagnostic(`Application graph stable public API ${api} must have a stablePublicApi compatibility label.`));
      continue;
    }
    if (!label.rationale?.trim()) diagnostics.push(compatibilityDiagnostic(`Application graph stable public API ${api} must document its implementation or fail-closed rationale.`));
    if (!label.implementation) diagnostics.push(compatibilityDiagnostic(`Application graph stable public API ${api} must declare implementation support.`));
    if (label.implementation === 'failClosedReserved' && (label.diagnostics?.length ?? 0) === 0) {
      diagnostics.push(compatibilityDiagnostic(`Application graph stable public API ${api} is fail-closed reserved but has no release-facing diagnostics.`));
    }
    const rationale = label.rationale?.toLowerCase() ?? '';
    if ((rationale.includes('not implemented') || rationale.includes('not enabled')) && !rationale.includes('fail-closed') && !rationale.includes('fail closed')) {
      diagnostics.push(compatibilityDiagnostic(`Application graph stable public API ${api} describes missing implementation without documented fail-closed behavior.`));
    }
  }
  for (const node of graph.nodes) {
    const stableApi = stablePublicApiForApplicationGraphNode(node);
    if (!stableApi) continue;
    const label = labelsByName.get(stableApi);
    if (label?.surface === 'stablePublicApi' && label.implementation === 'implemented' && node.stability !== 'stable') {
      diagnostics.push(compatibilityDiagnostic(`Application graph node ${node.id} is emitted by stable public API ${stableApi} but has ${node.stability} stability.`));
    }
  }
  diagnostics.push(...compatibilitySurfaceDiagnostics('documented internal contract', 'documentedInternalContract', graph.compatibility.documentedInternalContracts, labelsByName));
  diagnostics.push(...compatibilitySurfaceDiagnostics('experimental surface', 'experimentalSurface', graph.compatibility.experimentalSurfaces, labelsByName));
  diagnostics.push(...compatibilitySurfaceDiagnostics('post-v0.3 surface', 'postV3Surface', graph.compatibility.postV3Surfaces, labelsByName));
  return diagnostics;
}

function stablePublicApiForApplicationGraphNode(node: ApplicationGraphNode): string | undefined {
  if (node.kind === 'provider') return `provider.${node.interface}`;
  if (node.kind === 'counter') return 'Resource.increment';
  if (node.kind === 'index') return 'Resource.index';
  if (node.kind === 'job') return node.schedule ? 'app.schedule' : 'app.job';
  const apiByNodeKind: Partial<Record<ApplicationGraphNodeKind, string>> = {
    crd: 'app.crd', model: 'app.model', server: 'app.server', aggregate: 'app.aggregate', config: 'app.config', secret: 'app.secret', exposure: 'app.expose',
    command: 'command', event: 'event', commandHandler: 'Model.on.command', processor: 'Model.on.command', task: 'task', taskHandler: 'app.task', workflow: 'workflow', workflowHandler: 'app.workflow', workflowWorker: 'app.workflow', aiAgent: 'app.agent', query: 'app.query', gateway: 'app.gateway', stream: 'app.stream', subscription: 'app.subscription', projection: 'app.projection',
  };
  return apiByNodeKind[node.kind];
}

function duplicateApplicationCompatibilityLabels(labels: readonly ApplicationCompatibilityLabel[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const label of labels) {
    if (seen.has(label.name)) duplicates.add(label.name);
    else seen.add(label.name);
  }
  return [...duplicates].sort(compareStrings);
}

function compatibilitySurfaceDiagnostics(kind: string, surface: ApplicationCompatibilitySurface, names: readonly string[], labelsByName: ReadonlyMap<string, ApplicationCompatibilityLabel>): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const name of names) {
    const label = labelsByName.get(name);
    if (label?.surface !== surface) diagnostics.push(compatibilityDiagnostic(`Application graph ${kind} ${name} must have a ${surface} compatibility label.`));
    else if (!label.rationale?.trim()) diagnostics.push(compatibilityDiagnostic(`Application graph ${kind} ${name} must document its compatibility rationale.`));
  }
  return diagnostics;
}

function compatibilityDiagnostic(message: string): Diagnostic {
  return { severity: 'error', code: 'COMPATIBILITY_FAILED', message, recovery: { summary: 'Update the application graph contract before emitting artifacts.' } };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
