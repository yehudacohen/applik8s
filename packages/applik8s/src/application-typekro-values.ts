// typecast-file-boundary: TypeKro/CEL installation values are parsed with a bounded grammar and structurally checked before typed materialization.
import { Cel } from 'typekro';

/**
 * Apply a TypeKro condition without emitting concrete boolean literals that
 * KRO rejects in includeWhen. A true condition is unconditional and therefore
 * omitted; false is preserved as a standalone CEL expression; schema-derived
 * booleans retain their branded TypeKro value.
 */
export function applyApplicationTypeKroIncludeWhen(
  resource: { withIncludeWhen(condition: boolean): unknown },
  condition: boolean,
): void {
  if (condition === true) return;
  resource.withIncludeWhen(condition === false ? Cel.expr<boolean>('false') : condition);
}

/** Build one string that remains concrete in direct mode and composable in KRO mode. */
export function applicationTypeKroString(...parts: readonly unknown[]): string {
  const expressions = parts.map(applicationTypeKroExpression);
  if (expressions.every((expression) => expression === undefined)) {
    return parts.map((part) => String(part ?? '')).join('');
  }
  // Preserve a direct string reference canonically. Besides avoiding noisy
  // `string(...)` wrappers, this keeps independently normalized copies of the
  // same installation field byte-identical for namespace safety checks.
  if (parts.length === 1 && expressions[0]) return Cel.expr<string>(expressions[0]);
  const expression = parts.map((part, index) => {
    const dynamic = expressions[index];
    if (dynamic) return `string(${dynamic})`;
    if (part === undefined || part === null) return '""';
    if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') return JSON.stringify(String(part));
    throw new Error('A TypeKro-composable string may contain only primitive literals and TypeKro references.');
  }).join(' + ');
  return Cel.expr<string>(expression);
}

/**
 * Compose framework-owned installation values into a string without exposing
 * TypeKro/CEL details to provider adapters. Concrete values use ordinary
 * JavaScript concatenation; installation references remain graph expressions.
 */
export function applicationValueString(...parts: readonly unknown[]): string {
  return applicationTypeKroString(...parts);
}

/**
 * Encode a string array for an environment variable without serializing
 * TypeKro references into nested `${...}` marker text. The returned value is
 * concrete JSON in direct mode and one CEL string expression in KRO mode.
 *
 * Provider endpoints are URI-like values and therefore cannot contain the
 * JSON string delimiters that would require a second escaping pass.
 */
export function applicationTypeKroJsonStringArray(values: readonly unknown[]): string {
  const expressions = values.map(applicationTypeKroExpression);
  if (expressions.every((expression) => expression === undefined)) {
    return JSON.stringify(values.map((value) => String(value)));
  }
  const parts: unknown[] = ['["'];
  values.forEach((value, index) => {
    if (index > 0) parts.push('","');
    parts.push(value);
  });
  parts.push('"]');
  return applicationTypeKroString(...parts);
}

export function applicationTypeKroValueIdentity(value: unknown): string {
  return applicationTypeKroExpression(value) ?? String(value ?? '');
}

/** Internal expression projection used by typed Application graph helpers. */
export function applicationTypeKroExpressionValue(value: unknown): string | undefined {
  return applicationTypeKroExpression(value);
}

export function applicationTypeKroGreaterThan(value: number, threshold: number): boolean {
  const expression = applicationTypeKroExpression(value);
  // Parenthesize the operand because installation selections commonly lower
  // to nested CEL ternaries, whose precedence would otherwise change the
  // branch type (for example `condition ? 1 : 3 > 1`).
  return expression ? Cel.expr<boolean>(`(${expression}) > ${threshold}`) : value > threshold;
}

/** Preserve JavaScript nullish-default semantics for direct and KRO profile values. */
export function applicationValueDefault<T>(value: T | null | undefined, fallback: T): T {
  // typecast: this framework boundary deliberately preserves the caller's
  // exact generic shape while TypeKro exposes separate scalar/object overloads.
  return Cel.default(value as never, fallback as never) as T;
}

/** Preserve a TypeKro value in non-Kubernetes artifacts such as the ApplicationGraph. */
export function applicationTypeKroSerializedValue(value: unknown): string {
  const expression = applicationTypeKroExpression(value);
  return expression ? `\${${expression}}` : String(value ?? '');
}

/**
 * JSON-normalize provider metadata without erasing TypeKro references. This is
 * the graph-boundary counterpart to JSON.stringify/parse: unsupported values
 * are omitted, array holes become null, and references become portable KRO
 * expression strings.
 */
export function applicationTypeKroGraphValue(value: unknown): unknown {
  return graphValue(value, new WeakSet());
}

function graphValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (typeof value !== 'object') return undefined;
  const expression = applicationTypeKroExpression(value);
  if (expression) return `\${${expression}}`;
  if (ancestors.has(value)) throw new Error('Application provider configuration must not contain circular values.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => graphValue(entry, ancestors) ?? null);
    const toJSON = Reflect.get(value, 'toJSON');
    if (typeof toJSON === 'function') return graphValue(Reflect.apply(toJSON, value, []), ancestors);
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
      const normalized = graphValue(entry, ancestors);
      return normalized === undefined ? [] : [[key, normalized]];
    }));
  } finally {
    ancestors.delete(value);
  }
}

function applicationTypeKroExpression(value: unknown): string | undefined {
  // ApplicationGraph is a portable JSON boundary. It represents a branded
  // TypeKro value as one complete `${...}` marker, so accept that exact form
  // when a later composition stage hydrates the graph. Partial/interpolated
  // strings remain ordinary application data.
  if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
    return value.slice(2, -1);
  }
  const serializedSchemaReference = typeof value === 'string'
    ? value.match(/^__KUBERNETES_REF___schema___([A-Za-z0-9_.]+)__$/)
    : undefined;
  if (serializedSchemaReference?.[1]) {
    return `schema.${serializedSchemaReference[1]}`;
  }
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    const resourceId = Reflect.get(value, 'resourceId');
    const fieldPath = Reflect.get(value, 'fieldPath');
    if (resourceId === '__schema__' && typeof fieldPath === 'string') return `schema.${fieldPath}`;
    if (typeof resourceId === 'string' && typeof fieldPath === 'string') return `${resourceId}.${fieldPath}`;
  }
  const expression = Reflect.get(value, 'expression');
  return typeof expression === 'string' && (
    Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    || Object.keys(value).every((key) => key === 'expression' || key === '__isTemplate')
  )
    ? expression
    : undefined;
}
// typecast-file-boundary: TypeKro/CEL installation values are parsed with a bounded grammar and structurally checked before typed materialization.
