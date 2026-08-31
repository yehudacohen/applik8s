// typecast-file-boundary: SQL selection rows and cursor components are validated against the compiled selection contract before generic result hydration.
import type {
  ApplicationQuerySelectionContract,
  ApplicationQuerySelectionMaterializationRequest,
  ApplicationQuerySelectionRuntime,
} from '@applik8s/applik8s/query-runtime';
import type {
  ApplicationPortableQueryPredicate,
  ApplicationPortableQueryValueExpression,
} from '@applik8s/core';
import { type SQL, sql } from 'drizzle-orm';

export interface ApplicationPostgresQuerySelectionDatabase {
  execute(statement: SQL): Promise<unknown>;
}

/** Executes the normalized selection IR through a policy-scoped Drizzle connection. */
export async function materializePostgresApplicationQuerySelection<TItem extends object>(options: {
  readonly selection: ApplicationQuerySelectionContract;
  readonly input: unknown;
  readonly database: ApplicationPostgresQuerySelectionDatabase;
  readonly maximumRows: number;
}): Promise<readonly TItem[]> {
  if (!Number.isSafeInteger(options.maximumRows) || options.maximumRows < 1) {
    throw new TypeError('PostgreSQL query selection maximumRows must be a positive safe integer.');
  }
  const columns = new Map(options.selection.source.columns.map((column) => [column.property, column]));
  if (columns.size !== options.selection.source.columns.length || columns.size === 0) {
    throw new Error(`PostgreSQL query selection ${options.selection.digest} has invalid physical column metadata.`);
  }
  const projected = options.selection.source.columns.map((column) =>
    sql`${sql.identifier(column.column)} AS ${sql.identifier(column.property)}`);
  const table = options.selection.source.schema
    ? sql`${sql.identifier(options.selection.source.schema)}.${sql.identifier(options.selection.source.table)}`
    : sql`${sql.identifier(options.selection.source.table)}`;
  const predicate = options.selection.predicate
    ? sql` WHERE ${postgresPredicate(options.selection.predicate, columns, options.input)}`
    : sql``;
  const order = sql.join(options.selection.order.map((item) => {
    if (item.expression.kind !== 'field') {
      throw new Error(`PostgreSQL query selection ${options.selection.digest} ordering must reference model fields.`);
    }
    return sql`${postgresField(item.expression, columns)} ${sql.raw(
      item.direction === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST',
    )}`;
  }), sql`, `);
  const result = await options.database.execute(sql`
    SELECT ${sql.join(projected, sql`, `)}
    FROM ${table}${predicate}
    ORDER BY ${order}
    LIMIT ${options.maximumRows}
  `);
  return Object.freeze(postgresRows(result).map((row) => Object.freeze(Object.fromEntries(
    options.selection.source.columns.map((column) => [
      column.property,
      normalizePostgresSelectionValue(Reflect.get(row, column.property), column.logicalType),
    ]),
  )) as TItem));
}

/** Runtime adapter for callers that already own a scoped database executor. */
export function createPostgresApplicationQuerySelectionRuntime(options: {
  readonly database: () => ApplicationPostgresQuerySelectionDatabase;
}): ApplicationQuerySelectionRuntime {
  return {
    materialize<TItem extends object>(request: ApplicationQuerySelectionMaterializationRequest) {
      return materializePostgresApplicationQuerySelection<TItem>({
        selection: request.selection,
        input: request.input,
        database: options.database(),
        maximumRows: request.maximumRows,
      });
    },
  };
}

