import type { AnyResourceDefinition, ResourceIndex } from '@applik8s/core';
import type { ApplicationRuntimeModelContract } from './application-models.js';

interface ApplicationServerRuntimeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
  readonly scope: 'Namespaced' | 'Cluster';
}

interface ApplicationRuntimeIndexBackend {
  readonly kind: 'valkey';
  readonly host: string;
  readonly port: number;
}

interface ApplicationServerRuntimeIndex {
  readonly name: string;
  readonly resource: ApplicationServerRuntimeResource;
  readonly options: ResourceIndex<object, object>['options'];
  readonly backend?: ApplicationRuntimeIndexBackend;
}

export function generatedApplicationServerRuntimeSource(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): string {
  const resourceTable = JSON.stringify(runtimeResourceTable(resources));
  const indexTable = JSON.stringify(runtimeIndexTable(indexes, indexBackend, cache));
  const modelTable = JSON.stringify(models);
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
${Object.keys(models).length > 0 ? `import { createPostgresModelClient } from './runtime/transactional-database-postgres.mjs';` : ''}

const runtimeResources = ${resourceTable};
const runtimeIndexes = ${indexTable};
const runtimeModels = ${modelTable};

export function createRuntimeBindings() {
  return {
    resourceClients: Object.fromEntries(Object.entries(runtimeResources).map(([name, resource]) => [name, createResourceClient(resource)])),
    indexClients: Object.fromEntries(Object.entries(runtimeIndexes).map(([name, index]) => [name, createIndexClient(index)])),
    modelClients: Object.fromEntries(Object.entries(runtimeModels).map(([name, model]) => [name, createPostgresModelClient(model)])),
  };
}

export async function formData(request) {
  const body = await readBody(request);
  const params = new URLSearchParams(body);
  return {
    string: (name) => params.get(name) ?? '',
    enum(name, values) {
      const value = params.get(name) ?? '';
      if (!values.includes(value)) {
        throw new Error('Invalid form field ' + name + ': expected one of ' + values.join(', '));
      }
      return value;
    },
  };
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function createResourceClient(resource) {
  return {
    async create(input) {
      const object = asKubernetesObject(resource, input);
      return kubernetesRequest({ method: 'POST', path: collectionPath(resource, object.metadata?.namespace), body: object });
    },
    async get(query) {
      try {
        return await kubernetesRequest({ method: 'GET', path: objectPath(resource, query.namespace, query.name) });
      } catch (error) {
        if (error && typeof error === 'object' && error.statusCode === 404) {
          return undefined;
        }
        throw error;
      }
    },
    async query(query = {}) {
      const response = await kubernetesRequest({ method: 'GET', path: listPath(resource, query) });
      const items = Array.isArray(response.items) ? response.items : [];
      return { items: sortItems(items, query.orderBy), continueToken: response.metadata?.continue };
    },
    async patch(query, patch) {
      return kubernetesRequest({ method: 'PATCH', path: objectPath(resource, query.namespace, query.name), body: patch, contentType: 'application/json-patch+json' });
    },
    async delete(query) {
      await kubernetesRequest({ method: 'DELETE', path: objectPath(resource, query.namespace, query.name) });
      return { ref: { apiVersion: resource.apiVersion, kind: resource.kind, name: query.name, namespace: query.namespace }, deleted: true };
    },
    async increment(input) {
      return bufferResourceCounterIncrement(resource, input);
    },
  };
}

const resourceCounterBuffers = new Map();
let resourceCounterFlushTimer;
let resourceCounterFlushInFlight = false;

function bufferResourceCounterIncrement(resource, input) {
  if (!input || !input.name) {
    throw new Error(resource.kind + '.increment(...) requires a resource name.');
  }
  const amount = Number(input.amount ?? 1);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(resource.kind + '.increment(...) amount must be a positive finite number.');
  }
  const field = input.field || 'spec.count';
  const key = JSON.stringify({ apiVersion: resource.apiVersion, kind: resource.kind, namespace: input.namespace || defaultNamespace(), name: input.name, field });
  const existing = resourceCounterBuffers.get(key);
  const entry = existing || { resource, input: { ...input, field }, pending: 0 };
  entry.input = { ...entry.input, ...input, field };
  entry.pending += amount;
  resourceCounterBuffers.set(key, entry);
  ensureResourceCounterFlushTimer(input.flushMs);
  return { buffered: true, pending: entry.pending };
}

function ensureResourceCounterFlushTimer(flushMs) {
  if (resourceCounterFlushTimer) {
    return;
  }
  const interval = Number.isFinite(Number(flushMs)) && Number(flushMs) > 0 ? Number(flushMs) : 1000;
  resourceCounterFlushTimer = setInterval(() => {
    flushResourceCounterBuffers().catch((error) => {
      console.error(JSON.stringify({ event: 'applik8s-server-counter-flush-failure', message: error instanceof Error ? error.message : String(error) }));
    });
  }, interval);
  resourceCounterFlushTimer.unref?.();
}

async function flushResourceCounterBuffers() {
  if (resourceCounterFlushInFlight || resourceCounterBuffers.size === 0) {
    return;
  }
  resourceCounterFlushInFlight = true;
  const entries = [...resourceCounterBuffers.entries()];
  for (const [key, entry] of entries) {
    resourceCounterBuffers.delete(key);
  }
  try {
    const results = await Promise.allSettled(entries.map(([, entry]) => flushResourceCounterBuffer(entry)));
    const failures = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue;
      }
      const [key, failedEntry] = entries[index];
      const current = resourceCounterBuffers.get(key);
      if (current) {
        current.pending += failedEntry.pending;
      } else {
        resourceCounterBuffers.set(key, failedEntry);
      }
      failures.push(result.reason);
    }
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; '));
    }
  } finally {
    resourceCounterFlushInFlight = false;
  }
}

