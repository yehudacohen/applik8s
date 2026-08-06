import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Resolve the stable project root for lifecycle state and generated runtime
 * modules. Invocation cwd is deliberately excluded: the same application must
 * address the same Alchemy stack whether the CLI is run from its package or a
 * workspace root.
 */
export async function resolveApplicationProjectRoot(
  entrypoint: string,
): Promise<string> {
  const resolvedEntrypoint = resolve(entrypoint);
  return await findAncestorContaining(
    dirname(resolvedEntrypoint),
    'package.json',
  ) ?? dirname(resolvedEntrypoint);
}

export async function resolveApplicationBuildPackage(entrypoint: string): Promise<{
  readonly directory: string;
  readonly name?: string;
}> {
  const directory = await findAncestorContaining(
    dirname(resolve(entrypoint)),
    'package.json',
  );
  if (!directory) {
    throw new Error(
      `Application entrypoint ${entrypoint} is not contained by a package.json. Add an application package with a build script, or pass --skip-app-build for an operator-only application.`,
    );
  }
  const path = resolve(directory, 'package.json');
  let manifest: { readonly name?: unknown; readonly scripts?: unknown };
  try {
    // typecast: JSON fields remain unknown until the checks below validate the build-package contract.
    manifest = JSON.parse(await readFile(path, 'utf8')) as {
      readonly name?: unknown;
      readonly scripts?: unknown;
    };
  } catch (cause) {
    throw new Error(
      `Application package manifest ${path} is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const scripts =
    manifest.scripts
    && typeof manifest.scripts === 'object'
    && !Array.isArray(manifest.scripts)
      ? manifest.scripts
      : undefined;
  const build = scripts ? Reflect.get(scripts, 'build') : undefined;
  if (typeof build !== 'string' || !build.trim()) {
    const label =
      typeof manifest.name === 'string' && manifest.name.trim()
        ? manifest.name
        : directory;
    throw new Error(
      `Application package ${label} containing ${entrypoint} has no non-empty build script. Add scripts.build, or pass --skip-app-build only when the application has no build-time host assets.`,
    );
  }
  return {
    directory,
    ...(typeof manifest.name === 'string' && manifest.name.trim()
      ? { name: manifest.name }
      : {}),
  };
}

async function findAncestorContaining(
  startDirectory: string,
  file: string,
): Promise<string | undefined> {
  let current = resolve(startDirectory);
  while (true) {
    if (
      await access(resolve(current, file))
        .then(() => true)
        .catch(() => false)
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
