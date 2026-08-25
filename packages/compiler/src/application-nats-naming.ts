import { createHash } from 'node:crypto';

/**
 * Produce one identity that is valid both as a Kubernetes resource name and as
 * a JetStream durable consumer name. Kubernetes permits dots that JetStream
 * rejects, so a generic Kubernetes-name normalizer is not sufficient here.
 */
export function jetStreamConsumerName(
  value: string,
  fallback = 'applik8s-consumer',
): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!normalized) return fallback;

  const requiresDisambiguation = /[^A-Za-z0-9-]/u.test(value);
  if (!requiresDisambiguation) return normalized.slice(0, 63).replace(/-+$/u, '') || fallback;

  const suffix = createHash('sha256').update(value).digest('hex').slice(0, 8);
  const prefix = normalized.slice(0, 54).replace(/-+$/u, '') || fallback.slice(0, 54);
  return `${prefix}-${suffix}`;
}
