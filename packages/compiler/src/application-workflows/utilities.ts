import { createHash } from 'node:crypto';

export function objectConfig(value: unknown): Readonly<Record<string, unknown>> {
  // typecast: the runtime guard narrows unknown to a non-array object whose fields are read defensively.
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

export function stringConfig(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function numberConfig(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function kubernetesName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function jsName(value: string): string {
  return `declaration_${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

export function workflowObjectEnabledEnvironment(storeId: string): string {
	return `APPLIK8S_TASK_OBJECT_ENABLED_${createHash('sha256').update(storeId).digest('hex').slice(0, 12).toUpperCase()}`;
}
