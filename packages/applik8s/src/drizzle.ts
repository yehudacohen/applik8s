// typecast-file-boundary: Drizzle's generic table metadata is promoted into an equivalent model type after runtime table validation.
// biome-ignore lint/suspicious/noRedundantUseStrict: Explicit ESM strictness prevents esbuild from alternating equivalent bundle output and artifact identities.
'use strict';

import {
  type BuildColumns,
  type BuildExtraConfigColumns,
  relations,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfig,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  bigint,
  bigserial,
  boolean,
  char,
  date,
  doublePrecision,
  index,
  integer,
  json,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ApplicationSignalBinding,
  ApplicationSignalDefinition,
  ApplicationSignalReference,
} from './application-signals.js';
import type { ApplicationRelationalModel } from './native-models.js';

export interface ApplicationSignalFieldOptions {
  readonly visibility: 'same-as-issuance';
  /** Maximum period for which the persisted reference may remain callable. */
  readonly maxAge: string;
}

export interface ApplicationSignalFieldDeclaration {
  readonly contract: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly visibility: 'same-as-issuance';
  readonly maxAge: string;
}

/**
 * Authoritative relational model declaration.
 *
 * The returned value is a native Drizzle table by identity, so relations,
 * migrations, and advanced queries retain their complete Drizzle inference.
 * Applik8s application binding adds distributed model facets without asking
 * authors to define or map the fields again.
 */
export interface ApplicationRelationalModelOptions<
  TColumnsMap extends Record<string, PgColumnBuilderBase>,
> {
  /** Public model name when the database schema key is an implementation detail. */
  readonly name?: string;
  /** Canonical scalar identity fields when they cannot be inferred from the primary key. */
  readonly identity?: readonly (keyof TColumnsMap & string)[];
  /**
   * Optimistic-concurrency revision field. Use `false` when a domain field
   * named `revision` is not the framework concurrency token.
   */
  readonly revision?: (keyof TColumnsMap & string) | false;
  /** Stable framework/module roles consumed through explicit graph dependencies. */
  readonly runtimeRoles?: readonly string[];
}

type DeclaredApplicationRelationalModel<
  TTableName extends string,
  TColumnsMap extends Record<string, PgColumnBuilderBase>,
> = ApplicationRelationalModel<
  PgTableWithColumns<{
    name: TTableName;
    schema: undefined;
    columns: BuildColumns<TTableName, TColumnsMap, 'pg'>;
    dialect: 'pg';
  }>
>;

export interface ApplicationRelationalModelFactory {
  <
    TTableName extends string,
    TColumnsMap extends Record<string, PgColumnBuilderBase>,
  >(
    name: TTableName,
    columns: TColumnsMap,
    options?: ApplicationRelationalModelOptions<TColumnsMap>,
  ): DeclaredApplicationRelationalModel<TTableName, TColumnsMap>;
  <
    TTableName extends string,
    TColumnsMap extends Record<string, PgColumnBuilderBase>,
  >(
    name: TTableName,
    columns: TColumnsMap,
    extraConfig: (
      self: BuildExtraConfigColumns<TTableName, TColumnsMap, 'pg'>,
    ) => PgTableExtraConfigValue[] | PgTableExtraConfig,
    options?: ApplicationRelationalModelOptions<TColumnsMap>,
  ): DeclaredApplicationRelationalModel<TTableName, TColumnsMap>;
}

/**
 * Declares one authoritative relational model.
 *
 * The value is an ordinary Drizzle table by runtime identity. Its Applik8s
 * facet is installed automatically when the table appears in a typed
 * `app.database.postgres(..., { schema })` or `app.database.bind(...)`
 * declaration, so ordinary applications do not repeat `app.model(table)`.
 */
const applicationRelationalModelDeclaration = Symbol.for(
  'applik8s.relationalModelDeclaration',
);
const applicationRelationalModelDeclarationOptions = Symbol.for(
  'applik8s.relationalModelDeclarationOptions',
);
const applicationSignalFieldDeclaration = Symbol.for(
  'applik8s.signalFieldDeclaration',
);

