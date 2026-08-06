// typecast-file-boundary: generated server capture analysis validates route bindings and runtime module shapes before restoring their authoring generics.

import {
  type ApplicationOperation,
  createApplicationRuntimeOperation,
  observeApplicationOperationAuthority,
} from '@applik8s/client';
import type { AnyResourceDefinition, ResourceIndex } from '@applik8s/core';
import type {
  ApplicationKubernetesRbacRule,
  ApplicationRouteHandler,
  ApplicationServer,
  ApplicationServerRoute,
} from './application.js';
import type { ApplicationServerRuntimeResource } from './application-generated-runtime-sources.js';
import { apiGroupForApiVersion, unique } from './application-identifiers.js';
import type { ApplicationRuntimeModelContract } from './application-models.js';
import {
  type ApplicationServerRouteSourceAnalysis,
  analyzeApplicationServerRouteSource,
  applicationRouteSourceDependencies,
  extractApplicationRouteHandlerSource,
  normalizeSerializableFunctionSource,
  routeAnalysisCallsMethod,
  routeDynamicBindingAccesses,
  type SerializedApplicationServerRouteWithDependencies,
  unsupportedRouteFreeIdentifiers,
} from './application-route-source.js';

export {
  serializeApplicationServerCaptures,
  serializedApplicationServerCaptureAliases,
  type SerializedApplicationServerCaptures,
} from './application-server-captures.js';

export interface ApplicationServerPermissionInferenceRequest {
  readonly routes: readonly ApplicationServerRoute[];
  readonly resources: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly indexBackend: { readonly kind: 'valkey'; readonly host: string; readonly port: number } | undefined;
  readonly cache: readonly ResourceIndex<object, object>[];
  readonly explicit: readonly ApplicationKubernetesRbacRule[];
}

export function applicationRuntimeResource(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>): ApplicationServerRuntimeResource {
  return { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope };
}

export function transactionalDatabaseEnvironmentVariables(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, serverNamespace: string | undefined): readonly { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }[] {
  const byEnvName = new Map<string, { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }>();
  for (const model of Object.values(models)) {
    const secretNamespace = model.secretNamespace ?? 'default';
    const podNamespace = serverNamespace ?? 'default';
    if (secretNamespace !== podNamespace) {
      throw new Error(`app.server cannot bind model ${JSON.stringify(model.name)} because its TransactionalDatabase Secret ${model.secretName} is in namespace ${secretNamespace}, but the server is in namespace ${podNamespace}. Run the server in the same namespace or provide a same-namespace connectionSecret.`);
    }
    byEnvName.set(model.connectionEnvName, { name: model.connectionEnvName, valueFrom: { secretKeyRef: { name: model.secretName, key: model.secretKey } } });
  }
  return [...byEnvName.values()];
}

export function assertRuntimeBindingNames(bindings: Readonly<Record<string, unknown>>): void {
  for (const name of Object.keys(bindings)) {
    if (!/^[$A-Z_a-z][$\w]*$/.test(name)) throw new Error(`app.server runtime binding ${JSON.stringify(name)} must be a valid JavaScript identifier.`);
  }
}

export function assertDistinctRuntimeBindingNames(bindings: Readonly<Record<string, Readonly<Record<string, unknown>>>>): void {
  const seen = new Map<string, string>();
  for (const [kind, values] of Object.entries(bindings)) {
    for (const name of Object.keys(values)) {
      const previous = seen.get(name);
      if (previous) throw new Error(`app.server runtime binding ${JSON.stringify(name)} is declared as both ${previous} and ${kind}. Use distinct resource, index, and capture names.`);
      seen.set(name, kind);
    }
  }
}

export function serializeApplicationServerRoutes(
  routes: readonly ApplicationServerRoute[],
  bindingNames: ReadonlySet<string>,
  dynamicAccessDisallowedBindings: ReadonlySet<string>,
): readonly SerializedApplicationServerRouteWithDependencies[] {
  return routes.map((route) => serializeApplicationServerRoute(route, bindingNames, dynamicAccessDisallowedBindings));
}

