import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * Module roots available to compiler-authored generated entrypoints.
 *
 * Application dependencies resolve from the caller workspace. Dependencies
 * imported solely by generated source resolve from the compiler package that
 * owns those imports. This keeps generated implementation details out of an
 * application's direct dependency manifest and works from both src/ and dist/.
 */
export function generatedRuntimeNodePaths(cwd = process.cwd()): readonly string[] {
  const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return [...new Set([join(cwd, 'node_modules'), join(compilerRoot, 'node_modules')])];
}
