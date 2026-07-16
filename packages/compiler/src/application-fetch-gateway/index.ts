import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  ApplicationCrdNode,
  ApplicationGraph,
  ApplicationProviderNode,
  ApplicationQueryNode,
  ApplicationSerializedCallbackContract,
} from '@applik8s/core';

export interface GeneratedApplicationFetchGatewayModules {
  readonly entrypoint: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Generates a framework-neutral Fetch gateway from graph metadata.
 *
 * Each callback is isolated in its own module so transitive captures can be
 * bundled without helper-name collisions. The browser facade never imports
 * these modules.
 */
export function generatedApplicationFetchGatewayModules(graph: ApplicationGraph): GeneratedApplicationFetchGatewayModules | undefined {
  const queries = graph.nodes.filter((node): node is ApplicationQueryNode => node.kind === 'query' && Boolean(node.kubernetes));
  const commands = graph.nodes.filter((node): node is ApplicationCrdNode => node.kind === 'crd' && Boolean(node.create));
  if (queries.length === 0 && commands.length === 0) return undefined;
  const identity = graph.nodes.filter(
    (node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === 'RequestIdentity',
  );
  if (identity.length !== 1) throw new Error('Generated application Fetch gateway requires exactly one RequestIdentity provider.');
  const identityConfig = objectConfig(objectConfig(identity[0]?.config).identity);
  const authentication = serializedCallbackConfig(identityConfig, 'authentication');
  const files: Record<string, string> = {};
  const imports = ["import { createApplik8sKubernetesGateway } from '@applik8s/vite/server';"];
  const authenticate = graphCallback(files, imports, identity[0]?.id ?? 'RequestIdentity', 'identity', authentication);
  const querySources = queries.map((query) => {
    if (!query.kubernetes) throw new Error(`Application query ${query.id} lost its Kubernetes authority.`);
    const callbacks = {
      authorize: graphCallback(files, imports, query.id, 'authorize', {
        source: query.authorizationSource,
        ...(query.authorizationDependencies ? { dependencies: query.authorizationDependencies } : {}),
        ...(query.authorizationLocation ? { location: query.authorizationLocation } : {}),
        ...(query.authorizationUnresolved ? { unresolved: query.authorizationUnresolved } : {}),
      }),
      namespace: query.kubernetes.namespaceResolver ? graphCallback(files, imports, query.id, 'namespace', query.kubernetes.namespaceResolver) : undefined,
      labelSelector: query.kubernetes.labelSelector ? graphCallback(files, imports, query.id, 'label-selector', query.kubernetes.labelSelector) : undefined,
      fieldSelector: query.kubernetes.fieldSelector ? graphCallback(files, imports, query.id, 'field-selector', query.kubernetes.fieldSelector) : undefined,
      filter: query.kubernetes.filter ? graphCallback(files, imports, query.id, 'filter', query.kubernetes.filter) : undefined,
      compare: query.kubernetes.compare ? graphCallback(files, imports, query.id, 'compare', query.kubernetes.compare) : undefined,
      project: graphCallback(files, imports, query.id, 'project', query.kubernetes.project),
      limit: query.kubernetes.limit ? graphCallback(files, imports, query.id, 'limit', query.kubernetes.limit) : undefined,
    };
    const model = requiredCrd(graph, query.kubernetes.model.nodeId, query.id);
    return `{
      id: ${JSON.stringify(query.publicId ?? `${query.name}.${query.version}`)},
      model: ${JSON.stringify(model.name)},
      resource: ${JSON.stringify(query.kubernetes.resource)},
      inputSchema: ${JSON.stringify(query.input.jsonSchema)},
      outputSchema: ${JSON.stringify(query.output.jsonSchema)},
      budgets: ${JSON.stringify(query.budgets)},
      bounds: ${JSON.stringify({ pageSize: query.kubernetes.pageSize, maxPages: query.kubernetes.maxPages, maxItems: query.kubernetes.maxItems })},
      authorize: (request) => ${callbacks.authorize}(request),
      ${query.kubernetes.namespace ? `fixedNamespace: ${JSON.stringify(query.kubernetes.namespace)},` : ''}
      ${callbacks.namespace ? `namespace: (request) => ${callbacks.namespace}(request),` : ''}
      ${callbacks.labelSelector ? `labelSelector: (request) => ${callbacks.labelSelector}(request),` : ''}
      ${callbacks.fieldSelector ? `fieldSelector: (request) => ${callbacks.fieldSelector}(request),` : ''}
      ${callbacks.filter ? `filter: (request) => ${callbacks.filter}(request),` : ''}
      ${callbacks.compare ? `compare: (request) => ${callbacks.compare}(request),` : ''}
      project: (request) => ${callbacks.project}(request),
      ${callbacks.limit ? `limit: (request) => ${callbacks.limit}(request),` : ''}
    }`;
  });
  const commandSources = commands.map((model) => {
    if (!model.create) throw new Error(`Kubernetes model ${model.id} lost its create authority.`);
    const authorize = graphCallback(files, imports, model.id, 'create-authorize', model.create.authorize);
    const place = graphCallback(files, imports, model.id, 'create-place', model.create.place);
    return `{
      id: ${JSON.stringify(`${model.name}.create`)},
      model: ${JSON.stringify(model.name)},
      resource: ${JSON.stringify(model.resource)},
      inputSchema: ${JSON.stringify(model.create.input.jsonSchema)},
      authorize: (request) => ${authorize}(request),
      place: (request) => ${place}(request),
    }`;
  });
  files['gateway.generated.ts'] = `${imports.join('\n')}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(\`Missing required environment variable \${name}\`);
  return value;
}

export const gateway = createApplik8sKubernetesGateway({
  authenticate: (request) => ${authenticate}(request),
  cursorSecret: requiredEnv('APPLIK8S_CURSOR_SECRET'),
  commands: [${commandSources.join(',\n')}],
  queries: [${querySources.join(',\n')}],
});

export const handleApplik8sRequest = (request) => gateway.handle(request);
`;
  return { entrypoint: 'gateway.generated.ts', files };
}

function graphCallback(
  files: Record<string, string>,
  imports: string[],
  owner: string,
  role: string,
  callback: ApplicationSerializedCallbackContract,
): string {
  if (callback.unresolved && callback.unresolved.length > 0 && !callback.dependencies) {
    throw new Error(`Generated application Fetch gateway ${owner} ${role} callback has unresolved captures: ${callback.unresolved.join(', ')}.`);
  }
  const digest = createHash('sha256').update(`${owner}:${role}`).digest('hex').slice(0, 12);
  const file = `${role}-${digest}.generated.ts`;
  const variable = `callback_${role.replace(/[^A-Za-z0-9_$]+/g, '_')}_${digest}`;
  const dependencies = callback.dependencies?.source
    ? absoluteDependencyImports(callback.dependencies.source, callback.dependencies.resolveDir)
    : '';
  files[file] = `${dependencies}${dependencies ? '\n\n' : ''}export const callback = (${callback.source});\n`;
  imports.push(`import { callback as ${variable} } from './${file.replace(/\.ts$/, '.js')}';`);
  return variable;
}

function requiredCrd(graph: ApplicationGraph, id: string, owner: string): ApplicationCrdNode {
  const node = graph.nodes.find((candidate): candidate is ApplicationCrdNode => candidate.kind === 'crd' && candidate.id === id);
  if (!node) throw new Error(`Generated application Fetch gateway ${owner} references missing Kubernetes model ${id}.`);
  return node;
}

function absoluteDependencyImports(source: string, resolveDir: string): string {
  return source
    .replace(/(\bfrom\s+['"])(\.[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => `${prefix}${resolve(resolveDir, specifier)}${suffix}`)
    .replace(/(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g, (_match, line: string, prefix: string, specifier: string, suffix: string) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`);
}

function objectConfig(value: unknown): Readonly<Record<string, unknown>> {
  // typecast: the object/array guard establishes the compiler-owned JSON configuration record boundary.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringConfig(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function serializedCallbackConfig(
  config: Readonly<Record<string, unknown>>,
  prefix: string,
): ApplicationSerializedCallbackContract {
  const source = stringConfig(config[`${prefix}Source`]);
  if (!source) throw new Error(`Generated application Fetch gateway ${prefix} callback has no serialized source.`);
  const dependencies = objectConfig(config[`${prefix}Dependencies`]);
  const location = objectConfig(config[`${prefix}Location`]);
  const unresolved = config[`${prefix}Unresolved`];
  return {
    source,
    ...(stringConfig(dependencies.source) && stringConfig(dependencies.resolveDir)
      ? { dependencies: { source: stringConfig(dependencies.source), resolveDir: stringConfig(dependencies.resolveDir) } }
      : {}),
    ...(stringConfig(location.file) && Number.isSafeInteger(location.line) && Number.isSafeInteger(location.column)
      ? {
          location: {
            file: stringConfig(location.file),
            line: Number(location.line),
            column: Number(location.column),
          },
        }
      : {}),
    ...(Array.isArray(unresolved) && unresolved.every((value) => typeof value === 'string')
      ? { unresolved }
      : {}),
  };
}