export function inferApplicationServerPermissions(request: ApplicationServerPermissionInferenceRequest): readonly ApplicationKubernetesRbacRule[] {
  const cachedIndexes = new Set(request.indexBackend ? request.cache : []);
  const inferred: ApplicationKubernetesRbacRule[] = [];
  for (const route of request.routes) {
    const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
    for (const [name, resource] of Object.entries(request.resources)) {
      for (const operation of resourceOperationsInSource(analysis, name)) inferred.push(resourceOperationPermission(resource, operation));
    }
    for (const [name, index] of Object.entries(request.indexes)) {
      if (!cachedIndexes.has(index) && routeAnalysisCallsMethod(analysis, name, 'query')) inferred.push(resourceOperationPermission(index.resource, 'query'));
    }
  }
  return mergeApplicationKubernetesRbacRules([...request.explicit, ...inferred]);
}

export function createRouteRecorder(serverName: string, routes: ApplicationServerRoute[]): ApplicationServer {
  const record = (
    method: ApplicationServerRoute['method'],
    nameOrPath: string,
    pathOrHandler: string | ApplicationRouteHandler,
    maybeHandler?: ApplicationRouteHandler,
  ): ApplicationOperation<Parameters<ApplicationRouteHandler>[0], unknown> => {
    const named = typeof pathOrHandler === 'string';
    const name = named ? nameOrPath : routeId(method, nameOrPath, routes.length);
    const path = named ? pathOrHandler : nameOrPath;
    const handler = named ? maybeHandler : pathOrHandler;
    if (typeof handler !== 'function') {
      throw new Error(`app.http(${JSON.stringify(serverName)}) route ${method} ${path} requires a handler.`);
    }
    if (!name.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error(`app.http(${JSON.stringify(serverName)}) route name ${JSON.stringify(name)} must be a stable non-empty identifier.`);
    }
    if (routes.some((route) => route.id === name)) {
      throw new Error(`app.http(${JSON.stringify(serverName)}) route name ${JSON.stringify(name)} is already declared.`);
    }
    const extracted = extractApplicationRouteHandlerSource(method, named ? 2 : 1);
    const fallbackSource = normalizeSerializableFunctionSource(handler.toString().trim());
    const route: ApplicationServerRoute = {
      id: name,
      named,
      method,
      path,
      handlerSource: extracted?.source ?? fallbackSource,
      handlerSourceKind: extracted ? 'source' : 'functionToString',
      ...(extracted ? { handlerSourceLocation: extracted.location } : {}),
    };
    routes.push(route);
    const operation = createApplicationRuntimeOperation<Parameters<ApplicationRouteHandler>[0], unknown>({
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id: `applik8s://http/${serverName}/operations/${name}`,
      model: serverName,
      name,
      operation: 'custom',
      transport: 'runtime',
      version: 'v1',
    }, async (request) => handler(request));
    observeApplicationOperationAuthority(operation, (authority) => {
      Object.assign(route, { authority });
    });
    return operation;
  };
  return {
    get: ((...args: [string, ApplicationRouteHandler] | [string, string, ApplicationRouteHandler]) =>
      args.length === 2
        ? record('GET', args[0], args[1])
        : record('GET', args[0], args[1], args[2])) as ApplicationServer['get'],
    post: ((...args: [string, ApplicationRouteHandler] | [string, string, ApplicationRouteHandler]) =>
      args.length === 2
        ? record('POST', args[0], args[1])
        : record('POST', args[0], args[1], args[2])) as ApplicationServer['post'],
  };
}

