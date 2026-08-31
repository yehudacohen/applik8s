// typecast-file-boundary: branded expression proxies preserve model and input
// generics while producing a closed, JSON-serializable selection algebra.
import { createHash } from 'node:crypto';
import {
  type ApplicationPortableQueryPredicate,
  type ApplicationPortableQueryValueExpression,
  canonicalJsonV1String,
  type JsonValue,
} from '@applik8s/core';

export const applicationQuerySelectionProtocol = 'applik8s.query-selection/v1alpha1' as const;

const queryExpression = Symbol('applik8s.queryExpression');
const queryPredicate = Symbol('applik8s.queryPredicate');
const querySelection = Symbol('applik8s.querySelection');
const modelFacet = Symbol.for('@applik8s/model-facet');

export interface ApplicationQueryPredicateExpression {
  readonly [queryPredicate]: ApplicationPortableQueryPredicate;
  and(...operands: readonly ApplicationQueryPredicateExpression[]): ApplicationQueryPredicateExpression;
  or(...operands: readonly ApplicationQueryPredicateExpression[]): ApplicationQueryPredicateExpression;
}

export interface ApplicationQueryOrderExpression {
  readonly expression: ApplicationPortableQueryValueExpression;
  readonly direction: 'asc' | 'desc';
}

export type ApplicationQueryComparable = string | number | boolean | null;

export interface ApplicationQueryFieldExpression<TValue> {
  readonly [queryExpression]: ApplicationPortableQueryValueExpression;
  eq(value: TValue): ApplicationQueryPredicateExpression;
  notEq(value: TValue): ApplicationQueryPredicateExpression;
  lessThan(value: TValue): ApplicationQueryPredicateExpression;
  lessThanOrEqual(value: TValue): ApplicationQueryPredicateExpression;
  greaterThan(value: TValue): ApplicationQueryPredicateExpression;
  greaterThanOrEqual(value: TValue): ApplicationQueryPredicateExpression;
  in(values: readonly TValue[]): ApplicationQueryPredicateExpression;
  asc(): ApplicationQueryOrderExpression;
  desc(): ApplicationQueryOrderExpression;
}

export type ApplicationQueryRow<TValue> = {
  readonly [TKey in keyof TValue]: TValue[TKey] extends ApplicationQueryComparable
    ? ApplicationQueryFieldExpression<TValue[TKey]>
    : TValue[TKey] extends readonly (infer TItem)[]
      ? ApplicationQueryFieldExpression<readonly TItem[]>
      : TValue[TKey] extends object
        ? ApplicationQueryRow<TValue[TKey]>
        : ApplicationQueryFieldExpression<TValue[TKey]>;
};

export interface ApplicationQuerySelectionContract {
  readonly protocol: typeof applicationQuerySelectionProtocol;
  readonly sourceModel: string;
  readonly source: {
    readonly provider: 'postgres';
    readonly database: string;
    readonly table: string;
    readonly schema?: string;
    readonly columns: readonly {
      readonly property: string;
      readonly column: string;
      readonly logicalType?: string;
      readonly nullable: boolean;
    }[];
  };
  readonly predicate?: ApplicationPortableQueryPredicate;
  readonly order: readonly ApplicationQueryOrderExpression[];
  readonly identity: readonly ApplicationPortableQueryValueExpression[];
  readonly relationshipReads: readonly string[];
  readonly sourceAuthority: string;
  readonly digest: string;
}

export interface ApplicationQuerySelection<TItem extends object, TIdentity = unknown> {
  readonly [querySelection]: true;
  readonly contract: ApplicationQuerySelectionContract;
  where(
    predicate: (row: ApplicationQueryRow<TItem>) => ApplicationQueryPredicateExpression,
  ): ApplicationQuerySelection<TItem, TIdentity>;
  orderBy(
    order: (row: ApplicationQueryRow<TItem>) =>
      | ApplicationQueryOrderExpression
      | readonly ApplicationQueryOrderExpression[],
  ): ApplicationQuerySelection<TItem, TIdentity>;
  all(): ApplicationQuerySelection<TItem, TIdentity>;
}

