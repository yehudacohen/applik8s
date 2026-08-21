// typecast-file-boundary: Generic callback erasure and restoration occur only after declared-schema validation.
import type { ApplicationLakehousePublicationNode } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { serializeApplicationCallback } from './application-callback.js';
import { applicationProviderGraphNodeId, kubernetesNameSegment } from './application-identifiers.js';
import type { ApplicationLakehousePublication, QualifiedLakehouseDatasetRef } from './application-lakehouse.js';
import { validateLakehousePartition } from './application-lakehouse.js';
import { declaredSchema, validateMessage } from './application-schema-runtime.js';
import type { EventDefinition } from './dsl.js';

/** Authoring-only lakehouse declaration; runtime packages import the focused runtime module instead. */
export function createApplicationLakehousePublication<TEvent extends object, TRow extends object>(
  event: EventDefinition<TEvent>,
  dataset: QualifiedLakehouseDatasetRef,
  row: SchemaInput<TRow>,
  transform: (event: TEvent, output: { append(row: TRow): TRow }) => TRow,
): ApplicationLakehousePublication<TRow> {
  const qualification = dataset?.qualification;
  if (dataset?.name !== 'LakehouseDataset' || !qualification?.name) {
    throw new Error('Event.publish(...) requires a qualified LakehouseDataset.named(...) capability.');
  }
  const append = (value: TRow): TRow => validateMessage(row, value, `${qualification.name}.row`);
  const map = (value: TEvent): TRow => transform(value, { append });
  const datasetNodeId = applicationProviderGraphNodeId('LakehouseDataset', {
    name: qualification.name,
    compatibilityRevision: qualification.compatibilityRevision ?? 'v1alpha1',
  });
  const rowContract = declaredSchema(row, `${qualification.name}.row`);
  const create = (partition?: (value: TRow) => Readonly<Record<string, string>>): ApplicationLakehousePublication<TRow> => {
    const graphNode: ApplicationLakehousePublicationNode = {
      id: `lakehouse-publication.${kubernetesNameSegment(event.id)}.${kubernetesNameSegment(qualification.name)}`,
      kind: 'lakehousePublication',
      name: `${event.id}:${qualification.name}`,
      stability: 'experimental',
      sourceEventId: event.id,
      sourceContract: { name: event.name, version: event.version },
      source: declaredSchema(event.payload, `${event.id}.payload`),
      dataset: { interface: 'LakehouseDataset', nodeId: datasetNodeId },
      row: rowContract,
      transform: serializeApplicationCallback({ registrar: 'event.publish', argumentIndex: 2, property: 'transform', label: `Lakehouse publication ${event.id} to ${qualification.name}`, callback: transform as (...args: never[]) => unknown, allowDeferredResolution: true }),
      ...(partition ? { partition: serializeApplicationCallback({ registrar: 'lakehouse.partitionBy', argumentIndex: 0, property: 'partition', label: `Lakehouse partition ${event.id} to ${qualification.name}`, callback: partition as (...args: never[]) => unknown, allowDeferredResolution: true }) } : {}),
      semantics: { publication: 'atomicManifest', frontier: 'sourceEvent', schemaEvolution: 'explicitRevision' },
    };
    return Object.freeze({
      kind: 'applicationLakehousePublication' as const,
      event: event as EventDefinition<object>,
      dataset,
      row: rowContract,
      graphNode,
      transform: (value: object) => map(value as TEvent),
      ...(partition ? { partition: (value: TRow) => validateLakehousePartition(partition(value)) } : {}),
      partitionBy(next: (value: TRow) => Readonly<Record<string, string>>) { return create(next); },
    });
  };
  return create();
}
