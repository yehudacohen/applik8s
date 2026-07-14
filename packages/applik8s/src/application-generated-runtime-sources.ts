import type { ResourceIndex } from '@applik8s/core';

export interface ApplicationServerRuntimeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
  readonly scope: 'Namespaced' | 'Cluster';
}

export interface ApplicationServerRuntimeIndex {
  readonly name: string;
  readonly resource: ApplicationServerRuntimeResource;
  readonly options: ResourceIndex<object, object>['options'];
  readonly backend?: { readonly kind: 'valkey'; readonly host: string; readonly port: number };
}

export function generatedApplicationAggregateSource(request: {
  readonly name: string;
  readonly source: ApplicationServerRuntimeResource;
  readonly sourceOptions: ResourceIndex<object, object>['options'];
  readonly target: ApplicationServerRuntimeResource;
  readonly targetName: string;
  readonly targetNamespace?: string;
  readonly initial: object;
  readonly reduceSource: string;
  readonly statusSource: string;
  readonly flushEveryMs: number;
  readonly maxEvents: number;
}): string {
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

const aggregateName = ${JSON.stringify(request.name)};
const sourceResource = ${JSON.stringify(request.source)};
const sourceOptions = ${JSON.stringify(request.sourceOptions)};
const targetResource = ${JSON.stringify(request.target)};
const targetName = ${JSON.stringify(request.targetName)};
const targetNamespace = ${JSON.stringify(request.targetNamespace ?? null)};
const initialStats = ${JSON.stringify(request.initial)};
const flushEveryMs = ${request.flushEveryMs};
const maxEvents = ${request.maxEvents};
const reduce = (${request.reduceSource});
const status = (${request.statusSource});
const objectStore = new Map();
let stats = structuredClone(initialStats);
let pendingEvents = 0;
let flushing = false;

void startWatchLoop();
setInterval(() => {
  flushAggregate().catch((error) => logError('flush-failed', error));
}, flushEveryMs);

async function syncAggregate() {
  const response = await kubernetesRequest({ method: 'GET', path: listPath(sourceResource, { namespace: aggregateNamespace(), labelSelector: pushdownLabelSelector(sourceOptions) }) });
  stats = structuredClone(initialStats);
  objectStore.clear();
  for (const item of Array.isArray(response.items) ? response.items : []) {
    applySnapshotObject(item);
  }
  await flushAggregate(true);
  return response.metadata?.resourceVersion;
}

async function startWatchLoop() {
  let resourceVersion;
  for (;;) {
    try {
      resourceVersion = resourceVersion ?? await syncAggregate();
      resourceVersion = await watchAggregate(resourceVersion) ?? await syncAggregate();
    } catch (error) {
      logError('watch-failed', error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      resourceVersion = undefined;
    }
  }
}

async function watchAggregate(resourceVersion) {
  const response = await kubernetesRequest({ method: 'GET', path: listPath(sourceResource, { namespace: aggregateNamespace(), labelSelector: pushdownLabelSelector(sourceOptions), watch: true, resourceVersion }), stream: true });
  let latestResourceVersion = resourceVersion;
  let buffer = '';
  response.setEncoding('utf8');
  for await (const chunk of response) {
    buffer += chunk;
    const lines = buffer.split('\\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line);
      if (event.type === 'BOOKMARK') {
        continue;
      }
      latestResourceVersion = event.object?.metadata?.resourceVersion ?? latestResourceVersion;
      applySourceObject(event.type, event.object);
      if (pendingEvents >= maxEvents) {
        await flushAggregate();
      }
    }
  }
  return latestResourceVersion;
}

function applyAggregateEvent(event) {
  stats = reduce(stats, event);
  pendingEvents += 1;
  return stats;
}

function applySnapshotObject(item) {
  if (!sourceObjectMatches(item)) {
    return;
  }
  const key = objectKey(item);
  if (!key) {
    return;
  }
  applyAggregateEvent({ type: 'created', object: item, previous: undefined });
  objectStore.set(key, item);
}

function applySourceObject(kubernetesEventType, item) {
  if (!item) {
    return;
  }
  const key = objectKey(item);
  if (!key) {
    return;
  }
  const previous = objectStore.get(key);
  if (kubernetesEventType === 'DELETED') {
    if (!previous) {
      return;
    }
    applyAggregateEvent({ type: 'deleted', object: item, previous });
    objectStore.delete(key);
    return;
  }
  if (!sourceObjectMatches(item)) {
    if (previous) {
      applyAggregateEvent({ type: 'deleted', object: item, previous });
      objectStore.delete(key);
    }
    return;
  }
  applyAggregateEvent({ type: previous ? 'updated' : 'created', object: item, previous });
  objectStore.set(key, item);
}

async function flushAggregate(force = false) {
  if (flushing || (!force && pendingEvents === 0)) {
    return;
  }
  flushing = true;
  try {
    const nextStatus = status(stats);
    await patchTargetStatus(nextStatus);
    pendingEvents = 0;
  } finally {
    flushing = false;
  }
}

async function patchTargetStatus(nextStatus) {
  if (!nextStatus || typeof nextStatus !== 'object' || Array.isArray(nextStatus)) {
    throw new Error('Aggregate status mapper must return an object.');
  }
  return kubernetesRequest({
    method: 'PATCH',
    path: objectPath(targetResource, targetNamespace ?? aggregateNamespace(), targetName) + '/status',
    body: { status: nextStatus },
      contentType: 'application/merge-patch+json',
  });
}

function aggregateNamespace() {
  return process.env.APPLIK8S_AGGREGATE_NAMESPACE || 'default';
}

function sourceObjectMatches(item) {
  return applyIndexFilter([item], sourceOptions.filter).length === 1;
}

function objectKey(item) {
  const name = item.metadata?.name;
  if (!name) {
    return undefined;
  }
  return (item.metadata?.namespace || aggregateNamespace()) + '/' + name;
}

function pushdownLabelSelector(options) {
  const filter = options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    return { matchLabels: { [filter.left.value]: String(filter.right) } };
  }
  return undefined;
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

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.watch) {
    params.set('watch', 'true');
  }
  if (query.resourceVersion) {
    params.set('resourceVersion', query.resourceVersion);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  return labels.join(',');
}

function collectionPath(resource, namespace) {
  const groupPath = apiGroupPath(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return groupPath + '/namespaces/' + encodeURIComponent(namespace) + '/' + resource.plural;
  }
  return groupPath + '/' + resource.plural;
}

function objectPath(resource, namespace, name) {
  return collectionPath(resource, namespace) + '/' + encodeURIComponent(name);
}

function apiGroupPath(apiVersion) {
  if (apiVersion.includes('/')) {
    const [group, version] = apiVersion.split('/');
    return '/apis/' + group + '/' + version;
  }
  return '/api/' + apiVersion;
}

async function kubernetesRequest(options) {
  const token = (await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8')).trim();
  const namespace = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').catch(() => 'default');
  const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  const path = options.path.replace(/__NAMESPACE__/g, namespace.trim());
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      method: options.method,
      host,
      port,
      path,
      rejectUnauthorized: false,
      headers: {
        authorization: 'Bearer ' + token,
        accept: options.stream ? 'application/json' : 'application/json',
        ...(options.body ? { 'content-type': options.contentType || 'application/json' } : {}),
      },
    }, (response) => {
      if (options.stream) {
        if ((response.statusCode || 0) >= 400) {
          reject(new Error('Kubernetes watch failed with HTTP ' + response.statusCode));
          return;
        }
        resolve(response);
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if ((response.statusCode || 0) >= 400) {
          reject(new Error(body || 'Kubernetes request failed with HTTP ' + response.statusCode));
          return;
        }
        resolve(body ? JSON.parse(body) : {});
      });
    });
    request.on('error', reject);
    if (options.body) {
      request.write(JSON.stringify(options.body));
    }
    request.end();
  });
}

