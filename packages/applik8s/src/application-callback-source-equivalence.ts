import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  authoredFile?: string,
): boolean {
  try {
    const aliases = authoredFile ? sourceImportAliases(authoredFile) : undefined;
    const canonical = (source: string, runtime = false) =>
      transformSync(
        `const __applik8sCallback = (${normalizeBundledImportAccess(source, runtime ? aliases : undefined)});`,
        {
          loader: 'ts',
          target: 'es2022',
          format: 'esm',
          minifyIdentifiers: false,
          minifySyntax: true,
          minifyWhitespace: true,
        },
      ).code;
    return canonical(authoredSource) === canonical(runtimeSource, true);
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
export function normalizeBundledImportAccess(
  source: string,
  aliases?: ReadonlyMap<string, string>,
): string {
  return source.replace(
    /\b__vite_ssr_import_\d+__\.([$A-Z_a-z][$\w]*)/g,
    (_match, exportedName: string) => aliases?.get(exportedName) ?? exportedName,
  );
}

function sourceImportAliases(file: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  try {
    const path = file.startsWith('file:') ? fileURLToPath(file) : file;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gu)) {
      for (const rawSpecifier of (match[1] ?? '').split(',')) {
        const specifier = rawSpecifier.trim().replace(/^type\s+/u, '');
        const parsed = /^([$A-Z_a-z][$\w]*)(?:\s+as\s+([$A-Z_a-z][$\w]*))?$/u.exec(specifier);
        if (parsed?.[1]) aliases.set(parsed[1], parsed[2] ?? parsed[1]);
      }
    }
    for (const match of source.matchAll(/\bimport\s+([$A-Z_a-z][$\w]*)\s*(?:,|from\s*['"])/gu)) {
      if (match[1]) aliases.set('default', match[1]);
    }
  } catch {
    // A missing source file keeps the strict exported-name comparison.
  }
  return aliases;
}
