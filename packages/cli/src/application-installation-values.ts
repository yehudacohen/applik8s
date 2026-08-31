// typecast-file-boundary: Concrete installation values are recursively normalized from unknown serialized graph data at this checked materialization boundary.
import { evaluate } from 'cel-js';

interface ResolveApplicationInstallationValueOptions {
  readonly preserveUnknownReferences?: boolean;
  /** Select provider branches, but retain their installation expressions for KRO instance-time evaluation. */
  readonly preserveInstallationReferences?: boolean;
}

const APPLICATION_OMIT = Symbol('applik8s.application-installation.omit');

/** Resolve direct installation-schema references at the deployment boundary. */
export function resolveApplicationInstallationValues<T>(
  value: T,
  spec: Readonly<Record<string, unknown>>,
  options: ResolveApplicationInstallationValueOptions = {},
): T {
  return resolveValue(value, spec, new WeakMap(), options) as T;
}

function resolveValue(value: unknown, spec: Readonly<Record<string, unknown>>, seen: WeakMap<object, unknown>, options: ResolveApplicationInstallationValueOptions): unknown {
  if (typeof value === 'string') return resolveString(value, spec, options);
  if (!value || typeof value !== 'object') return value;
  const providerSelection = applicationProviderSelection(value);
  if (providerSelection) {
    let selected: unknown;
    try {
      selected = installationSpecPath(spec, providerSelection.selector);
    } catch (error) {
      if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return value;
      throw error;
    }
    if (typeof selected !== 'string') {
      throw new Error(`Application provider selection ${providerSelection.selector} must resolve to a string discriminator.`);
    }
    const branch = Object.hasOwn(providerSelection.cases, selected)
      ? providerSelection.cases[selected]
      : providerSelection.default;
    return resolveValue(branch, spec, seen, options);
  }
  const descriptorExpression = applicationInstallationExpression(value);
  if (descriptorExpression) {
    if (options.preserveInstallationReferences) return value;
    try {
      return resolveApplicationSchemaExpression(descriptorExpression, spec);
    } catch (error) {
      if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return value;
      throw error;
    }
  }
  const previous = seen.get(value);
  if (previous !== undefined) return previous;
  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    seen.set(value, resolved);
    for (const entry of value) {
      const next = resolveValue(entry, spec, seen, options);
      if (next !== APPLICATION_OMIT) resolved.push(next);
    }
    return resolved;
  }
  const resolved: Record<string, unknown> = {};
  seen.set(value, resolved);
  for (const [key, entry] of Object.entries(value)) {
    const next = resolveValue(entry, spec, seen, options);
    if (next !== APPLICATION_OMIT) resolved[key] = next;
  }
  return resolved;
}

function applicationProviderSelection(value: object): {
  readonly selector: string;
  readonly cases: Readonly<Record<string, unknown>>;
  readonly default: unknown;
} | undefined {
  if (Reflect.get(value, 'kind') !== 'application-provider-selection') return undefined;
  const selector = Reflect.get(value, 'selector');
  const cases = Reflect.get(value, 'cases');
  if (!directInstallationPath(selector) || !cases || typeof cases !== 'object' || Array.isArray(cases) || !Object.hasOwn(value, 'default')) {
    throw new Error('Application provider selection must use a direct schema.spec string discriminator and declare a default provider.');
  }
  return { selector, cases: cases as Readonly<Record<string, unknown>>, default: Reflect.get(value, 'default') };
}

function applicationInstallationExpression(value: object): string | undefined {
  if (Object.keys(value).length !== 1) return undefined;
  const expression = Reflect.get(value, 'expression');
  return directInstallationPath(expression) ? expression : undefined;
}

