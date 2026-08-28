import type {
  ApplicationPlan,
  ApplicationSourceProvenance,
} from '@applik8s/core';
import type {
  DevelopmentResolvedAttachment,
  DevelopmentSelectionResolver,
  DevelopmentVisualSelection,
} from './contracts.js';

export interface ApplicationPlanSelectionResolverOptions {
  /** The latest immutable plan for the coordinator's current revision. */
  readonly currentPlan: () => ApplicationPlan | undefined;
}

/**
 * Resolves opaque provenance IDs against the canonical ApplicationPlan. It
 * never accepts source paths or semantic identities supplied by the browser.
 */
export function applicationPlanSelectionResolver(
  options: ApplicationPlanSelectionResolverOptions,
): DevelopmentSelectionResolver {
  return {
    async resolve(selection, context) {
      const plan = options.currentPlan();
      if (!plan) return [];
      const hintResolution = resolveHints(plan, selection);
      const hints = hintResolution.provenance;
      if (hints.size === 0) return [];
      const matchedProvenance = provenanceRecords(plan).filter((provenance) => hints.has(provenance.id));
      if (matchedProvenance.length === 0) return [];
      const resolution = hintResolution.exact ? 'exact' : 'candidate';
      const attachments: DevelopmentResolvedAttachment[] = [];

      for (const provenance of uniqueById(matchedProvenance)) {
        attachments.push({
          class: 'source',
          resolution,
          redaction: 'none',
          payload: {
            projectId: context.projectId,
            revision: context.revision,
            provenance,
          },
        });
      }

      for (const node of recordsForProvenance(plan.semantic.nodes, hints)) {
        attachments.push({
          class: 'graphNode', resolution, redaction: 'none',
          payload: { id: node.id, graphNodeId: node.graphNodeId, kind: node.kind, name: node.name, fact: node.fact },
        });
      }
      for (const operation of [
        ...recordsForProvenance(plan.semantic.executions, hints).map((record) => ({ category: 'execution', record })),
        ...recordsForProvenance(plan.semantic.authority, hints).map((record) => ({ category: 'authority', record })),
      ]) {
        attachments.push({ class: 'operation', resolution, redaction: 'none', payload: operation });
      }
      for (const record of applicationPlanRecords(plan).filter(({ provenance }) =>
        provenance.some(({ id }) => hints.has(id)))) {
        attachments.push({
          class: 'applicationPlanNode', resolution, redaction: 'none',
          payload: { category: record.category, record: record.value },
        });
      }
      return deduplicate(attachments);
    },
  };
}

function resolveHints(
  plan: ApplicationPlan,
  selection: DevelopmentVisualSelection,
): { readonly provenance: ReadonlyMap<string, unknown>; readonly exact: boolean } {
  const matches = new Map<string, ApplicationSourceProvenance>();
  let exact = selection.sourceHints.length === 1 && selection.sourceHints[0]?.confidence === 'exact';
  for (const hint of selection.sourceHints) {
    const direct = provenanceRecords(plan).filter(({ id }) => id === hint.provenanceId);
    const semanticNodes = plan.semantic.nodes.filter((node) =>
      node.id === hint.provenanceId || node.graphNodeId === hint.provenanceId);
    const identities = plan.identities.filter(({ id }) => id === hint.provenanceId);
    const records = [
      ...direct,
      ...semanticNodes.flatMap(({ provenance }) => provenance),
      ...identities.flatMap((identity) => applicationPlanRecords(plan)
        .filter(({ value }) => value.id === identity.id || value.identity === identity.id || value.consumer === identity.id)
        .flatMap(({ provenance }) => provenance)),
    ];
    if (records.length === 0) {
      exact = false;
      continue;
    }
    for (const provenance of records) matches.set(provenance.id, provenance);
  }
  return { provenance: matches, exact };
}

type Provenanced = { readonly id: string; readonly provenance: readonly ApplicationSourceProvenance[] };

function provenanceRecords(plan: ApplicationPlan): readonly ApplicationSourceProvenance[] {
  return applicationPlanRecords(plan).flatMap(({ provenance }) => provenance);
}

function applicationPlanRecords(plan: ApplicationPlan): readonly {
  readonly category: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly provenance: readonly ApplicationSourceProvenance[];
}[] {
  return [
    ...categorized('semantic.node', plan.semantic.nodes),
    ...categorized('semantic.edge', plan.semantic.edges),
    ...categorized('semantic.execution', plan.semantic.executions),
    ...categorized('semantic.authority', plan.semantic.authority),
    ...categorized('semantic.dataFlow', plan.semantic.dataFlows),
    ...categorized('semantic.state', plan.semantic.state),
    ...categorized('semantic.exposure', plan.semantic.exposures),
    ...categorized('semantic.observability', plan.semantic.observability),
    ...categorized('semantic.runtimeAccess', plan.semantic.runtimeAccess),
    ...categorized('resolution.capability', plan.resolution.capabilities),
    ...categorized('physical.node', plan.physical.nodes),
  ];
}

function categorized<T extends Provenanced>(category: string, records: readonly T[]) {
  return records.map((value) => ({
    category,
    // typecast: ApplicationPlan records are immutable data objects; this uniform view is used only for opaque attachment payloads.
    value: value as unknown as Readonly<Record<string, unknown>>,
    provenance: value.provenance,
  }));
}

function recordsForProvenance<T extends Provenanced>(records: readonly T[], hints: ReadonlyMap<string, unknown>): readonly T[] {
  return records.filter(({ provenance }) => provenance.some(({ id }) => hints.has(id)));
}

function uniqueById(records: readonly ApplicationSourceProvenance[]): readonly ApplicationSourceProvenance[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function deduplicate(records: readonly DevelopmentResolvedAttachment[]): readonly DevelopmentResolvedAttachment[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.class}:${JSON.stringify(record.payload)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
