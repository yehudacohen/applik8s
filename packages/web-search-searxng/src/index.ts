import type {
  ApplicationWebSearchProvider,
} from '@applik8s/web-search';
import { applicationValueString } from '@applik8s/applik8s';
import { bindApplicationWebSearchProviderRuntime } from '@applik8s/web-search/runtime-contract';
import { createSearxngApplicationWebSearch } from './runtime.js';

export interface SearxngSecretKeyReference {
  readonly name: string;
  readonly key?: string;
}

export interface ManagedSearxngWebSearchOptions {
  readonly name?: string;
  readonly namespace?: string;
  readonly secretKeyRef: SearxngSecretKeyReference;
  readonly replicas?: number;
  readonly image?: string;
  readonly redisUrl?: string;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

export interface ExternalSearxngWebSearchOptions {
  readonly endpoint: string;
  readonly allowInsecureHttp?: boolean;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

export interface SearxngWebSearchProvider extends ApplicationWebSearchProvider {
  readonly kind: 'searxng';
  readonly mode: 'live';
  readonly deployment:
    | ({ readonly management: 'typekro' } & ManagedSearxngWebSearchOptions)
    | ({ readonly management: 'external' } & ExternalSearxngWebSearchOptions);
}

export const SearxngWebSearch = Object.freeze({
  managed(options: ManagedSearxngWebSearchOptions): SearxngWebSearchProvider {
    const name = concreteDnsLabel(
      options.name ?? 'web-search',
      'SearXNG name',
    );
    const namespace = concreteDnsLabel(
      options.namespace ?? `${String(name)}-system`,
      'SearXNG namespace',
    );
    validateManagedOptions(options);
    const endpoint = applicationValueString(
      'http://',
      name,
      '.',
      namespace,
      '.svc.cluster.local:8080',
    );
    return provider({
      management: 'typekro',
      ...options,
      name,
      namespace,
    }, endpoint);
  },
  external(options: ExternalSearxngWebSearchOptions): SearxngWebSearchProvider {
    const endpoint = typeof options.endpoint === 'string'
      ? endpointUrl(options.endpoint, options.allowInsecureHttp ?? false)
      : options.endpoint;
    return provider({ ...options, management: 'external', endpoint }, endpoint);
  },
});

function provider(
  deployment: SearxngWebSearchProvider['deployment'],
  endpoint: string,
): SearxngWebSearchProvider {
  const timeoutMs = boundedInteger(
    deployment.timeoutMs ?? 10_000,
    100,
    30_000,
    'SearXNG timeoutMs',
  );
  const maximumResponseBytes = boundedInteger(
    deployment.maximumResponseBytes ?? 2_000_000,
    1_024,
    8_000_000,
    'SearXNG maximumResponseBytes',
  );
  const implementation: SearxngWebSearchProvider = {
    provider: 'searxng',
    kind: 'searxng',
    mode: 'live',
    deployment: Object.freeze(deployment),
    search: createSearxngApplicationWebSearch({
      endpoint,
      timeoutMs,
      maximumResponseBytes,
    }),
  };
  return Object.freeze(bindApplicationWebSearchProviderRuntime(implementation, {
    env: {
      APPLIK8S_WEB_SEARCH_KIND: 'searxng',
      APPLIK8S_WEB_SEARCH_ENDPOINT: endpoint,
      APPLIK8S_WEB_SEARCH_TIMEOUT_MS: String(timeoutMs),
      APPLIK8S_WEB_SEARCH_MAX_RESPONSE_BYTES: String(maximumResponseBytes),
    },
  }));
}

function validateManagedOptions(options: ManagedSearxngWebSearchOptions): void {
  concreteDnsLabel(options.secretKeyRef.name, 'SearXNG Secret name');
  const key = options.secretKeyRef.key ?? 'secret_key';
  if (typeof key === 'string' && !/^[A-Za-z0-9._-]{1,253}$/u.test(key)) {
    throw new Error('SearXNG Secret key must be a valid non-empty Secret data key.');
  }
  if (typeof options.replicas === 'number') {
    boundedInteger(options.replicas, 1, 32, 'SearXNG replicas');
  }
  if (options.image !== undefined && options.image.trim().length === 0) {
    throw new Error('SearXNG image must be non-empty.');
  }
}

function endpointUrl(value: string, allowInsecureHttp: boolean): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('SearXNG endpoint must be an absolute HTTP or HTTPS URL.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('SearXNG endpoint must not embed credentials.');
  }
  if (endpoint.protocol !== 'https:' && !(allowInsecureHttp && endpoint.protocol === 'http:')) {
    throw new Error('External SearXNG endpoints require HTTPS unless allowInsecureHttp is explicitly enabled.');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/u, '');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

function concreteDnsLabel(value: string, label: string): string {
  if (typeof value !== 'string') return value;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) {
    throw new Error(`${label} must be a DNS-1123 label of at most 63 characters.`);
  }
  return value;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
