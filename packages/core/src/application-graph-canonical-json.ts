/**
 * Adapts provider-owned reference objects into the portable marker strings
 * accepted by the application-graph Canonical JSON contract.
 */
export function adaptApplicationGraphCanonicalJsonV1(value: unknown): unknown {
  return adaptApplicationGraphValue(value, new WeakMap<object, object>());
}

function adaptApplicationGraphValue(
  value: unknown,
  seen: WeakMap<object, object>,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  const reference = serializedApplicationGraphReference(value);
  if (reference !== undefined) return reference;
  const previous = seen.get(value);
  if (previous) return previous;
  if (Array.isArray(value)) {
    const adapted: unknown[] = [];
    seen.set(value, adapted);
    for (const entry of value) {
      adapted.push(adaptApplicationGraphValue(entry, seen));
    }
    return adapted;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const adapted: Record<string, unknown> = {};
  seen.set(value, adapted);
  for (const [key, entry] of Object.entries(value)) {
    adapted[key] = adaptApplicationGraphValue(entry, seen);
  }
  return adapted;
}

function serializedApplicationGraphReference(value: object): string | undefined {
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    const resourceId = Reflect.get(value, 'resourceId');
    const fieldPath = Reflect.get(value, 'fieldPath');
    if (resourceId === '__schema__' && nonEmptyString(fieldPath)) {
      return `\${schema.${fieldPath}}`;
    }
    if (nonEmptyString(resourceId) && nonEmptyString(fieldPath)) {
      return `\${${resourceId}.${fieldPath}}`;
    }
  }
  const expression = Reflect.get(value, 'expression');
  const keys = Object.keys(value);
  if (nonEmptyString(expression) && (
    Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    || keys.every((key) => key === 'expression' || key === '__isTemplate')
  )) {
    return `\${${expression}}`;
  }
  return undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
