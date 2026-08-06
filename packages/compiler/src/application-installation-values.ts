/**
 * Preserve a TypeKro reference embedded in the serialized ApplicationGraph as
 * a KRO expression string. Graph values pass through JSON before workload
 * lowering, so accept both live branded references and their plain descriptor
 * representation.
 */
export function applicationGraphStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const reference = value.match(/^__KUBERNETES_REF___schema___([A-Za-z0-9_.]+)__$/);
    return reference?.[1] ? `\${schema.${reference[1]}}` : value;
  }
  if (!isObjectLike(value)) return undefined;
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    const resourceId = Reflect.get(value, 'resourceId');
    const fieldPath = Reflect.get(value, 'fieldPath');
    if (resourceId === '__schema__' && nonEmptyString(fieldPath)) return `\${schema.${fieldPath}}`;
    if (nonEmptyString(resourceId) && nonEmptyString(fieldPath)) return `\${${resourceId}.${fieldPath}}`;
  }
  const expression = Reflect.get(value, 'expression');
  if ((
    Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    || Object.keys(value).every((key) => key === 'expression' || key === '__isTemplate')
  ) && nonEmptyString(expression)) {
    return `\${${expression}}`;
  }
  return undefined;
}

/** Compose literals and serialized ApplicationGraph expressions as one KRO string. */
export function applicationGraphInterpolate(
  ...parts: readonly unknown[]
): string {
  const values = parts.map(applicationGraphStringValue);
  const expressions = values.map(applicationGraphExpression);
  if (expressions.every((expression) => expression === undefined)) {
    return values.map((value) => value ?? '').join('');
  }
  const expression = values
    .map((value, index) => {
      const dynamic = expressions[index];
      return dynamic ? `string(${dynamic})` : JSON.stringify(value ?? '');
    })
    .join(' + ');
  return `\${${expression}}`;
}

/**
 * Encode graph-aware endpoint values as one JSON string expression suitable
 * for Kubernetes environment variables. This prevents `${...}` references
 * from becoming nested marker text after JSON serialization.
 */
export function applicationGraphJsonStringArray(
  values: readonly unknown[],
): string {
  const strings = values.map(applicationGraphStringValue);
  const expressions = strings.map(applicationGraphExpression);
  if (expressions.every((expression) => expression === undefined)) {
    return JSON.stringify(strings.map((value) => value ?? ''));
  }
  const parts: string[] = [JSON.stringify('["')];
  strings.forEach((value, index) => {
    if (index > 0) parts.push(JSON.stringify('","'));
    const dynamic = expressions[index];
    parts.push(dynamic ? `string(${dynamic})` : JSON.stringify(value ?? ''));
  });
  parts.push(JSON.stringify('"]'));
  return `\${${parts.join(' + ')}}`;
}

function applicationGraphExpression(value: string | undefined): string | undefined {
  return value?.startsWith('${') && value.endsWith('}')
    ? value.slice(2, -1)
    : undefined;
}

export function applicationGraphServiceHost(name: string, namespace: unknown): string {
  return `${name}.${applicationGraphStringValue(namespace) ?? 'default'}.svc.cluster.local`;
}

export function applicationGraphNumberValue(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const expression = applicationGraphStringValue(value);
  return expression?.startsWith('${') ? expression : undefined;
}

/** Preserve a concrete or installation-derived boolean as a KRO includeWhen value. */
export function applicationGraphBooleanCondition(value: unknown): string | undefined {
  if (typeof value === 'boolean') return String(value);
  const expression = applicationGraphStringValue(value);
  return expression?.startsWith('${') ? expression : undefined;
}

/** Combine typed installation booleans into one KRO includeWhen expression. */
export function applicationGraphAllConditions(...values: readonly unknown[]): string | undefined {
  const conditions = values
    .map(applicationGraphBooleanCondition)
    .filter((value): value is string => value !== undefined && value !== 'true');
  if (conditions.includes('false')) return 'false';
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return `\${${conditions.map((condition) => {
    const trimmed = condition.trim();
    return `(${trimmed.startsWith('${') && trimmed.endsWith('}') ? trimmed.slice(2, -1) : trimmed})`;
  }).join(' && ')}}`;
}

/** Normalize a compiler boolean into KRO's standalone-expression grammar. */
export function applicationKroIncludeWhen(condition: string | undefined): string | undefined {
  if (condition === undefined || condition === 'true') return undefined;
  if (condition === 'false') return '${false}';
  if (condition.startsWith('${') && condition.endsWith('}')) return condition;
  throw new Error(`KRO includeWhen condition must be a standalone expression, received ${JSON.stringify(condition)}.`);
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