async function flushResourceCounterBuffer(entry) {
  const { resource, input, pending } = entry;
  const field = input.field || 'spec.count';
  const query = { name: input.name, namespace: input.namespace };
  try {
    const current = await kubernetesRequest({ method: 'GET', path: objectPath(resource, query.namespace, query.name) });
    const currentValue = valueAtPath(current, field);
    const nextValue = Number(currentValue ?? 0) + pending;
    const operation = currentValue === undefined ? 'add' : 'replace';
    await kubernetesRequest({ method: 'PATCH', path: objectPath(resource, query.namespace, query.name), body: [{ op: operation, path: jsonPointerForPath(field), value: nextValue }], contentType: 'application/json-patch+json' });
  } catch (error) {
    if (!error || typeof error !== 'object' || error.statusCode !== 404) {
      throw error;
    }
    const object = asKubernetesObject(resource, {
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: input.annotations,
      spec: input.spec || {},
    });
    const currentValue = valueAtPath(object, field);
    setValueAtPath(object, field, Number(currentValue ?? 0) + pending);
    await kubernetesRequest({ method: 'POST', path: collectionPath(resource, object.metadata?.namespace), body: object });
  }
}

function jsonPointerForPath(path) {
  return '/' + path.split('.').map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

function setValueAtPath(source, path, value) {
  const parts = path.split('.');
  let current = source;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

process.once('SIGTERM', () => {
  flushResourceCounterBuffers().finally(() => process.exit(0));
});

function createIndexClient(index) {
  return {
    async query(partition, query = {}) {
      const labels = indexLabels(index, partition);
      if (Object.keys(labels).length === 0) {
        throw new Error('Index ' + index.name + ' cannot be queried from a request path without a label partition or label filter.');
      }
      if (index.backend?.kind === 'valkey') {
        return queryValkeyIndex(index, partition, query);
      }
      const response = await kubernetesRequest({ method: 'GET', path: listPath(index.resource, { ...query, labels }) });
      const filtered = applyIndexFilter(Array.isArray(response.items) ? response.items : [], index.options.filter);
      const ordered = sortIndexedItems(filtered, index.options.orderBy);
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = query.limit ?? ordered.length;
      const items = ordered.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      const nextCursor = nextOffset < ordered.length ? String(nextOffset) : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
  };
}

async function queryValkeyIndex(index, partition, query) {
  const namespace = query.namespace || defaultNamespace();
  const offset = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? 50;
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const stop = start + Math.max(1, limit) - 1;
  const key = valkeyPartitionKey(index, namespace, partition);
  const descending = index.options.orderBy?.direction === 'desc';
  const members = await valkeyCommand(index.backend, descending ? ['ZREVRANGE', key, String(start), String(stop)] : ['ZRANGE', key, String(start), String(stop)]);
  if (!Array.isArray(members) || members.length === 0) {
    return { items: [] };
  }
  const objectKeys = members.map((member) => valkeyObjectKey(index, String(member)));
  const objects = await valkeyCommand(index.backend, ['MGET', ...objectKeys]);
  const items = (Array.isArray(objects) ? objects : []).map((value) => value ? JSON.parse(String(value)) : undefined).filter(Boolean);
  const nextCursor = items.length === limit ? String(start + items.length) : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function valkeyPartitionKey(index, namespace, partition) {
  return 'applik8s:index:' + index.name + ':partition:' + namespace + ':' + String(partition);
}

function valkeyObjectKey(index, member) {
  return 'applik8s:index:' + index.name + ':object:' + member;
}

function indexLabels(index, partition) {
  const labels = {};
  const partitionExpression = index.options.partitionBy;
  if (partitionExpression?.expressionKind === 'label') {
    labels[partitionExpression.value] = String(partition);
  }
  const filter = index.options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    labels[filter.left.value] = String(filter.right);
  }
  return labels;
}

function applyIndexFilter(items, filter) {
  if (!filter || filter.expressionKind !== 'predicate' || filter.operator !== 'eq') {
    return items;
  }
  if (filter.left?.expressionKind === 'label') {
    return items.filter((item) => item.metadata?.labels?.[filter.left.value] === String(filter.right));
  }
  if (filter.left?.expressionKind === 'field') {
    return items.filter((item) => valueAtPath(item, filter.left.value) === filter.right);
  }
  return items;
}

function valueAtPath(source, path) {
  return path.split('.').reduce((current, part) => current && typeof current === 'object' ? current[part] : undefined, source);
}

function sortIndexedItems(items, orderBy) {
  if (!orderBy || orderBy.expressionKind !== 'ordering') {
    return items;
  }
  const path = orderBy.expression?.value;
  const direction = orderBy.direction === 'desc' ? -1 : 1;
  return [...items].sort((left, right) => String(valueAtPath(left, path) || '').localeCompare(String(valueAtPath(right, path) || '')) * direction);
}

function asKubernetesObject(resource, input) {
  if (input && typeof input === 'object' && input.apiVersion && input.kind && input.metadata) {
    return input;
  }
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: {
      name: input.name,
      ...(input.namespace ? { namespace: input.namespace } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.annotations ? { annotations: input.annotations } : {}),
    },
    spec: input.spec,
  };
}

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labels) {
    params.set('labelSelector', Object.entries(query.labels).map(([key, value]) => key + '=' + value).join(','));
  } else if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.fieldSelector) {
    params.set('fieldSelector', query.fieldSelector);
  }
  if (query.limit) {
    params.set('limit', String(query.limit));
  }
  if (query.continueToken) {
    params.set('continue', query.continueToken);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  const expressions = (selector.matchExpressions || []).map((expression) => {
    if (expression.operator === 'Exists' || expression.operator === 'DoesNotExist') {
      return expression.operator === 'DoesNotExist' ? '!' + expression.key : expression.key;
    }
    return expression.key + ' ' + (expression.operator === 'In' ? 'in' : 'notin') + ' (' + (expression.values || []).join(',') + ')';
  });
  return [...labels, ...expressions].join(',');
}