export interface ApplicationQuerySelectionContext {
  select<TItem extends object, TIdentity = unknown>(
    model: ApplicationQuerySelectableModel<TItem, TIdentity>,
  ): ApplicationQuerySelection<TItem, TIdentity>;
}

export interface ApplicationQuerySelectionMaterializationRequest<TInput = unknown> {
  readonly selection: ApplicationQuerySelectionContract;
  readonly input: TInput;
  readonly principal: { readonly id: string };
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly maximumRows: number;
}

export interface ApplicationQuerySelectionRuntime {
  materialize<TItem extends object>(
    request: ApplicationQuerySelectionMaterializationRequest,
  ): Promise<readonly TItem[]>;
}

export type ApplicationQuerySelectionRuntimeResolver = (
  selection: ApplicationQuerySelectionContract,
) => ApplicationQuerySelectionRuntime | undefined;

const selectionRuntimeResolvers: ApplicationQuerySelectionRuntimeResolver[] = [];

/** Installs a provider adapter for one managed execution scope. */
export function installApplicationQuerySelectionRuntimeResolver(
  resolver: ApplicationQuerySelectionRuntimeResolver,
): () => void {
  selectionRuntimeResolvers.push(resolver);
  return () => {
    const index = selectionRuntimeResolvers.lastIndexOf(resolver);
    if (index >= 0) selectionRuntimeResolvers.splice(index, 1);
  };
}

export async function materializeApplicationQuerySelection<TItem extends object>(
  request: ApplicationQuerySelectionMaterializationRequest,
): Promise<readonly TItem[]> {
  for (const resolver of [...selectionRuntimeResolvers].reverse()) {
    const runtime = resolver(request.selection);
    if (runtime) return runtime.materialize<TItem>(request);
  }
  throw new Error(
    `Portable query selection ${request.selection.digest} has no active ${request.selection.source.provider} runtime.`,
  );
}

/**
 * Provider-independent semantic evaluator used by conformance tests and the
 * deterministic local provider. Maintained physical providers must produce
 * the same ordered result for the same selection and input.
 */
export function evaluateApplicationQuerySelection<TItem extends object>(options: {
  readonly selection: ApplicationQuerySelectionContract;
  readonly input: unknown;
  readonly rows: readonly TItem[];
  readonly maximumRows?: number;
}): readonly TItem[] {
  const maximumRows = options.maximumRows ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 0) {
    throw new TypeError('Query selection maximumRows must be a non-negative safe integer.');
  }
  const predicate = options.selection.predicate;
  const selected = predicate
    ? options.rows.filter((row) => evaluatePredicate(predicate, row, options.input))
    : [...options.rows];
  selected.sort((left, right) => compareSelectionRows(options.selection.order, left, right, options.input));
  return Object.freeze(selected.slice(0, maximumRows));
}

/** Deterministic local adapter with the same runtime boundary as PostgreSQL. */
export function createDeterministicApplicationQuerySelectionRuntime(options: {
  readonly rows: (
    selection: ApplicationQuerySelectionContract,
  ) => readonly object[] | Promise<readonly object[]>;
}): ApplicationQuerySelectionRuntime {
  return {
    async materialize<TItem extends object>(request: ApplicationQuerySelectionMaterializationRequest) {
      const rows = await options.rows(request.selection);
      return evaluateApplicationQuerySelection({
        selection: request.selection,
        input: request.input,
        rows: rows as readonly TItem[],
        maximumRows: request.maximumRows,
      });
    },
  };
}

export interface ApplicationQuerySelectableModel<TItem extends object, TIdentity = unknown> {
  /** Drizzle's compile-time selected-row carrier; it is never read at runtime. */
  readonly $inferSelect: TItem;
  readonly $model?: {
    readonly kind: 'applicationModelFacet';
    readonly name: string;
    readonly provider: string;
    readonly database?: string;
    readonly table?: {
      readonly name: string;
      readonly schema?: string;
      readonly columns: readonly {
        readonly property: string;
        readonly column: string;
        readonly logicalType?: string;
        readonly nullable: boolean;
      }[];
    };
    readonly identity: { readonly fields: readonly string[] };
  };
  readonly __queryItem?: TItem;
  readonly __queryIdentity?: TIdentity;
}

