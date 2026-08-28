import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnyResourceDefinition, JsonValue, ResourceIndex } from '@applik8s/core';
import { applicationBuildSync, applicationTransformSync } from './application-build-tool.js';
import type { ApplicationRuntimeModelContract } from './application-models.js';
import type { SerializedApplicationServerRouteWithDependencies } from './application-route-source.js';
import { generatedServerRuntimeBundleContract } from './application-server-runtime-bundle.js';

interface GeneratedApplicationServerRouteModule {
  readonly route: SerializedApplicationServerRouteWithDependencies;
  readonly fileName: string;
  readonly exportName: string;
}
type SerializedApplicationServerCaptures = Readonly<Record<string, SerializedApplicationServerCapture>>;
type SerializedApplicationServerCapture =
  | { readonly kind: 'json'; readonly value: JsonValue }
  | { readonly kind: 'function'; readonly source: string; readonly aliasName?: string };

interface ApplicationRouteModuleBundle {
  readonly source: string;
  readonly inputs: readonly string[];
}

const applicationModulePath = fileURLToPath(import.meta.url);

function routeDiagnosticsContract() {
  // typecast: preserve literal diagnostic field names for generated route contract emission.
  return {
    routeFailureEvent: 'applik8s-server-route-failure',
    actionFailureEvent: 'applik8s-route-action-failure',
    failurePolicy: 'failClosed',
    partialEffects: 'unknownAfterActionStarted',
    sourceMaps: 'required',
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'],
  } as const;
}

export function kroSafeJavaScriptSourceBundle(bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(bundle).map(([fileName, source]) => [
    fileName,
    isJavaScriptSourceFile(fileName) ? lowerTemplateLiteralsForKro(fileName, source) : source,
  ]));
}

export function mountedConfigMapSourceBundle(bundle: Readonly<Record<string, string>>): { readonly data: Readonly<Record<string, string>>; readonly items: { key: string; path: string }[] } {
  const usedKeys = new Set<string>();
  const data: Record<string, string> = {};
  const items: { key: string; path: string }[] = [];

  for (const [fileName, source] of Object.entries(bundle)) {
    assertSafeConfigMapVolumePath(fileName);
    const key = configMapSourceKey(fileName, usedKeys);
    usedKeys.add(key);
    data[key] = source;
    items.push({ key, path: fileName });
  }

  return { data, items };
}

function configMapSourceKey(fileName: string, usedKeys: ReadonlySet<string>): string {
  const baseKey = fileName.replaceAll('/', '__').replace(/[^A-Za-z0-9._-]/g, '_') || 'source';
  let key = baseKey;
  let attempt = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey}-${attempt}`;
    attempt += 1;
  }
  return key;
}

function assertSafeConfigMapVolumePath(fileName: string): void {
  if (fileName.startsWith('/') || fileName.split('/').some((part) => part.length === 0 || part === '..')) {
    throw new Error(`Generated server source file ${JSON.stringify(fileName)} is not a safe ConfigMap volume path.`);
  }
}

function isJavaScriptSourceFile(fileName: string): boolean {
  return fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs');
}

function lowerTemplateLiteralsForKro(fileName: string, source: string): string {
  if (!source.includes('${')) {
    return source;
  }
  const diagnosticHeader = source.match(/^(?:\/\/ applik8s-route-[^\n]*\n)+/)?.[0] ?? '';
  const transformed = applicationTransformSync(source, {
    loader: 'js',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    minifyWhitespace: true,
    supported: { 'template-literal': false },
  }).code;
  const withoutComments = stripJavaScriptLineComments(stripJavaScriptBlockComments(transformed));
  const output = diagnosticHeader && !withoutComments.startsWith(diagnosticHeader) ? `${diagnosticHeader}${withoutComments}` : withoutComments;
  if (output.includes('${')) {
    const index = output.indexOf('${');
    const context = output.slice(Math.max(0, index - 80), index + 120).replace(/\s+/g, ' ');
    throw new Error(`Generated JavaScript source ${fileName} still contains raw \`\${\` after template lowering near ${JSON.stringify(context)}; KRO cannot embed it safely.`);
  }
  return output;
}

function stripJavaScriptLineComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '*' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function stripJavaScriptBlockComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'single' | 'double' | 'template' | 'regex' | undefined;
  let regexCharacterClass = false;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (!mode && character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += character;
    if (mode) {
      if (character === '\\') {
        index += 1;
        output += source[index] ?? '';
      } else if (mode === 'regex') {
        if (character === '[') {
          regexCharacterClass = true;
        } else if (character === ']') {
          regexCharacterClass = false;
        } else if (character === '/' && !regexCharacterClass) {
          mode = undefined;
        }
      } else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"') || (mode === 'template' && character === '`')) {
        mode = undefined;
      }
    } else if (character === "'") {
      mode = 'single';
    } else if (character === '"') {
      mode = 'double';
    } else if (character === '`') {
      mode = 'template';
    } else if (character === '/' && next !== '/' && canStartJavaScriptRegexLiteral(previousSignificantCharacter(output.slice(0, -1)))) {
      mode = 'regex';
      regexCharacterClass = false;
    }
    index += 1;
  }
  return output;
}

function previousSignificantCharacter(source: string): string | undefined {
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const character = source[index];
    if (character && !/\s/.test(character)) {
      return character;
    }
  }
  return undefined;
}

function canStartJavaScriptRegexLiteral(previous: string | undefined): boolean {
  return !previous || '({[=,:;!&|?+-*~^<>'.includes(previous);
}

export function generatedApplicationServerRouteModules(routes: readonly SerializedApplicationServerRouteWithDependencies[]): readonly GeneratedApplicationServerRouteModule[] {
  return routes.map((route) => ({
    route,
    fileName: `route-${route.id}.mjs`,
    exportName: `route_${route.id.replace(/[^A-Za-z0-9_$]/g, '_')}`,
  }));
}

