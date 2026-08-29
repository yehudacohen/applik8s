import type { JsonValue, RuntimeSchema } from '@applik8s/core';
import type { Type } from 'arktype';
import type { ApplicationQueryBinding } from './application-queries.js';

export function validateQueryInput<TInput>(query: ApplicationQueryBinding<TInput>, value: unknown): TInput {
  return validateQuerySchema(query.id, 'input', query.input, value);
}

export function validateQueryOutput<TOutput>(query: ApplicationQueryBinding<unknown, TOutput>, value: unknown): TOutput {
  return validateQuerySchema(query.id, 'output', query.output, value);
}

// typecast-boundary: heterogeneous query catalogs erase their schema source;
// this function restores the phantom value type only after the corresponding
// ArkType or normalized runtime validator has accepted the value.
function validateQuerySchema<TValue>(
  query: string,
  direction: 'input' | 'output',
  schema: Type<TValue> | RuntimeSchema<object>,
  value: unknown,
): TValue {
  if (typeof schema === 'function') {
    const result = (schema as Type<TValue>)(value);
    if (result && typeof result === 'object' && 'summary' in result) throw new Error(`Application query ${query} ${direction} validation failed: ${String(Reflect.get(result, 'summary'))}`);
    // typecast: ArkType returns TValue after the error-shape branch above rejects validation failures.
    return result as TValue;
  }
  const result = schema.validate(value as JsonValue);
  if (!result.ok) {
    throw new Error(`Application query ${query} ${direction} validation failed: ${result.error.message}`);
  }
  // typecast: the schema's phantom TValue and runtime validator describe the
  // same public contract; the erased binding widens only heterogeneous catalogs.
  return result.value as TValue;
}