function logError(event, error) {
  console.error(JSON.stringify({ level: 'error', component: 'applik8s-aggregate', aggregate: aggregateName, event, message: error instanceof Error ? error.message : String(error) }));
}
`.trimStart();
}

export function generatedValkeyIndexerSource(indexes: Readonly<Record<string, ApplicationServerRuntimeIndex>>): string {
  return `
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';

const runtimeIndexes = ${JSON.stringify(indexes)};
const syncIntervalMs = Number(process.env.APPLIK8S_INDEX_SYNC_INTERVAL_MS || 5000);

await syncAllIndexes();
for (const index of Object.values(runtimeIndexes)) {
  startWatchLoop(index);
}
setInterval(() => {
  syncAllIndexes().catch((error) => {
    console.error(JSON.stringify({ level: 'error', component: 'applik8s-indexer', message: error instanceof Error ? error.message : String(error) }));
  });
}, syncIntervalMs).unref();

process.stdin.resume();

async function syncAllIndexes() {
  for (const index of Object.values(runtimeIndexes)) {
    await syncIndex(index);
  }
}

async function syncIndex(index) {
  if (index.backend?.kind !== 'valkey') {
    return;
  }
  const namespace = defaultNamespace();
  const response = await kubernetesRequest({ method: 'GET', path: listPath(index.resource, { namespace, labelSelector: pushdownLabelSelector(index) }) });
  const items = applyIndexFilter(Array.isArray(response.items) ? response.items : [], index.options.filter);
  const partitioned = new Map();
  for (const item of items) {
    const partition = indexPartition(index, item);
    if (!partition) {
      continue;
    }
    const member = itemMember(item);
    if (!member) {
      continue;
    }
    const current = partitioned.get(partition) || [];
    current.push({ item, member, score: indexScore(index, item) });
    partitioned.set(partition, current);
  }
  const partitionsKey = valkeyPartitionsKey(index, namespace);
  const oldPartitions = await valkeyCommand(index.backend, ['SMEMBERS', partitionsKey]);
  for (const partition of Array.isArray(oldPartitions) ? oldPartitions : []) {
    await valkeyCommand(index.backend, ['DEL', valkeyPartitionKey(index, namespace, String(partition))]);
  }
  await valkeyCommand(index.backend, ['DEL', partitionsKey]);
  for (const [partition, entries] of partitioned.entries()) {
    const partitionKey = valkeyPartitionKey(index, namespace, partition);
    await valkeyCommand(index.backend, ['SADD', partitionsKey, partition]);
    for (const entry of entries) {
      await valkeyCommand(index.backend, ['SET', valkeyObjectKey(index, entry.member), JSON.stringify(entry.item)]);
      await valkeyCommand(index.backend, ['ZADD', partitionKey, String(entry.score), entry.member]);
    }
  }
  console.log(JSON.stringify({ level: 'info', component: 'applik8s-indexer', index: index.name, partitions: partitioned.size, items: items.length }));
  return response.metadata?.resourceVersion;
}

