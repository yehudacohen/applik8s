// typecast-file-boundary: compiler-discovered module exports and serialized composition metadata are discriminator-checked before typed planning.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

import type { Diagnostic, OperatorDefinition, Result } from '@applik8s/core';
import { build } from 'esbuild';

import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import type { CompileResult } from '../interfaces.js';
import { deferTemporaryDirectoryCleanup } from './entrypoint-discovery-cleanup.js';
import { handlerSourceMetadataPlugin } from './entrypoint-handler-instrumentation.js';

export {
  applicationCallbackModuleIsInstrumentable,
  applicationCallbackModuleOwnsDependencies,
  applicationPackageOwnsModule,
  instrumentApplicationCallbackRegistrations,
} from './entrypoint-handler-instrumentation.js';

export interface EntrypointExports {
  readonly operators: readonly OperatorDefinition[];
  readonly typeKroCompositions: readonly TypeKroCompositionExport[];
  readonly applicationOperations: readonly EntrypointApplicationOperationExport[];
  readonly applicationModels: readonly EntrypointApplicationModelExport[];
  readonly applicationSignals: readonly EntrypointApplicationSignalExport[];
  readonly applicationAgents: readonly EntrypointApplicationAgentExport[];
  readonly applicationObjectStores: readonly EntrypointApplicationObjectStoreExport[];
}

export interface EntrypointApplicationOperationExport {
  readonly name: string;
  readonly operationId: string;
}

export interface EntrypointApplicationModelExport {
  readonly name: string;
  readonly modelName: string;
}

export interface EntrypointApplicationSignalExport {
  readonly name: string;
  readonly signalId: string;
}

export interface EntrypointApplicationAgentExport {
  readonly name: string;
  readonly agentName: string;
}

export interface EntrypointApplicationObjectStoreExport {
  readonly name: string;
  readonly objectStoreName: string;
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
      plugins: [
        handlerSourceMetadataPlugin(entrypoint),
        applik8sWorkspaceSourcePlugin(),
      ],
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
    const applicationOperations = Object.entries(imported)
      .flatMap(([name, value]) => {
        const operationId = exportedApplicationOperationId(value);
        return operationId ? [{ name, operationId }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationModels = Object.entries(imported)
      .flatMap(([name, value]) => {
        const modelName = exportedApplicationModelName(value);
        return modelName ? [{ name, modelName }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationSignals = Object.entries(imported)
      .flatMap(([name, value]) => {
        const signalId = exportedApplicationSignalId(value);
        return signalId ? [{ name, signalId }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationAgents = Object.entries(imported)
      .flatMap(([name, value]) => {
        const agentName = exportedApplicationAgentName(value);
        return agentName ? [{ name, agentName }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationObjectStores = Object.entries(imported)
      .flatMap(([name, value]) => {
        const objectStoreName = exportedApplicationObjectStoreName(value);
        return objectStoreName ? [{ name, objectStoreName }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      ok: true,
      value: {
        operators,
        typeKroCompositions,
        applicationOperations,
        applicationModels,
        applicationSignals,
        applicationAgents,
        applicationObjectStores,
      },
    };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : `Failed to discover exported entrypoint exports: ${inspect(cause)}`);
  } finally {
    deferTemporaryDirectoryCleanup(bundleRoot);
  }
}

function exportedApplicationOperationId(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  const search = Reflect.get(value, 'search');
  const operation = Reflect.get(value, 'kind') === 'applicationSearchIndex'
    && (typeof search === 'object' || typeof search === 'function')
    && search !== null
    ? Reflect.get(search, 'operation')
    : Reflect.get(value, 'operation');
  if (typeof operation !== 'object' || operation === null) return undefined;
  const id = Reflect.get(operation, 'id');
  const kind = Reflect.get(operation, 'kind');
  return typeof id === 'string' && kind === 'applicationOperation' ? id : undefined;
}

function exportedApplicationModelName(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const facet = Reflect.get(value, Symbol.for('@applik8s/model-facet'));
  if (
    !facet
    || typeof facet !== 'object'
    || Reflect.get(facet, 'kind') !== 'applicationModelFacet'
  ) {
    return undefined;
  }
  const name = Reflect.get(facet, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function exportedApplicationSignalId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Reflect.get(value, 'signalKind') !== 'applicationSignal') return undefined;
  const signal = Reflect.get(value, 'signal');
  if (typeof signal !== 'object' || signal === null) return undefined;
  const id = Reflect.get(signal, 'id');
  const kind = Reflect.get(signal, 'kind');
  return typeof id === 'string' && kind === 'applicationSignalDefinition'
    ? id
    : undefined;
}

function exportedApplicationAgentName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Reflect.get(value, 'kind') !== 'applicationAgent') return undefined;
  const name = Reflect.get(value, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function exportedApplicationObjectStoreName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (Reflect.get(value, 'kind') !== 'applicationObjectStore') return undefined;
  const name = Reflect.get(value, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
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
