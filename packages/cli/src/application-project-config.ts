// typecast-file-boundary: package.json and process environment values are validated before becoming CLI defaults.
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ApplicationProjectConfiguration {
  readonly entrypoint?: string;
  readonly compositionName?: string;
  readonly instance?: string;
  readonly context?: string;
  readonly outDir?: string;
}

export async function readApplicationProjectConfiguration(
  cwd: string,
): Promise<ApplicationProjectConfiguration> {
  const packageRoot = await findPackageRoot(cwd);
  if (!packageRoot) return {};
  const path = resolve(packageRoot, 'package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new Error(
      `Application package manifest ${path} is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Application package manifest ${path} must contain an object.`);
  }
  const candidate = Reflect.get(manifest, 'applik8s');
  if (candidate === undefined) return {};
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Application package manifest ${path} applik8s configuration must contain an object.`);
  }
  return {
    ...optionalProjectPath(candidate, 'entrypoint', path),
    ...optionalProjectPath(candidate, 'instance', path),
    ...optionalProjectPath(candidate, 'outDir', path),
    ...optionalProjectString(candidate, 'compositionName', path),
    ...optionalProjectString(candidate, 'context', path),
  };
}

export function resolveApplicationEntrypoint(
  explicit: string | undefined,
  configuration: ApplicationProjectConfiguration,
): string {
  const value = explicit ?? configuration.entrypoint;
  if (!value?.trim()) {
    throw new Error(
      'No application entrypoint was provided. Pass <entrypoint> or declare package.json applik8s.entrypoint.',
    );
  }
  return value;
}

export function resolveApplicationContext(
  explicit: string | undefined,
  configuration: ApplicationProjectConfiguration,
): string {
  const value = explicit ?? process.env.APPLIK8S_CONTEXT ?? configuration.context;
  if (!value?.trim()) {
    throw new Error(
      'No Kubernetes context was provided. Pass --context, set APPLIK8S_CONTEXT, or declare package.json applik8s.context. The ambient current context is never used implicitly.',
    );
  }
  return value;
}

async function findPackageRoot(start: string): Promise<string | undefined> {
  let current = resolve(start);
  while (true) {
    if (await access(resolve(current, 'package.json')).then(() => true).catch(() => false)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function optionalProjectPath(
  value: object,
  key: 'entrypoint' | 'instance' | 'outDir',
  manifestPath: string,
): Readonly<Record<string, string>> {
  const candidate = Reflect.get(value, key);
  if (candidate === undefined) return {};
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.startsWith('/')) {
    throw new Error(
      `Application package manifest ${manifestPath} applik8s.${key} must be a non-empty project-relative path.`,
    );
  }
  return { [key]: candidate };
}

function optionalProjectString(
  value: object,
  key: 'compositionName' | 'context',
  manifestPath: string,
): Readonly<Record<string, string>> {
  const candidate = Reflect.get(value, key);
  if (candidate === undefined) return {};
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(
      `Application package manifest ${manifestPath} applik8s.${key} must be a non-empty string.`,
    );
  }
  return { [key]: candidate };
}