function sortItems(items, orderBy) {
  if (orderBy === 'metadata.name') {
    return [...items].sort((left, right) => String(left.metadata?.name || '').localeCompare(String(right.metadata?.name || '')));
  }
  if (orderBy === 'metadata.creationTimestamp') {
    return [...items].sort((left, right) => String(left.metadata?.creationTimestamp || '').localeCompare(String(right.metadata?.creationTimestamp || '')));
  }
  return items;
}

function collectionPath(resource, namespace) {
  const prefix = apiPrefix(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return prefix + '/namespaces/' + encodeURIComponent(namespace || defaultNamespace()) + '/' + encodeURIComponent(resource.plural);
  }
  return prefix + '/' + encodeURIComponent(resource.plural);
}

function objectPath(resource, namespace, name) {
  return collectionPath(resource, namespace) + '/' + encodeURIComponent(name);
}

function apiPrefix(apiVersion) {
  if (!apiVersion.includes('/')) {
    return '/api/' + encodeURIComponent(apiVersion);
  }
  const [group, version] = apiVersion.split('/');
  return '/apis/' + encodeURIComponent(group) + '/' + encodeURIComponent(version);
}

function defaultNamespace() {
  return process.env.APPLIK8S_SERVER_NAMESPACE || 'default';
}

async function kubernetesRequest({ method, path, body, contentType = 'application/json' }) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(payload ? { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, data }));
    });
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
  const parsed = response.data ? JSON.parse(response.data) : undefined;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(parsed?.message || 'Kubernetes request failed with HTTP ' + response.statusCode);
    error.statusCode = response.statusCode;
    throw error;
  }
  return parsed;
}