const applicationRelationalModel = ((
  name: string,
  columns: Record<string, PgColumnBuilderBase>,
  extraConfigOrOptions?:
    | ((self: Record<string, unknown>) => PgTableExtraConfigValue[] | PgTableExtraConfig)
    | ApplicationRelationalModelOptions<Record<string, PgColumnBuilderBase>>,
  declarationOptions?: ApplicationRelationalModelOptions<
    Record<string, PgColumnBuilderBase>
  >,
) => {
  const extraConfig = typeof extraConfigOrOptions === 'function'
    ? extraConfigOrOptions
    : undefined;
  const signalFields = Object.fromEntries(
    Object.entries(columns).flatMap(([fieldName, builder]) => {
      const declaration = Reflect.get(
        builder,
        applicationSignalFieldDeclaration,
      );
      return declaration && typeof declaration === 'object'
        ? [[fieldName, declaration]]
        : [];
    }),
  ) as Readonly<Record<string, ApplicationSignalFieldDeclaration>>;
  const options = Object.freeze({
    ...(typeof extraConfigOrOptions === 'function'
      ? declarationOptions
      : extraConfigOrOptions),
    ...(Object.keys(signalFields).length > 0 ? { signalFields } : {}),
  });
  const table = Reflect.apply(
    pgTable,
    undefined,
    extraConfig
      ? [name, columns, extraConfig]
      : [name, columns],
  ) as object;
  Object.defineProperty(table, applicationRelationalModelDeclaration, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(table, applicationRelationalModelDeclarationOptions, {
    value: options,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return table;
}) as ApplicationRelationalModelFactory;

export const model = applicationRelationalModel;

/** Internal assembly predicate; provider-native pgTable() remains an explicit advanced lane. */
export function isApplicationRelationalModel(value: unknown): value is object {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, applicationRelationalModelDeclaration) === true,
  );
}

/** Internal assembly metadata captured by the single model declaration. */
export function applicationRelationalModelOptionsFor(
  value: unknown,
): Readonly<{
  readonly name?: string;
  readonly identity?: readonly string[];
  readonly revision?: string | false;
  readonly runtimeRoles?: readonly string[];
  readonly signalFields?: Readonly<
    Record<string, ApplicationSignalFieldDeclaration>
  >;
}> {
  if (!isApplicationRelationalModel(value)) return Object.freeze({});
  const options = Reflect.get(
    value,
    applicationRelationalModelDeclarationOptions,
  );
  return options && typeof options === 'object'
    ? options as Readonly<{
        readonly name?: string;
        readonly identity?: readonly string[];
        readonly revision?: string | false;
        readonly runtimeRoles?: readonly string[];
        readonly signalFields?: Readonly<
          Record<string, ApplicationSignalFieldDeclaration>
        >;
      }>
    : Object.freeze({});
}

/**
 * Logical field constructors for `model()`.
 *
 * These are the supported Drizzle builders under an Applik8s-owned authoring
 * namespace. Provider-specific escape hatches may still import Drizzle
 * directly, but maintained applications should not need `pgTable()`.
 */
export const field = Object.freeze({
  bigint,
  bigserial,
  boolean,
  char,
  date,
  doublePrecision,
  integer,
  json,
  jsonb,
  numeric,
  real,
  serial,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  varchar,
  signal<
    TDefinition extends ApplicationSignalDefinition,
    TName extends string,
  >(
    definitionOrBinding:
      | TDefinition
      | ApplicationSignalBinding<TDefinition>,
    options: ApplicationSignalFieldOptions,
    name?: TName,
  ) {
    const definition =
      'signalKind' in definitionOrBinding
        ? definitionOrBinding.signal
        : definitionOrBinding;
    if (options.visibility !== 'same-as-issuance') {
      throw new Error(
        'field.signal(...) visibility must be "same-as-issuance".',
      );
    }
    if (!/^[1-9]\d*(?:ms|s|m|h|d)$/.test(options.maxAge)) {
      throw new Error(
        'field.signal(...) maxAge must be a positive duration such as "24h".',
      );
    }
    const builder = name === undefined
      ? jsonb().$type<ApplicationSignalReference<TDefinition>>()
      : jsonb(name).$type<ApplicationSignalReference<TDefinition>>();
    Object.defineProperty(builder, applicationSignalFieldDeclaration, {
      value: Object.freeze({
        contract: Object.freeze({
          id: definition.id,
          name: definition.name,
          version: definition.version,
        }),
        visibility: options.visibility,
        maxAge: options.maxAge,
      } satisfies ApplicationSignalFieldDeclaration),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return builder;
  },
});

export { index, pgEnum, primaryKey, relations, unique, uniqueIndex };

const authenticatedPrincipalDefault = Symbol.for('@applik8s/drizzle-authenticated-principal-default');
const causalPrincipalDefault = Symbol.for(
  '@applik8s/drizzle-causal-principal-default',
);

export type ApplicationAuthenticatedPrincipalDefault = SQL<string> & {
  readonly [authenticatedPrincipalDefault]: true;
};

/**
 * PostgreSQL default established from the gateway-admitted durable principal.
 *
 * When this default is also the scalar model identity, Applik8s derives the
 * command partition key from that principal and initializes the row with the
 * same value. The browser therefore omits actor identity without sacrificing
 * deterministic routing, idempotency, or relational primary-key fidelity.
 */
export const authenticatedPrincipalId = sql<string>`nullif(current_setting('applik8s.principal.id', true), '')` as ApplicationAuthenticatedPrincipalDefault;
Object.defineProperty(authenticatedPrincipalId, authenticatedPrincipalDefault, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false,
});

export function isApplicationAuthenticatedPrincipalDefault(value: unknown): value is ApplicationAuthenticatedPrincipalDefault {
  if (!value || typeof value !== 'object') return false;
  if (Reflect.get(value, authenticatedPrincipalDefault) === true) return true;
  // Vite/Drizzle can recreate SQL wrappers while evaluating an application
  // entrypoint. Recognize only the exact fail-closed SQL emitted above; nearby
  // current_setting expressions must not silently gain identity semantics.
  const chunks = Reflect.get(value, 'queryChunks');
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const text = Reflect.get(chunk, 'value');
    return Array.isArray(text)
      && text.join('') === "nullif(current_setting('applik8s.principal.id', true), '')";
  });
}

