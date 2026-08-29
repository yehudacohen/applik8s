import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from './application-builder.js';
import type { ApplicationProcessorOptions } from './application-processor-policy.js';
import { isApplicationRelationalModel } from './drizzle.js';

const applicationModuleDefinition = Symbol.for(
  'applik8s.applicationModuleDefinition',
);

export interface ApplicationModuleContext<
  _TSpec extends object = Record<string, never>,
  _TStatus extends object = { readonly ready: boolean },
> {
  /** Application-selected native database, resolved after profile wiring. */
  readonly database: ApplicationDatabaseBinding;
  /** Profile-owned processor placement inherited by maintained models. */
  readonly processor: ApplicationProcessorOptions | undefined;
  /** Includes another module through the same idempotent application graph. */
  include<TResult>(module: ApplicationModuleReference<TResult>): TResult;
}

export interface ApplicationModuleMetadata<
  TResult,
  TSpec extends object = Record<string, never>,
  TStatus extends object = { readonly ready: boolean },
> {
  /** Type-only result association used by the erased inclusion boundary. */
  readonly resultType?: TResult;
  /** Stable graph identity. */
  readonly name: string;
  /**
   * Native Drizzle schema contributed by the module. Tables and relations keep
   * their original identity when merged into the selected application database.
   */
  readonly schema?: Readonly<Record<string, unknown>>;
  /**
   * Infers top-level model and relation exports after setup. Explicit schema
   * remains the pre-setup escape hatch for callbacks that use model facets
   * while they are being installed.
   */
  readonly inferReturnedSchema?: boolean;
  install(
    application: KubernetesApplicationBuilder<TSpec, TStatus>,
    context: ApplicationModuleContext<TSpec, TStatus>,
  ): TResult;
}

export interface ApplicationModuleOptions<
  TSchema extends Readonly<Record<string, unknown>> =
    Readonly<Record<string, unknown>>,
> {
  /**
   * Schema members that must be bound before setup runs. Most application
   * modules can omit this when their models already belong to the application
   * database or are simply returned from setup.
   */
  readonly schema?: TSchema;
}

export type ApplicationModuleSetup<
  TResult extends Readonly<Record<string, unknown>>,
  TSpec extends object = object,
  TStatus extends object = object,
> = (
  application: KubernetesApplicationBuilder<TSpec, TStatus>,
) => TResult;

/**
 * Maintained modules remain directly callable for focused tests and advanced
 * assembly, while app.include() consumes their invisible graph metadata.
 */
export type ApplicationModuleDefinition<
  TResult,
  TSpec extends object = Record<string, never>,
  TStatus extends object = { readonly ready: boolean },
  TCallable extends CallableFunction = CallableFunction,
> = TCallable & {
  readonly [applicationModuleDefinition]: ApplicationModuleMetadata<
    TResult,
    TSpec,
    TStatus
  >;
  /** Compiler-owned structural marker; application code must not construct it. */
  readonly __applik8sApplicationModule: {
    readonly name: string;
    readonly resultType?: TResult;
  };
};

/**
 * Erased inclusion boundary for a branded module. Root installation spec and
 * status types are intentionally absent: a reusable module contributes to the
 * application scope and must not become invariant in an unrelated root CRD.
 */
export type ApplicationModuleReference<
  TResult = unknown,
> = CallableFunction & {
  readonly __applik8sApplicationModule: {
    readonly name: string;
    readonly resultType?: TResult;
  };
};

/**
 * Adds application-owned discovery metadata without changing callable identity.
 *
 * @deprecated Use callback-native `module(name, options?, setup)` for public
 * application modules. This lower-level adapter remains for the compatibility
 * window and framework internals that need the installation context.
 */
export function defineApplicationModule<
  TResult,
  TSpec extends object,
  TStatus extends object,
  TCallable extends CallableFunction,
