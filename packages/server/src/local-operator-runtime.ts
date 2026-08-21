// typecast-file-boundary: digest-verified compiler manifests and dispatcher results are validated at the local runtime boundary.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Applik8sLocalResourceStore,
  applik8sLocalResourcePlural,
  type Applik8sLocalResourceAddress,
  type Applik8sLocalResourceEvent,
  type Applik8sLocalResourceObject,
} from './local-resource-authority.js';

export interface Applik8sLocalOperatorArtifact {
  readonly name: string;
  readonly manifest: string;
  readonly source: string;
  readonly digest: string;
}

export interface Applik8sLocalOperatorRuntime {
  close(): void;
}

interface LocalOperatorManifest {
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly handlerAbi: string;
    readonly handlerExports: readonly LocalHandlerExport[];
    readonly watches: readonly LocalWatch[];
    readonly bundle: { readonly artifacts: readonly { readonly kind: string; readonly path: string; readonly digest: string }[] };
  };
}

interface LocalHandlerExport {
  readonly handlerId: string;
  readonly exportName: string;
  readonly resource: { readonly apiVersion: string; readonly kind: string };
  readonly event: string;
}

interface LocalWatch {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural?: string;
  readonly scope?: 'Namespaced' | 'Cluster';
  readonly namespace?: string;
  readonly name?: string;
  readonly names?: readonly string[];
  readonly labelSelector?: Readonly<Record<string, string>>;
  readonly fieldSelector?: string;
  readonly handlers: readonly string[];
}

interface LoadedOperator {
  readonly artifact: Applik8sLocalOperatorArtifact;
  readonly manifest: LocalOperatorManifest;
  readonly handle: (input: string) => Promise<string> | string;
}

export async function startApplik8sLocalOperatorRuntime(
  artifacts: readonly Applik8sLocalOperatorArtifact[],
  store: Applik8sLocalResourceStore,
): Promise<Applik8sLocalOperatorRuntime> {
  if (artifacts.length === 0) return { close() {} };
  const builtLoader = new URL('./local-operator-loader.js', import.meta.url);
  register(existsSync(fileURLToPath(builtLoader)) ? builtLoader : new URL('./local-operator-loader.ts', import.meta.url));
  const host = localOperatorHost(store);
  Reflect.set(globalThis, Symbol.for('applik8s.localOperatorHost'), host);
  const operators = await Promise.all(artifacts.map(loadOperator));
  let closed = false;
  const tails = new Map<string, Promise<void>>();
  const enqueue = (operator: LoadedOperator, handler: LocalHandlerExport, object: Applik8sLocalResourceObject): void => {
    const key = `${operator.manifest.metadata.name}:${handler.handlerId}:${object.metadata.uid}`;
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (!closed) await reconcile(operator, handler, object, store, enqueue);
    }).catch((cause: unknown) => {
      process.stderr.write(`Applik8s local reconcile ${key} failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`);
    }).finally(() => {
      if (tails.get(key) === next) tails.delete(key);
    });
    tails.set(key, next);
  };
  const dispatch = (event: Applik8sLocalResourceEvent): void => {
    for (const operator of operators) for (const watch of operator.manifest.spec.watches) {
      if (!watchMatches(watch, event.object)) continue;
      for (const handlerId of watch.handlers) {
        const handler = operator.manifest.spec.handlerExports.find((candidate) => candidate.handlerId === handlerId);
        if (handler && eventPermitsHandler(event.type, handler.event)) enqueue(operator, handler, event.object);
      }
    }
  };
  const unsubscribe = store.subscribe(dispatch);
  for (const operator of operators) for (const watch of operator.manifest.spec.watches) {
    const [group, version] = splitApiVersion(watch.apiVersion);
    const listed = store.list({ group, version, ...(watch.namespace ? { namespace: watch.namespace } : {}), plural: watch.plural ?? applik8sLocalResourcePlural(watch.kind) }, { limit: 500 });
    const items = Reflect.get(listed, 'items');
    if (Array.isArray(items)) for (const object of items) dispatch({ type: 'MODIFIED', object: object as Applik8sLocalResourceObject });
  }
  return {
    close() {
      closed = true;
      unsubscribe();
      Reflect.deleteProperty(globalThis, Symbol.for('applik8s.localOperatorHost'));
    },
  };
}

