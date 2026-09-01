// typecast-file-boundary: deployment deletion selection validates generated JSON/YAML and dynamic module exports before returning typed identities.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
export {
  readExplicitApplicationInstallationSpec,
  stageExplicitApplicationInstance,
} from './application-deployment-instance-files.js';
export type { StagedApplicationInstance } from './application-deployment-instance-files.js';

export interface GeneratedApplicationDeleteOptions {
  readonly context?: string;
  readonly instanceName?: string;
  readonly controlPlaneNamespace?: string;
}

export interface GeneratedApplicationDeleteTarget {
  readonly apiVersion: string;
  readonly kind: string;
  readonly instanceName: string;
  readonly controlPlaneNamespace: string;
  readonly applicationInstance?: true;
  readonly resourceGraphDefinitionName?: string;
}

export interface TypeKroApplicationComposition {
  factory(mode: 'kro', options: Readonly<Record<string, unknown>>): {
    deleteInstance(name: string): Promise<unknown>;
  };
}

export async function resolveGeneratedApplicationDeleteTarget(
  bundlePath: string,
  options: GeneratedApplicationDeleteOptions,
): Promise<GeneratedApplicationDeleteTarget> {
  const instancesDirectory = join(dirname(bundlePath), 'instances');
  const rootIdentity = await generatedApplicationRootIdentity(bundlePath);
  const persistedIdentity = await persistedApplicationDeploymentIdentity(bundlePath);
  const files = (await readdir(instancesDirectory)).filter((file) => file.endsWith('.yaml')).sort();
  const candidates = await Promise.all(files.map(async (file) => {
    const value = parse(await readFile(join(instancesDirectory, file), 'utf8')) as unknown;
    if (!value || typeof value !== 'object') return undefined;
    const resource = value as Readonly<Record<string, unknown>>;
    const metadata = resource.metadata;
    if (!metadata || typeof metadata !== 'object') return undefined;
    const name = Reflect.get(metadata, 'name');
    const namespace = Reflect.get(metadata, 'namespace');
    const labels = Reflect.get(metadata, 'labels');
    const apiVersion = resource.apiVersion;
    const kind = resource.kind;
    if (typeof name !== 'string' || typeof apiVersion !== 'string' || typeof kind !== 'string') return undefined;
    return {
      apiVersion,
      kind,
      instanceName: name,
      ...(typeof namespace === 'string' ? { controlPlaneNamespace: namespace } : {}),
      applicationInstance: labels && typeof labels === 'object'
        && (Reflect.get(labels, 'typekro.io/mode') === 'kro'
          || typeof Reflect.get(labels, 'typekro.io/factory') === 'string'
          || typeof Reflect.get(labels, 'typekro.io/rgd') === 'string')
        || rootIdentity?.apiVersion === apiVersion && rootIdentity.kind === kind,
    };
  }));
  const instances = candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  const applicationInstances = instances.filter((candidate) => candidate.applicationInstance);
  const rootInstances = rootIdentity
    ? instances.filter(
      (candidate) =>
        candidate.apiVersion === rootIdentity.apiVersion
        && candidate.kind === rootIdentity.kind,
    )
    : [];
  const persistedRoot = rootIdentity && persistedIdentity
    && (!options.instanceName || options.instanceName === persistedIdentity.instance)
    ? {
        apiVersion: rootIdentity.apiVersion,
        kind: rootIdentity.kind,
        instanceName: persistedIdentity.instance,
        controlPlaneNamespace: persistedIdentity.controlPlaneNamespace,
        applicationInstance: true,
      }
    : undefined;
  const selected = options.instanceName
    ? instances.find((candidate) => candidate.instanceName === options.instanceName)
      ?? persistedRoot
    : rootInstances.length === 1
      ? rootInstances[0]
      : persistedRoot
        ? persistedRoot
        : applicationInstances.length === 1
          ? applicationInstances[0]
          : instances.length === 1
            ? instances[0]
            : undefined;
  if (!selected) {
    const available = instances.map((candidate) => candidate.instanceName).join(', ') || '<none>';
    throw new Error(`Unable to select one generated Application instance for TypeKro deletion. Available instances: ${available}. Pass --instance-name when necessary.`);
  }
  const controlPlaneNamespace = options.controlPlaneNamespace ?? selected.controlPlaneNamespace;
  if (!controlPlaneNamespace?.trim()) {
    throw new Error(`Application instance ${selected.instanceName} has no control-plane namespace. Pass --control-plane-namespace explicitly.`);
  }
  return {
    apiVersion: selected.apiVersion,
    kind: selected.kind,
    instanceName: selected.instanceName,
    controlPlaneNamespace,
    ...(selected.applicationInstance ? { applicationInstance: true as const } : {}),
    ...(rootIdentity ? { resourceGraphDefinitionName: rootIdentity.resourceGraphDefinitionName } : {}),
  };
}

