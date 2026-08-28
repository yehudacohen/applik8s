// typecast-file-boundary: The dynamically loaded esbuild module is validated
// before restoring its published generic API; no application value crosses
// this authoring-only module boundary unchecked.
import { createRequire } from 'node:module';
import type {
  BuildOptions,
  BuildResult,
  TransformOptions,
  TransformResult,
} from 'esbuild';

const requireApplicationBuildTool = createRequire(import.meta.url);

interface ApplicationBuildTool {
  readonly buildSync: typeof import('esbuild').buildSync;
  readonly transformSync: (
    input: string,
    options?: TransformOptions,
  ) => TransformResult;
}

let loadedApplicationBuildTool: ApplicationBuildTool | undefined;

function applicationBuildTool(): ApplicationBuildTool {
  if (loadedApplicationBuildTool) return loadedApplicationBuildTool;
  // Keep the authoring-only tool opaque to generated application bundlers.
  // A literal require causes esbuild to recursively bundle its worker runtime
  // into each operation image, even though compilation is already complete.
  const loaded = requireApplicationBuildTool(['es', 'build'].join('')) as Partial<ApplicationBuildTool>;
  if (
    typeof loaded.buildSync !== 'function'
    || typeof loaded.transformSync !== 'function'
  ) {
    throw new Error('Application callback compilation requires the esbuild authoring dependency.');
  }
  loadedApplicationBuildTool = loaded as ApplicationBuildTool;
  return loadedApplicationBuildTool;
}

export function applicationBuildSync<T extends BuildOptions>(
  options: T,
): BuildResult<T> {
  // typecast: the wrapper preserves esbuild's generic write/metafile result
  // relationship; SameShape is an excess-property helper on the direct API.
  return applicationBuildTool().buildSync(options as never) as BuildResult<T>;
}

export function applicationTransformSync(
  input: string,
  options?: TransformOptions,
): TransformResult {
  return applicationBuildTool().transformSync(input, options);
}
