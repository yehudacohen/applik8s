import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import { handlerSourceMetadataPlugin } from './entrypoint-handler-instrumentation.js';

/**
 * Build the application module that the Node deployment host evaluates while
 * adapting the generated graph to TypeKro/Alchemy.
 *
 * This must use the same callback instrumentation as compiler discovery.
 * Loading authored TypeScript through a generic loader loses module-local
 * workflow/helper dependency metadata and makes deployment semantics differ
 * from the graph that was just compiled.
 *
 * @internal
 */
export async function bundleApplicationCompositionRuntimeEntrypoint(
  entrypoint: string,
  outfile: string,
): Promise<string> {
  const source = resolve(entrypoint);
  const output = resolve(outfile);
  await mkdir(dirname(output), { recursive: true });
  await build({
    absWorkingDir: dirname(source),
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    plugins: [
      absoluteExternalPackagePlugin(),
      handlerSourceMetadataPlugin(source),
      // Discovery and deployment must evaluate one physical copy of every
      // workspace package. Without this resolver, callback instrumentation may
      // capture a package's src tree while an authored bare import resolves its
      // dist tree, producing distinct Drizzle table identities for one model.
      // Installed consumers fall back to their package exports because the
      // workspace source paths do not exist there.
      applik8sWorkspaceSourcePlugin(),
    ],
    logLevel: 'silent',
  });
  return output;
}

/**
 * Preserve framework source instrumentation while keeping provider/native
 * packages untransformed. Bare package imports are resolved from the module
 * that authored them, then emitted as absolute host-only imports. This is
 * important with isolated node_modules layouts: after workspace source is
 * bundled, a transitive package import can no longer rely on its original
 * package-local node_modules directory.
 */
function absoluteExternalPackagePlugin(): Plugin {
  const recursionMarker = '__applik8sAbsoluteExternalResolution';
  return {
    name: 'applik8s-absolute-external-packages',
    setup(buildContext) {
      buildContext.onResolve(
        { filter: /^(?:@[^/]+\/|[^./])/ },
        async (args) => {
          const pluginData =
            args.pluginData && typeof args.pluginData === 'object'
              // The object guard establishes esbuild pluginData as the map
              // typecast: used solely to read our private recursion marker.
              ? args.pluginData as Readonly<Record<string, unknown>>
              : {};
          if (pluginData[recursionMarker]) return undefined;
          if (
            args.path.startsWith('node:')
            || args.path.startsWith('@applik8s/')
          ) {
            return undefined;
          }
          const resolved = await buildContext.resolve(args.path, {
            importer: args.importer,
            namespace: args.namespace,
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: {
              ...pluginData,
              [recursionMarker]: true,
            },
          });
          if (resolved.errors.length > 0) {
            return {
              errors: resolved.errors,
              warnings: resolved.warnings,
            };
          }
          return {
            // File URLs remain stable across macOS /var -> /private/var
            // canonicalization. Esbuild's relative external-path rendering
            // otherwise computes against the symlink spelling of the output
            // directory and can create a nonexistent /private/private path.
            path: pathToFileURL(resolved.path).href,
            external: true,
            warnings: resolved.warnings,
          };
        },
      );
    },
  };
}
