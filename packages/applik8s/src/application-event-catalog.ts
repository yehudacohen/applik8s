// typecast-file-boundary: catalog selections preserve declaration-time event unions while graph/runtime registries erase them by stable contract identity.

import { createHash } from 'node:crypto';
import type { JsonObject, JsonSchemaSource } from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import type { ApplicationDatabaseBinding } from './application.js';
import type {
  ApplicationStreamBinding,
  ApplicationStreamOptions,
} from './application-reactive.js';
import type { EventDefinition, StreamDefinition } from './dsl.js';

export interface ApplicationCatalogEvent<
  TDetail extends object = object,
  TId extends string = string,
> {
  readonly id: string;
  readonly contract: {
    readonly id: TId;
    readonly name: string;
    readonly version: string;
  };
  readonly source: { readonly kind: string; readonly id: string };
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly detail: TDetail;
}

export interface ApplicationEventProducer<
  TEvents extends Readonly<Record<string, EventDefinition<object>>> = Readonly<Record<string, EventDefinition<object>>>,
> {
  readonly events: TEvents;
}

type EventDetail<TEvent> = TEvent extends EventDefinition<infer TPayload, string>
  ? TPayload
  : never;

type EventIdentity<TEvent> = TEvent extends EventDefinition<object, infer TId>
  ? TId
  : string;

export type ApplicationCatalogEventFor<TEvent> = TEvent extends EventDefinition<object, string>
  ? ApplicationCatalogEvent<EventDetail<TEvent>, EventIdentity<TEvent>>
  : never;

type ProducerEvents<TProducer> = TProducer extends ApplicationEventProducer<infer TEvents>
  ? TEvents[keyof TEvents]
  : never;

export interface ApplicationEventSelectionBinding<TEvent extends ApplicationCatalogEvent>
  extends ApplicationStreamBinding<TEvent> {
  where<TNarrow extends TEvent>(
    predicate: (event: TEvent) => event is TNarrow,
  ): ApplicationEventSelectionBinding<TNarrow>;
  where(predicate: (event: TEvent) => boolean): ApplicationEventSelectionBinding<TEvent>;
}

export interface ApplicationEventCatalog {
  of<const TEvents extends readonly EventDefinition<object, string>[]>(
    ...events: TEvents
  ): ApplicationEventSelectionBinding<ApplicationCatalogEventFor<TEvents[number]>>;
  from<const TProducers extends readonly ApplicationEventProducer[]>(
    ...producers: TProducers
  ): ApplicationEventSelectionBinding<ApplicationCatalogEventFor<ProducerEvents<TProducers[number]>>>;
  all(): ApplicationEventSelectionBinding<ApplicationCatalogEvent>;
}

export interface ApplicationEventCatalogSource<TPayload extends object = object> {
  readonly definition: EventDefinition<TPayload, string>;
  readonly database: ApplicationDatabaseBinding;
  readonly producer: { readonly kind: string; readonly id: string };
  stream(): ApplicationStreamBinding<TPayload>;
}

export interface ApplicationEventCatalogRegistry {
  readonly eventSources: Map<string, ApplicationEventCatalogSource>;
  readonly producerSources: WeakMap<object, readonly ApplicationEventCatalogSource[]>;
}

export function createApplicationEventCatalogRegistry(): ApplicationEventCatalogRegistry {
  return { eventSources: new Map(), producerSources: new WeakMap() };
}

export function bindApplicationEventCatalogSource<TPayload extends object>(
  registry: ApplicationEventCatalogRegistry,
  source: ApplicationEventCatalogSource<TPayload>,
): void {
  const previous = registry.eventSources.get(source.definition.id);
  if (previous && (
    previous.definition.name !== source.definition.name
    || previous.definition.version !== source.definition.version
    || previous.database.name !== source.database.name
  )) {
    throw new Error(`Application event ${source.definition.id} has conflicting catalog source registrations.`);
  }
  registry.eventSources.set(source.definition.id, source as unknown as ApplicationEventCatalogSource);
}

export function bindApplicationEventProducer(
  registry: ApplicationEventCatalogRegistry,
  producer: object,
  sources: readonly ApplicationEventCatalogSource[],
): void {
  registry.producerSources.set(producer, Object.freeze([...sources]));
}

interface ApplicationEventCatalogRegistration {
  readonly registry: ApplicationEventCatalogRegistry;
  readonly databases: ReadonlyMap<string, ApplicationDatabaseBinding>;
  promote(definition: EventDefinition<object, string>): ApplicationEventCatalogSource;
  register<TEvent extends ApplicationCatalogEvent>(input: {
    readonly definition: StreamDefinition<TEvent>;
    readonly schema: SchemaInput<TEvent>;
    readonly database: ApplicationDatabaseBinding;
    readonly sources: readonly ApplicationEventCatalogSource[];
    readonly selection: 'of' | 'from' | 'all';
    readonly predicate?: (event: TEvent) => boolean;
  }): ApplicationEventSelectionBinding<TEvent>;
}

