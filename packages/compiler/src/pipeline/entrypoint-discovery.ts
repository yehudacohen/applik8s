import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

import type { Diagnostic, OperatorDefinition, Result } from '@applik8s/core';
import { build } from 'esbuild';

import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import type { CompileResult } from '../interfaces.js';

export interface EntrypointExports {
  readonly operators: readonly OperatorDefinition[];
  readonly typeKroCompositions: readonly TypeKroCompositionExport[];
}

export interface TypeKroCompositionExport {
  readonly name?: string;
  readonly operatorInstalls: readonly { readonly operatorName: string; readonly operator?: unknown }[];
  resolveOperatorInstalls(options: { readonly manifests: readonly CompileResult[] }): Result<unknown>;
}

export async function discoverExportedOperators(entrypoint: string): Promise<Result<{ readonly operators: readonly OperatorDefinition[] }>> {
  const discovered = await discoverEntrypointExports(entrypoint);
  return discovered.ok ? { ok: true, value: { operators: discovered.value.operators } } : discovered;
}

export async function discoverEntrypointExports(entrypoint: string): Promise<Result<EntrypointExports>> {
  const bundleRoot = join(process.cwd(), '.applik8s-tmp', `discovery-${process.pid}-${Date.now()}`);
  const discoveryBundle = join(bundleRoot, 'entrypoint.mjs');
  try {
    await mkdir(bundleRoot, { recursive: true });
    await build({
      entryPoints: [entrypoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      nodePaths: [join(process.cwd(), 'node_modules')],
      tsconfigRaw: { compilerOptions: {} },
      outfile: discoveryBundle,
      banner: {
        js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
      },
      external: ['applik8s:handler/capabilities', 'applik8s:handler/kubernetes', '@applik8s/compiler', '@applik8s/compiler/*', 'esbuild', 'typekro', 'typekro/*', '@napi-rs/lzma-*', '@oxc-parser/binding-*'],
      plugins: [applik8sWorkspaceSourcePlugin()],
    });
    const discoverySpecifier = `${pathToFileURL(discoveryBundle).href}?applik8s=${Date.now()}`;
    const discoveryEntrypointKey = Symbol.for('applik8s.discovery.entrypoint');
    const previousDiscoveryEntrypoint = Reflect.get(globalThis, discoveryEntrypointKey);
    Reflect.set(globalThis, discoveryEntrypointKey, entrypoint);
    let imported: Record<string, unknown>;
    try {
      // static-import-exception: compiler discovery loads a generated local ESM bundle and narrows every exported value structurally. typecast: import() exposes unknown exports which the following structural filters validate.
      imported = (await import(/* @vite-ignore */ discoverySpecifier)) as Record<string, unknown>;
    } finally {
      if (previousDiscoveryEntrypoint === undefined) Reflect.deleteProperty(globalThis, discoveryEntrypointKey);
      else Reflect.set(globalThis, discoveryEntrypointKey, previousDiscoveryEntrypoint);
    }
    const operators = Object.values(imported).filter(isExportedOperator).map((value) => value.definition);
    const duplicate = firstDuplicate(operators.map((operator) => operator.name));
    if (duplicate) return error('BUNDLE_INVALID', `Entrypoint exports multiple operators named ${duplicate}.`);
    const typeKroCompositions: TypeKroCompositionExport[] = [];
    for (const [name, value] of Object.entries(imported)) {
      if (isExportedTypeKroComposition(value)) typeKroCompositions.push(Object.assign(value, { name }));
    }
    return { ok: true, value: { operators, typeKroCompositions } };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : `Failed to discover exported entrypoint exports: ${inspect(cause)}`);
  } finally {
    deferTemporaryDirectoryCleanup(bundleRoot);
  }
}

const deferredTemporaryDirectoryCleanups = new Set<string>();
let temporaryDirectoryCleanupRegistered = false;

function deferTemporaryDirectoryCleanup(directory: string): void {
  if (process.env.APPLIK8S_KEEP_TMP === '1') return;
  deferredTemporaryDirectoryCleanups.add(directory);
  if (temporaryDirectoryCleanupRegistered) return;
  temporaryDirectoryCleanupRegistered = true;
  process.once('exit', () => {
    for (const cleanupDirectory of deferredTemporaryDirectoryCleanups) rmSync(cleanupDirectory, { recursive: true, force: true });
    deferredTemporaryDirectoryCleanups.clear();
  });
}

function isExportedOperator(value: unknown): value is { readonly definition: OperatorDefinition } {
  return Boolean(value && typeof value === 'function' && typeof Reflect.get(value, 'definition') === 'object');
}

function isExportedTypeKroComposition(value: unknown): value is TypeKroCompositionExport {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && Array.isArray(Reflect.get(value, 'operatorInstalls')) && typeof Reflect.get(value, 'resolveOperatorInstalls') === 'function');
}

function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
