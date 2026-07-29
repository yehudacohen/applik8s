import type { Type } from 'arktype';
import type { ApplicationQueryBinding } from './application-queries.js';

export function validateQueryInput<TInput>(query: ApplicationQueryBinding<TInput>, value: unknown): TInput {
  return validateArkType(query.id, 'input', query.input, value);
}

export function validateQueryOutput<TOutput>(query: ApplicationQueryBinding<unknown, TOutput>, value: unknown): TOutput {
  return validateArkType(query.id, 'output', query.output, value);
}

function validateArkType<TValue>(query: string, direction: 'input' | 'output', schema: Type<TValue>, value: unknown): TValue {
  const result = schema(value);
  if (result && typeof result === 'object' && 'summary' in result) throw new Error(`Application query ${query} ${direction} validation failed: ${String(Reflect.get(result, 'summary'))}`);
  // typecast: ArkType returns TValue after the error-shape branch above rejects validation failures.
  return result as TValue;
}