async function valkeyCommand(backend, parts) {
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: backend.host, port: backend.port }, () => {
      socket.write(encodeResp(parts));
    });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      try {
        const parsed = parseResp(buffer);
        socket.end();
        resolve(parsed.value);
      } catch (error) {
        if (!(error instanceof IncompleteRespError)) {
          socket.destroy();
          reject(error);
        }
      }
    });
    socket.on('error', reject);
  });
  return response;
}

function encodeResp(parts) {
  return '*' + parts.length + '\\r\\n' + parts.map((part) => {
    const value = String(part);
    return '$' + Buffer.byteLength(value) + '\\r\\n' + value + '\\r\\n';
  }).join('');
}

class IncompleteRespError extends Error {}

function parseResp(input, offset = 0) {
  if (offset >= input.length) {
    throw new IncompleteRespError('Incomplete RESP value');
  }
  const type = input[offset];
  const lineEnd = input.indexOf('\\r\\n', offset);
  if (lineEnd === -1) {
    throw new IncompleteRespError('Incomplete RESP line');
  }
  const line = input.slice(offset + 1, lineEnd);
  const next = lineEnd + 2;
  if (type === '+') {
    return { value: line, offset: next };
  }
  if (type === ':') {
    return { value: Number(line), offset: next };
  }
  if (type === '-') {
    throw new Error(line);
  }
  if (type === '$') {
    const length = Number(line);
    if (length < 0) {
      return { value: undefined, offset: next };
    }
    const end = next + length;
    if (input.length < end + 2) {
      throw new IncompleteRespError('Incomplete RESP bulk string');
    }
    return { value: input.slice(next, end), offset: end + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    const values = [];
    let current = next;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(input, current);
      values.push(parsed.value);
      current = parsed.offset;
    }
    return { value: values, offset: current };
  }
  throw new Error('Unsupported RESP type ' + type);
}

export function writeResponse(response, result) {
  if (result && typeof result === 'object' && 'redirect' in result) {
    response.writeHead(303, { location: String(result.redirect) });
    response.end();
    return;
  }
  if (result && typeof result === 'object' && typeof result.html === 'string') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(result.html);
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(result ?? null));
}
`.trimStart();
}

function runtimeResourceTable(resources: Readonly<Record<string, AnyResourceDefinition>>): Readonly<Record<string, ApplicationServerRuntimeResource>> {
  // typecast: Object.fromEntries loses the keyed resource metadata shape, but each entry is built from AnyResourceDefinition fields above.
  return Object.fromEntries(Object.entries(resources).map(([name, resource]) => [name, {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    plural: resource.plural,
    scope: resource.scope,
  }])) as Readonly<Record<string, ApplicationServerRuntimeResource>>;
}

export function runtimeIndexTable(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, backend: ApplicationRuntimeIndexBackend | undefined, cache: readonly ResourceIndex<object, object>[]): Readonly<Record<string, ApplicationServerRuntimeIndex>> {
  const cached = new Set(cache);
  // typecast: Object.fromEntries loses the keyed index metadata shape, but each entry is built from ResourceIndex fields above.
  return Object.fromEntries(Object.entries(indexes).map(([name, index]) => [name, {
    name: index.name,
    resource: index.resource,
    options: index.options,
    ...(cached.has(index) && backend ? { backend } : {}),
  }])) as Readonly<Record<string, ApplicationServerRuntimeIndex>>;
}
