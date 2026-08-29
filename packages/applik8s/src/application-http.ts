// typecast-file-boundary: typed route schemas and callbacks are validated before
// their generic associations are erased into the application graph.

import {
  type ApplicationOperation,
  createApplicationRuntimeOperation,
  observeApplicationOperationAuthority,
} from '@applik8s/client';
import type {
  ApplicationAdmissionInvocationContextV1,
  ApplicationOperationAuthorityGraphContract,
  ApplicationPrincipal,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import type { ApplicationServerOptions } from './application-builder.js';
import {
  type ExpandedApplicationCallbackDependencies,
  expandApplicationCallbackDependencies,
  serializeApplicationCallback,
} from './application-callback.js';
import { declaredSchema } from './application-workflow-serialization.js';
import { applicationGeneratedDependencyAlias } from './application-workflows.js';

interface ApplicationHttpWorkflowBinding {
  readonly kind: 'applicationTask' | 'applicationWorkflow';
  readonly definition: { readonly id: string };
}

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

export interface ApplicationHttpWebhookRequest {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface ApplicationHttpContext {
  /** Canonical framework admission for this exact route invocation. */
  readonly admission: ApplicationAdmissionInvocationContextV1;
  readonly principal: ApplicationPrincipal;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  /**
   * Framework-normalized operation idempotency identity. Ordinary typed
   * routes receive the trimmed, bounded `Idempotency-Key`; authenticated
   * webhooks receive the provider-event identity derived by the framework.
   * Raw request headers remain unavailable.
   */
  readonly idempotencyKey: string;
  /**
   * Browser-supplied HTTP Origin after strict HTTP(S) normalization. This is
   * framework transport metadata, not application input, and is intentionally
   * absent for non-browser/server-to-server callers.
   */
  readonly requestOrigin?: string;
  readonly signal: AbortSignal;
}

export type ApplicationHttpWebhookAuthentication<
  TEvent extends { readonly id: string },
> = (
  request: ApplicationHttpWebhookRequest,
) => TEvent | Promise<TEvent>;

export interface ApplicationHttpWebhookContract<
  TEvent extends { readonly id: string },
  TOutput extends object,
> {
  /** Schema for the provider-authenticated event returned by authenticate. */
  readonly event: SchemaInput<TEvent>;
  readonly output: SchemaInput<TOutput>;
  /**
   * Authenticates the exact raw request before JSON parsing. A provider
   * signature or equivalent receipt is the admission boundary.
   */
  readonly authenticate: ApplicationHttpWebhookAuthentication<TEvent>;
  /** @internal Compiler-injected semantic callback leaves. */
  readonly __generatedCalls?: readonly unknown[];
  /** @internal Compiler-injected semantic callback leaves keyed by source path. */
  readonly __generatedBindings?: Readonly<Record<string, unknown>>;
  /** @internal Compiler-injected awaited callback leaves keyed by source path. */
  readonly __generatedAwaitedCalls?: Readonly<Record<string, unknown>>;
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
  webhook<
    TEvent extends { readonly id: string },
    TOutput extends object,
  >(
    name: string,
    path: string,
    contract: ApplicationHttpWebhookContract<TEvent, TOutput>,
    handler: ApplicationHttpHandler<TEvent, TOutput>,
  ): ApplicationOperation<TEvent, TOutput>;
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
  readonly webhookAuthentication?: {
    readonly source: string;
    readonly dependencies?: {
      readonly source: string;
      readonly resolveDir: string;
    };
    readonly location?: {
      readonly file: string;
      readonly line: number;
      readonly column: number;
    };
  };
  /** @internal Original raw-request authenticator retained until compilation. */
  readonly webhookAuthenticate?: ApplicationHttpWebhookAuthentication<{
    readonly id: string;
  }>;
  /** @internal Semantic dependencies retained until transaction inference. */
  readonly handlerDependencyGraph: ExpandedApplicationCallbackDependencies;
  /** @internal Durable workflow leaves reconstructed by the generated worker. */
  readonly workflowBindings: Readonly<
    Record<string, ApplicationHttpWorkflowBinding>
  >;
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
      const handlerDependencies = expandApplicationCallbackDependencies({
        calls: [handler, ...(contract.__generatedCalls ?? [])],
        bindings: contract.__generatedBindings,
        awaited: contract.__generatedAwaitedCalls,
      });
      const workflowBindings = applicationHttpWorkflowBindings(
        handlerDependencies,
      );
      const serializedHandler = serializeApplicationCallback({
        registrar: 'app.http',
        argumentIndex: 3,
        property: 'handler',
        label: `HTTP route ${serverName}.${name}`,
        callback: handler as (...args: never[]) => unknown,
        allowDeferredResolution: true,
        injectedIdentifiers: applicationHttpInjectedIdentifiers(
          workflowBindings,
        ),
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
        workflowBindings,
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
    webhook<
      TEvent extends { readonly id: string },
      TOutput extends object,
    >(
      name: string,
      path: string,
      contract: ApplicationHttpWebhookContract<TEvent, TOutput>,
      handler: ApplicationHttpHandler<TEvent, TOutput>,
    ): ApplicationOperation<TEvent, TOutput> {
      assertApplicationHttpRoute(serverName, name, path, ids);
      const input = declaredSchema(
        contract.event,
        `app.http(${serverName}).${name}.event`,
      );
      const output = declaredSchema(
        contract.output,
        `app.http(${serverName}).${name}.output`,
      );
      const serializedAuthentication = serializeApplicationCallback({
        registrar: 'app.http.webhook',
        argumentIndex: 2,
        property: 'authenticate',
        label: `HTTP webhook ${serverName}.${name} authentication`,
        callback: contract.authenticate as (...args: never[]) => unknown,
        allowDeferredResolution: true,
      });
      const handlerDependencies = expandApplicationCallbackDependencies({
        calls: [
          handler,
          contract.authenticate,
          ...(contract.__generatedCalls ?? []),
        ],
        bindings: contract.__generatedBindings,
        awaited: contract.__generatedAwaitedCalls,
      });
      const workflowBindings = applicationHttpWorkflowBindings(
        handlerDependencies,
      );
      const serializedHandler = serializeApplicationCallback({
        registrar: 'app.http.webhook',
        argumentIndex: 3,
        property: 'handler',
        label: `HTTP webhook ${serverName}.${name}`,
        callback: handler as (...args: never[]) => unknown,
        allowDeferredResolution: true,
        injectedIdentifiers: applicationHttpInjectedIdentifiers(
          workflowBindings,
        ),
      });
      const authority: ApplicationOperationAuthorityGraphContract = {
        classification: 'public',
        permissionIds: [],
        grantable: false,
        delegable: false,
        scope: {
          kind: 'target',
          model: serverName,
          identity: { key: name },
        },
        transports: ['http'],
      };
      const route: ApplicationHttpRouteDeclaration = {
        id: name,
        method: 'POST',
        path,
        input: input.jsonSchema,
        output: output.jsonSchema,
        inputSchema: contract.event as SchemaInput<object>,
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
        webhookAuthentication: {
          source: serializedAuthentication.source,
          ...(serializedAuthentication.dependencies
            ? { dependencies: serializedAuthentication.dependencies }
            : {}),
          ...(serializedAuthentication.location
            ? { location: serializedAuthentication.location }
            : {}),
        },
        webhookAuthenticate:
          contract.authenticate as ApplicationHttpWebhookAuthentication<{
            readonly id: string;
          }>,
        handlerDependencyGraph: handlerDependencies,
        workflowBindings,
        authority,
      };
      const operation = createApplicationRuntimeOperation<TEvent, TOutput>({
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
          'Authenticated webhook operations execute only through their generated raw-request boundary.',
        );
      });
      applyWebhookOperationAuthority(operation);
      onRoute(route);
      ids.add(name);
      return operation;
    },
  });
}

function applicationHttpWorkflowBindings(
  dependencies: ExpandedApplicationCallbackDependencies,
): Readonly<Record<string, ApplicationHttpWorkflowBinding>> {
  const inferred = dependencies.calls.filter(isApplicationHttpWorkflowBinding);
  return Object.fromEntries(
    inferred.flatMap((binding) => {
      const identifiers = Object.entries(dependencies.bindings)
        .filter(
          ([identifier, candidate]) =>
            candidate === binding && !/^generatedCall\d+$/.test(identifier),
        )
        .map(([identifier]) => identifier);
      return (identifiers.length > 0
        ? identifiers
        : [applicationGeneratedDependencyAlias(binding.definition.id)])
        .map((identifier) => [identifier, binding] as const);
    }),
  );
}

function isApplicationHttpWorkflowBinding(
  value: unknown,
): value is ApplicationHttpWorkflowBinding {
  return typeof value === 'function'
    && (
      Reflect.get(value, 'kind') === 'applicationTask'
      || Reflect.get(value, 'kind') === 'applicationWorkflow'
    );
}

function applicationHttpInjectedIdentifiers(
  bindings: Readonly<Record<string, ApplicationHttpWorkflowBinding>>,
): readonly string[] {
  return Object.keys(bindings)
    .flatMap((identifier) => [identifier, identifier.split('.')[0] ?? identifier])
    .filter(
      (identifier, index, identifiers) =>
        identifier.length > 0 && identifiers.indexOf(identifier) === index,
    );
}

function applyWebhookOperationAuthority<TInput, TOutput>(
  operation: ApplicationOperation<TInput, TOutput>,
): void {
  operation.public();
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
