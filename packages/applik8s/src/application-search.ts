// typecast-file-boundary: search paths preserve model/column generics while the serialized planner stores their normalized runtime metadata.
import { createHash } from 'node:crypto';
import {
  type ApplicationGraphNodeRef,
  type ApplicationSearchFieldKind,
  type ApplicationSearchFieldPlan,
  type ApplicationSearchIndexPlan,
  type ApplicationSearchSourceFrontier,
} from '@applik8s/core';
import {
  createApplicationQueryOperation,
  type ApplicationQueryOperation,
} from '@applik8s/client';
import {
  getTableColumns,
  type AnyColumn,
  type GetColumnData,
} from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  addApplicationGraphEdge,
  addApplicationGraphNode,
  addApplicationProviderBinding,
  addApplicationProviderRequirement,
  type ApplicationGraphState,
} from './application-graph-state.js';
import {
  applicationProviderGraphNodeId,
  kubernetesNameSegment,
} from './application-identifiers.js';
import {
  applicationProviderImplementationName,
  type ApplicationProviderQualification,
  type ApplicationSearchCapability,
  type ApplicationSearchProvider,
} from './application-providers.js';
import {
  getApplicationModelFacet,
  type ApplicationModelRelationshipContract,
  type CommonApplicationModelFacet,
} from './native-models.js';

const applicationSearchPath = Symbol.for('@applik8s/search-path');

type SearchScalar = string | number | boolean | Date | null;

export interface ApplicationSearchPath<TValue = unknown> {
  readonly [applicationSearchPath]: true;
  readonly value?: TValue;
  readonly segments: readonly ApplicationSearchFieldPlan['path'][number][];
}

export type ApplicationSearchSource<TValue = unknown> =
  | ApplicationSearchPath<TValue>
  | AnyColumn;

type SearchSourceValue<TSource> =
  TSource extends ApplicationSearchPath<infer TValue>
    ? TValue
    : TSource extends AnyColumn
      ? GetColumnData<TSource, 'query'>
      : never;

type NonNullableSearchSourceValue<TSource> = NonNullable<
  SearchSourceValue<TSource>
>;

export interface ApplicationSearchField<
  TValue = unknown,
  TAlias extends string = string,
> {
  readonly kind: ApplicationSearchFieldKind;
  readonly alias: TAlias;
  readonly path: ApplicationSearchPath<TValue>;
  readonly boost?: number;
  readonly authorizationRelevant: boolean;
}

export interface ApplicationUnaliasedSearchField<TValue = unknown> {
  readonly kind: ApplicationSearchFieldKind;
  readonly path: ApplicationSearchPath<TValue>;
  readonly boost?: number;
  readonly authorizationRelevant: boolean;
  as<const TAlias extends string>(
    alias: TAlias,
  ): ApplicationSearchField<TValue, TAlias>;
}

export type ApplicationSearchDocument<
  TFields extends readonly ApplicationSearchField[],
> = {
  readonly [TField in TFields[number] as TField['alias']]:
    TField extends ApplicationSearchField<infer TValue, string>
      ? TValue
      : never;
};

export type ApplicationSearchComparison<TValue> =
  | TValue
  | {
      readonly eq?: TValue;
      readonly ne?: TValue;
      readonly in?: readonly TValue[];
      readonly lt?: TValue;
      readonly lte?: TValue;
      readonly gt?: TValue;
      readonly gte?: TValue;
    };

export interface ApplicationSearchSort<TAlias extends string = string> {
  readonly field: TAlias;
  readonly direction: 'asc' | 'desc';
}

export interface ApplicationSearchFieldHandle<
  TValue,
  TAlias extends string,
> {
  readonly name: TAlias;
  asc(): ApplicationSearchSort<TAlias>;
  desc(): ApplicationSearchSort<TAlias>;
  readonly __value?: TValue;
}

