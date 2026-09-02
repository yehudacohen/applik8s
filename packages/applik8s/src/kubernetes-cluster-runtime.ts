// typecast-file-boundary: host-mediated Kubernetes responses are structurally validated before typed resources cross into application code.
import type {
  JsonObject,
  JsonValue,
  ResourceDefinition,
  ResourceObject,
} from '@applik8s/core';
import { canonicalJsonV1String } from '@applik8s/core/canonical-json';
import { currentApplicationProviderOperation } from './application-provider-telemetry-runtime.js';
import type {
  ApplicationKubernetesDeletePreconditions,
  ApplicationKubernetesIdentity,
  ApplicationKubernetesListQuery,
  ApplicationKubernetesListResult,
  ApplicationKubernetesMutationOwnership,
  ApplicationKubernetesPageBounds,
  ApplicationKubernetesResourceFamily,
  ApplicationKubernetesWatchBounds,
  ApplicationKubernetesWatchResult,
} from './application-kubernetes-cluster.js';

export const applicationKubernetesCapabilityProtocol =
  'applik8s.kubernetes-capability/v1alpha1' as const;

export type ApplicationKubernetesCapabilityFailureCode =
  | 'KUBERNETES_CLUSTER_BINDING_MISSING'
  | 'KUBERNETES_CLUSTER_AUTHORITY_UNDECLARED'
  | 'KUBERNETES_CLUSTER_SCOPE_UNBOUNDED'
  | 'KUBERNETES_CLUSTER_ENDPOINT_FORBIDDEN'
  | 'KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED'
  | 'KUBERNETES_CLUSTER_LIST_UNBOUNDED'
  | 'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE'
  | 'KUBERNETES_CLUSTER_RESPONSE_LIMIT'
  | 'KUBERNETES_CLUSTER_CONTINUATION_INVALID'
  | 'KUBERNETES_CLUSTER_NOT_FOUND'
  | 'KUBERNETES_CLUSTER_CONFLICT'
  | 'KUBERNETES_CLUSTER_FORBIDDEN'
  | 'KUBERNETES_CLUSTER_UNAVAILABLE'
  | 'KUBERNETES_CLUSTER_DEADLINE'
  | 'KUBERNETES_CLUSTER_CANCELLED'
  | 'KUBERNETES_CLUSTER_SCHEMA_MISMATCH';

export interface ApplicationKubernetesCapabilityResource {
  readonly group: string;
  readonly version: string;
  readonly kind: string;
  readonly plural: string;
  readonly scope: 'namespaced' | 'cluster';
  readonly schemaDigest?: string;
}

export type ApplicationKubernetesCapabilityOperation =
  | { readonly kind: 'get'; readonly identity: ApplicationKubernetesIdentity }
  | { readonly kind: 'list'; readonly query: ApplicationKubernetesListQuery; readonly page: { readonly limit: number; readonly continue?: string; readonly maxBytes: number } }
  | { readonly kind: 'watch'; readonly query: ApplicationKubernetesListQuery; readonly from?: string; readonly maxEvents: number; readonly maxBytes: number }
  | { readonly kind: 'apply'; readonly value: JsonObject; readonly ownership: ApplicationKubernetesMutationOwnership }
  | { readonly kind: 'patch'; readonly identity: ApplicationKubernetesIdentity; readonly patch: JsonObject; readonly ownership: ApplicationKubernetesMutationOwnership }
  | { readonly kind: 'delete'; readonly identity: ApplicationKubernetesIdentity; readonly preconditions: ApplicationKubernetesDeletePreconditions };

export interface ApplicationKubernetesCapabilityIntent {
  readonly protocol: typeof applicationKubernetesCapabilityProtocol;
  readonly bindingId: string;
  readonly operationId: string;
  readonly resource: ApplicationKubernetesCapabilityResource;
  readonly operation: ApplicationKubernetesCapabilityOperation;
  readonly deadlineUnixMs: number;
}

export interface ApplicationKubernetesCapabilityRequest
  extends ApplicationKubernetesCapabilityIntent {
  readonly authorityReceipt: string;
  readonly causalContext: string;
  readonly traceContext?: string;
}

