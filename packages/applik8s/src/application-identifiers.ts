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

export function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function pascalCase(value: string): string {
  const parts = kubernetesNameSegment(value).split(/[-.]+/).filter(Boolean);
  const result = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('');
  return result || 'App';
}

export function pluralizeKubernetesKind(kind: string): string {
  const segment = kubernetesNameSegment(kind).replaceAll('-', '');
  if (segment.endsWith('y')) return `${segment.slice(0, -1)}ies`;
  if (segment.endsWith('s')) return `${segment}es`;
  return `${segment}s`;
}