export interface ApplicationSearchRequest<TDocument extends object> {
  readonly text?: string;
  readonly where?: {
    readonly [TKey in keyof TDocument]?: ApplicationSearchComparison<
      TDocument[TKey]
    >;
  };
  readonly facets?: readonly ApplicationSearchFieldHandle<
    unknown,
    keyof TDocument & string
  >[];
  readonly orderBy?:
    | ApplicationSearchSort<keyof TDocument & string>
    | readonly ApplicationSearchSort<keyof TDocument & string>[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ApplicationSearchFacetBucket<TValue = unknown> {
  readonly value: TValue;
  readonly count: number;
}

export interface ApplicationSearchHit<TDocument extends object> {
  readonly document: TDocument;
  readonly score?: number;
  readonly highlights?: Partial<Record<keyof TDocument, readonly string[]>>;
}

export interface ApplicationSearchResult<TDocument extends object> {
  readonly hits: readonly ApplicationSearchHit<TDocument>[];
  readonly facets: Partial<
    Record<keyof TDocument, readonly ApplicationSearchFacetBucket[]>
  >;
  readonly cursor?: string;
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  readonly sourceProjectionRevision: string;
  readonly lag: {
    readonly changes: number;
    readonly milliseconds: number;
    readonly state: 'current' | 'lagging' | 'rebuildRequired';
  };
}

export interface ApplicationSearchIndexBinding<TDocument extends object> {
  readonly kind: 'applicationSearchIndex';
  readonly name: string;
  readonly plan: ApplicationSearchIndexPlan;
  readonly fields: {
    readonly [TKey in keyof TDocument & string]:
      ApplicationSearchFieldHandle<TDocument[TKey], TKey>;
  };
  readonly search: ApplicationQueryOperation<
    ApplicationSearchRequest<TDocument>,
    ApplicationSearchResult<TDocument>
  >;
  require(
    capability: ApplicationSearchCapability,
  ): ApplicationSearchIndexBinding<TDocument>;
}

export interface ApplicationSearchIndexOptions {
  readonly provider?: ApplicationSearchProvider;
  readonly fanOutCeiling?: number;
  readonly authorizationFields?: readonly string[];
  readonly requiredCapabilities?: readonly ApplicationSearchCapability[];
}

export interface ApplicationSearchRootOptions {
  readonly root: object;
  /**
   * The canonical model identity is used by default. Supplying an identity is
   * reserved for future explicit codecs and fails closed when it differs.
   */
  readonly identity?: unknown;
  readonly provider?: ApplicationSearchProvider;
  readonly fanOutCeiling?: number;
  readonly authorizationFields?: readonly string[];
  readonly requiredCapabilities?: readonly ApplicationSearchCapability[];
}

interface RegisteredSearchColumn {
  readonly model: string;
  readonly field: string;
  readonly valueType: ApplicationSearchFieldPlan['valueType'];
  readonly nullable: boolean;
  readonly authority: CommonApplicationModelFacet<
    unknown,
    unknown,
    unknown,
    unknown
  >['provider'];
}

export type ApplicationSearchIndexRegistrar = <
  const TFields extends readonly ApplicationSearchField[],
>(
  root: object,
  name: string,
  fields: TFields,
  options?: ApplicationSearchIndexOptions,
) => ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;

const registeredColumns = new WeakMap<object, RegisteredSearchColumn>();
const searchRegistrars = new WeakMap<object, ApplicationSearchIndexRegistrar>();

export function bindApplicationSearchModel(
  model: object,
  registrar: ApplicationSearchIndexRegistrar,
): void {
  const facet = requiredModelFacet(model);
  searchRegistrars.set(model, registrar);
  if (facet.native === 'drizzle-table') {
    for (const [field, column] of Object.entries(
      getTableColumns(model as AnyPgTable),
    )) {
      const metadata: RegisteredSearchColumn = {
        model: facet.name,
        field,
        valueType: searchValueType(column),
        nullable: !column.notNull,
        authority: facet.provider,
      };
      registeredColumns.set(column, metadata);
      const existing = registeredColumnList.findIndex(
        ([candidate]) => candidate === column,
      );
      const entry = [column, metadata] as const;
      if (existing >= 0) registeredColumnList[existing] = entry;
      else registeredColumnList.push(entry);
    }
  }
  if (!('index' in model)) {
    Object.defineProperty(model, 'index', {
      value: (
        name: string,
        ...fields: readonly ApplicationSearchField[]
      ) => requiredSearchRegistrar(model)(model, name, fields),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

export function applicationSearchIndexRegistrar(
  model: object,
): ApplicationSearchIndexRegistrar | undefined {
  return searchRegistrars.get(model);
}

export function createApplicationSearchRegistrar(options: {
  readonly application: string;
  readonly state: ApplicationGraphState;
  readonly provider: ApplicationSearchProvider;
  readonly qualification?: ApplicationProviderQualification;
}): ApplicationSearchIndexRegistrar {
  return (root, name, fields, indexOptions = {}) =>
    registerApplicationSearchIndex({
      ...options,
      root,
      name,
      fields,
      indexOptions,
      provider: indexOptions.provider ?? options.provider,
    });
}

function registerApplicationSearchIndex<
  const TFields extends readonly ApplicationSearchField[],
>(options: {
  readonly application: string;
  readonly state: ApplicationGraphState;
  readonly provider: ApplicationSearchProvider;
  readonly qualification?: ApplicationProviderQualification;
  readonly root: object;
  readonly name: string;
  readonly fields: TFields;
  readonly indexOptions: ApplicationSearchIndexOptions;
}): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>> {
  if (!/^[a-z][A-Za-z0-9-]*$/.test(options.name)) {
    throw new Error(
      `Application search index ${JSON.stringify(options.name)} must have an explicit stable lowerCamelCase or kebab-case name.`,
    );
  }
  if (options.fields.length === 0) {
    throw new Error(
      `Application search index ${options.name} requires at least one field.`,
    );
  }
  const root = requiredModelFacet(options.root);
  if (root.identity.encoding !== 'scalar' || root.identity.fields.length !== 1) {
    throw new Error(
      `Application search index ${options.name} requires one canonical scalar root identity.`,
    );
  }
  const queryNodeId = `query.${kubernetesNameSegment(`${options.name}-search`)}`;
  const plan = compileSearchIndexPlan({
    application: options.application,
    root,
    name: options.name,
    fields: options.fields,
    fanOutCeiling: options.indexOptions.fanOutCeiling ?? 1_000,
    authorizationFields: options.indexOptions.authorizationFields ?? [],
    requiredCapabilities: options.indexOptions.requiredCapabilities ?? [],
    queryNodeId,
  });
  const nodeId = `index.${kubernetesNameSegment(options.name)}`;
  const providerNodeId = applicationProviderGraphNodeId(
    'Search',
    options.qualification,
  );
  const providerRef = {
    interface: 'Search' as const,
    nodeId: providerNodeId,
    implementation: applicationProviderImplementationName(options.provider),
  };
  addApplicationGraphNode(options.state, {
    id: nodeId,
    kind: 'index',
    name: options.name,
    stability: 'stable',
    purpose: 'searchProjection',
    source: { nodeId: modelNodeId(root.name) },
    provider: providerRef,
    search: plan,
  });
  addApplicationGraphNode(options.state, {
    id: queryNodeId,
    kind: 'query',
    name: `${options.name}.search`,
    publicId: `${options.name}.search`,
    stability: 'stable',
    version: 'v1',
    input: {
      kind: 'declared',
      runtime: 'arktype',
      jsonSchema: searchRequestJsonSchema(plan),
    },
    output: {
      kind: 'declared',
      runtime: 'arktype',
      jsonSchema: searchResultJsonSchema(plan),
    },
    reads: [{ model: { nodeId: modelNodeId(root.name) } }],
    authorization: 'application-defined',
    authority: {
      classification: 'unclassified',
      permissionIds: [],
      grantable: false,
      delegable: false,
      scope: { kind: 'all' },
    },
    trustedContext: [],
    budgets: {
      timeoutMs: 10_000,
      maxResultBytes: 2 * 1024 * 1024,
      maxRows: 100,
    },
    snapshotResume: 'resumableInvalidation',
    incremental: 'invalidation-requery',
    cursor: 'opaque-query-version-context-scoped',
    authorizationSource:
      'async ({ principal, context }) => ({ principal, context, mode: "mandatory-search-filter" })',
    handlerSource:
      'async (input, context) => context.search.execute(input)',
    authorizationUnresolved: [],
    handlerUnresolved: [],
  });
  addApplicationGraphEdge(options.state, {
    from: { nodeId },
    to: { nodeId: modelNodeId(root.name) },
    relationship: 'projects',
  });
  addApplicationGraphEdge(options.state, {
    from: { nodeId: queryNodeId },
    to: { nodeId },
    relationship: 'queries',
  });
  for (const source of plan.sourceFrontiers) {
    addApplicationGraphEdge(options.state, {
      from: { nodeId },
      to: { nodeId: modelNodeId(source.model) },
      relationship: source.model === root.name ? 'projects' : 'hydrates',
    });
  }
  const requirementId = `search.${kubernetesNameSegment(options.name)}`;
  addApplicationProviderRequirement(options.state, {
    id: requirementId,
    interface: 'Search',
    consumer: { nodeId },
    provider: providerRef,
    required: true,
    purpose: 'search',
    diagnostics: {
      missing: `Search index ${options.name} requires a Search provider.`,
      ambiguous: `Search index ${options.name} resolved more than one Search provider.`,
    },
  });
  addApplicationProviderBinding(options.state, {
    requirement: requirementId,
    provider: providerRef,
    generatedResources: [],
    runtime: {
      readiness: {
        dependencies: [],
        condition: 'search-provider-ready',
        timeoutSeconds: 600,
      },
    },
  });

  const searchOperation = createApplicationQueryOperation<
    ApplicationSearchRequest<ApplicationSearchDocument<TFields>>,
    ApplicationSearchResult<ApplicationSearchDocument<TFields>>
  >({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: `${options.name}.search`,
    name: 'search',
    model: root.name,
    operation: 'query',
    transport: 'query',
  });
  return searchBinding(options.name, plan, searchOperation);
}

function compileSearchIndexPlan(options: {
  readonly application: string;
  readonly root: CommonApplicationModelFacet<unknown, unknown, unknown, unknown>;
  readonly name: string;
  readonly fields: readonly ApplicationSearchField[];
  readonly fanOutCeiling: number;
  readonly authorizationFields: readonly string[];
  readonly requiredCapabilities: readonly ApplicationSearchCapability[];
  readonly queryNodeId: string;
}): ApplicationSearchIndexPlan {
  if (
    !Number.isInteger(options.fanOutCeiling)
    || options.fanOutCeiling < 1
  ) {
    throw new Error(
      `Application search index ${options.name} fanOutCeiling must be a positive integer.`,
    );
  }
  const aliases = options.fields.map((field) => field.alias);
  if (new Set(aliases).size !== aliases.length) {
    throw new Error(
      `Application search index ${options.name} contains duplicate field aliases.`,
    );
  }
  const fields = options.fields.map((field) =>
    normalizeSearchField(field, options.authorizationFields),
  );
  const sourceModels = [
    ...new Set(
      fields.flatMap((field) => field.path.map((segment) => segment.model)),
    ),
  ].sort();
  if (!sourceModels.includes(options.root.name)) {
    throw new Error(
      `Application search index ${options.name} has no field rooted in ${options.root.name}.`,
    );
  }
  const sourceFrontiers = sourceModels.map((model) =>
    searchSourceFrontier(model, fields, options.root),
  );
  const inverseInvalidation = sourceModels.map((model) => {
    const relationships = [
      ...new Set(
        fields
          .filter((field) =>
            field.path.some((segment) => segment.model === model),
          )
          .flatMap((field) =>
            field.path.flatMap((segment) =>
              segment.relationship ? [segment.relationship] : [],
            ),
          ),
      ),
    ];
    return {
      sourceModel: model,
      affectedRoot: options.root.name,
      relationships,
      lookup:
        model === options.root.name
          ? ('rootIdentity' as const)
          : ('foreignKey' as const),
      fanOutCeiling: options.fanOutCeiling,
      overflow: 'partitionedRepair' as const,
    };
  });
  const requiredCapabilities = [
    ...new Set([
      'text',
      'filters',
      ...fields.flatMap((field) =>
        field.kind === 'facet' ? ['facets'] : [],
      ),
      ...options.requiredCapabilities,
    ]),
  ].sort();
  const revisionInput = {
    root: {
      name: options.root.name,
      identity: options.root.identity,
      revision: options.root.revision,
      relationships: options.root.relationships,
    },
    fields,
    sourceFrontiers,
    inverseInvalidation,
    authorizationFields: [...options.authorizationFields].sort(),
    requiredCapabilities,
  };
  const revision = digest(revisionInput);
  return {
    apiVersion: 'applik8s.searchIndex/v1alpha1',
    logicalIdentity: {
      application: options.application,
      name: options.name,
    },
    root: {
      model: { nodeId: modelNodeId(options.root.name) },
      identity: options.root.identity.fields,
      encoding: 'scalar',
    },
    revision: {
      digest: revision,
      rootModelRevision: digest(revisionInput.root),
      documentSchemaRevision: digest(
        fields.map(({ alias, valueType, nullable }) => ({
          alias,
          valueType,
          nullable,
        })),
      ),
      fieldPlanRevision: digest(fields),
      invalidationPlanRevision: digest(inverseInvalidation),
      authorizationPlanRevision: digest({
        fields: options.authorizationFields,
      }),
    },
    fields,
    sourceFrontiers,
    inverseInvalidation,
    synchronization: {
      source: 'committedChanges',
      writes: 'wholeDocumentReplaceDelete',
      idempotency: 'committedChangeIdentity',
      historyLoss: 'rebuildRequired',
      checkpoint: 'contiguousCommittedFrontier',
    },
    rebuild: {
      snapshot: 'boundedAuthoritativeScan',
      catchup: 'retainedCommittedChanges',
      validation: ['count', 'schema', 'sample', 'checksum', 'authorization'],
      cutover: 'atomicAlias',
    },
    authorization: {
      mandatoryFilters: 'trustedAdmissionScope',
      composition: 'monotonicIntersection',
      pagePostFiltering: 'forbidden',
    },
    physicalGeneration: {
      naming: 'logical-name-revision-generation',
      cutover: 'atomicAlias',
      cursorBinding: 'exactGeneration',
      retirement: 'observedReadersThenExplicitDelete',
    },
    requiredCapabilities,
    searchOperation: { nodeId: options.queryNodeId },
  };
}

function normalizeSearchField(
  field: ApplicationSearchField,
  authorizationFields: readonly string[],
): ApplicationSearchFieldPlan {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.alias)) {
    throw new Error(
      `Search field alias ${JSON.stringify(field.alias)} must be a JavaScript identifier.`,
    );
  }
  const many = field.path.segments.some(
    (segment) => segment.cardinality === 'many',
  );
  if (
    many
    && field.kind !== 'values'
    && field.kind !== 'minimum'
    && field.kind !== 'maximum'
    && field.kind !== 'count'
  ) {
    throw new Error(
      `Search field ${field.alias} crosses a many-valued relationship and requires search.values(), search.minimum(), search.maximum(), or search.count().`,
    );
  }
  if (
    !many
    && (field.kind === 'values'
      || field.kind === 'minimum'
      || field.kind === 'maximum'
      || field.kind === 'count')
  ) {
    throw new Error(
      `Search field ${field.alias} uses ${field.kind} without a many-valued relationship.`,
    );
  }
  const terminal = field.path.segments.at(-1);
  if (!terminal) throw new Error(`Search field ${field.alias} has no path.`);
  return {
    alias: field.alias,
    kind: field.kind,
    valueType: terminalValueType(field.path),
    nullable: terminalNullable(field.path),
    path: field.path.segments,
    ...(field.boost !== undefined ? { boost: field.boost } : {}),
    authorizationRelevant:
      field.authorizationRelevant
      || authorizationFields.includes(field.alias),
  };
}

function searchSourceFrontier(
  model: string,
  fields: readonly ApplicationSearchFieldPlan[],
  root: CommonApplicationModelFacet<unknown, unknown, unknown, unknown>,
): ApplicationSearchSourceFrontier {
  const segment = fields
    .flatMap((field) => field.path)
    .find((candidate) => candidate.model === model);
  const authority =
    model === root.name
      ? root.provider
      : segment?.integrity === 'reconcile-checked'
        ? 'kubernetes'
        : 'postgres';
  if (authority === 'kubernetes') {
    return {
      model,
      authority: 'kubernetes-watch',
      consistency: 'observedResourceVersion',
    };
  }
  if (authority === 'analytical-database') {
    return {
      model,
      authority: 'analytical-checkpoint',
      consistency: 'checkpoint',
    };
  }
  if (authority === 'transactional-database') {
    return {
      model,
      authority: 'transactional-database-outbox',
      consistency: 'transactionalSnapshot',
    };
  }
  return {
    model,
    authority: 'postgres-change-log',
    consistency: 'transactionalSnapshot',
  };
}

function searchBinding<TDocument extends object>(
  name: string,
  plan: ApplicationSearchIndexPlan,
  operation: ApplicationQueryOperation<
    ApplicationSearchRequest<TDocument>,
    ApplicationSearchResult<TDocument>
  >,
): ApplicationSearchIndexBinding<TDocument> {
  const fields = Object.fromEntries(
    plan.fields.map((field) => [
      field.alias,
      Object.freeze({
        name: field.alias,
        asc: () => ({ field: field.alias, direction: 'asc' as const }),
        desc: () => ({ field: field.alias, direction: 'desc' as const }),
      }),
    ]),
  ) as ApplicationSearchIndexBinding<TDocument>['fields'];
  const binding: ApplicationSearchIndexBinding<TDocument> = {
    kind: 'applicationSearchIndex',
    name,
    plan,
    fields,
    search: operation,
    require(capability) {
      if (plan.requiredCapabilities.includes(capability)) return binding;
      const required = [...plan.requiredCapabilities, capability].sort();
      return searchBinding(
        name,
        {
          ...plan,
          requiredCapabilities: required,
          revision: {
            ...plan.revision,
            digest: digest({
              revision: plan.revision.digest,
              requiredCapabilities: required,
            }),
          },
        },
        operation,
      );
    },
  };
  Object.assign(binding, fields);
  return Object.freeze(binding);
}

function requiredSearchRegistrar(model: object): ApplicationSearchIndexRegistrar {
  const registrar = searchRegistrars.get(model);
  if (!registrar) {
    throw new Error(
      'Application search indexes must be declared on a model registered through app.model(...) or app.crd(...).',
    );
  }
  return registrar;
}

function requiredModelFacet(
  model: object,
): CommonApplicationModelFacet<unknown, unknown, unknown, unknown> {
  const facet = getApplicationModelFacet(model);
  if (!facet) {
    throw new Error(
      'Application search paths and indexes require promoted application models.',
    );
  }
  return facet;
}

function sourcePath<TSource extends ApplicationSearchSource>(
  source: TSource,
): ApplicationSearchPath<SearchSourceValue<TSource>> {
  if (isSearchPath(source)) {
    return source as ApplicationSearchPath<SearchSourceValue<TSource>>;
  }
  const column = registeredColumns.get(source);
  if (!column) {
    throw new Error(
      'Search fields must come from a model registered through app.model(...), or from search.path(...).',
    );
  }
  return Object.freeze({
    [applicationSearchPath]: true,
    segments: [
      {
        model: column.model,
        field: column.field,
        cardinality: 'one',
      },
    ],
  }) as ApplicationSearchPath<SearchSourceValue<TSource>>;
}

function relationshipPath<TValue>(
  root: object | ApplicationSearchPath<unknown>,
  relationship: ApplicationModelRelationshipContract,
  target: ApplicationSearchSource<TValue>,
): ApplicationSearchPath<TValue> {
  const prefix = isSearchPath(root)
    ? root
    : rootIdentityPath(requiredModelFacet(root));
  const rootModel = prefix.segments.at(-1)?.model;
  if (rootModel !== relationship.source) {
    throw new Error(
      `Search relationship ${relationship.source}.${relationship.name} cannot extend path rooted at ${rootModel ?? '<unknown>'}.`,
    );
  }
  if (
    relationship.fields.length === 0
    || relationship.references.length === 0
  ) {
    throw new Error(
      `Search relationship ${relationship.source}.${relationship.name} has no bounded inverse key plan.`,
    );
  }
  const targetPath = sourcePath(target);
  const terminal = targetPath.segments.at(-1);
  if (!terminal || terminal.model !== relationship.target) {
    throw new Error(
      `Search relationship ${relationship.source}.${relationship.name} targets ${relationship.target}, not ${terminal?.model ?? '<unknown>'}.`,
    );
  }
  const segments = [
    ...prefix.segments.slice(0, -1),
    {
      model: relationship.source,
      field: relationship.fields.join(','),
      relationship: relationship.name,
      target: relationship.target,
      cardinality: relationship.cardinality,
      integrity: relationship.integrity,
    },
    ...targetPath.segments,
  ];
  const modelVisits = segments.map((segment) => segment.model);
  if (new Set(modelVisits).size !== modelVisits.length) {
    throw new Error(
      `Search relationship path through ${relationship.name} contains a cycle; declare a bounded projection instead.`,
    );
  }
  return Object.freeze({
    [applicationSearchPath]: true,
    segments,
  }) as ApplicationSearchPath<TValue>;
}

function rootIdentityPath(
  facet: CommonApplicationModelFacet<unknown, unknown, unknown, unknown>,
): ApplicationSearchPath<unknown> {
  return Object.freeze({
    [applicationSearchPath]: true,
    segments: [
      {
        model: facet.name,
        field: facet.identity.fields[0] ?? 'identity',
        cardinality: 'one' as const,
      },
    ],
  }) as ApplicationSearchPath<unknown>;
}

function searchField<TValue>(
  kind: ApplicationSearchFieldKind,
  path: ApplicationSearchPath<TValue>,
  options: {
    readonly boost?: number;
    readonly authorizationRelevant?: boolean;
  } = {},
): ApplicationUnaliasedSearchField<TValue> {
  if (
    options.boost !== undefined
    && (!Number.isFinite(options.boost) || options.boost <= 0)
  ) {
    throw new Error('Search text boost must be a positive finite number.');
  }
  return Object.freeze({
    kind,
    path,
    ...(options.boost !== undefined ? { boost: options.boost } : {}),
    authorizationRelevant: options.authorizationRelevant ?? false,
    as<const TAlias extends string>(alias: TAlias) {
      return Object.freeze({
        kind,
        alias,
        path,
        ...(options.boost !== undefined ? { boost: options.boost } : {}),
        authorizationRelevant: options.authorizationRelevant ?? false,
      });
    },
  });
}

export const search = Object.freeze({
  path<TValue>(
    root: object | ApplicationSearchPath<unknown>,
    relationship: ApplicationModelRelationshipContract,
    target: ApplicationSearchSource<TValue>,
  ): ApplicationSearchPath<TValue> {
    return relationshipPath(root, relationship, target);
  },
  text<TSource extends ApplicationSearchSource>(
    source: TSource & (
      NonNullableSearchSourceValue<TSource> extends string ? unknown : never
    ),
    options: { readonly boost?: number } = {},
  ): ApplicationUnaliasedSearchField<SearchSourceValue<TSource>> {
    return searchField('text', sourcePath(source), options);
  },
  facet<TSource extends ApplicationSearchSource>(
    source: TSource,
  ): ApplicationUnaliasedSearchField<SearchSourceValue<TSource>> {
    return searchField('facet', sourcePath(source));
  },
  filter<TSource extends ApplicationSearchSource>(
    source: TSource & (
      NonNullableSearchSourceValue<TSource> extends SearchScalar
        ? unknown
        : never
    ),
  ): ApplicationUnaliasedSearchField<SearchSourceValue<TSource>> {
    return searchField('filter', sourcePath(source));
  },
  values<TSource extends ApplicationSearchSource>(
    source: TSource,
  ): ApplicationUnaliasedSearchField<
    readonly NonNullable<SearchSourceValue<TSource>>[]
  > {
    return searchField(
      'values',
      sourcePath(source),
    ) as ApplicationUnaliasedSearchField<
      readonly NonNullable<SearchSourceValue<TSource>>[]
    >;
  },
  minimum<TSource extends ApplicationSearchSource>(
    source: TSource & (
      NonNullableSearchSourceValue<TSource> extends number | Date
        ? unknown
        : never
    ),
  ): ApplicationUnaliasedSearchField<SearchSourceValue<TSource>> {
    return searchField('minimum', sourcePath(source));
  },
  maximum<TSource extends ApplicationSearchSource>(
    source: TSource & (
      NonNullableSearchSourceValue<TSource> extends number | Date
        ? unknown
        : never
    ),
  ): ApplicationUnaliasedSearchField<SearchSourceValue<TSource>> {
    return searchField('maximum', sourcePath(source));
  },
  count<TSource extends ApplicationSearchSource>(
    source: TSource,
  ): ApplicationUnaliasedSearchField<number> {
    return searchField(
      'count',
      sourcePath(source),
    ) as ApplicationUnaliasedSearchField<number>;
  },
});

function isSearchPath(value: unknown): value is ApplicationSearchPath {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, applicationSearchPath) === true,
  );
}

function searchValueType(
  column: AnyColumn,
): ApplicationSearchFieldPlan['valueType'] {
  switch (column.dataType) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'json':
    case 'array':
      return 'json';
    default:
      return 'unknown';
  }
}

function terminalValueType(
  path: ApplicationSearchPath,
): ApplicationSearchFieldPlan['valueType'] {
  const terminal = path.segments.at(-1);
  if (!terminal) return 'unknown';
  for (const [column, registered] of registeredColumnEntries()) {
    void column;
    if (
      registered.model === terminal.model
      && registered.field === terminal.field
    ) {
      return registered.valueType;
    }
  }
  return 'unknown';
}

function terminalNullable(path: ApplicationSearchPath): boolean {
  const terminal = path.segments.at(-1);
  if (!terminal) return true;
  for (const [, registered] of registeredColumnEntries()) {
    if (
      registered.model === terminal.model
      && registered.field === terminal.field
    ) {
      return registered.nullable;
    }
  }
  return true;
}

const registeredColumnList: Array<readonly [object, RegisteredSearchColumn]> = [];

function registeredColumnEntries(): readonly (
  readonly [object, RegisteredSearchColumn]
)[] {
  return registeredColumnList;
}

function modelNodeId(model: string): string {
  return `model.${kubernetesNameSegment(model)}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function searchRequestJsonSchema(plan: ApplicationSearchIndexPlan) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      where: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          plan.fields.map((field) => [
            field.alias,
            searchFieldJsonSchema(field),
          ]),
        ),
      },
      facets: {
        type: 'array',
        maxItems: 32,
        items: {
          type: 'string',
          enum: plan.fields
            .filter((field) => field.kind === 'facet')
            .map((field) => field.alias),
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      cursor: { type: 'string' },
    },
  } as const;
}

function searchResultJsonSchema(plan: ApplicationSearchIndexPlan) {
  const document = {
    type: 'object',
    additionalProperties: false,
    required: plan.fields
      .filter((field) => !field.nullable)
      .map((field) => field.alias),
    properties: Object.fromEntries(
      plan.fields.map((field) => [
        field.alias,
        searchFieldJsonSchema(field),
      ]),
    ),
  };
  return {
    type: 'object',
    required: [
      'hits',
      'facets',
      'logicalIndex',
      'indexRevision',
      'physicalGeneration',
      'sourceProjectionRevision',
      'lag',
    ],
    properties: {
      hits: {
        type: 'array',
        items: {
          type: 'object',
          required: ['document'],
          properties: {
            document,
            score: { type: 'number' },
            highlights: { type: 'object' },
          },
        },
      },
      facets: { type: 'object' },
      cursor: { type: 'string' },
      logicalIndex: { type: 'string' },
      indexRevision: { type: 'string' },
      physicalGeneration: { type: 'string' },
      sourceProjectionRevision: { type: 'string' },
      lag: {
        type: 'object',
        required: ['changes', 'milliseconds', 'state'],
        properties: {
          changes: { type: 'integer', minimum: 0 },
          milliseconds: { type: 'number', minimum: 0 },
          state: {
            type: 'string',
            enum: ['current', 'lagging', 'rebuildRequired'],
          },
        },
      },
    },
  } as const;
}

function searchFieldJsonSchema(field: ApplicationSearchFieldPlan) {
  const base =
    field.valueType === 'string' || field.valueType === 'date'
      ? { type: 'string' }
      : field.valueType === 'number'
        ? { type: 'number' }
        : field.valueType === 'boolean'
          ? { type: 'boolean' }
          : {};
  if (field.kind === 'values') {
    return { type: 'array', items: base };
  }
  return field.nullable ? { anyOf: [base, { type: 'null' }] } : base;
}
