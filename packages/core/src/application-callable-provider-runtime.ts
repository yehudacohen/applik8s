// typecast-file-boundary: Branded callable-provider handles are validated through private symbols and exact operation contracts before receiver generics are restored.
import type { ApplicationProviderNode } from './application-graph-contract.js';

export type ApplicationCallableProviderRuntimeEnvironmentSource =
  | { readonly kind: 'value'; readonly value: string }
  | {
      readonly kind: 'secret';
      readonly namespace?: string;
      readonly name: string;
      readonly key: string;
      readonly optional: boolean;
    };

export interface ApplicationCallableProviderRuntimeEnvironmentEntry {
  readonly providerId: string;
  readonly name: string;
  readonly source: ApplicationCallableProviderRuntimeEnvironmentSource;
}

/**
 * Resolves provider-authored runtime bindings without loading provider
 * implementations. Target adapters consume this neutral projection and remain
 * responsible for materializing values and Secret keys without exposing them
 * to application artifacts.
 */
export function resolveApplicationCallableProviderRuntimeEnvironment(
  providers: readonly ApplicationProviderNode[],
  options: {
    readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
    /** Select one concrete branch when the target installation is known. */
    readonly profile?: string;
    readonly namespace?: string;
  },
): readonly ApplicationCallableProviderRuntimeEnvironmentEntry[] {
  const result = new Map<string, ApplicationCallableProviderRuntimeEnvironmentEntry>();
  for (const provider of providers) {
    const binding = provider.config?.callableRuntime;
    if (!binding) continue;
    const environment = runtimeEnvironment(binding, provider, options);
    for (const [name, source] of environment) {
      const entry = { providerId: provider.id, name, source } as const;
      const previous = result.get(name);
      if (previous && JSON.stringify(previous.source) !== JSON.stringify(source)) {
        throw new Error(
          `Callable providers ${previous.providerId} and ${provider.id} assigned to one workload declare conflicting runtime environment ${name}.`,
        );
      }
      result.set(name, entry);
    }
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function runtimeEnvironment(
  candidate: unknown,
  provider: ApplicationProviderNode,
  options: {
    readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
    readonly profile?: string;
    readonly namespace?: string;
  },
): ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource> {
  const binding = record(candidate, `provider ${provider.id} callable runtime`);
  const kind = string(binding.kind, `provider ${provider.id} callable runtime kind`);
  if (kind === 'runtime') {
    return directRuntimeEnvironment(
      record(binding.runtime, `provider ${provider.id} runtime binding`),
      provider,
      options.namespace,
    );
  }
  if (kind === 'targetSelection') {
    const targets = record(binding.targets, `provider ${provider.id} callable runtime targets`);
    const selected = targets[options.target];
    if (!selected) throw new Error(`Callable provider ${provider.id} has no ${options.target} runtime binding.`);
    return runtimeEnvironment(selected, provider, options);
  }
  if (kind === 'profileSelection') {
    const cases = record(binding.cases, `provider ${provider.id} callable runtime profile cases`);
    const fallback = binding.default;
    if (!fallback) throw new Error(`Callable provider ${provider.id} profile runtime requires a default branch.`);
    if (options.profile) {
      return runtimeEnvironment(cases[options.profile] ?? fallback, provider, options);
    }
    const selector = string(binding.selector, `provider ${provider.id} callable runtime profile selector`);
    const branches = Object.fromEntries(
      Object.entries(cases).map(([variant, branch]) => [
        variant,
        runtimeEnvironment(branch, provider, options),
      ]),
    );
    if (Object.keys(branches).length === 0) {
      throw new Error(`Callable provider ${provider.id} profile runtime requires at least one named branch.`);
    }
    return selectedRuntimeEnvironment(
      provider,
      selector,
      branches,
      runtimeEnvironment(fallback, provider, options),
    );
  }
  throw new Error(
    `Callable provider ${provider.id} uses unsupported runtime binding kind ${JSON.stringify(kind)}.`,
  );
}

function directRuntimeEnvironment(
  runtime: Readonly<Record<string, unknown>>,
  provider: ApplicationProviderNode,
  workloadNamespace: string | undefined,
): ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource> {
  const result = new Map<string, ApplicationCallableProviderRuntimeEnvironmentSource>();
  for (const [name, value] of Object.entries(optionalRecord(runtime.env))) {
    result.set(name, { kind: 'value', value: string(value, `provider ${provider.id} environment ${name}`) });
  }
  for (const [name, value] of Object.entries(optionalRecord(runtime.secretEnv))) {
    if (result.has(name)) {
      throw new Error(`Callable provider ${provider.id} declares ${name} as both public and Secret-backed environment.`);
    }
    const binding = record(value, `provider ${provider.id} secret environment ${name}`);
    const secret = record(binding.secret, `provider ${provider.id} secret environment ${name} reference`);
    if (string(secret.kind, `provider ${provider.id} secret kind`) !== 'Secret') {
      throw new Error(`Callable provider ${provider.id} secret environment ${name} must reference a Kubernetes Secret.`);
    }
    const secretNamespace = optionalString(secret.namespace);
    if (
      secretNamespace
      && workloadNamespace
      && !isExpression(secretNamespace)
      && !isExpression(workloadNamespace)
      && secretNamespace !== workloadNamespace
    ) {
      throw new Error(
        `Callable provider ${provider.id} cannot project Secret ${secretNamespace}/${String(secret.name)} into workload namespace ${workloadNamespace}.`,
      );
    }
    result.set(name, {
      kind: 'secret',
      ...(secretNamespace ? { namespace: secretNamespace } : {}),
      name: string(secret.name, `provider ${provider.id} secret environment ${name} Secret name`),
      key: string(binding.key, `provider ${provider.id} secret environment ${name} key`),
      optional: binding.optional === true,
    });
  }
  return result;
}

function selectedRuntimeEnvironment(
  provider: ApplicationProviderNode,
  selector: string,
  cases: Readonly<Record<string, ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource>>>,
  fallback: ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource>,
): ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource> {
  const names = new Set([
    ...fallback.keys(),
    ...Object.values(cases).flatMap((branch) => [...branch.keys()]),
  ]);
  const result = new Map<string, ApplicationCallableProviderRuntimeEnvironmentSource>();
  for (const name of names) {
    const values = [
      fallback.get(name),
      ...Object.values(cases).map((branch) => branch.get(name)),
    ].filter((value): value is ApplicationCallableProviderRuntimeEnvironmentSource => value !== undefined);
    const kinds = new Set(values.map((value) => value.kind));
    if (kinds.size > 1) {
      throw new Error(
        `Callable provider ${provider.id} profile binds ${name} as both public and Secret-backed environment. Use distinct stable environment names.`,
      );
    }
    if (values[0]?.kind === 'value') {
      result.set(name, {
        kind: 'value',
        value: selectedScalar(selector, cases, fallback, (source) => source?.kind === 'value' ? source.value : '', name),
      });
      continue;
    }
    result.set(name, {
      kind: 'secret',
      name: selectedScalar(selector, cases, fallback, (source) => source?.kind === 'secret' ? source.name : 'applik8s-callable-provider-unused', name),
      key: selectedScalar(selector, cases, fallback, (source) => source?.kind === 'secret' ? source.key : 'unused', name),
      optional: values.some((value) => value.kind === 'secret' && value.optional)
        || Object.values(cases).some((branch) => !branch.has(name))
        || !fallback.has(name),
    });
  }
  return result;
}

function selectedScalar(
  selector: string,
  cases: Readonly<Record<string, ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource>>>,
  fallback: ReadonlyMap<string, ApplicationCallableProviderRuntimeEnvironmentSource>,
  select: (source: ApplicationCallableProviderRuntimeEnvironmentSource | undefined) => string,
  name: string,
): string {
  const expression = expressionBody(selector);
  const fallbackValue = select(fallback.get(name));
  const entries = Object.entries(cases);
  const values = [...entries.map(([, branch]) => select(branch.get(name))), fallbackValue];
  if (values.every((value) => value === values[0])) return values[0] ?? '';
  const selected = entries.reduceRight(
    (otherwise, [variant, branch]) =>
      `(${expression}) == ${JSON.stringify(variant)} ? (${celScalar(select(branch.get(name)))}) : (${otherwise})`,
    celScalar(fallbackValue),
  );
  return `\${${selected}}`;
}

function expressionBody(value: string): string {
  const normalized = value.trim();
  const expression = /^\$\{([\s\S]+)\}$/u.exec(normalized)?.[1] ?? normalized;
  if (!/^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u.test(expression)) {
    throw new Error(
      `Callable provider profile selector ${JSON.stringify(value)} must be a direct installation-spec path.`,
    );
  }
  return expression;
}

function celScalar(value: string): string {
  const expression = /^\$\{([\s\S]+)\}$/u.exec(value)?.[1];
  return expression ?? JSON.stringify(value);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value === undefined ? {} : record(value, 'Callable provider runtime field');
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string; received ${JSON.stringify(value)}.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isExpression(value: string): boolean {
  return /^\$\{[\s\S]+\}$/u.test(value);
}
// typecast-file-boundary: Branded callable-provider handles are validated through private symbols and exact operation contracts before receiver generics are restored.
