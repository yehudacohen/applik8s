import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';

/**
 * Validates one runtime message without importing any authoring-time callback,
 * provider, or deployment machinery.
 */
export function validateRuntimeMessage<T extends object>(
  schema: SchemaInput<T>,
  value: unknown,
  name: string,
): T {
  // typecast: schema validation intentionally accepts the untrusted unknown value.
  const validated = normalizeSchema(schema, name).validate(value as never);
  if (!validated.ok) {
    throw new Error(
      `applik8s-workflow-schema-invalid: ${name}: ${validated.error.message}`,
    );
  }
  // typecast: successful validation proves the caller's generic message contract.
  return validated.value as T;
}