function startWatchLoop(index) {
  if (index.backend?.kind !== 'valkey') {
    return;
  }
  void (async () => {
    let resourceVersion;
    for (;;) {
      try {
        resourceVersion = await syncIndex(index);
        await watchIndex(index, resourceVersion);
      } catch (error) {
        console.error(JSON.stringify({ level: 'error', component: 'applik8s-indexer', index: index.name, message: error instanceof Error ? error.message : String(error) }));
        await sleep(2000);
      }
    }
  })();
}

async function watchIndex(index, resourceVersion) {
  const namespace = defaultNamespace();
  const path = listPath(index.resource, { namespace, labelSelector: pushdownLabelSelector(index), watch: true, resourceVersion });
  await kubernetesWatch({ method: 'GET', path }, async (event) => {
    if (!event || event.type === 'BOOKMARK') {
      return;
    }
    const object = event.object;
    if (!object) {
      return;
    }
    if (event.type === 'DELETED') {
      await removeIndexedItem(index, object);
      return;
    }
    if (event.type === 'ADDED' || event.type === 'MODIFIED') {
      await upsertIndexedItem(index, object);
    }
  });
}

async function upsertIndexedItem(index, item) {
  const member = itemMember(item);
  if (!member) {
    return;
  }
  await removeIndexedMember(index, item.metadata?.namespace || defaultNamespace(), member);
  if (applyIndexFilter([item], index.options.filter).length === 0) {
    return;
  }
  const partition = indexPartition(index, item);
  if (!partition) {
    return;
  }
  const namespace = item.metadata?.namespace || defaultNamespace();
  await valkeyCommand(index.backend, ['SET', valkeyObjectKey(index, member), JSON.stringify(item)]);
  await valkeyCommand(index.backend, ['SADD', valkeyPartitionsKey(index, namespace), partition]);
  await valkeyCommand(index.backend, ['ZADD', valkeyPartitionKey(index, namespace, partition), String(indexScore(index, item)), member]);
}

