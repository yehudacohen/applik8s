import { createHash } from 'node:crypto';
import type { SchemaInput } from '@applik8s/sdk';
import { type } from 'arktype';

export { type };

export interface DslExpression {
  readonly expressionKind: string;
  readonly value: string;
  eq(value: unknown): DslPredicate;
  desc(): DslOrdering;
  asc(): DslOrdering;
}

export interface DslPredicate {
  readonly expressionKind: 'predicate';
  readonly left: DslExpression;
  readonly operator: 'eq';
  readonly right: unknown;
}

export interface DslOrdering {
  readonly expressionKind: 'ordering';
  readonly expression: DslExpression;
  readonly direction: 'asc' | 'desc';
}

export interface EntityDefinition<TSpec extends object, TStatus extends object = Record<string, never>> {
  readonly kind: 'applik8sEntity';
  readonly name: string;
  readonly spec: SchemaInput<TSpec>;
  readonly status?: SchemaInput<TStatus>;
}

export function field(path: string): DslExpression {
  return expression('field', path);
}

export function label(name: string): DslExpression {
  return expression('label', name);
}

export function entity<TSpec extends object, TStatus extends object = Record<string, never>>(
  name: string,
  options: { readonly spec: SchemaInput<TSpec>; readonly status?: SchemaInput<TStatus> }
): EntityDefinition<TSpec, TStatus> {
  return {
    kind: 'applik8sEntity',
    name,
    spec: options.spec,
    ...(options.status ? { status: options.status } : {}),
  };
}

export const metadata = {
  creationTimestamp: expression('metadata', 'metadata.creationTimestamp'),
  name: expression('metadata', 'metadata.name'),
};

export function now(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function expression(expressionKind: string, value: string): DslExpression {
  const current: DslExpression = {
    expressionKind,
    value,
    eq(right) {
      return { expressionKind: 'predicate', left: current, operator: 'eq', right };
    },
    desc() {
      return { expressionKind: 'ordering', expression: current, direction: 'desc' };
    },
    asc() {
      return { expressionKind: 'ordering', expression: current, direction: 'asc' };
    },
  };
  return current;
}
