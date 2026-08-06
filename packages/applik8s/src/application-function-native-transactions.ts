// typecast-file-boundary: compiler-owned callback metadata is discriminant-checked before its erased model/event leaves are restored to their graph contracts.
import type {
  ApplicationFunctionNativeTransactionContract,
} from '@applik8s/core';
import type {
  expandApplicationCallbackDependencies,
} from './application-callback.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import {
  addApplicationGraphNode,
} from './application-graph-state.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import { declaredSchema } from './application-workflow-serialization.js';
import { applicationEventDefinitionFor } from './dsl.js';
import {
  nativeApplicationModelBindingFor,
} from './native-models.js';
import {
  applicationNativeModelMethodDependencyFor,
} from './native-model-execution.js';

type ExpandedApplicationCallbackDependencies = ReturnType<
  typeof expandApplicationCallbackDependencies
>;

/**
 * Interprets compiler-captured callback leaves as one atomic model
 * transaction. The trigger family owns the durable identity while the
 * application keeps ordinary Model.edit/require and Event.emit calls.
 *
 * @internal Shared registration lowering; not an application authoring API.
 */
export function inferApplicationFunctionNativeTransaction(
  state: ApplicationGraphState,
  label: string,
  dependencies: ExpandedApplicationCallbackDependencies,
  idempotency: ApplicationFunctionNativeTransactionContract['idempotency'],
): ApplicationFunctionNativeTransactionContract | undefined {
  const modelDependencies = Object.entries(dependencies.bindings)
    .flatMap(([identifier, value]) => {
      const dependency = applicationNativeModelMethodDependencyFor(value);
      const model = dependency
        ? nativeApplicationModelBindingFor(dependency.model)
        : value !== null && typeof value === 'object'
          ? nativeApplicationModelBindingFor(value)
          : undefined;
      if (!model) {
        if (!dependency) return [];
        throw new Error(
          `${label} reaches ${dependency.modelName}.${dependency.method} before that promoted model is registered through app.model(...).`,
        );
      }
      return [{
        identifier,
        dependency: dependency ?? {
          kind: 'applicationNativeModelMethod' as const,
          model: value as object,
          modelName: model.name,
          method: 'get' as const,
          access: 'read' as const,
        },
        model,
      }];
    })
    .filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.identifier === entry.identifier
            && candidate.model.name === entry.model.name
            && candidate.dependency.method === entry.dependency.method,
        ) === index,
    );
  const writes = modelDependencies.filter(
    ({ dependency }) => dependency.access === 'write',
  );
  const writeModels = [...new Map(
    writes.map(({ model }) => [model.name, model] as const),
  ).values()];
  if (writeModels.length === 0) return undefined;
  if (writeModels.length > 1) {
    throw new Error(
      `${label} reaches Model.edit(...) for multiple authoritative models (${writeModels.map((model) => model.name).sort().join(', ')}). One managed callback must have exactly one atomic model boundary.`,
    );
  }
  const models = [...new Map(
    modelDependencies.map(({ model }) => [model.name, model] as const),
  ).values()];
  for (const model of models) {
    if (!state.graphNodes.some(
      (node) => node.kind === 'model' && node.name === model.name,
    )) {
      throw new Error(
        `${label} reaches model ${model.name}, but that model is absent from the application graph.`,
      );
    }
  }
  const events = [...new Map(
    [
      ...dependencies.calls,
      ...Object.values(dependencies.bindings),
    ].flatMap((value) => {
      const event = applicationEventDefinitionFor(value);
      return event ? [[event.id, event] as const] : [];
    }),
  ).values()];
  const eventBindings = Object.entries(dependencies.bindings)
    .flatMap(([identifier, value]) => {
      const event = applicationEventDefinitionFor(value);
      return event ? [{ identifier, event }] : [];
    })
    .filter(
      (entry, index, entries) =>
        !/^generatedCall\d+$/.test(entry.identifier)
        && entries.findIndex(
          (candidate) =>
            candidate.identifier === entry.identifier
            && candidate.event.id === entry.event.id,
        ) === index,
    );
  for (const event of events) {
    addApplicationGraphNode(state, {
      id: functionNativeNodeId('event', event.id),
      kind: 'event',
      name: event.id,
      stability: 'stable',
      contract: {
        name: event.name,
        version: event.version,
        payload: declaredSchema(event.payload, `${event.id}.payload`),
      },
    });
  }
  const primary = writeModels[0];
  if (!primary) return undefined;
  return {
    primaryModel: { nodeId: functionNativeNodeId('model', primary.name) },
    models: models
      .map((model) => ({ nodeId: functionNativeNodeId('model', model.name) }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    modelBindings: modelDependencies
      .filter(
        ({ identifier }) => !/^generatedCall\d+$/.test(identifier),
      )
      .map(({ identifier, model, dependency }) => ({
        identifier,
        model: { nodeId: functionNativeNodeId('model', model.name) },
        access: dependency.access,
      }))
      .sort((left, right) =>
        `${left.identifier}:${left.model.nodeId}`.localeCompare(
          `${right.identifier}:${right.model.nodeId}`,
        )),
    ...(eventBindings.length > 0
      ? {
          eventBindings: eventBindings
            .map(({ identifier, event }) => ({
              identifier,
              event: { nodeId: functionNativeNodeId('event', event.id) },
            }))
            .sort((left, right) =>
              `${left.identifier}:${left.event.nodeId}`.localeCompare(
                `${right.identifier}:${right.event.nodeId}`,
              )),
        }
      : {}),
    outbox: events
      .map((event) => ({ nodeId: functionNativeNodeId('event', event.id) }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    idempotency,
  };
}

function functionNativeNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}
