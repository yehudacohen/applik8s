export function apiGroupForApiVersion(apiVersion: string): string {
  return apiVersion.includes('/') ? apiVersion.split('/')[0] ?? '' : '';
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function graphResourceId(name: string, suffix: string): string {
  const parts = `${name}-${suffix}`.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [first = 'resource', ...rest] = parts;
  return `${first.slice(0, 1).toLowerCase()}${first.slice(1)}${rest.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')}`;
}