async function removeIndexedItem(index, item) {
  const member = itemMember(item);
  if (!member) {
    return;
  }
  await removeIndexedMember(index, item.metadata?.namespace || defaultNamespace(), member);
}

async function removeIndexedMember(index, namespace, member) {
  const partitions = await valkeyCommand(index.backend, ['SMEMBERS', valkeyPartitionsKey(index, namespace)]);
  for (const partition of Array.isArray(partitions) ? partitions : []) {
    await valkeyCommand(index.backend, ['ZREM', valkeyPartitionKey(index, namespace, String(partition)), member]);
  }
  await valkeyCommand(index.backend, ['DEL', valkeyObjectKey(index, member)]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushdownLabelSelector(index) {
  const filter = index.options.filter;
  if (filter?.expressionKind === 'predicate' && filter.operator === 'eq' && filter.left?.expressionKind === 'label') {
    return { matchLabels: { [filter.left.value]: String(filter.right) } };
  }
  return undefined;
}

function indexPartition(index, item) {
  const partition = index.options.partitionBy;
  if (partition?.expressionKind === 'label') {
    return item.metadata?.labels?.[partition.value];
  }
  return undefined;
}

function itemMember(item) {
  const namespace = item.metadata?.namespace || defaultNamespace();
  const name = item.metadata?.name;
  return name ? namespace + '/' + name : undefined;
}

function indexScore(index, item) {
  const orderBy = index.options.orderBy;
  const value = orderBy?.expression ? valueAtPath(item, orderBy.expression.value) : item.metadata?.creationTimestamp;
  const timestamp = Date.parse(String(value || ''));
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
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

function valkeyPartitionsKey(index, namespace) {
  return 'applik8s:index:' + index.name + ':partitions:' + namespace;
}

function valkeyPartitionKey(index, namespace, partition) {
  return 'applik8s:index:' + index.name + ':partition:' + namespace + ':' + String(partition);
}

function valkeyObjectKey(index, member) {
  return 'applik8s:index:' + index.name + ':object:' + member;
}

function listPath(resource, query) {
  const params = new URLSearchParams();
  if (query.labelSelector) {
    params.set('labelSelector', labelSelectorString(query.labelSelector));
  }
  if (query.watch) {
    params.set('watch', 'true');
  }
  if (query.resourceVersion) {
    params.set('resourceVersion', query.resourceVersion);
  }
  const queryString = params.toString();
  return collectionPath(resource, query.namespace) + (queryString ? '?' + queryString : '');
}

function labelSelectorString(selector) {
  const labels = selector.matchLabels ? Object.entries(selector.matchLabels).map(([key, value]) => key + '=' + value) : [];
  return labels.join(',');
}

function collectionPath(resource, namespace) {
  const prefix = apiPrefix(resource.apiVersion);
  if (resource.scope === 'Namespaced') {
    return prefix + '/namespaces/' + encodeURIComponent(namespace || defaultNamespace()) + '/' + encodeURIComponent(resource.plural);
  }
  return prefix + '/' + encodeURIComponent(resource.plural);
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

async function kubernetesRequest({ method, path }) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const response = await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, data }));
    });
    request.on('error', reject);
    request.end();
  });
  const parsed = response.data ? JSON.parse(response.data) : undefined;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(parsed?.message || 'Kubernetes request failed with HTTP ' + response.statusCode);
  }
  return parsed;
}

async function kubernetesWatch({ method, path }, onEvent) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  await new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
      port: Number(process.env.KUBERNETES_SERVICE_PORT || 443),
      method,
      path,
      ca,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    }, (response) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => reject(new Error('Kubernetes watch failed with HTTP ' + (response.statusCode || 0) + ': ' + body)));
        return;
      }
      let buffer = '';
      let queue = Promise.resolve();
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim().length === 0) {
            continue;
          }
          queue = queue.then(() => onEvent(JSON.parse(line)));
        }
      });
      response.on('end', () => {
        queue.then(resolve, reject);
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function valkeyCommand(backend, parts) {
  return new Promise((resolve, reject) => {
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
`.trimStart();
}
