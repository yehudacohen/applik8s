import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

/**
 * Preserve compiler-discovered callback/helper metadata when the Node
 * deployment host evaluates the authored composition for TypeKro supporting
 * declarations. The generated deployment graph remains authoritative; this
 * runtime module supplies only the matching TypeKro source seam.
 */
export async function prepareTypeKroCompositionRuntimeEntrypoint(
  entrypoint: string,
  bundlePath: string,
  projectRoot = dirname(entrypoint),
): Promise<string> {
  // Deployment preparation loads the compiler only after the public
  // composition build has completed.
  // static-import-exception: preserve the CLI/compiler runtime boundary.
  const { bundleApplicationCompositionRuntimeEntrypoint } = await import(
    '@applik8s/compiler'
  );
  const outputIdentity = createHash('sha256')
    .update(resolve(bundlePath))
    .digest('hex')
    .slice(0, 16);
  return bundleApplicationCompositionRuntimeEntrypoint(
    entrypoint,
    // This module is evaluated by Node and intentionally leaves ordinary npm
    // packages external. Keep it under the application project so Node can
    // resolve those dependencies even when --out-dir points elsewhere.
    join(
      resolve(projectRoot),
      '.applik8s',
      'runtime',
      outputIdentity,
      'application-entrypoint.mjs',
    ),
  );
}
