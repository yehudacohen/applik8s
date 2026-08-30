import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'esbuild';

/** Keeps compiler-owned dependencies anchored to the compiler during discovery. */
export function compilerOwnedDiscoveryDependenciesPlugin(): Plugin {
  const compilerDirectory = dirname(fileURLToPath(import.meta.url));
  const resolvingCompilerDependency = Object.freeze({
    compilerOwnedDiscoveryDependency: true,
  });
  return {
    name: 'applik8s-compiler-owned-discovery-dependencies',
    setup(buildContext) {
      buildContext.onResolve(
        { filter: /^(?:@applik8s\/compiler(?:\/.*)?|esbuild|typekro(?:\/.*)?)$/ },
        async (args) => {
          if (args.pluginData === resolvingCompilerDependency) return undefined;
          const resolved = await buildContext.resolve(args.path, {
            kind: args.kind,
            resolveDir: compilerDirectory,
            pluginData: resolvingCompilerDependency,
          });
          if (resolved.errors.length > 0) return { errors: resolved.errors };
          return {
            // The discovery bundle executes below the application directory.
            // Anchor compiler implementation externals to this compiler module.
            path: resolved.path,
            external: true,
          };
        },
      );
    },
  };
}
