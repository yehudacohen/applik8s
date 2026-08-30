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
import {
  exportedApplicationActorId,
  exportedApplicationAgentName,
  exportedApplicationDurable,
  exportedApplicationLakehousePublication,
  exportedApplicationModelName,
  exportedApplicationObjectStoreName,
  exportedApplicationOperationId,
  exportedApplicationSchedule,
  exportedApplicationSignalId,
  firstDuplicate,
  isExportedOperator,
  isExportedTypeKroComposition,
} from './entrypoint-export-inspection.js';
import { compilerOwnedDiscoveryDependenciesPlugin } from './entrypoint-discovery-plugin.js';
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
  readonly applicationDurables: readonly EntrypointApplicationDurableExport[];
  readonly applicationSchedules: readonly EntrypointApplicationScheduleExport[];
  readonly applicationLakehousePublications: readonly EntrypointApplicationLakehousePublicationExport[];
  readonly applicationActors: readonly EntrypointApplicationActorExport[];
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

export interface EntrypointApplicationDurableExport {
  readonly name: string;
  readonly kind: 'workflow' | 'task';
  readonly id: string;
}

export interface EntrypointApplicationScheduleExport {
  readonly name: string;
  readonly id: string;
  readonly graphNode: import('@applik8s/core').ApplicationScheduleNode;
}

export interface EntrypointApplicationLakehousePublicationExport {
  readonly name: string;
  readonly graphNode: import('@applik8s/core').ApplicationLakehousePublicationNode;
}

export interface EntrypointApplicationActorExport {
  readonly name: string;
  readonly actorId: string;
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
      external: ['applik8s:handler/capabilities', 'applik8s:handler/kubernetes', '@napi-rs/lzma-*', '@oxc-parser/binding-*'],
      plugins: [
        handlerSourceMetadataPlugin(entrypoint),
        compilerOwnedDiscoveryDependenciesPlugin(),
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
    const applicationDurables = Object.entries(imported)
      .flatMap(([name, value]) => {
        const durable = exportedApplicationDurable(value);
        return durable ? [{ name, ...durable }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationSchedules = Object.entries(imported)
      .flatMap(([name, value]) => {
        const schedule = exportedApplicationSchedule(value);
        return schedule ? [{ name, ...schedule }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationLakehousePublications = Object.entries(imported)
      .flatMap(([name, value]) => {
        const graphNode = exportedApplicationLakehousePublication(value);
        return graphNode ? [{ name, graphNode }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const applicationActors = Object.entries(imported)
      .flatMap(([name, value]) => {
        const actorId = exportedApplicationActorId(value);
        return actorId ? [{ name, actorId }] : [];
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
        applicationDurables,
        applicationSchedules,
        applicationLakehousePublications,
        applicationActors,
      },
    };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : `Failed to discover exported entrypoint exports: ${inspect(cause)}`);
  } finally {
    deferTemporaryDirectoryCleanup(bundleRoot);
  }
}

function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
