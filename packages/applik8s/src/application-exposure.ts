import type { ApplicationDnsIntent, ApplicationExposureOptions, ApplicationServerBinding, ApplicationTlsIntent } from './application.js';
import { kubernetesNameSegment } from './application-identifiers.js';
import type { ApplicationDnsPublicationProvider } from './application-providers.js';

export type NormalizedApplicationTlsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName: string };

export function normalizeApplicationTlsIntent(name: string, options: ApplicationExposureOptions): NormalizedApplicationTlsIntent {
  if (options.tls && typeof options.tls === 'object') {
    if (options.tls.mode === 'managed') return { mode: 'managed', secretName: options.tls.secretName ?? options.tlsSecretName ?? `${kubernetesNameSegment(name)}-tls` };
    if (options.tls.mode === 'external') return options.tls;
    return { mode: 'disabled' };
  }
  if (options.tls === 'required' && !options.tlsSecretName) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with tls: "required" requires tlsSecretName so generated Ingress TLS Secret ownership stays explicit.`);
  }
  if (options.tlsSecretName) return { mode: 'external', secretName: options.tlsSecretName };
  return { mode: 'disabled' };
}

export function applicationLegacyTlsMode(tls: ApplicationExposureOptions['tls'], intent: ApplicationTlsIntent): 'required' | 'optional' | 'disabled' {
  if (typeof tls === 'string') return tls;
  return intent.mode === 'disabled' ? 'disabled' : 'required';
}

export function applicationExternalDnsAnnotations(provider: ApplicationDnsPublicationProvider, hostnames: readonly string[], intent: ApplicationDnsIntent): Readonly<Record<string, string>> {
  if (intent.mode !== 'managed') return {};
  const prefix = provider.annotationPrefix ?? 'external-dns.alpha.kubernetes.io';
  return { [`${prefix}/hostname`]: hostnames.join(','), ...(intent.ttlSeconds === undefined ? {} : { [`${prefix}/ttl`]: String(intent.ttlSeconds) }) };
}

export function applicationExposureServiceName(service: string | ApplicationServerBinding | undefined): string | undefined {
  return typeof service === 'string' ? service : service?.serviceName;
}

export function applicationExposureServiceNamespace(service: string | ApplicationServerBinding | undefined): string | undefined {
  return typeof service === 'string' ? undefined : service?.namespace;
}

export function applicationConfigLabels(name: string, component: 'config' | 'secret' | 'exposure'): Readonly<Record<string, string>> {
  return { 'app.kubernetes.io/name': kubernetesNameSegment(name), 'app.kubernetes.io/component': component, 'app.kubernetes.io/managed-by': 'applik8s' };
}