export type ApplicationCausalPrincipalDefault = SQL<string> & {
  readonly [causalPrincipalDefault]: true;
};

/**
 * PostgreSQL default attributed to the trusted request principal that caused
 * the current operation.
 *
 * Direct human requests resolve to the authenticated principal. Agent,
 * workflow, and event executions retain their own actor for authorization and
 * audit while this default resolves to the framework-admitted causal
 * principal. Application input can never supply or override that attribution.
 */
export const causalPrincipalId = sql<string>`coalesce(nullif(current_setting('applik8s.principal.causal_id', true), ''), nullif(current_setting('applik8s.principal.id', true), ''))` as ApplicationCausalPrincipalDefault;
Object.defineProperty(causalPrincipalId, causalPrincipalDefault, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false,
});

export function isApplicationCausalPrincipalDefault(
  value: unknown,
): value is ApplicationCausalPrincipalDefault {
  if (!value || typeof value !== 'object') return false;
  if (Reflect.get(value, causalPrincipalDefault) === true) return true;
  const chunks = Reflect.get(value, 'queryChunks');
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const text = Reflect.get(chunk, 'value');
    return Array.isArray(text)
      && text.join('') === "coalesce(nullif(current_setting('applik8s.principal.causal_id', true), ''), nullif(current_setting('applik8s.principal.id', true), ''))";
  });
}

/**
 * Internal identity-default predicate for Drizzle's UUID `defaultRandom()`.
 *
 * Native model commands need a durable routing identity before PostgreSQL
 * performs the insert. Recognizing this exact Drizzle default lets the command
 * envelope supply that identity without exposing ID generation to application
 * or browser code.
 */
export function isApplicationRandomUuidDefault(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const chunks = Reflect.get(value, 'queryChunks');
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const text = Reflect.get(chunk, 'value');
    return Array.isArray(text) && text.join('') === 'gen_random_uuid()';
  });
}
