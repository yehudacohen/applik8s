import type {
  ApplicationLakehousePublicationNode,
  ApplicationScheduleNode,
  OperatorDefinition,
} from '@applik8s/core';

import type { TypeKroCompositionExport } from './entrypoint-discovery.js';

export function exportedApplicationDurable(value: unknown): {
  readonly kind: 'workflow' | 'task' | 'job';
  readonly id: string;
} | undefined {
  if (typeof value !== 'function') return undefined;
  const bindingKind = Reflect.get(value, 'kind');
  const kind = bindingKind === 'applicationWorkflow'
    ? 'workflow'
    : bindingKind === 'applicationTask'
      ? 'task'
      : bindingKind === 'applicationJob'
        ? 'job'
      : undefined;
  if (!kind) return undefined;
  const definition = Reflect.get(value, 'definition');
  const id = definition && typeof definition === 'object'
    ? Reflect.get(definition, 'id')
    : undefined;
  return typeof id === 'string' && id.trim().length > 0
    ? { kind, id }
    : undefined;
}

export function exportedApplicationActorId(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  if (Reflect.get(value, 'kind') !== 'applicationActor') return undefined;
  const id = Reflect.get(value, 'id');
  const graphNode = Reflect.get(value, 'graphNode');
  return typeof id === 'string'
    && id.trim().length > 0
    && graphNode !== null
    && typeof graphNode === 'object'
    && Reflect.get(graphNode, 'kind') === 'actor'
    ? id
    : undefined;
}

export function exportedApplicationLakehousePublication(
  value: unknown,
): ApplicationLakehousePublicationNode | undefined {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'applicationLakehousePublication') return undefined;
  const graphNode = Reflect.get(value, 'graphNode');
  return graphNode && typeof graphNode === 'object' && Reflect.get(graphNode, 'kind') === 'lakehousePublication'
    // typecast: the discriminant check above narrows the reflective export to the public graph-node contract.
    ? graphNode as ApplicationLakehousePublicationNode
    : undefined;
}

export function exportedApplicationSchedule(value: unknown): {
  readonly id: string;
  readonly graphNode: ApplicationScheduleNode;
} | undefined {
  if (typeof value !== 'function' || Reflect.get(value, 'kind') !== 'applicationSchedule') return undefined;
  const definition = Reflect.get(value, 'definition');
  const graphNode = Reflect.get(value, 'graphNode');
  if (!definition || typeof definition !== 'object' || !graphNode || typeof graphNode !== 'object') return undefined;
  const id = Reflect.get(definition, 'id');
  if (typeof id !== 'string' || Reflect.get(graphNode, 'kind') !== 'schedule') return undefined;
  // typecast: the schedule discriminant above validates the reflective graph node before returning it.
  return { id, graphNode: graphNode as ApplicationScheduleNode };
}

export function exportedApplicationOperationId(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  const search = Reflect.get(value, 'search');
  const operation = Reflect.get(value, 'kind') === 'applicationSearchIndex'
    && (typeof search === 'object' || typeof search === 'function')
    && search !== null
    ? Reflect.get(search, 'operation')
    : Reflect.get(value, 'operation');
  if (typeof operation !== 'object' || operation === null) return undefined;
  const id = Reflect.get(operation, 'id');
  return typeof id === 'string' && Reflect.get(operation, 'kind') === 'applicationOperation'
    ? id
    : undefined;
}

export function exportedApplicationModelName(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  const facet = Reflect.get(value, Symbol.for('@applik8s/model-facet'));
  if (!facet || typeof facet !== 'object' || Reflect.get(facet, 'kind') !== 'applicationModelFacet') return undefined;
  const name = Reflect.get(facet, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

export function exportedApplicationSignalId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Reflect.get(value, 'signalKind') !== 'applicationSignal') return undefined;
  const signal = Reflect.get(value, 'signal');
  if (typeof signal !== 'object' || signal === null) return undefined;
  const id = Reflect.get(signal, 'id');
  return typeof id === 'string' && Reflect.get(signal, 'kind') === 'applicationSignalDefinition'
    ? id
    : undefined;
}

export function exportedApplicationAgentName(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || Reflect.get(value, 'kind') !== 'applicationAgent') return undefined;
  const name = Reflect.get(value, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

export function exportedApplicationObjectStoreName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Reflect.get(value, 'kind') !== 'applicationObjectStore') return undefined;
  const name = Reflect.get(value, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

export function isExportedOperator(
  value: unknown,
): value is { readonly definition: OperatorDefinition } {
  return Boolean(value && typeof value === 'function' && typeof Reflect.get(value, 'definition') === 'object');
}

export function isExportedTypeKroComposition(
  value: unknown,
): value is TypeKroCompositionExport {
  return Boolean(value
    && (typeof value === 'object' || typeof value === 'function')
    && Array.isArray(Reflect.get(value, 'operatorInstalls'))
    && typeof Reflect.get(value, 'resolveOperatorInstalls') === 'function');
}

export function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}
