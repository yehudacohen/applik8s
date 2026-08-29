import type { JsonValue } from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import type { Type } from 'arktype';
import type { ApplicationQueryBinding, ApplicationQuerySchema } from './application-queries.js';

export function validateQueryInput<TInput>(query: ApplicationQueryBinding<TInput>, value: unknown): TInput {
  return validateQuerySchema(query.id, 'input', query.input, value);
}

export function validateQueryOutput<TOutput>(query: ApplicationQueryBinding<unknown, TOutput>, value: unknown): TOutput {
  return validateQuerySchema(query.id, 'output', query.output, value);
}

function validateQuerySchema<TValue>(
  query: string,
  direction: 'input' | 'output',
  schema: ApplicationQuerySchema<TValue> | SchemaInput<object>,
  value: unknown,
): TValue {
  if (typeof schema === 'function') {
    const result = (schema as Type<TValue>)(value);
    if (result && typeof result === 'object' && 'summary' in result) throw new Error(`Application query ${query} ${direction} validation failed: ${String(Reflect.get(result, 'summary'))}`);
    // typecast: ArkType returns TValue after the error-shape branch above rejects validation failures.
    return result as TValue;
  }
  const result = normalizeSchema(
    schema as SchemaInput<object>,
    `Application query ${query} ${direction}`,
  ).validate(value as JsonValue);
  if (!result.ok) {
    throw new Error(`Application query ${query} ${direction} validation failed: ${result.error.message}`);
  }
  // typecast: the schema's phantom TValue and runtime validator describe the
  // same public contract; the erased binding widens only heterogeneous catalogs.
  return result.value as TValue;
}
