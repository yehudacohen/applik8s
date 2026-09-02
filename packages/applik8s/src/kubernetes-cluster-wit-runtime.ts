import type {
  ApplicationKubernetesCapabilityFailureCode,
  ApplicationKubernetesCapabilityHostResolver,
  ApplicationKubernetesCapabilityResponse,
} from './kubernetes-cluster-runtime.js';

const protocol = 'applik8s.kubernetes-capability/v1alpha1' as const;
const resolverSymbol = Symbol.for('applik8s.kubernetes-capability.host-resolver.v1alpha1');

export type ApplicationKubernetesCapabilityWitImportResult =
  | { readonly tag: 'ok'; readonly val: string }
  | { readonly tag: 'err'; readonly val: string }
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/**
 * Handler-safe adapter from the component WIT import into the provider-neutral
 * Kubernetes capability protocol. It deliberately has no Node dependencies.
 */
export function installApplicationKubernetesCapabilityWitHost(
  invokeHost: (requestJson: string) => ApplicationKubernetesCapabilityWitImportResult,
): () => void {
  const previous = Reflect.get(globalThis, resolverSymbol) as ApplicationKubernetesCapabilityHostResolver | undefined;
  const resolver: ApplicationKubernetesCapabilityHostResolver = () => ({
    async invoke(intent) {
      try {
        const transport = invokeHost(JSON.stringify(intent));
        let encoded: string;
        if ('tag' in transport) {
          if (transport.tag === 'err') {
            return failure('KUBERNETES_CLUSTER_UNAVAILABLE', transport.val, true);
          }
          encoded = transport.val;
        } else {
          if (!transport.ok) {
            return failure('KUBERNETES_CLUSTER_UNAVAILABLE', transport.error, true);
          }
          encoded = transport.value;
        }
        const outer = record(JSON.parse(encoded));
        if (outer.ok !== true) {
          return failure(
            'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE',
            stringValue(recordOrEmpty(outer.error).message) ?? 'Kubernetes component host rejected the request.',
            false,
          );
        }
        return capabilityResponse(outer.value);
      } catch (cause) {
        return failure(
          'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE',
          cause instanceof Error ? cause.message : 'Kubernetes component host returned an invalid transport envelope.',
          false,
        );
      }
    },
  });
  Reflect.set(globalThis, resolverSymbol, resolver);
  return () => {
    if (previous) Reflect.set(globalThis, resolverSymbol, previous);
    else Reflect.deleteProperty(globalThis, resolverSymbol);
  };
}

function capabilityResponse(value: unknown): ApplicationKubernetesCapabilityResponse {
  const response = record(value);
  if (response.protocol !== protocol) throw new TypeError('Kubernetes capability host returned an incompatible protocol.');
  if (response.ok === true) {
    if (!Object.hasOwn(response, 'value')) throw new TypeError('Successful Kubernetes capability responses must include a value.');
    return { protocol, ok: true, value: structuredClone(response.value) as never };
  }
  if (response.ok !== false) throw new TypeError('Kubernetes capability response must declare whether it succeeded.');
  const error = record(response.error);
  if (!isFailureCode(error.code)) throw new TypeError('Kubernetes capability response uses an unknown failure code.');
  if (typeof error.retryable !== 'boolean') throw new TypeError('Kubernetes capability response error.retryable must be a boolean.');
  const message = stringValue(error.message);
  if (!message) throw new TypeError('Kubernetes capability response error.message must be a non-empty string.');
  return { protocol, ok: false, error: { code: error.code, message, retryable: error.retryable } };
}

function failure(
  code: ApplicationKubernetesCapabilityFailureCode,
  message: string,
  retryable: boolean,
): ApplicationKubernetesCapabilityResponse {
  return { protocol, ok: false, error: { code, message, retryable } };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Kubernetes capability response must be an object.');
  return value as Readonly<Record<string, unknown>>;
}

function recordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isFailureCode(value: unknown): value is ApplicationKubernetesCapabilityFailureCode {
  return typeof value === 'string' && failureCodes.has(value as ApplicationKubernetesCapabilityFailureCode);
}

const failureCodes = new Set<ApplicationKubernetesCapabilityFailureCode>([
  'KUBERNETES_CLUSTER_BINDING_MISSING',
  'KUBERNETES_CLUSTER_AUTHORITY_UNDECLARED',
  'KUBERNETES_CLUSTER_SCOPE_UNBOUNDED',
  'KUBERNETES_CLUSTER_ENDPOINT_FORBIDDEN',
  'KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED',
  'KUBERNETES_CLUSTER_LIST_UNBOUNDED',
  'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE',
  'KUBERNETES_CLUSTER_RESPONSE_LIMIT',
  'KUBERNETES_CLUSTER_CONTINUATION_INVALID',
  'KUBERNETES_CLUSTER_NOT_FOUND',
  'KUBERNETES_CLUSTER_CONFLICT',
  'KUBERNETES_CLUSTER_FORBIDDEN',
  'KUBERNETES_CLUSTER_UNAVAILABLE',
  'KUBERNETES_CLUSTER_DEADLINE',
  'KUBERNETES_CLUSTER_CANCELLED',
  'KUBERNETES_CLUSTER_SCHEMA_MISMATCH',
]);