export type ApplicationKubernetesCapabilityResponse =
  | { readonly protocol: typeof applicationKubernetesCapabilityProtocol; readonly ok: true; readonly value: JsonValue }
  | {
      readonly protocol: typeof applicationKubernetesCapabilityProtocol;
      readonly ok: false;
      readonly error: {
        readonly code: ApplicationKubernetesCapabilityFailureCode;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

export interface ApplicationKubernetesCapabilityHost {
  invoke(intent: ApplicationKubernetesCapabilityIntent): Promise<ApplicationKubernetesCapabilityResponse>;
}

export interface ApplicationKubernetesCapabilityAuthorityContext {
  readonly authorityReceipt: string;
  readonly causalContext: string;
  readonly traceContext?: string;
}

export class ApplicationKubernetesCapabilityError extends Error {
  constructor(
    readonly code: ApplicationKubernetesCapabilityFailureCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApplicationKubernetesCapabilityError';
  }
}

type ApplicationKubernetesCapabilityHostResolver = (
  bindingId: string,
) => ApplicationKubernetesCapabilityHost | Promise<ApplicationKubernetesCapabilityHost | undefined> | undefined;

let hostResolver: ApplicationKubernetesCapabilityHostResolver | undefined;

/** Host integration seam. Credentials and Kubernetes clients remain behind this resolver. */
export function installApplicationKubernetesCapabilityHostResolver(
  resolver: ApplicationKubernetesCapabilityHostResolver,
): () => void {
  const previous = hostResolver;
  hostResolver = resolver;
  return () => { hostResolver = previous; };
}

/**
 * Creates the credential-free request envelope accepted by a host adapter.
 * The adapter, rather than the managed closure, derives this authority context.
 */
export function createApplicationKubernetesCapabilityRequest(
  intent: ApplicationKubernetesCapabilityIntent,
  authority: ApplicationKubernetesCapabilityAuthorityContext,
): ApplicationKubernetesCapabilityRequest {
  if (intent.protocol !== applicationKubernetesCapabilityProtocol) {
    protocolError('Kubernetes capability intent uses an incompatible protocol.');
  }
  return Object.freeze({
    ...intent,
    authorityReceipt: nonEmpty(authority.authorityReceipt, 'Kubernetes authority receipt'),
    causalContext: nonEmpty(authority.causalContext, 'Kubernetes causal context'),
    ...(authority.traceContext
      ? { traceContext: nonEmpty(authority.traceContext, 'Kubernetes trace context') }
      : {}),
  });
}

/**
 * Compiler-hydrated entrypoint. The returned family is finite: lists and
 * watches require explicit portable bounds and never retain a hidden socket.
 */
export function resourcesApplicationKubernetesCluster<
  TSpec extends object,
  TStatus extends object,
>(
  definition: Pick<
    ResourceDefinition<TSpec, TStatus>,
    'apiVersion' | 'kind' | 'plural' | 'scope'
  >,
  explicit?: { readonly bindingId: string },
): ApplicationKubernetesResourceFamily<TSpec, TStatus> {
  const operation = currentApplicationProviderOperation();
  const bindingId = operation?.interface === 'KubernetesCluster'
    ? operation.nodeId
    : explicit?.bindingId;
  if (!bindingId) {
    throw new ApplicationKubernetesCapabilityError(
      'KUBERNETES_CLUSTER_BINDING_MISSING',
      'Kubernetes cluster access requires one compiler-hydrated named cluster binding.',
      false,
    );
  }
  const resource = normalizeResource(definition);
  return Object.freeze({
    get: async (identity: ApplicationKubernetesIdentity) => objectValue<TSpec, TStatus>(
      await invoke(bindingId, resource, { kind: 'get', identity: normalizeIdentity(resource, identity) }, 30_000),
      resource,
    ),
    list: async (query: ApplicationKubernetesListQuery = {}, bounds: ApplicationKubernetesPageBounds = {}) => listResources<TSpec, TStatus>(bindingId, resource, query, bounds),
    watch: async (query: ApplicationKubernetesListQuery, bounds: ApplicationKubernetesWatchBounds) => watchResources<TSpec, TStatus>(bindingId, resource, query, bounds),
    apply: async (value: ResourceObject<TSpec, TStatus> | JsonObject, ownership: ApplicationKubernetesMutationOwnership) => objectValue<TSpec, TStatus>(
      await invoke(bindingId, resource, {
        kind: 'apply',
        value: jsonObject(value, `${resource.kind} apply value`),
        ownership: normalizeOwnership(ownership),
      }, 30_000),
      resource,
    ),
    patch: async (identity: ApplicationKubernetesIdentity, patch: JsonObject, ownership: ApplicationKubernetesMutationOwnership) => objectValue<TSpec, TStatus>(
      await invoke(bindingId, resource, {
        kind: 'patch',
        identity: normalizeIdentity(resource, identity),
        patch,
        ownership: normalizeOwnership(ownership),
      }, 30_000),
      resource,
    ),
    delete: async (identity: ApplicationKubernetesIdentity, preconditions: ApplicationKubernetesDeletePreconditions) => {
      const value = record(await invoke(bindingId, resource, {
        kind: 'delete',
        identity: normalizeIdentity(resource, identity),
        preconditions: normalizeDeletePreconditions(preconditions),
      }, 30_000), `${resource.kind} delete result`);
      if (value.deleted !== true) protocolError(`${resource.kind} delete result did not confirm deletion.`);
      return Object.freeze({ deleted: true as const, ...(typeof value.uid === 'string' ? { uid: value.uid } : {}) });
    },
  });
}

async function listResources<TSpec extends object, TStatus extends object>(
  bindingId: string,
  resource: ApplicationKubernetesCapabilityResource,
  query: ApplicationKubernetesListQuery,
  bounds: ApplicationKubernetesPageBounds,
): Promise<ApplicationKubernetesListResult<ResourceObject<TSpec, TStatus>>> {
  const normalizedQuery = normalizeQuery(resource, query);
  const pageSize = boundedInteger(bounds.pageSize ?? 100, 1, 500, 'Kubernetes list pageSize');
  const maxPages = boundedInteger(bounds.maxPages ?? 10, 1, 100, 'Kubernetes list maxPages');
  const maxItems = boundedInteger(bounds.maxItems ?? 1_000, 1, 100_000, 'Kubernetes list maxItems');
  const maxBytes = boundedInteger(bounds.maxBytes ?? 4_000_000, 1_024, 32_000_000, 'Kubernetes list maxBytes');
  const timeoutMs = durationMs(bounds.timeout ?? '30s', 100, 300_000, 'Kubernetes list timeout');
  const deadlineUnixMs = Date.now() + timeoutMs;
  const items: ResourceObject<TSpec, TStatus>[] = [];
  let continuation = normalizedQuery.continue;
  let resourceVersion: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const value = record(await invokeAtDeadline(bindingId, resource, {
      kind: 'list', query: normalizedQuery, page: { limit: Math.min(pageSize, maxItems - items.length), maxBytes, ...(continuation ? { continue: continuation } : {}) },
    }, deadlineUnixMs), `${resource.kind} list page`);
    const pageItems = array(value.items, `${resource.kind} list items`).map((item) => objectValue<TSpec, TStatus>(item, resource));
    items.push(...pageItems);
    if (items.length > maxItems || jsonByteLength(items) > maxBytes) {
      throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_RESPONSE_LIMIT', `${resource.kind} list exceeded its declared bound.`, false);
    }
    resourceVersion = optionalString(value.resourceVersion) ?? resourceVersion;
    continuation = optionalString(value.continue);
    if (!continuation || items.length === maxItems) break;
    if (seen.has(continuation)) {
      throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_CONTINUATION_INVALID', `${resource.kind} list repeated a continuation token.`, false);
    }
    seen.add(continuation);
  }
  return Object.freeze({ items: Object.freeze(items), ...(resourceVersion ? { resourceVersion } : {}), ...(continuation ? { continue: continuation } : {}) });
}

async function watchResources<TSpec extends object, TStatus extends object>(
  bindingId: string,
  resource: ApplicationKubernetesCapabilityResource,
  query: ApplicationKubernetesListQuery,
  bounds: ApplicationKubernetesWatchBounds,
): Promise<ApplicationKubernetesWatchResult<ResourceObject<TSpec, TStatus>>> {
  const timeoutMs = durationMs(bounds.timeout, 100, 300_000, 'Kubernetes watch timeout');
  const maxEvents = boundedInteger(bounds.maxEvents, 1, 10_000, 'Kubernetes watch maxEvents');
  const maxBytes = boundedInteger(bounds.maxBytes ?? 4_000_000, 1_024, 32_000_000, 'Kubernetes watch maxBytes');
  const value = record(await invoke(bindingId, resource, {
    kind: 'watch',
    query: normalizeQuery(resource, query),
    ...(bounds.from ? { from: nonEmpty(bounds.from, 'Kubernetes watch resourceVersion') } : {}),
    maxEvents,
    maxBytes,
  }, timeoutMs), `${resource.kind} watch result`);
  const events = array(value.events, `${resource.kind} watch events`).map((candidate) => {
    const event = record(candidate, `${resource.kind} watch event`);
    if (!['Added', 'Modified', 'Deleted', 'Bookmark'].includes(String(event.type))) protocolError(`${resource.kind} watch event type is invalid.`);
    return Object.freeze({
      type: event.type as 'Added' | 'Modified' | 'Deleted' | 'Bookmark',
      object: objectValue<TSpec, TStatus>(event.object, resource),
    });
  });
  if (events.length > maxEvents || jsonByteLength(events) > maxBytes) {
    throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_RESPONSE_LIMIT', `${resource.kind} watch exceeded its declared bound.`, false);
  }
  const resourceVersion = optionalString(value.resourceVersion);
  return Object.freeze({ events: Object.freeze(events), ...(resourceVersion ? { resourceVersion } : {}) });
}

async function invoke(
  bindingId: string,
  resource: ApplicationKubernetesCapabilityResource,
  operation: ApplicationKubernetesCapabilityOperation,
  timeoutMs: number,
): Promise<JsonValue> {
  return invokeAtDeadline(bindingId, resource, operation, Date.now() + timeoutMs);
}

async function invokeAtDeadline(
  bindingId: string,
  resource: ApplicationKubernetesCapabilityResource,
  operation: ApplicationKubernetesCapabilityOperation,
  deadlineUnixMs: number,
): Promise<JsonValue> {
  const host = await hostResolver?.(bindingId);
  if (!host) {
    throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_BINDING_MISSING', `Kubernetes cluster binding ${bindingId} has no host adapter.`, false);
  }
  const response = await host.invoke({
    protocol: applicationKubernetesCapabilityProtocol,
    bindingId,
    operationId: `k8s_${globalThis.crypto.randomUUID()}`,
    resource,
    operation,
    deadlineUnixMs,
  });
  if (response.protocol !== applicationKubernetesCapabilityProtocol) protocolError('Kubernetes capability host returned an incompatible protocol.');
  if (!response.ok) throw new ApplicationKubernetesCapabilityError(response.error.code, response.error.message, response.error.retryable);
  return response.value;
}

function normalizeResource<TSpec extends object, TStatus extends object>(
  definition: Pick<ResourceDefinition<TSpec, TStatus>, 'apiVersion' | 'kind' | 'plural' | 'scope'>,
): ApplicationKubernetesCapabilityResource {
  const [group, version] = definition.apiVersion.includes('/')
    ? definition.apiVersion.split('/', 2)
    : ['', definition.apiVersion];
  if (!version || !/^[a-z0-9][a-z0-9.-]*$/u.test(version)) throw new TypeError('Kubernetes resource apiVersion is invalid.');
  const scope = definition.scope === 'Namespaced' ? 'namespaced' : definition.scope === 'Cluster' ? 'cluster' : undefined;
  if (!scope) throw new TypeError(`Kubernetes resource ${definition.kind} has an invalid scope.`);
  return Object.freeze({ group: group ?? '', version, kind: nonEmpty(definition.kind, 'Kubernetes resource kind'), plural: nonEmpty(definition.plural, 'Kubernetes resource plural'), scope });
}

function normalizeIdentity(resource: ApplicationKubernetesCapabilityResource, identity: ApplicationKubernetesIdentity): ApplicationKubernetesIdentity {
  const name = dnsSubdomain(identity.name, `${resource.kind} name`);
  if (resource.scope === 'namespaced') {
    if (!identity.namespace) throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_SCOPE_UNBOUNDED', `${resource.kind} requires an explicit namespace.`, false);
    return Object.freeze({ name, namespace: dnsSubdomain(identity.namespace, `${resource.kind} namespace`) });
  }
  if (identity.namespace !== undefined) throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_SCOPE_UNBOUNDED', `${resource.kind} is cluster-scoped and cannot receive a namespace.`, false);
  return Object.freeze({ name });
}

function normalizeQuery(resource: ApplicationKubernetesCapabilityResource, query: ApplicationKubernetesListQuery): ApplicationKubernetesListQuery {
  if (resource.scope === 'namespaced' && !query.namespace) throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_SCOPE_UNBOUNDED', `${resource.kind} list/watch requires an explicit namespace.`, false);
  if (resource.scope === 'cluster' && query.namespace !== undefined) throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_SCOPE_UNBOUNDED', `${resource.kind} is cluster-scoped and cannot receive a namespace.`, false);
  return Object.freeze({
    ...(query.namespace ? { namespace: dnsSubdomain(query.namespace, `${resource.kind} namespace`) } : {}),
    ...(query.labels ? { labels: normalizeSelector(query.labels, 'label') } : {}),
    ...(query.fields ? { fields: normalizeSelector(query.fields, 'field') } : {}),
    ...(query.continue ? { continue: nonEmpty(query.continue, 'Kubernetes continuation') } : {}),
  });
}

function normalizeSelector(value: Readonly<Record<string, string>>, label: string): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [nonEmpty(key, `Kubernetes ${label} selector key`), nonEmpty(item, `Kubernetes ${label} selector value`)])));
}

