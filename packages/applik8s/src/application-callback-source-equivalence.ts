import { transformSync } from 'esbuild';

/**
 * Rejects a stale stack-derived callsite before it can replace the callback
 * that was actually passed at runtime. Both forms are normalized by the same
 * TypeScript/esbuild parser so harmless formatting and downlevel syntax do not
 * obscure a genuine callback mismatch.
 */
export function applicationCallbackSourceMatchesRuntime(
  authoredSource: string,
  runtimeSource: string,
): boolean {
  try {
    const canonical = (source: string) =>
      transformSync(
        `const __applik8sCallback = (${normalizeBundledImportAccess(source)});`,
        {
          loader: 'ts',
          target: 'es2022',
          format: 'esm',
          minifyIdentifiers: false,
          minifySyntax: true,
          minifyWhitespace: true,
        },
      ).code;
    return canonical(authoredSource) === canonical(runtimeSource);
  } catch {
    return false;
  }
}

/**
 * Vite's SSR transform preserves the imported export name but routes it
 * through an implementation-owned namespace object. Comparing that wrapper
 * literally would reject the exact authored callback during source-tree tests
 * and development even though the production compiler sees the original
 * source. Keep the normalization deliberately narrow: only Vite's generated
 * namespace identifier is removed, while the referenced export name and the
 * rest of the callback must still match exactly.
 */
function normalizeBundledImportAccess(source: string): string {
  return source.replace(
    /\b__vite_ssr_import_\d+__\.([$A-Z_a-z][$\w]*)/g,
    '$1',
  );
}