async function loadOperator(artifact: Applik8sLocalOperatorArtifact): Promise<LoadedOperator> {
  const manifest = validateManifest(JSON.parse(await readFile(artifact.manifest, 'utf8')));
  const source = await readFile(artifact.source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  if (digest !== artifact.digest) throw new Error(`Local operator ${artifact.name} dispatcher digest mismatch.`);
  const declared = manifest.spec.bundle.artifacts.find((candidate) => candidate.kind === 'javascript-bundle');
  if (!declared || declared.path !== artifact.source || declared.digest !== artifact.digest) throw new Error(`Local operator ${artifact.name} manifest does not authorize its dispatcher artifact.`);
  // static-import-exception: the compiler-produced dispatcher path and digest are runtime artifacts validated immediately above, not build-time modules.
  const module = await import(`${pathToFileURL(artifact.source).href}?digest=${encodeURIComponent(digest)}`) as { readonly handle?: unknown };
  if (typeof module.handle !== 'function') throw new Error(`Local operator ${artifact.name} dispatcher does not export handle().`);
  return { artifact, manifest, handle: module.handle as LoadedOperator['handle'] };
}

async function reconcile(
  operator: LoadedOperator,
  handler: LocalHandlerExport,
  observed: Applik8sLocalResourceObject,
  store: Applik8sLocalResourceStore,
  enqueue: (operator: LoadedOperator, handler: LocalHandlerExport, object: Applik8sLocalResourceObject) => void,
): Promise<void> {
  const watch = operator.manifest.spec.watches.find((candidate) => candidate.handlers.includes(handler.handlerId));
  if (!watch) throw new Error(`Handler ${handler.handlerId} has no watch registration.`);
  const currentAddress = addressFor(watch.apiVersion, watch.plural ?? applik8sLocalResourcePlural(watch.kind), observed.metadata.namespace, observed.metadata.name);
  let current: Applik8sLocalResourceObject;
  try {
    current = store.get(currentAddress);
  } catch (cause) {
    if (numericCode(cause) === 404) return;
    throw cause;
  }
  const output = await operator.handle(JSON.stringify({
    abiVersion: 'applik8s.handler/v1alpha1',
    handlerId: handler.handlerId,
    event: handler.event,
    object: current,
    runtime: { reconcileId: `${handler.handlerId}:${current.metadata.uid}:${current.metadata.resourceVersion}` },
  }));
  const plan = record(JSON.parse(output), `Handler ${handler.handlerId} output`);
  const operations = plan.operations;
  if (!Array.isArray(operations)) throw new Error(`Handler ${handler.handlerId} output has no operation array.`);
  let requeueSeconds: number | undefined;
  for (const operationValue of operations) {
    const operation = record(operationValue, `Handler ${handler.handlerId} operation`);
    const kind = requiredString(operation.kind, 'Operation kind');
    if (kind === 'status') {
      const target = operation.ref ? addressFromRef(record(operation.ref, 'Status ref'), operator) : currentAddress;
      const nextStatus = operation.status ?? {};
      const targetObject = store.get(target);
      if (canonical(targetObject.status ?? {}) !== canonical(nextStatus)) await store.replaceStatus(target, nextStatus);
    } else if (kind === 'apply') {
      await applyObject(store, record(operation.resource, 'Apply resource'), operator);
    } else if (kind === 'patch') {
      const target = addressFromRef(record(operation.ref, 'Patch ref'), operator);
      const patch = operation.patch;
      if (!Array.isArray(patch)) throw new Error('Patch operation requires an array.');
      await store.update(target, (object) => applyJsonPatch(object, patch));
    } else if (kind === 'delete') {
      const target = addressFromRef(record(operation.ref, 'Delete ref'), operator);
      await store.delete(target).catch((cause: unknown) => {
        if (numericCode(cause) !== 404) throw cause;
      });
    } else if (kind === 'finalizer') {
      const finalizer = requiredString(operation.finalizer, 'Finalizer');
      const action = requiredString(operation.operation, 'Finalizer action');
      await store.update(currentAddress, (object) => {
        const finalizers = new Set(Array.isArray(object.metadata.finalizers) ? object.metadata.finalizers.filter((value): value is string => typeof value === 'string') : []);
        if (action === 'add') finalizers.add(finalizer);
        else if (action === 'remove') finalizers.delete(finalizer);
        else throw new Error(`Unsupported finalizer action ${action}.`);
        return { ...object, metadata: { ...object.metadata, finalizers: [...finalizers] } };
      });
    } else if (kind === 'requeue') {
      const policy = record(operation.policy, 'Requeue policy');
      const afterSeconds = policy.afterSeconds;
      if (typeof afterSeconds === 'number' && Number.isFinite(afterSeconds) && afterSeconds >= 0 && afterSeconds <= 86_400) requeueSeconds = afterSeconds;
    } else if (kind !== 'event') {
      throw new Error(`Local operator runtime does not support operation kind ${kind}.`);
    }
  }
  if (requeueSeconds !== undefined) setTimeout(() => {
    try {
      enqueue(operator, handler, store.get(currentAddress));
    } catch {
      // The resource was deleted before its bounded requeue.
    }
  }, requeueSeconds * 1_000).unref();
}

function localOperatorHost(store: Applik8sLocalResourceStore): { readonly kubernetesRead: (request: string) => string; readonly capabilityRequest: (request: string) => string } {
  return {
    kubernetesRead(requestJson) {
      try {
        const request = record(JSON.parse(requestJson), 'Kubernetes read request');
        const apiVersion = requiredString(request.apiVersion, 'Kubernetes read apiVersion');
        const plural = requiredString(request.plural, 'Kubernetes read plural');
        const query = record(request.query ?? {}, 'Kubernetes read query');
        const namespace = typeof query.namespace === 'string' ? query.namespace : undefined;
        const base = addressFor(apiVersion, plural, namespace);
        if (request.operation === 'get') {
          const name = requiredString(query.name, 'Kubernetes get name');
          let value: Applik8sLocalResourceObject | undefined;
          try { value = store.get({ ...base, name }); } catch (cause) { if (numericCode(cause) !== 404) throw cause; }
          return JSON.stringify({ ok: true, value: value ?? null });
        }
        if (request.operation === 'list') {
          const listed = store.list(base, {
            ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
            ...(typeof query.continueToken === 'string' ? { continueToken: query.continueToken } : {}),
            ...(query.labels && typeof query.labels === 'object' ? { labelSelector: Object.entries(query.labels as Record<string, unknown>).map(([key, value]) => `${key}=${String(value)}`).join(',') } : {}),
            ...(typeof query.fields === 'string' ? { fieldSelector: query.fields } : {}),
          });
          const metadata = record(Reflect.get(listed, 'metadata'), 'List metadata');
          return JSON.stringify({ ok: true, value: { items: Reflect.get(listed, 'items'), ...(metadata._continue ? { continueToken: metadata._continue } : {}) } });
        }
        throw new Error(`Unsupported Kubernetes read operation ${String(request.operation)}.`);
      } catch (cause) {
        return JSON.stringify({ ok: false, error: { code: 'LOCAL_KUBERNETES_READ_FAILED', message: cause instanceof Error ? cause.message : String(cause), severity: 'error', context: {} } });
      }
    },
    capabilityRequest() {
      return JSON.stringify({ ok: false, error: { code: 'LOCAL_CAPABILITY_UNBOUND', message: 'The local operator requested a capability without a local provider binding.', severity: 'error', context: {} } });
    },
  };
}

async function applyObject(store: Applik8sLocalResourceStore, resource: Record<string, unknown>, operator: LoadedOperator): Promise<void> {
  const metadata = record(resource.metadata, 'Apply metadata');
  const apiVersion = requiredString(resource.apiVersion, 'Apply apiVersion');
  const kind = requiredString(resource.kind, 'Apply kind');
  const name = requiredString(metadata.name, 'Apply metadata.name');
  const plural = operator.manifest.spec.watches.find((watch) => watch.apiVersion === apiVersion && watch.kind === kind)?.plural ?? applik8sLocalResourcePlural(kind);
  const address = addressFor(apiVersion, plural, typeof metadata.namespace === 'string' ? metadata.namespace : undefined, name);
  try {
    store.get(address);
    await store.replace(address, resource);
  } catch (cause) {
    if (numericCode(cause) !== 404) throw cause;
    await store.create(address, resource);
  }
}

function applyJsonPatch(object: Applik8sLocalResourceObject, entries: readonly unknown[]): Applik8sLocalResourceObject {
  const result = structuredClone(object) as Record<string, unknown>;
  for (const entryValue of entries) {
    const entry = record(entryValue, 'JSON patch entry');
    const path = requiredString(entry.path, 'JSON patch path').split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    if (path.length === 0) throw new Error('Root JSON patch operations are not supported locally.');
    let parent = result;
    for (const segment of path.slice(0, -1)) {
      const next = parent[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) parent[segment] = {};
      parent = parent[segment] as Record<string, unknown>;
    }
    const key = path.at(-1)!;
    if (entry.op === 'remove') delete parent[key];
    else if (entry.op === 'add' || entry.op === 'replace') parent[key] = entry.value;
    else throw new Error(`Unsupported local JSON patch operation ${String(entry.op)}.`);
  }
  return result as unknown as Applik8sLocalResourceObject;
}

function addressFromRef(ref: Record<string, unknown>, operator: LoadedOperator): Applik8sLocalResourceAddress {
  const apiVersion = requiredString(ref.apiVersion, 'Object ref apiVersion');
  const kind = requiredString(ref.kind, 'Object ref kind');
  const plural = operator.manifest.spec.watches.find((watch) => watch.apiVersion === apiVersion && watch.kind === kind)?.plural ?? applik8sLocalResourcePlural(kind);
  return addressFor(apiVersion, plural, typeof ref.namespace === 'string' ? ref.namespace : undefined, requiredString(ref.name, 'Object ref name'));
}

function addressFor(apiVersion: string, plural: string, namespace?: string, name?: string): Applik8sLocalResourceAddress {
  const [group, version] = splitApiVersion(apiVersion);
  return { group, version, plural, ...(namespace ? { namespace } : {}), ...(name ? { name } : {}) };
}

function watchMatches(watch: LocalWatch, object: Applik8sLocalResourceObject): boolean {
  if (watch.apiVersion !== object.apiVersion || watch.kind !== object.kind) return false;
  if (watch.namespace && watch.namespace !== object.metadata.namespace) return false;
  if (watch.name && watch.name !== object.metadata.name) return false;
  if (watch.names && !watch.names.includes(object.metadata.name)) return false;
  const labels = object.metadata.labels && typeof object.metadata.labels === 'object' ? object.metadata.labels as Record<string, unknown> : {};
  if (watch.labelSelector && Object.entries(watch.labelSelector).some(([key, value]) => labels[key] !== value)) return false;
  return true;
}

function eventPermitsHandler(type: Applik8sLocalResourceEvent['type'], event: string): boolean {
  return event === 'reconcile'
    || (type === 'ADDED' && ['create', 'created'].includes(event))
    || (type === 'MODIFIED' && ['update', 'updated', 'statusChanged'].includes(event))
    || (type === 'DELETED' && ['delete', 'deleted', 'finalize'].includes(event));
}

function validateManifest(value: unknown): LocalOperatorManifest {
  const manifest = record(value, 'Local operator manifest');
  const spec = record(manifest.spec, 'Local operator manifest spec');
  if (manifest.apiVersion !== 'applik8s.operator/v1alpha1' || manifest.kind !== 'OperatorBundle' || spec.handlerAbi !== 'applik8s.handler/v1alpha1' || !Array.isArray(spec.handlerExports) || !Array.isArray(spec.watches)) throw new Error('Local operator manifest is incompatible.');
  return value as LocalOperatorManifest;
}

function splitApiVersion(value: string): readonly [string, string] {
  const separator = value.indexOf('/');
  if (separator < 1 || separator === value.length - 1) throw new Error(`API version ${value} must include group/version.`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function numericCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const code = Reflect.get(cause, 'code');
  return typeof code === 'number' ? code : undefined;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}