/** Pure selection constructor installed on managed query contexts. */
export function createApplicationQuerySelection<TItem extends object, TIdentity = unknown>(
  model: ApplicationQuerySelectableModel<TItem, TIdentity>,
): ApplicationQuerySelection<TItem, TIdentity> {
  const facet = applicationSelectionModelFacet(model);
  if (facet.provider !== 'postgres' || !facet.database || !facet.table?.name) {
    throw new Error(
      `Query batching currently requires a promoted PostgreSQL model; ${facet.name} is backed by ${facet.provider}.`,
    );
  }
  const state: MutableSelection = {
    sourceModel: facet.name,
    source: {
      provider: 'postgres',
      database: facet.database,
      table: facet.table.name,
      ...(facet.table.schema ? { schema: facet.table.schema } : {}),
      columns: facet.table.columns,
    },
    order: [],
    identity: facet.identity.fields.map((field) => fieldExpression([field])),
    relationshipReads: [],
  };
  return selectionBinding<TItem, TIdentity>(state);
}

export function isApplicationQuerySelection(
  value: unknown,
): value is ApplicationQuerySelection<object, unknown> {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, querySelection) === true);
}

/**
 * Captures the portable selection from a synchronous function-native query.
 * The callback executes only when its source explicitly uses context.select;
 * every other context capability fails closed during this pure capture pass.
 */
export function captureApplicationQuerySelection(
  implementation: (input: unknown, context: unknown) => unknown,
  source: string,
): ApplicationQuerySelectionContract | undefined {
  if (!/\b(?:context|ctx)\s*\.\s*select\s*\(/u.test(source)) return undefined;
  const context = new Proxy(
    { select: createApplicationQuerySelection },
    {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        throw new Error(
          `Batchable query selection capture cannot read context.${String(property)}. Selection construction must remain synchronous and pure.`,
        );
      },
    },
  );
  const result = implementation(inputProxy([]), context);
  if (result instanceof Promise) {
    void result.catch(() => undefined);
    throw new Error(
      'A Query.onBatch selection implementation must return context.select(...) synchronously. Provider execution remains asynchronous after the selection is compiled.',
    );
  }
  if (!isApplicationQuerySelection(result)) {
    throw new Error(
      'A query implementation using context.select(...) must return the resulting selection so one-time invocation and Query.onBatch share one meaning.',
    );
  }
  return result.contract;
}

function selectionBinding<TItem extends object, TIdentity>(
  state: MutableSelection,
): ApplicationQuerySelection<TItem, TIdentity> {
  const row = rowProxy<TItem>([]);
  const binding: ApplicationQuerySelection<TItem, TIdentity> = {
    [querySelection]: true,
    get contract() {
      return finalizedSelection(state);
    },
    where(callback) {
      const predicate = callback(row);
      if (!predicate || typeof predicate !== 'object' || !Reflect.has(predicate, queryPredicate)) {
        throw new Error('Query selection where(...) must return a typed query predicate.');
      }
      state.predicate = state.predicate
        ? logicalPredicate('and', [state.predicate, predicate[queryPredicate]])[queryPredicate]
        : predicate[queryPredicate];
      return binding;
    },
    orderBy(callback) {
      const value = callback(row);
      const order = Array.isArray(value) ? value : [value];
      if (order.length === 0 || order.some((item) => !isOrderExpression(item))) {
        throw new Error('Query selection orderBy(...) must return at least one typed asc()/desc() expression.');
      }
      state.order = [...order];
      return binding;
    },
    all() {
      return binding;
    },
  };
  return Object.freeze(binding);
}

interface MutableSelection {
  readonly sourceModel: string;
  readonly source: ApplicationQuerySelectionContract['source'];
  predicate?: ApplicationPortableQueryPredicate;
  order: readonly ApplicationQueryOrderExpression[];
  readonly identity: readonly ApplicationPortableQueryValueExpression[];
  readonly relationshipReads: readonly string[];
}