>(
  callable: TCallable,
  metadata: ApplicationModuleMetadata<TResult, TSpec, TStatus>,
): ApplicationModuleDefinition<TResult, TSpec, TStatus, TCallable> {
  Object.defineProperty(callable, applicationModuleDefinition, {
    value: Object.freeze(metadata),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(callable, '__applik8sApplicationModule', {
    value: Object.freeze({ name: metadata.name }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  // defineProperty attaches the closed metadata symbol to this exact callable.
  // typecast: preserve its original call signature as the public module API.
  return callable as ApplicationModuleDefinition<
    TResult,
    TSpec,
    TStatus,
    TCallable
  >;
}

/**
 * Declares one reusable application module as ordinary callback-native
 * TypeScript. The returned object is the public module boundary; Applik8s
 * validates and freezes it when the module is included.
 */
export function module<
  const TResult extends Readonly<Record<string, unknown>>,
  TSpec extends object = object,
  TStatus extends object = object,
>(
  name: string,
  setup: ApplicationModuleSetup<TResult, TSpec, TStatus>,
): ApplicationModuleDefinition<
  Readonly<TResult>,
  TSpec,
  TStatus,
  ApplicationModuleSetup<Readonly<TResult>, TSpec, TStatus>
>;
export function module<
  const TResult extends Readonly<Record<string, unknown>>,
  TModel extends object,
  TSpec extends object = object,
  TStatus extends object = object,
>(
  name: string,
  model: TModel,
  setup: ApplicationModuleSetup<TResult, TSpec, TStatus>,
): ApplicationModuleDefinition<
  Readonly<TResult>,
  TSpec,
  TStatus,
  ApplicationModuleSetup<Readonly<TResult>, TSpec, TStatus>
>;
export function module<
  const TResult extends Readonly<Record<string, unknown>>,
  const TSchema extends Readonly<Record<string, unknown>>,
  TSpec extends object = object,
  TStatus extends object = object,
>(
  name: string,
  options: ApplicationModuleOptions<TSchema>,
  setup: ApplicationModuleSetup<TResult, TSpec, TStatus>,
): ApplicationModuleDefinition<
  Readonly<TResult>,
  TSpec,
  TStatus,
  ApplicationModuleSetup<Readonly<TResult>, TSpec, TStatus>
>;
export function module<
  const TResult extends Readonly<Record<string, unknown>>,
>(
  name: string,
  optionsOrSetup:
    | ApplicationModuleOptions
    | object
    | ApplicationModuleSetup<TResult>,
  maybeSetup?: ApplicationModuleSetup<TResult>,
): ApplicationModuleDefinition<
  Readonly<TResult>,
  object,
  object,
  ApplicationModuleSetup<Readonly<TResult>>
> {
  const stableName = name.trim();
  if (!stableName) {
    throw new Error('Application module name must be a non-empty string.');
  }
  const model = typeof optionsOrSetup === 'object'
    && isApplicationRelationalModel(optionsOrSetup)
      ? optionsOrSetup
      : undefined;
  const options = typeof optionsOrSetup === 'function'
    ? undefined
    : model
      ? { schema: { [stableName]: model } }
      // The overload boundary has excluded the directly owned model and callback forms.
      // typecast: the remaining value has the public module-options shape.
      : optionsOrSetup as ApplicationModuleOptions;
  const setup = typeof optionsOrSetup === 'function'
    ? optionsOrSetup
    : maybeSetup;
  if (typeof setup !== 'function') {
    throw new Error(
      `Application module ${JSON.stringify(stableName)} requires a setup callback.`,
    );
  }
  if (
    options !== undefined
    && (
      !isPlainRecord(options)
      || Object.keys(options).some((key) => key !== 'schema')
    )
  ) {
    throw new Error(
      `Application module ${JSON.stringify(stableName)} options support only the explicit schema escape hatch.`,
    );
  }
  if (options?.schema !== undefined && !isPlainRecord(options.schema)) {
    throw new Error(
      `Application module ${JSON.stringify(stableName)} schema must be a plain object.`,
    );
  }

  const install: ApplicationModuleSetup<Readonly<TResult>> = (application) =>
    validateAndFreezeApplicationModuleExports(
      stableName,
      setup(application),
    );

  return defineApplicationModule(install, {
    name: stableName,
    ...(options?.schema ? { schema: Object.freeze({ ...options.schema }) } : {}),
    inferReturnedSchema: true,
    install(application) {
      return install(application);
    },
  });
}

function validateAndFreezeApplicationModuleExports<
  const TResult extends Readonly<Record<string, unknown>>,
>(name: string, exports: TResult): Readonly<TResult> {
  if (!isPlainRecord(exports)) {
    throw new Error(
      `Application module ${JSON.stringify(name)} must return a plain object of public exports.`,
    );
  }
  const symbols = Object.getOwnPropertySymbols(exports);
  if (symbols.length > 0) {
    throw new Error(
      `Application module ${JSON.stringify(name)} cannot export symbol-keyed values.`,
    );
  }
  for (const [exportName, value] of Object.entries(exports)) {
    if (
      exportName === '__proto__'
      || exportName === 'prototype'
      || exportName === 'constructor'
    ) {
      throw new Error(
        `Application module ${JSON.stringify(name)} uses unsafe export name ${JSON.stringify(exportName)}.`,
      );
    }
    if (value === undefined) {
      throw new Error(
        `Application module ${JSON.stringify(name)} export ${JSON.stringify(exportName)} is undefined.`,
      );
    }
  }
  return Object.freeze(exports);
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function applicationModuleMetadataFor<TResult>(
  value: unknown,
): ApplicationModuleMetadata<TResult, object, object> | undefined {
  if (typeof value !== 'function') return undefined;
  const metadata = Reflect.get(value, applicationModuleDefinition);
  if (
    !metadata
    || typeof metadata !== 'object'
    || typeof Reflect.get(metadata, 'name') !== 'string'
    || typeof Reflect.get(metadata, 'install') !== 'function'
  ) {
    return undefined;
  }
  // The reflective guards validate the non-enumerable metadata boundary.
  // typecast: recover the generic result after validating every consumed field.
  return metadata as ApplicationModuleMetadata<TResult, object, object>;
}