function resolveString(value: string, spec: Readonly<Record<string, unknown>>, options: ResolveApplicationInstallationValueOptions): unknown {
  if (options.preserveInstallationReferences) return value;
  const complete = /^\$\{(schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\}$/.exec(value);
  if (complete?.[1]) {
    try {
      return installationSpecPath(spec, complete[1]);
    } catch (error) {
      if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return value;
      throw error;
    }
  }
  const computed = /^\$\{(.+)\}$/.exec(value);
  if (computed?.[1]) {
    if (supportedApplicationSchemaExpression(
      concretizeApplicationHasExpressions(computed[1], spec),
    )) {
      try {
        return resolveApplicationSchemaExpression(computed[1], spec);
      } catch (error) {
        if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return value;
        throw error;
      }
    }
    const resolved = resolveApplicationStringExpression(computed[1], spec, options);
    if (resolved !== undefined) return resolved;
  }
  return value.replace(/\$\{(schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\}/g, (_match, path: string) => {
    let resolved: unknown;
    try {
      resolved = installationSpecPath(spec, path);
    } catch (error) {
      if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return _match;
      throw error;
    }
    if (typeof resolved !== 'string' && typeof resolved !== 'number' && typeof resolved !== 'boolean') {
      throw new Error(`Application installation reference ${path} cannot be interpolated because it does not resolve to a primitive value.`);
    }
    return String(resolved);
  });
}

/**
 * Materialize only the schema-only CEL grammar emitted by app.select/when/all.
 * Authored CEL that mentions resources, methods, collections, or arbitrary
 * functions stays deferred to KRO. This gives deployment lowering the same
 * concrete branch as the generated graph without introducing an eval surface.
 */
function resolveApplicationSchemaExpression(expression: string, spec: Readonly<Record<string, unknown>>): unknown {
  if (directInstallationPathPattern.test(expression)) return installationSpecPath(spec, expression);
  const concretizedExpression = concretizeApplicationHasExpressions(expression, spec);
  if (!supportedApplicationSchemaExpression(concretizedExpression)) {
    throw new Error(`Unsupported Application installation expression ${expression}.`);
  }
  try {
    const resolved = evaluate(
      concretizedExpression,
      {
        schema: {
          spec: installationSpecWithAbsentReferences(concretizedExpression, spec),
        },
      },
      {
        string: (value: unknown) => String(value),
        dyn: <T>(value: T): T => value,
        omit: () => APPLICATION_OMIT,
      },
    );
    if (resolved === undefined || resolved === null) throw new Error('expression resolved to an absent value');
    return resolved;
  } catch (error) {
    throw new MissingApplicationInstallationValueError(expression, error);
  }
}

/**
 * TypeKro lowers optional JavaScript access into CEL `has(schema.spec.path)`
 * guards. Deployment planning must choose the same concrete branch before a
 * nested composition sees the value, but it must not gain a general CEL
 * reflection surface. Concretize only exact direct installation paths and do
 * not inspect quoted fallback data.
 */
function concretizeApplicationHasExpressions(
  expression: string,
  spec: Readonly<Record<string, unknown>>,
): string {
  let resolved = '';
  let index = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  while (index < expression.length) {
    const character = expression[index] ?? '';
    if (quote) {
      resolved += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      resolved += character;
      index += 1;
      continue;
    }
    const previous = index === 0 ? '' : expression[index - 1] ?? '';
    if (
      expression.startsWith('has', index)
      && !/[A-Za-z0-9_]/.test(previous)
    ) {
      const match = /^has\s*\(\s*(schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\)/.exec(
        expression.slice(index),
      );
      if (match?.[1]) {
        resolved += installationSpecHasPath(spec, match[1]) ? 'true' : 'false';
        index += match[0].length;
        continue;
      }
    }
    resolved += character;
    index += 1;
  }
  return resolved;
}

function installationSpecHasPath(
  spec: Readonly<Record<string, unknown>>,
  path: string,
): boolean {
  if (!directInstallationPath(path)) return false;
  let current: unknown = spec;
  for (const segment of path.split('.').slice(2)) {
    if (
      !current
      || typeof current !== 'object'
      || Array.isArray(current)
      || !Object.hasOwn(current, segment)
    ) return false;
    current = Reflect.get(current, segment);
  }
  return true;
}

/**
 * CEL implementations may resolve member paths before choosing a conditional
 * branch. Profile schemas intentionally omit fields that belong only to an
 * inactive variant, so give those paths an inert null leaf while preserving
 * every authored value. If the selected branch actually needs one, the final
 * absent-value check still fails closed.
 */
function installationSpecWithAbsentReferences(
  expression: string,
  spec: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const copy = structuredClone(spec) as Record<string, unknown>;
  for (const match of expression.matchAll(
    /\bschema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/g,
  )) {
    const segments = (match[1] ?? '').split('.').filter(Boolean);
    let cursor = copy;
    for (const [index, segment] of segments.entries()) {
      if (index === segments.length - 1) {
        if (!Object.hasOwn(cursor, segment)) cursor[segment] = null;
        continue;
      }
      const current = cursor[segment];
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        if (current !== undefined) break;
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
  }
  return copy;
}

function supportedApplicationSchemaExpression(expression: string): boolean {
  if (expression.length > 4_096 || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|\b)/.test(expression)) return false;
  if (directInstallationPathPattern.test(expression)) return true;
  if (!expression.includes('schema.spec.')) return false;
  if (/schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+\s*\(/.test(expression)) return false;
  const withoutStrings = expression.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const withoutReferences = withoutStrings.replace(/\bschema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g, '');
  const withoutFunctions = withoutReferences.replace(
    /\b(?:string|dyn|omit)(?=\s*\()/g,
    '',
  );
  const withoutLiterals = withoutFunctions.replace(/\b(?:true|false|null)\b/g, '');
  const withoutNumbers = withoutLiterals.replace(/\b\d+(?:\.\d+)?\b/g, '');
  return /^[\s()?:=!<>&|+*/%.,\-"']+$/.test(withoutNumbers);
}

/**
 * Evaluate only the string-concatenation grammar emitted by app.interpolate.
 * Unknown CEL remains untouched; deployment lowering never evaluates
 * arbitrary authored expressions.
 */
function resolveApplicationStringExpression(
  expression: string,
  spec: Readonly<Record<string, unknown>>,
  options: { readonly preserveUnknownReferences?: boolean },
): string | undefined {
  const terms = expression.split(/\s+\+\s+/);
  if (terms.length < 2) return undefined;
  const resolved: string[] = [];
  for (const term of terms) {
    const reference = /^string\((schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\)$/.exec(term)?.[1];
    if (reference) {
      let value: unknown;
      try {
        value = installationSpecPath(spec, reference);
      } catch (error) {
        if (options.preserveUnknownReferences && error instanceof MissingApplicationInstallationValueError) return undefined;
        throw error;
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Application installation reference ${reference} cannot be interpolated because it does not resolve to a primitive value.`);
      }
      resolved.push(String(value));
      continue;
    }
    if (!/^"(?:[^"\\]|\\.)*"$/.test(term)) return undefined;
    const literal = JSON.parse(term) as unknown;
    if (typeof literal !== 'string') return undefined;
    resolved.push(literal);
  }
  return resolved.join('');
}

function installationSpecPath(spec: Readonly<Record<string, unknown>>, path: string): unknown {
  if (!directInstallationPath(path)) throw new Error(`Unsupported Application installation expression ${path}. Deployment lowering accepts direct schema.spec paths only.`);
  let current: unknown = spec;
  for (const segment of path.split('.').slice(2)) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, segment)) {
      throw new MissingApplicationInstallationValueError(path);
    }
    current = Reflect.get(current, segment);
  }
  if (current === undefined || current === null) throw new Error(`Application installation deployment value ${path} must not be null or undefined.`);
  return current;
}

class MissingApplicationInstallationValueError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`Application installation spec does not define required deployment value ${path}.`, cause === undefined ? undefined : { cause });
    this.name = 'MissingApplicationInstallationValueError';
  }
}

function directInstallationPath(value: unknown): value is string {
  return typeof value === 'string' && directInstallationPathPattern.test(value);
}

const directInstallationPathPattern = /^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;