async function persistedApplicationDeploymentIdentity(
  bundlePath: string,
): Promise<{
  readonly instance: string;
  readonly controlPlaneNamespace: string;
} | undefined> {
  try {
    const graph = JSON.parse(
      await readFile(
        join(dirname(bundlePath), 'application-deployment-graph.json'),
        'utf8',
      ),
    ) as unknown;
    const metadata = graph && typeof graph === 'object'
      ? Reflect.get(graph, 'metadata')
      : undefined;
    const identity = metadata && typeof metadata === 'object'
      ? Reflect.get(metadata, 'identity')
      : undefined;
    const instance = identity && typeof identity === 'object'
      ? Reflect.get(identity, 'instance')
      : undefined;
    const controlPlaneNamespace = identity && typeof identity === 'object'
      ? Reflect.get(identity, 'controlPlaneNamespace')
      : undefined;
    if (
      typeof instance !== 'string'
      || !instance.trim()
      || typeof controlPlaneNamespace !== 'string'
      || !controlPlaneNamespace.trim()
    ) {
      throw new Error(
        'Persisted Application deployment graph has no concrete instance and control-plane namespace identity.',
      );
    }
    return { instance, controlPlaneNamespace };
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}

export async function loadTypeKroCompositionEntrypoint(
  entrypoint: string,
  exportName: string,
): Promise<TypeKroApplicationComposition> {
  let module: Readonly<Record<string, unknown>>;
  try {
    // static-import-exception: the authored application entrypoint is selected by the CLI at runtime.
    module = await import(pathToFileURL(entrypoint).href) as Readonly<Record<string, unknown>>;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Unable to load TypeKro composition entrypoint ${entrypoint}. ${detail}`, { cause });
  }
  const composition = module[exportName];
  if (!composition || (typeof composition !== 'object' && typeof composition !== 'function') || typeof Reflect.get(composition, 'factory') !== 'function') {
    throw new Error(`Entrypoint ${entrypoint} does not export TypeKro composition ${exportName}.`);
  }
  return composition as TypeKroApplicationComposition;
}

async function generatedApplicationRootIdentity(
  bundlePath: string,
): Promise<{ readonly apiVersion: string; readonly kind: string; readonly resourceGraphDefinitionName: string } | undefined> {
  const directory = dirname(bundlePath);
  try {
    const graph = JSON.parse(await readFile(join(directory, 'application-graph.json'), 'utf8')) as unknown;
    const graphMetadata = graph && typeof graph === 'object' ? Reflect.get(graph, 'metadata') : undefined;
    const graphName = graphMetadata && typeof graphMetadata === 'object' ? Reflect.get(graphMetadata, 'name') : undefined;
    if (typeof graphName !== 'string' || !graphName.trim()) return undefined;
    const resources = JSON.parse(await readFile(join(directory, 'resources.json'), 'utf8')) as unknown;
    if (!Array.isArray(resources)) return undefined;
    const definition = resources.find((resource) => {
      if (!resource || typeof resource !== 'object' || Reflect.get(resource, 'kind') !== 'ResourceGraphDefinition') return false;
      const metadata = Reflect.get(resource, 'metadata');
      return metadata && typeof metadata === 'object' && Reflect.get(metadata, 'name') === graphName;
    });
    const spec = definition && typeof definition === 'object' ? Reflect.get(definition, 'spec') : undefined;
    const schema = spec && typeof spec === 'object' ? Reflect.get(spec, 'schema') : undefined;
    const group = schema && typeof schema === 'object' ? Reflect.get(schema, 'group') : undefined;
    const version = schema && typeof schema === 'object' ? Reflect.get(schema, 'apiVersion') : undefined;
    const kind = schema && typeof schema === 'object' ? Reflect.get(schema, 'kind') : undefined;
    return typeof group === 'string' && typeof version === 'string' && typeof kind === 'string'
      ? { apiVersion: `${group}/${version}`, kind, resourceGraphDefinitionName: graphName }
      : undefined;
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') return undefined;
    throw cause;
  }
}