export function bundleGeneratedApplicationServerSourceBundle(sourceFileName: string, bundle: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const tempDir = mkdtempSync(join(tmpdir(), 'applik8s-generated-server-'));
  try {
    for (const [fileName, source] of Object.entries(bundle)) {
      assertSafeConfigMapVolumePath(fileName);
      const target = join(tempDir, fileName);
      const targetDir = dirname(target);
      if (!existsSync(targetDir)) {
        mkdirpSync(targetDir);
      }
      writeFileSync(target, source, 'utf8');
    }
    return {
      ...Object.fromEntries(Object.entries(bundle).filter(([fileName]) => fileName !== sourceFileName)),
      ...bundleApplicationServerEntrypoint(sourceFileName, tempDir, bundle['routes.manifest.json']),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function mkdirpSync(path: string): void {
  if (existsSync(path)) {
    return;
  }
  mkdirpSync(dirname(path));
  mkdirSync(path);
}

function bundleApplicationServerEntrypoint(sourceFileName: string, sourceDir: string, routesManifest: string | undefined): Readonly<Record<string, string>> {
  const result = applicationBuildSync({
    entryPoints: [join(sourceDir, sourceFileName)],
    outfile: join(sourceDir, 'dist', sourceFileName),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    nodePaths: generatedServerBundleNodePaths(),
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    sourcemap: true,
    sourcesContent: false,
    write: false,
  });
  const files = Object.fromEntries(result.outputFiles.map((file) => [file.path.split('/').pop() ?? file.path, file.text]));
  const bundledSource = files[sourceFileName] ?? result.outputFiles.find((file) => !file.path.endsWith('.map'))?.text;
  const sourceMap = files[`${sourceFileName}.map`] ?? result.outputFiles.find((file) => file.path.endsWith('.map'))?.text;
  if (!bundledSource || !sourceMap) {
    throw new Error(`Generated server bundling did not produce ${sourceFileName} and ${sourceFileName}.map.`);
  }
  return {
    [sourceFileName]: bundledSource,
    [`${sourceFileName}.map`]: normalizeGeneratedServerSourceMap(sourceMap, sourceDir),
    'routes.manifest.json': routesManifest ?? '[]\n',
    'runtime.bundle.json': `${JSON.stringify(generatedServerRuntimeBundleContract(sourceFileName), null, 2)}\n`,
  };
}

function generatedServerBundleNodePaths(): string[] {
  return [
    join(process.cwd(), 'node_modules'),
    join(dirname(applicationModulePath), '..', 'node_modules'),
    join(dirname(applicationModulePath), '..', '..', '..', 'node_modules'),
  ];
}

function normalizeGeneratedServerSourceMap(sourceMap: string, sourceDir: string): string {
  const parsed: { sources?: unknown } = JSON.parse(sourceMap);
  if (Array.isArray(parsed.sources)) {
    parsed.sources = parsed.sources.map((source) => normalizeGeneratedServerSourcePath(source, sourceDir));
  }
  return `${JSON.stringify(parsed)}\n`;
}

function normalizeGeneratedServerSourcePath(source: string, sourceDir: string): string {
  if (source.startsWith(sourceDir)) {
    return relative(sourceDir, source).replaceAll('\\', '/');
  }
  const marker = 'applik8s-generated-server-';
  const markerIndex = source.indexOf(marker);
  if (markerIndex !== -1) {
    const slashIndex = source.indexOf('/', markerIndex);
    if (slashIndex !== -1) {
      return source.slice(slashIndex + 1);
    }
  }
  return source.replaceAll('\\', '/');
}

export function generatedApplicationServerHonoEntrypointSource(): string {
  return `
import { Hono } from 'hono';
import { createServer } from 'node:http';
import { Transform } from 'node:stream';
import { routes } from './routes.mjs';

const applik8sServerRuntime = 'hono';
const maxRequestBodyBytes = positiveInteger(process.env.APPLIK8S_HTTP_MAX_BODY_BYTES, 1048576);
const mutationRateLimitMax = positiveInteger(process.env.APPLIK8S_HTTP_MUTATION_RATE_LIMIT_MAX, 120);
const mutationRateLimitWindowMs = positiveInteger(process.env.APPLIK8S_HTTP_MUTATION_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000;
const mutationWindows = new Map();

const app = new Hono();

app.use('*', async (context, next) => {
  const contentLength = Number(context.req.header('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    return context.text('Request body exceeds ' + maxRequestBodyBytes + ' bytes.', 413);
  }
  if (context.req.method !== 'GET' && context.req.method !== 'HEAD' && context.req.method !== 'OPTIONS') {
    const now = Date.now();
    const url = new URL(context.req.url);
    const client = context.req.header('x-applik8s-remote-address') || 'unknown';
    const key = client + ':' + context.req.method + ':' + url.pathname;
    const current = mutationWindows.get(key);
    const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + mutationRateLimitWindowMs } : current;
    window.count += 1;
    mutationWindows.set(key, window);
    if (mutationWindows.size > 10000) {
      for (const [candidate, value] of mutationWindows) if (value.resetAt <= now) mutationWindows.delete(candidate);
    }
    if (window.count > mutationRateLimitMax) {
      return context.text('Too many mutation requests. Retry after the current rate-limit window.', 429, { 'retry-after': String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))) });
    }
  }
  await next();
});

for (const route of routes) {
  app.on(route.method, route.path, async (context) => {
    try {
      if (route.functionNative) {
        const unavailable = new Error(
          'Function-native HTTP route execution has not been materialized by the authenticated operation worker.',
        );
        unavailable.statusCode = 503;
        unavailable.diagnostic = {
          event: 'applik8s-function-native-http-worker-unavailable',
          routeId: route.id,
        };
        throw unavailable;
      }
      const url = new URL(context.req.url);
      const params = context.req.param();
      const form = await honoFormData(context.req);
      const result = await route.handler({
        params,
        query: { ...Object.fromEntries(url.searchParams.entries()), ...params },
        form,
        formData: async () => form,
      });
      return honoResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      const stack = error instanceof Error && error.stack ? error.stack.split('\\n').slice(0, 12) : undefined;
      const diagnostic = error && typeof error === 'object' && 'diagnostic' in error ? error.diagnostic : undefined;
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-route-failure', runtime: applik8sServerRuntime, route: routeDiagnostics(route), message, statusCode, diagnostic, ...(stack ? { stack } : {}) }));
      console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: route.observability.actions.failureEvent, runtime: applik8sServerRuntime, routeId: route.id, method: route.method, path: route.path, module: route.module, sourceLocation: route.sourceLocation, bundleInputs: route.bundleInputs, action: route.export, diagnostic, partialEffects: route.observability.actions.partialEffects, failurePolicy: route.observability.actions.failurePolicy, message, statusCode, ...(stack ? { stack } : {}) }));
      return context.text('Route ' + route.id + ' (' + route.method + ' ' + route.path + ') failed: ' + message, statusCode);
    }
  });
}

app.get('/-/healthz', (context) => context.json({ ok: true, component: 'applik8s-server' }));

app.notFound((context) => {
  const url = new URL(context.req.url);
  return context.text('No route for ' + context.req.method + ' ' + url.pathname, 404);
});

createServer(async (incoming, outgoing) => {
  try {
    const request = nodeRequestToFetchRequest(incoming);
    const response = await app.fetch(request);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', component: 'applik8s-server', event: 'applik8s-server-request-failure', runtime: applik8sServerRuntime, message }));
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    outgoing.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    outgoing.end(message);
  }
}).listen(8080, '0.0.0.0');

function nodeRequestToFetchRequest(request) {
  const host = request.headers.host || '127.0.0.1';
  const url = 'http://' + host + (request.url || '/');
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  headers.set('x-applik8s-remote-address', request.socket.remoteAddress || 'unknown');
  const method = request.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, { method, headers, ...(hasBody ? { body: boundedRequestBody(request), duplex: 'half' } : {}) });
}

function boundedRequestBody(request) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxRequestBodyBytes) {
        const error = new Error('Request body exceeds ' + maxRequestBodyBytes + ' bytes.');
        error.statusCode = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  return request.pipe(limiter);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function writeFetchResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      outgoing.end();
      return;
    }
    outgoing.write(Buffer.from(chunk.value));
  }
}

async function honoFormData(request) {
  let data;
  try {
    data = await request.raw.formData();
  } catch (_error) {
    data = new FormData();
  }
  return {
    string: (name) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    },
    enum(name, values) {
      const value = data.get(name);
      if (typeof value !== 'string' || !values.includes(value)) {
        throw new Error('Invalid form field ' + name + ': expected one of ' + values.join(', '));
      }
      return value;
    },
  };
}

function honoResponse(result) {
  if (result instanceof Response) {
    return result;
  }
  if (result && typeof result === 'object' && 'redirect' in result) {
    return new Response(null, { status: 303, headers: { location: String(result.redirect) } });
  }
  if (result && typeof result === 'object' && typeof result.html === 'string') {
    return new Response(result.html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response(JSON.stringify(result ?? null), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function routeDiagnostics(route) {
  return {
    id: route.id,
    method: route.method,
    path: route.path,
    module: route.module,
    sourceKind: route.sourceKind,
    sourceLocation: route.sourceLocation,
    bundleInputs: route.bundleInputs,
    diagnostics: route.diagnostics,
  };
}
`.trimStart();
}

export function generatedApplicationServerRoutesSource(routeModules: readonly GeneratedApplicationServerRouteModule[]): string {
  const imports = routeModules.map((module) => `import { ${module.exportName} } from './${module.fileName}';`).join('\n');
  const routeEntries = routeModules.map((module) => `  { ${routeRuntimeMetadataProperties(module)}, handler: ${module.exportName} }`).join(',\n');
  return `
${imports}

export const routes = [
${routeEntries}
];
`.trimStart();
}

export function routeManifestEntry(module: GeneratedApplicationServerRouteModule): object {
  return {
    id: module.route.id,
    method: module.route.method,
    path: module.route.path,
    module: module.fileName,
    export: module.exportName,
    sourceKind: module.route.handlerSourceKind ?? 'functionToString',
    sourceLocation: module.route.handlerSourceLocation ?? null,
    bundleInputs: routeBundleInputs(module),
    diagnostics: routeDiagnosticsContract(),
    observability: routeObservabilityEntry(),
    ...(module.route.functionNative
      ? { functionNative: routeFunctionNativeManifest(module.route) }
      : {}),
  };
}

function routeRuntimeMetadataProperties(module: GeneratedApplicationServerRouteModule): string {
  return [
    `id: ${JSON.stringify(module.route.id)}`,
    `method: ${JSON.stringify(module.route.method)}`,
    `path: ${JSON.stringify(module.route.path)}`,
    `module: ${JSON.stringify(module.fileName)}`,
    `export: ${JSON.stringify(module.exportName)}`,
    `sourceKind: ${JSON.stringify(module.route.handlerSourceKind ?? 'functionToString')}`,
    `sourceLocation: ${JSON.stringify(module.route.handlerSourceLocation ?? null)}`,
    `bundleInputs: ${JSON.stringify(routeBundleInputs(module))}`,
    `diagnostics: ${JSON.stringify(routeDiagnosticsContract())}`,
    `observability: ${JSON.stringify(routeObservabilityEntry())}`,
    ...(module.route.functionNative
      ? [
          `functionNative: ${JSON.stringify(
            routeFunctionNativeManifest(module.route),
          )}`,
        ]
      : []),
  ].join(', ');
}

function routeFunctionNativeManifest(
  route: SerializedApplicationServerRouteWithDependencies,
): object {
  const functionNative = route.functionNative;
  if (!functionNative) return {};
  return {
    input: functionNative.input,
    output: functionNative.output,
    idempotency: {
      source: 'http-idempotency-key',
      contextScoped: true,
    },
    requestBoundary: {
      durableValues: 'schema-normalized-only',
      rawRequestCapture: 'rejected',
      principal: 'framework-authenticated',
    },
    transaction: Boolean(functionNative.transaction),
  };
}

function routeObservabilityEntry(): object {
  return {
    logs: { format: 'json', component: 'applik8s-server', failureEvent: 'applik8s-server-route-failure' },
    actions: { failureEvent: 'applik8s-route-action-failure', partialEffects: 'unknownAfterActionStarted', failurePolicy: 'failClosed' },
    metrics: { hooks: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    sourceMaps: 'required',
  };
}

function routeBundleInputs(module: GeneratedApplicationServerRouteModule): readonly string[] {
  const source = module.route.handlerDependencySource;
  if (!source) {
    return [];
  }
  const bundled = bundledApplicationServerRouteModuleSource(module, '');
  return bundled.inputs.map((input) => input.split('/').pop() ?? input);
}

export function generatedApplicationServerBindingsSource(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const resourceBindings = Object.keys(resources).map((name) => `const ${name} = resourceClients[${JSON.stringify(name)}];`).join('\n');
  const indexBindings = Object.keys(indexes).map((name) => `const ${name} = indexClients[${JSON.stringify(name)}];`).join('\n');
  const modelBindings = Object.keys(models).map((name) => `const ${name} = modelClients[${JSON.stringify(name)}];`).join('\n');
  const captureBindings = generatedApplicationServerCaptureBindings(captures);
  const exports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  return `
import { createRuntimeBindings } from './runtime.mjs';

const { resourceClients, indexClients, modelClients } = createRuntimeBindings();
${resourceBindings}
${indexBindings}
${modelBindings}
${captureBindings}

${exports.length > 0 ? `export { ${exports.join(', ')} };` : 'export {};'}
`.trimStart();
}

export function generatedApplicationServerRouteModuleSource(
  module: GeneratedApplicationServerRouteModule,
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): string {
  const imports = generatedApplicationServerBindingNames(resources, indexes, models, captures);
  const sourceLocation = module.route.handlerSourceLocation ? `${module.route.handlerSourceLocation.file}:${module.route.handlerSourceLocation.line}:${module.route.handlerSourceLocation.column}` : 'unavailable';
  const bindingImport = imports.length > 0 ? `import { ${imports.join(', ')} } from './bindings.mjs';\n` : '';
  const bundledRoute = module.route.handlerDependencySource ? bundledApplicationServerRouteModuleSource(module, bindingImport) : undefined;
  const routeSource = bundledRoute
    ? bundledRoute.source
    : `
// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}
// applik8s-route-source-location: ${sourceLocation}
${bindingImport}
export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart();
  const header = `// applik8s-route-source-kind: ${module.route.handlerSourceKind ?? 'functionToString'}\n// applik8s-route-source-location: ${sourceLocation}\n${bundledRoute ? `// applik8s-route-bundle-inputs: ${bundledRoute.inputs.map((input) => input.split('/').pop() ?? input).join(', ')}\n` : ''}`;
  return routeSource.startsWith('// applik8s-route-source-kind:') ? routeSource : `${header}${routeSource}`;
}

function bundledApplicationServerRouteModuleSource(module: GeneratedApplicationServerRouteModule, bindingImport: string): ApplicationRouteModuleBundle {
  const result = applicationBuildSync({
    stdin: {
      contents: `
${module.route.handlerDependencySource ?? ''}

export const ${module.exportName} = (${module.route.handlerSource});
`.trimStart(),
      resolveDir: module.route.handlerDependencyResolveDir ?? process.cwd(),
      sourcefile: `${module.fileName}.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minifySyntax: true,
    supported: { 'template-literal': false },
    metafile: true,
    sourcemap: false,
    write: false,
  });
  const bundled = result.outputFiles[0]?.text;
  if (!bundled) {
    throw new Error(`Generated server route bundling did not produce ${module.fileName}.`);
  }
  return { source: `${bindingImport}${bundled}`, inputs: Object.keys(result.metafile?.inputs ?? {}) };
}

function generatedApplicationServerBindingNames(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures
): readonly string[] {
  const names = new Set<string>([...Object.keys(resources), ...Object.keys(indexes), ...Object.keys(models), ...Object.keys(captures)]);
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      names.add(capture.aliasName);
    }
  }
  return [...names];
}

function generatedApplicationServerCaptureBindings(captures: SerializedApplicationServerCaptures): string {
  const bindings = ['const captures = {};'];
  for (const [name, capture] of Object.entries(captures)) {
    const expression = capture.kind === 'json' ? JSON.stringify(capture.value) : `(${capture.source})`;
    bindings.push(`const ${name} = captures[${JSON.stringify(name)}] = ${expression};`);
    if (capture.kind === 'function' && capture.aliasName) {
      bindings.push(`const ${capture.aliasName} = ${name};`);
    }
  }
  return bindings.join('\n');
}