function finalizedSelection(state: MutableSelection): ApplicationQuerySelectionContract {
  if (state.order.length === 0) {
    throw new Error(
      `Batchable query selection for ${state.sourceModel} must declare a deterministic orderBy(...).`,
    );
  }
  const orderedPaths = new Set(
    state.order.map(({ expression }) => expression.kind === 'field' ? expression.path.join('.') : ''),
  );
  const order = [...state.order];
  for (const identity of state.identity) {
    if (identity.kind === 'field' && !orderedPaths.has(identity.path.join('.'))) {
      order.push({ expression: identity, direction: 'asc' });
    }
  }
  const semantic = {
    protocol: applicationQuerySelectionProtocol,
    sourceModel: state.sourceModel,
    source: state.source,
    ...(state.predicate ? { predicate: state.predicate } : {}),
    order,
    identity: state.identity,
    relationshipReads: state.relationshipReads,
    sourceAuthority: `postgres:${state.source.database}:${state.source.schema ?? 'public'}.${state.source.table}`,
  } as const;
  return Object.freeze({
    ...semantic,
    digest: createHash('sha256').update(canonicalJsonV1String(semantic)).digest('hex'),
  });
}

function rowProxy<TValue extends object>(path: readonly string[]): ApplicationQueryRow<TValue> {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      return fieldProxy([...path, property]);
    },
  }) as ApplicationQueryRow<TValue>;
}

function fieldProxy(path: readonly string[]): unknown {
  const expression = fieldExpression(path);
  const field = {
    [queryExpression]: expression,
    eq: (value: unknown) => comparisonPredicate('eq', expression, valueExpression(value)),
    notEq: (value: unknown) => comparisonPredicate('notEq', expression, valueExpression(value)),
    lessThan: (value: unknown) => comparisonPredicate('lessThan', expression, valueExpression(value)),
    lessThanOrEqual: (value: unknown) => comparisonPredicate('lessThanOrEqual', expression, valueExpression(value)),
    greaterThan: (value: unknown) => comparisonPredicate('greaterThan', expression, valueExpression(value)),
    greaterThanOrEqual: (value: unknown) => comparisonPredicate('greaterThanOrEqual', expression, valueExpression(value)),
    in: (values: unknown) => membershipPredicate(expression, valueExpression(values)),
    asc: () => ({ expression, direction: 'asc' as const }),
    desc: () => ({ expression, direction: 'desc' as const }),
  };
  return new Proxy(field, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property !== 'string') return undefined;
      return fieldProxy([...path, property]);
    },
  });
}

function inputProxy(path: readonly string[]): unknown {
  return new Proxy({
    [queryExpression]: { kind: 'input', path } satisfies ApplicationPortableQueryValueExpression,
  }, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property !== 'string') return undefined;
      return inputProxy([...path, property]);
    },
  });
}

function comparisonPredicate(
  operation: Extract<ApplicationPortableQueryPredicate, { readonly kind: 'comparison' }>['operation'],
  left: ApplicationPortableQueryValueExpression,
  right: ApplicationPortableQueryValueExpression,
): ApplicationQueryPredicateExpression {
  return predicateBinding({ kind: 'comparison', operation, left, right });
}

function membershipPredicate(
  value: ApplicationPortableQueryValueExpression,
  candidates: ApplicationPortableQueryValueExpression,
): ApplicationQueryPredicateExpression {
  return predicateBinding({ kind: 'membership', operation: 'in', value, candidates });
}

function logicalPredicate(
  operation: 'and' | 'or',
  operands: readonly ApplicationPortableQueryPredicate[],
): ApplicationQueryPredicateExpression {
  if (operands.length < 2) throw new Error(`Query predicate ${operation}(...) requires at least two operands.`);
  return predicateBinding({ kind: 'logical', operation, operands });
}

function predicateBinding(
  predicate: ApplicationPortableQueryPredicate,
): ApplicationQueryPredicateExpression {
  const binding: ApplicationQueryPredicateExpression = {
    [queryPredicate]: predicate,
    and: (...operands) => logicalPredicate('and', [
      predicate,
      ...operands.map((operand) => operand[queryPredicate]),
    ]),
    or: (...operands) => logicalPredicate('or', [
      predicate,
      ...operands.map((operand) => operand[queryPredicate]),
    ]),
  };
  return Object.freeze(binding);
}

