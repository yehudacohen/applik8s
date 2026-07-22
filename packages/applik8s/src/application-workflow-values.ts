import type { ApplicationGraphNumberValue } from '@applik8s/core';
import { applicationTypeKroExpressionValue, applicationTypeKroGraphValue } from './application-typekro-values.js';

export function applicationWorkflowKubernetesName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function applicationWorkflowAlias(alias: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) throw new Error(`Workflow dependency alias ${JSON.stringify(alias)} must start with a letter and contain only letters, digits, underscore, or dash.`);
  return alias;
}

export function applicationWorkflowCron(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, ' ');
  if (normalized.split(' ').length !== 5) throw new Error(`Workflow cron ${JSON.stringify(expression)} must contain exactly five fields.`);
  return normalized;
}

export function positiveApplicationWorkflowInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function positiveApplicationWorkflowGraphInteger(value: number, name: string): ApplicationGraphNumberValue {
  const expression = applicationTypeKroExpressionValue(value);
  return expression ? `\${${expression}}` : positiveApplicationWorkflowInteger(value, name);
}

export function positiveApplicationWorkflowNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

export function applicationWorkflowJsonObject(value: unknown): Record<string, never> {
  // typecast: provider constructors validate their shape; normalization removes unsupported values while retaining installation-derived TypeKro strings.
  return applicationTypeKroGraphValue(value) as Record<string, never>;
}