function postgresPredicate(
  predicate: ApplicationPortableQueryPredicate,
  columns: ReadonlyMap<string, ApplicationQuerySelectionContract['source']['columns'][number]>,
  input: unknown,
): SQL {
  if (predicate.kind === 'logical') {
    const operator = predicate.operation === 'and' ? sql` AND ` : sql` OR `;
    return sql`(${sql.join(predicate.operands.map((operand) => postgresPredicate(operand, columns, input)), operator)})`;
  }
  if (predicate.kind === 'membership') {
    if (predicate.candidates.kind === 'field') {
      throw new Error('PostgreSQL query selection in(...) candidates cannot be sourced from another model field.');
    }
    const values = querySelectionValue(predicate.candidates, input);
    if (!Array.isArray(values)) throw new Error('PostgreSQL query selection in(...) candidates must resolve to an array.');
    if (values.length === 0) return sql`FALSE`;
    const subject = postgresValue(predicate.value, columns, input);
    const includesNull = values.includes(null);
    const nonNull = values.filter((value) => value !== null);
    if (nonNull.length === 0) return sql`${subject} IS NULL`;
    const membership = sql`${subject} IN (${sql.join(nonNull.map((value) => sql`${value}`), sql`, `)})`;
    return includesNull ? sql`(${membership} OR ${subject} IS NULL)` : membership;
  }
  const left = querySelectionValueIfConcrete(predicate.left, input);
  const right = querySelectionValueIfConcrete(predicate.right, input);
  if ((predicate.operation === 'eq' || predicate.operation === 'notEq') && (left === null || right === null)) {
    const value = left === null
      ? postgresValue(predicate.right, columns, input)
      : postgresValue(predicate.left, columns, input);
    return predicate.operation === 'eq' ? sql`${value} IS NULL` : sql`${value} IS NOT NULL`;
  }
  const operator = {
    eq: '=',
    notEq: '<>',
    lessThan: '<',
    lessThanOrEqual: '<=',
    greaterThan: '>',
    greaterThanOrEqual: '>=',
  }[predicate.operation];
  return sql`${postgresValue(predicate.left, columns, input)} ${sql.raw(operator)} ${postgresValue(predicate.right, columns, input)}`;
}

function postgresValue(
  expression: ApplicationPortableQueryValueExpression,
  columns: ReadonlyMap<string, ApplicationQuerySelectionContract['source']['columns'][number]>,
  input: unknown,
): SQL {
  if (expression.kind === 'field') return postgresField(expression, columns);
  return sql`${querySelectionValue(expression, input)}`;
}

function postgresField(
  expression: Extract<ApplicationPortableQueryValueExpression, { readonly kind: 'field' }>,
  columns: ReadonlyMap<string, ApplicationQuerySelectionContract['source']['columns'][number]>,
): SQL {
  if (expression.path.length !== 1) {
    throw new Error(`PostgreSQL query selection field path ${expression.path.join('.')} is not a direct model field.`);
  }
  const property = expression.path[0];
  if (!property) throw new Error('PostgreSQL query selection field path is empty.');
  const column = columns.get(property);
  if (!column) throw new Error(`PostgreSQL query selection references unknown field ${property}.`);
  return sql`${sql.identifier(column.column)}`;
}

function querySelectionValueIfConcrete(
  expression: ApplicationPortableQueryValueExpression,
  input: unknown,
): unknown {
  return expression.kind === 'field' ? undefined : querySelectionValue(expression, input);
}

function querySelectionValue(
  expression: Exclude<ApplicationPortableQueryValueExpression, { readonly kind: 'field' }>,
  input: unknown,
): unknown {
  if (expression.kind === 'literal') return expression.value;
  let value = input;
  for (const property of expression.path) {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
      throw new Error(`PostgreSQL query selection input path ${expression.path.join('.')} is missing.`);
    }
    value = Reflect.get(value, property);
  }
  if (value === undefined) throw new Error(`PostgreSQL query selection input path ${expression.path.join('.')} is undefined.`);
  return value;
}

function postgresRows(result: unknown): readonly object[] {
  const rows = Array.isArray(result) ? result : Reflect.get(result as object, 'rows');
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object')) {
    throw new Error('PostgreSQL query selection returned a non-row result.');
  }
  return rows as readonly object[];
}

function normalizePostgresSelectionValue(value: unknown, logicalType?: string): unknown {
  if (logicalType === 'number' && typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`PostgreSQL returned non-finite numeric value ${value}.`);
    return numeric;
  }
  if (logicalType === 'json' && typeof value === 'string') return JSON.parse(value) as unknown;
  return value;
}
