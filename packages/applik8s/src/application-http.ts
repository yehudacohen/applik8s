// typecast-file-boundary: typed route schemas and callbacks are validated before
// their generic associations are erased into the application graph.

import {
  type ApplicationOperation,
  createApplicationRuntimeOperation,
  observeApplicationOperationAuthority,
} from '@applik8s/client';
import type {
  ApplicationOperationAuthorityGraphContract,
  ApplicationPrincipal,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import {
  type ExpandedApplicationCallbackDependencies,
  expandApplicationCallbackDependencies,
  serializeApplicationCallback,
} from './application-callback.js';
import type { ApplicationServerOptions } from './application-builder.js';
import { declaredSchema } from './application-workflow-serialization.js';

export interface ApplicationHttpOptions
  extends Pick<
    ApplicationServerOptions,
    | 'namespace'
    | 'replicas'
    | 'resources'
    | 'indexes'
    | 'models'
    | 'maxRequestBodyBytes'
    | 'mutationRateLimit'
  > {}

export interface ApplicationHttpRouteContract<
  TInput extends object,
  TOutput extends object,
> {
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly authorize?: ApplicationHttpAuthorization<TInput>;
  /** @internal Compiler-injected semantic callback leaves. */
  readonly __generatedCalls?: readonly unknown[];
  /** @internal Compiler-injected semantic callback leaves keyed by source path. */
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
  /** @internal Compiler-injected awaited callback leaves keyed by source path. */
  readonly __generatedAwaitedCalls?: Readonly<Record<string, unknown>>;
}

export interface ApplicationHttpRequest<TInput extends object> {
  readonly input: TInput;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
}

export interface ApplicationHttpContext {
  readonly principal: ApplicationPrincipal;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly signal: AbortSignal;
}

export type ApplicationHttpAuthorization<TInput extends object> = (
  request: ApplicationHttpRequest<TInput>,
  context: ApplicationHttpContext,
) => boolean | Promise<boolean>;

export type ApplicationHttpHandler<TInput extends object, TOutput> = (
  request: ApplicationHttpRequest<TInput>,
  context: ApplicationHttpContext,
) => TOutput | Promise<TOutput>;

export interface ApplicationHttpServer {
  post<TInput extends object, TOutput extends object>(
    name: string,
    path: string,
    contract: ApplicationHttpRouteContract<TInput, TOutput>,
    handler: ApplicationHttpHandler<TInput, TOutput>,
  ): ApplicationOperation<TInput, TOutput>;
}

export type ApplicationHttpRegistrar = (
  name: string,
  options?: ApplicationHttpOptions,
) => ApplicationHttpServer;

export interface ApplicationHttpRouteDeclaration {
  readonly id: string;
  readonly method: 'POST';
  readonly path: string;
  readonly input: JsonObject;
  readonly output: JsonObject;
  /** @internal Authoring-time schema retained until graph finalization. */
  readonly inputSchema: SchemaInput<object>;
  /** @internal Authoring-time schema retained until graph finalization. */
  readonly outputSchema: SchemaInput<object>;
  readonly handlerSource: string;
  readonly handlerDependencies?: {
    readonly source: string;
    readonly resolveDir: string;
  };
  readonly handlerLocation?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  readonly authorizeSource?: string;
  readonly authorizeDependencies?: {
    readonly source: string;
    readonly resolveDir: string;
  };
  readonly authorizeLocation?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
  /** @internal Original authorization callback retained until compilation. */
  readonly authorize?: ApplicationHttpAuthorization<object>;
  /** @internal Semantic dependencies retained until transaction inference. */
  readonly handlerDependencyGraph: ExpandedApplicationCallbackDependencies;
  /** @internal Original function identity retained only until compilation. */
  readonly handler: ApplicationHttpHandler<object, object>;
  authority?: ApplicationOperationAuthorityGraphContract;
}

export function createApplicationHttpServer(
  serverName: string,
  onRoute: (route: ApplicationHttpRouteDeclaration) => void,
): ApplicationHttpServer {
  const ids = new Set<string>();
  return Object.freeze({
    post<TInput extends object, TOutput extends object>(
      name: string,
      path: string,
      contract: ApplicationHttpRouteContract<TInput, TOutput>,
      handler: ApplicationHttpHandler<TInput, TOutput>,
    ): ApplicationOperation<TInput, TOutput> {
      assertApplicationHttpRoute(serverName, name, path, ids);
      const input = declaredSchema(
        contract.input,
        `app.http(${serverName}).${name}.input`,
      );
      const output = declaredSchema(
        contract.output,
        `app.http(${serverName}).${name}.output`,
      );
      const serializedHandler = serializeApplicationCallback({
        registrar: 'app.http',
        argumentIndex: 3,
        property: 'handler',
        label: `HTTP route ${serverName}.${name}`,
        callback: handler as (...args: never[]) => unknown,
        allowDeferredResolution: true,
      });
      const handlerDependencies = expandApplicationCallbackDependencies({
        calls: [handler, ...(contract.__generatedCalls ?? [])],
        bindings: contract.__generatedBindings,
        awaited: contract.__generatedAwaitedCalls,
      });
      const serializedAuthorize = contract.authorize
        ? serializeApplicationCallback({
            registrar: 'app.http',
            argumentIndex: 2,
            property: 'authorize',
            label: `HTTP route ${serverName}.${name} authorization`,
            callback:
              contract.authorize as (...args: never[]) => unknown,
            allowDeferredResolution: true,
          })
        : undefined;
      const route: ApplicationHttpRouteDeclaration = {
        id: name,
        method: 'POST',
        path,
        input: input.jsonSchema,
        output: output.jsonSchema,
        inputSchema: contract.input as SchemaInput<object>,
        outputSchema: contract.output as SchemaInput<object>,
        handler:
          handler as unknown as ApplicationHttpHandler<object, object>,
        handlerSource: serializedHandler.source,
        ...(serializedHandler.dependencies
          ? { handlerDependencies: serializedHandler.dependencies }
          : {}),
        ...(serializedHandler.location
          ? { handlerLocation: serializedHandler.location }
          : {}),
        ...(serializedAuthorize
          ? {
              authorize:
                contract.authorize as ApplicationHttpAuthorization<object>,
              authorizeSource: serializedAuthorize.source,
              ...(serializedAuthorize.dependencies
                ? {
                    authorizeDependencies:
                      serializedAuthorize.dependencies,
                  }
                : {}),
              ...(serializedAuthorize.location
                ? { authorizeLocation: serializedAuthorize.location }
                : {}),
            }
          : {}),
        handlerDependencyGraph: handlerDependencies,
      };
      const operation = createApplicationRuntimeOperation<
        TInput,
        TOutput
      >({
        apiVersion: 'applik8s.operation/v1alpha1',
        kind: 'applicationOperation',
        id: `applik8s://http/${encodeURIComponent(serverName)}/operations/${encodeURIComponent(name)}`,
        model: serverName,
        name,
        operation: 'custom',
        transport: 'runtime',
        version: 'v1',
      }, async () => {
        throw new Error(
          'Function-native HTTP operations execute only through their generated authenticated route boundary.',
        );
      });
      observeApplicationOperationAuthority(operation, (authority) => {
        route.authority = authority;
      });
      if (contract.authorize) {
        operation.applicationPolicy();
      }
      ids.add(name);
      onRoute(route);
      return operation;
    },
  });
}

function assertApplicationHttpRoute(
  server: string,
  name: string,
  path: string,
  ids: ReadonlySet<string>,
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      `app.http(${JSON.stringify(server)}).post(...) route name ${JSON.stringify(name)} must be a stable identifier.`,
    );
  }
  if (ids.has(name)) {
    throw new Error(
      `app.http(${JSON.stringify(server)}) route ${JSON.stringify(name)} is already declared.`,
    );
  }
  if (!path.startsWith('/')) {
    throw new Error(
      `app.http(${JSON.stringify(server)}) route ${JSON.stringify(name)} path must begin with '/'.`,
    );
  }
}
