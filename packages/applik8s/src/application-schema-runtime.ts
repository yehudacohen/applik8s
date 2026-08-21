import type { ApplicationMessageContractSchema } from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';
import { validateRuntimeMessage } from './runtime-schema-validation.js';

/** Focused schema normalization used by generated runtimes without authoring/compiler imports. */
export function declaredSchema<T extends object>(input: SchemaInput<T>, name: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(input, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`applik8s-workflow-schema-unsupported: ${name}: ${emitted.error.message}`);
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema };
}

export function validateMessage<T extends object>(schema: SchemaInput<T>, value: unknown, name: string): T {
  return validateRuntimeMessage(schema, value, name);
}