function normalizeOwnership(value: ApplicationKubernetesMutationOwnership): ApplicationKubernetesMutationOwnership {
  if (!value || typeof value !== 'object') throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED', 'Kubernetes mutation ownership is required.', false);
  return Object.freeze({
    fieldManager: boundedNonEmpty(value.fieldManager, 128, 'Kubernetes fieldManager'),
    ...(value.force === true ? { force: true } : {}),
    ...(value.expectedUid ? { expectedUid: nonEmpty(value.expectedUid, 'Kubernetes expected UID') } : {}),
    ...(value.expectedResourceVersion ? { expectedResourceVersion: nonEmpty(value.expectedResourceVersion, 'Kubernetes expected resourceVersion') } : {}),
  });
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonV1String(value as never)).byteLength;
}

function normalizeDeletePreconditions(value: ApplicationKubernetesDeletePreconditions): ApplicationKubernetesDeletePreconditions {
  if (!value || typeof value !== 'object' || (!value.uid && !value.resourceVersion)) {
    throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED', 'Kubernetes delete requires a UID or resourceVersion precondition.', false);
  }
  return Object.freeze({
    ...(value.uid ? { uid: nonEmpty(value.uid, 'Kubernetes delete UID') } : {}),
    ...(value.resourceVersion ? { resourceVersion: nonEmpty(value.resourceVersion, 'Kubernetes delete resourceVersion') } : {}),
    ...(value.propagation ? { propagation: value.propagation } : {}),
  });
}