function valueExpression(value: unknown): ApplicationPortableQueryValueExpression {
  if (value && typeof value === 'object' && Reflect.has(value, queryExpression)) {
    return Reflect.get(value, queryExpression) as ApplicationPortableQueryValueExpression;
  }
  const encoded = canonicalJsonV1String(value);
  if (encoded === undefined) throw new Error('Query selection values must be canonical JSON values.');
  return { kind: 'literal', value: JSON.parse(encoded) as JsonValue };
}

function fieldExpression(path: readonly string[]): ApplicationPortableQueryValueExpression {
  return { kind: 'field', path };
}

function isOrderExpression(value: unknown): value is ApplicationQueryOrderExpression {
  return Boolean(
    value
      && typeof value === 'object'
      && (Reflect.get(value, 'direction') === 'asc' || Reflect.get(value, 'direction') === 'desc')
      && Reflect.get(value, 'expression'),
  );
}

function applicationSelectionModelFacet(model: object): {
  readonly kind: 'applicationModelFacet';
  readonly name: string;
  readonly provider: string;
  readonly database?: string;
  readonly table?: {
    readonly name: string;
    readonly schema?: string;
    readonly columns: readonly {
      readonly property: string;
      readonly column: string;
      readonly logicalType?: string;
      readonly nullable: boolean;
    }[];
  };
  readonly identity: { readonly fields: readonly string[] };
} {
  const candidate = Reflect.get(model, '$model') ?? Reflect.get(model, modelFacet);
  if (!candidate || typeof candidate !== 'object' || Reflect.get(candidate, 'kind') !== 'applicationModelFacet') {
    throw new Error('context.select(...) requires a promoted Applik8s model.');
  }
  const identity = Reflect.get(candidate, 'identity');
  if (!identity || typeof identity !== 'object' || !Array.isArray(Reflect.get(identity, 'fields'))) {
    throw new Error('context.select(...) requires a model with a stable identity.');
  }
  return candidate as ReturnType<typeof applicationSelectionModelFacet>;
}

function evaluatePredicate(
  predicate: ApplicationPortableQueryPredicate,
  row: object,
  input: unknown,
): boolean {
  if (predicate.kind === 'logical') {
    return predicate.operation === 'and'
      ? predicate.operands.every((operand) => evaluatePredicate(operand, row, input))
      : predicate.operands.some((operand) => evaluatePredicate(operand, row, input));
  }
  if (predicate.kind === 'membership') {
    const candidate = evaluateValue(predicate.value, row, input);
    const values = evaluateValue(predicate.candidates, row, input);
    return Array.isArray(values) && values.some((value) => compareValues(value, candidate) === 0);
  }
  const left = evaluateValue(predicate.left, row, input);
  const right = evaluateValue(predicate.right, row, input);
  const comparison = compareValues(left, right);
  switch (predicate.operation) {
    case 'eq': return comparison === 0;
    case 'notEq': return comparison !== 0;
    case 'lessThan': return comparison < 0;
    case 'lessThanOrEqual': return comparison <= 0;
    case 'greaterThan': return comparison > 0;
    case 'greaterThanOrEqual': return comparison >= 0;
  }
}

function compareSelectionRows(
  order: readonly ApplicationQueryOrderExpression[],
  left: object,
  right: object,
  input: unknown,
): number {
  for (const item of order) {
    const comparison = compareValues(
      evaluateValue(item.expression, left, input),
      evaluateValue(item.expression, right, input),
    );
    if (comparison !== 0) return item.direction === 'asc' ? comparison : -comparison;
  }
  return 0;
}

function evaluateValue(
  expression: ApplicationPortableQueryValueExpression,
  row: object,
  input: unknown,
): unknown {
  if (expression.kind === 'literal') return expression.value;
  return valueAtPath(expression.kind === 'field' ? row : input, expression.path);
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const property of path) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) return undefined;
    current = Reflect.get(current, property);
  }
  return current;
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : 1;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  const leftCanonical = canonicalJsonV1String(left);
  const rightCanonical = canonicalJsonV1String(right);
  if (leftCanonical === rightCanonical) return 0;
  return leftCanonical < rightCanonical ? -1 : 1;
}