export function createApplicationEventCatalog(
  registration: ApplicationEventCatalogRegistration,
): ApplicationEventCatalog {
  const select = <TEvent extends ApplicationCatalogEvent>(
    sources: readonly ApplicationEventCatalogSource[],
    selection: 'of' | 'from' | 'all',
    predicate?: (event: TEvent) => boolean,
  ): ApplicationEventSelectionBinding<TEvent> => {
    if (sources.length === 0) {
      throw new Error(`application.events.${selection}(...) selected no catalog event contracts.`);
    }
    const unique = [...new Map(sources.map((source) => [source.definition.id, source])).values()]
      .sort((left, right) => left.definition.id.localeCompare(right.definition.id));
    const databaseNames = new Set(unique.map((source) => source.database.name));
    if (databaseNames.size !== 1) {
      throw new Error('EVENT_MATERIALIZATION_REQUIRED: This event selection spans multiple authoritative databases and requires the normalized-stream provider.');
    }
    for (const source of unique) source.stream();
    const digest = createHash('sha256')
      .update(JSON.stringify({ selection, sources: unique.map((source) => source.definition.id), predicate: predicate ? String(predicate) : undefined }))
      .digest('hex')
      .slice(0, 24);
    const id = `catalog.${selection}.${digest}.v1` as const;
    const identity = id.slice(0, -3);
    const definition: StreamDefinition<TEvent> = {
      kind: 'applik8sStream',
      id,
      name: identity,
      version: 'v1',
      payload: catalogEnvelopeSchema<TEvent>(unique, id),
    };
    return registration.register({
      definition,
      schema: definition.payload,
      database: unique[0]!.database,
      sources: unique,
      selection,
      ...(predicate ? { predicate } : {}),
    });
  };
  const bindWhere = <TEvent extends ApplicationCatalogEvent>(
    binding: ApplicationEventSelectionBinding<TEvent>,
    sources: readonly ApplicationEventCatalogSource[],
    selection: 'of' | 'from' | 'all',
  ): ApplicationEventSelectionBinding<TEvent> => Object.assign(binding, {
    where(predicate: (event: TEvent) => boolean) {
      return bindWhere(select<TEvent>(sources, selection, predicate), sources, selection);
    },
  });
  return Object.freeze({
    of(...events: readonly EventDefinition<object, string>[]) {
      const sources = events.map((definition) =>
        registration.registry.eventSources.get(definition.id)
        ?? registration.promote(definition));
      return bindWhere(select(sources, 'of'), sources, 'of');
    },
    from(...producers: readonly ApplicationEventProducer[]) {
      const sources = producers.flatMap((producer) => {
        const registered = registration.registry.producerSources.get(producer);
        if (!registered) throw new Error('application.events.from(...) requires application-managed producer handles.');
        return registered;
      });
      return bindWhere(select(sources, 'from'), sources, 'from');
    },
    all() {
      const databaseNames = new Set(registration.databases.keys());
      const sources = [...registration.registry.eventSources.values()].filter((source) => databaseNames.has(source.database.name));
      return bindWhere(select(sources, 'all'), sources, 'all');
    },
  }) as ApplicationEventCatalog;
}

function catalogEnvelopeSchema<TEvent extends ApplicationCatalogEvent>(
  sources: readonly ApplicationEventCatalogSource[],
  id: string,
): JsonSchemaSource<TEvent> {
  const variants = sources.map((source) => {
    const emitted = normalizeSchema(source.definition.payload, `${source.definition.id}.payload`).emitJsonSchema();
    if (!emitted.ok) throw new Error(`Application event ${source.definition.id} cannot enter the catalog: ${emitted.error.message}`);
    return {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'contract', 'source', 'occurredAt', 'recordedAt', 'detail'],
      properties: {
        id: { type: 'string', minLength: 1 },
        contract: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'version'],
          properties: {
            id: { const: source.definition.id },
            name: { const: source.definition.name },
            version: { const: source.definition.version },
          },
        },
        source: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: {
            kind: { const: source.producer.kind },
            id: { const: source.producer.id },
          },
        },
        occurredAt: { type: 'string', format: 'date-time' },
        recordedAt: { type: 'string', format: 'date-time' },
        detail: emitted.value.schema,
      },
    } satisfies JsonObject;
  });
  return {
    kind: 'jsonSchema',
    ref: { kind: 'jsonSchema', exportName: id },
    schema: { oneOf: variants },
  };
}

export function applicationCatalogSourceOptions<TPayload extends object>(
  source: ApplicationEventCatalogSource<TPayload>,
): ApplicationStreamOptions<TPayload> {
  return {
    database: source.database,
    retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 10_000_000 },
    partitionBy: (payload) => applicationCatalogPartition(payload),
    authorize: () => false,
  };
}

function applicationCatalogPartition(payload: object): string {
  for (const key of ['identity', 'id', 'key']) {
    const value = Reflect.get(payload, key);
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return 'application';
}