function objectValue<TSpec extends object, TStatus extends object>(value: unknown, resource: ApplicationKubernetesCapabilityResource): ResourceObject<TSpec, TStatus> {
  const object = record(value, `${resource.kind} object`);
  const apiVersion = resource.group ? `${resource.group}/${resource.version}` : resource.version;
  if (object.apiVersion !== apiVersion || object.kind !== resource.kind) protocolError(`${resource.kind} response identity does not match ${apiVersion}.`);
  const metadata = record(object.metadata, `${resource.kind} metadata`);
  nonEmpty(metadata.name, `${resource.kind} metadata.name`);
  return structuredClone(object) as unknown as ResourceObject<TSpec, TStatus>;
}

function jsonObject(value: unknown, label: string): JsonObject {
  return record(value, label) as JsonObject;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolError(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) protocolError(`${label} must be an array.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function boundedNonEmpty(value: unknown, maximum: number, label: string): string {
  const normalized = nonEmpty(value, label);
  if (new TextEncoder().encode(normalized).byteLength > maximum) {
    throw new TypeError(`${label} must be at most ${maximum} bytes.`);
  }
  return normalized;
}

function dnsSubdomain(value: unknown, label: string): string {
  const normalized = nonEmpty(value, label);
  if (normalized.length > 253 || !/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u.test(normalized)) throw new TypeError(`${label} must be a Kubernetes DNS subdomain.`);
  return normalized;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}

function durationMs(value: string, minimum: number, maximum: number, label: string): number {
  const match = /^(\d+)(ms|s|m)$/u.exec(value);
  if (!match) throw new TypeError(`${label} must use ms, s, or m duration syntax.`);
  const magnitude = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  return boundedInteger(magnitude * multiplier, minimum, maximum, label);
}

function protocolError(message: string): never {
  throw new ApplicationKubernetesCapabilityError('KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE', message, false);
}