function serializeApplicationServerRoute(route: ApplicationServerRoute, bindingNames: ReadonlySet<string>, dynamicAccessDisallowedBindings: ReadonlySet<string>): SerializedApplicationServerRouteWithDependencies {
  try { Function(`return (${route.handlerSource});`); } catch (error) {
    const location = route.handlerSourceLocation ? ` at ${route.handlerSourceLocation.file}:${route.handlerSourceLocation.line}:${route.handlerSourceLocation.column}` : '';
    throw new Error(`app.server route ${route.method} ${route.path} must be a serializable JavaScript function expression (${route.handlerSourceKind ?? 'unknown'}${location}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const analysis = analyzeApplicationServerRouteSource(route.handlerSource);
  const dynamicAccesses = routeDynamicBindingAccesses(analysis, dynamicAccessDisallowedBindings);
  if (dynamicAccesses.length > 0) throw new Error(`app.server route ${route.method} ${route.path} uses unsupported dynamic binding access: ${dynamicAccesses.join(', ')}. Use direct methods like Resource.create(...) or index.query(...) so permissions can be inferred.`);
  const unsupported = unsupportedRouteFreeIdentifiers(analysis, bindingNames);
  const dependencies = route.handlerDependencySource
    ? {
        source: route.handlerDependencySource,
        resolveDir: route.handlerDependencyResolveDir ?? process.cwd(),
      }
    : applicationRouteSourceDependencies(route, unsupported, bindingNames);
  if (unsupported.length > 0 && !dependencies) throw new Error(`app.server route ${route.method} ${route.path} cannot serialize closure identifier(s): ${unsupported.join(', ')}. Pass serializable values through app.server captures, pass resources/indexes through app.server bindings, or inline constants inside the handler.`);
  return dependencies ? { ...route, handlerDependencySource: dependencies.source, handlerDependencyResolveDir: dependencies.resolveDir } : route;
}

type ApplicationServerResourceOperation = 'create' | 'get' | 'query' | 'patch' | 'delete' | 'increment';
const resourceOperationVerbs: Readonly<Record<ApplicationServerResourceOperation, readonly string[]>> = {
  create: ['create'], get: ['get'], query: ['get', 'list'], patch: ['patch'], delete: ['delete'], increment: ['create', 'get', 'patch'],
};

function resourceOperationsInSource(analysis: ApplicationServerRouteSourceAnalysis, bindingName: string): readonly ApplicationServerResourceOperation[] {
  // typecast: the complete readonly operation table makes its runtime keys exactly the operation union.
  return (Object.keys(resourceOperationVerbs) as ApplicationServerResourceOperation[]).filter((operation) => routeAnalysisCallsMethod(analysis, bindingName, operation));
}

function resourceOperationPermission(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'plural'>, operation: ApplicationServerResourceOperation): ApplicationKubernetesRbacRule {
  return { apiGroups: [apiGroupForApiVersion(resource.apiVersion)], resources: [resource.plural], verbs: resourceOperationVerbs[operation] };
}

export function mergeApplicationKubernetesRbacRules(permissions: readonly ApplicationKubernetesRbacRule[]): readonly ApplicationKubernetesRbacRule[] {
  const merged = new Map<string, { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames?: string[] }>();
  for (const permission of permissions) {
    const apiGroups = [...permission.apiGroups].sort();
    const resources = [...permission.resources].sort();
    const resourceNames = permission.resourceNames ? [...permission.resourceNames].sort() : undefined;
    const key = JSON.stringify({ apiGroups, resources, resourceNames });
    const existing = merged.get(key);
    if (existing) existing.verbs = unique([...existing.verbs, ...permission.verbs]);
    else merged.set(key, { apiGroups, resources, verbs: unique([...permission.verbs]), ...(resourceNames ? { resourceNames } : {}) });
  }
  return [...merged.values()];
}

function routeId(method: ApplicationServerRoute['method'], path: string, index: number): string {
  const safePath = path.split('/').filter(Boolean).join('-') || 'root';
  return `${method.toLowerCase()}-${safePath}-${index}`.replace(/[^a-z0-9-]+/g, '-');
}
