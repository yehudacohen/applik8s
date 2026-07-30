import type { ApplicationDnsIntent, ApplicationExposureOptions, ApplicationServerBinding } from './application.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import type { ApplicationDnsPublicationProvider, ApplicationHostBinding } from './application-providers.js';
import type { ApplicationGatewayBinding } from './application-reactive.js';

export type NormalizedApplicationTlsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName: string };

export function normalizeApplicationTlsIntent(name: string, options: ApplicationExposureOptions): NormalizedApplicationTlsIntent {
  if (options.tls?.mode === 'managed') {
    return {
      mode: 'managed',
      secretName: options.tls.secretName ?? `${kubernetesNameSegment(name)}-tls`,
    };
  }
  if (options.tls?.mode === 'external') {
    if (!options.tls.secretName.trim()) {
      throw new Error(`app.expose(${JSON.stringify(name)}, ...) with external TLS requires a non-empty secretName.`);
    }
    return options.tls;
  }
  return { mode: 'disabled' };
}

export function applicationExternalDnsAnnotations(provider: ApplicationDnsPublicationProvider, hostnames: readonly string[], intent: ApplicationDnsIntent): Readonly<Record<string, string>> {
  if (intent.mode !== 'managed') return {};
  const prefix = provider.annotationPrefix ?? 'external-dns.alpha.kubernetes.io';
  return { [`${prefix}/hostname`]: hostnames.join(','), ...(intent.ttlSeconds === undefined ? {} : { [`${prefix}/ttl`]: String(intent.ttlSeconds) }) };
}

type ApplicationExposureService = string | ApplicationServerBinding | ApplicationGatewayBinding | ApplicationHostBinding | undefined;

export function applicationExposureServiceName(service: ApplicationExposureService): string | undefined {
  if (typeof service === 'string') return service;
  if (service && 'kind' in service && service.kind === 'applicationHost') return service.service.name;
  return service?.serviceName;
}

export function applicationExposureServiceNamespace(service: ApplicationExposureService): string | undefined {
  if (typeof service === 'string') return undefined;
  if (service && 'kind' in service && service.kind === 'applicationHost') return service.service.namespace;
  return service?.namespace;
}

export function applicationExposureServicePort(service: ApplicationExposureService): number | undefined {
  if (typeof service === 'string' || !service || !('kind' in service)) return undefined;
  if (service.kind === 'applicationHost') return service.service.port;
  return service.kind === 'applicationGateway' ? service.port : undefined;
}

export function applicationConfigLabels(name: string, component: 'config' | 'secret' | 'exposure'): Readonly<Record<string, string>> {
  return { 'app.kubernetes.io/name': kubernetesNameSegment(name), 'app.kubernetes.io/component': component, 'app.kubernetes.io/managed-by': 'applik8s' };
}
