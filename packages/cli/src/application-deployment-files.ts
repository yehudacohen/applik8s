// typecast-file-boundary: deployment artifact selection validates generated JSON/YAML and dynamic module exports before returning typed identities.
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ApplicationGraph } from '@applik8s/core';
import { parse, parseAllDocuments, stringify } from 'yaml';
import { resolveApplicationInstallationValues } from './application-installation-values.js';

export interface StagedApplicationInstance {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly path: string;
  readonly resourceGraphDefinitionName: string;
}

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
  readonly resourceGraphDefinitionName?: string;
}

export interface TypeKroApplicationComposition {
  factory(mode: 'kro', options: Readonly<Record<string, unknown>>): {
    deleteInstance(name: string): Promise<unknown>;
  };
}

export async function stageExplicitApplicationInstance(
  entrypoint: string,
  bundlePath: string,
  explicitPath?: string,
): Promise<StagedApplicationInstance> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  if (!graphPath) throw new Error('Generated TypeKro bundle does not reference its ApplicationGraph.');
  const projectRoot = await findAncestorContaining(dirname(entrypoint), 'package.json');
  const graph = JSON.parse(await readFile(resolve(projectRoot ?? dirname(entrypoint), graphPath), 'utf8')) as ApplicationGraph;
  const resources = JSON.parse(await readFile(join(dirname(bundlePath), 'resources.json'), 'utf8')) as readonly unknown[];
  const applicationRgd = resources.find((resource) => {
    if (!resource || typeof resource !== 'object' || Reflect.get(resource, 'kind') !== 'ResourceGraphDefinition') return false;
    const metadata = Reflect.get(resource, 'metadata');
    return metadata && typeof metadata === 'object' && Reflect.get(metadata, 'name') === graph.metadata.name;
  });
  if (!applicationRgd || typeof applicationRgd !== 'object') {
    throw new Error(`Generated resources do not contain the root ResourceGraphDefinition ${graph.metadata.name}.`);
  }
  const schema = Reflect.get(Reflect.get(applicationRgd, 'spec') ?? {}, 'schema');
  const group = schema && typeof schema === 'object' ? Reflect.get(schema, 'group') : undefined;
  const version = schema && typeof schema === 'object' ? Reflect.get(schema, 'apiVersion') : undefined;
  const kind = schema && typeof schema === 'object' ? Reflect.get(schema, 'kind') : undefined;
  if (typeof group !== 'string' || typeof version !== 'string' || typeof kind !== 'string') {
    throw new Error(`Root ResourceGraphDefinition ${graph.metadata.name} has no concrete group, version, and kind.`);
  }
  const apiVersion = `${group}/${version}`;
  if (!projectRoot && !explicitPath) {
    throw new Error(`Cannot discover an explicit ${apiVersion}/${kind} instance because ${entrypoint} has no package root. Pass --instance <path>.`);
  }
  const sourcePaths = explicitPath
    ? [explicitPath]
    : await readdir(join(projectRoot as string, 'kubernetes'))
        .then((files) => files.filter((file) => /\.ya?ml$/.test(file)).sort().map((file) => join(projectRoot as string, 'kubernetes', file)))
        .catch((cause: unknown) => {
          if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') return [];
          throw cause;
        });
  const candidates: { readonly value: Record<string, unknown>; readonly sourcePath: string }[] = [];
  for (const sourcePath of sourcePaths) {
    const documents = parseAllDocuments(await readFile(sourcePath, 'utf8'));
    for (const document of documents) {
      const value = document.toJSON() as unknown;
      if (!value || typeof value !== 'object') continue;
      if (Reflect.get(value, 'apiVersion') === apiVersion && Reflect.get(value, 'kind') === kind) {
        candidates.push({ value: value as Record<string, unknown>, sourcePath });
      }
    }
  }
  if (candidates.length !== 1) {
    const source = explicitPath ?? `${projectRoot}/kubernetes/*.yaml`;
    throw new Error(`Expected exactly one explicit ${apiVersion}/${kind} Application instance in ${source}, found ${candidates.length}. Pass --instance <path> to disambiguate.`);
  }
  const candidate = candidates[0] as { readonly value: Record<string, unknown>; readonly sourcePath: string };
  const metadata = candidate.value.metadata;
  const name = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : undefined;
  const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
  if (typeof name !== 'string' || !name.trim() || typeof namespace !== 'string' || !namespace.trim()) {
    throw new Error(`Explicit Application instance ${candidate.sourcePath} requires concrete metadata.name and metadata.namespace.`);
  }
  const spec = candidate.value.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Explicit Application instance ${candidate.sourcePath} requires a concrete object spec for deployment lowering.`);
  }
  const instancesDirectory = join(dirname(bundlePath), 'instances');
  await mkdir(instancesDirectory, { recursive: true });
  for (const file of (await readdir(instancesDirectory)).filter((file) => /\.ya?ml$/.test(file))) {
    const path = join(instancesDirectory, file);
    const documents = parseAllDocuments(await readFile(path, 'utf8'))
      .map((document) => document.toJSON() as unknown)
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
    if (documents.some((document) => document.apiVersion === apiVersion && document.kind === kind)) {
      await unlink(path);
      continue;
    }
    if (documents.length !== 1) {
      throw new Error(`Generated prerequisite instance ${path} must contain exactly one Kubernetes resource.`);
    }
    const prerequisite = documents[0] as Record<string, unknown>;
    const metadata = prerequisite.metadata;
    const annotations = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? Reflect.get(metadata, 'annotations')
      : undefined;
    const encodedConditions = annotations && typeof annotations === 'object' && !Array.isArray(annotations)
      ? Reflect.get(annotations, 'applik8s.dev/include-when')
      : undefined;
    if (encodedConditions === undefined) continue;
    const conditions = typeof encodedConditions === 'string' ? JSON.parse(encodedConditions) as unknown : undefined;
    if (!Array.isArray(conditions) || !conditions.every((condition) => typeof condition === 'string')) {
      throw new Error(`Generated prerequisite instance ${path} has an invalid applik8s.dev/include-when contract.`);
    }
    const active = conditions.every((condition) => {
      const resolved = resolveApplicationInstallationValues(condition, spec as Readonly<Record<string, unknown>>);
      if (typeof resolved !== 'boolean') {
        throw new Error(`Generated prerequisite condition ${condition} must resolve to a boolean installation value.`);
      }
      return resolved;
    });
    if (!active) {
      await unlink(path);
      continue;
    }
    const retainedAnnotations = { ...(annotations as Record<string, unknown>) };
    delete retainedAnnotations['applik8s.dev/include-when'];
    const retainedMetadata = { ...(metadata as Record<string, unknown>) };
    if (Object.keys(retainedAnnotations).length > 0) retainedMetadata.annotations = retainedAnnotations;
    else delete retainedMetadata.annotations;
    await writeFile(path, stringify({ ...prerequisite, metadata: retainedMetadata }));
  }
  const stagedPath = join(instancesDirectory, `${name.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()}.yaml`);
  await writeFile(stagedPath, stringify(candidate.value));
  return {
    apiVersion,
    kind,
    name,
    namespace,
    spec: spec as Readonly<Record<string, unknown>>,
    path: stagedPath,
    resourceGraphDefinitionName: graph.metadata.name,
  };
}

export async function resolveGeneratedApplicationDeleteTarget(
  bundlePath: string,
  options: GeneratedApplicationDeleteOptions,
): Promise<GeneratedApplicationDeleteTarget> {
  const instancesDirectory = join(dirname(bundlePath), 'instances');
  const rootIdentity = await generatedApplicationRootIdentity(bundlePath);
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
  const selected = options.instanceName
    ? instances.find((candidate) => candidate.instanceName === options.instanceName)
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
    ...selected,
    controlPlaneNamespace,
    ...(rootIdentity ? { resourceGraphDefinitionName: rootIdentity.resourceGraphDefinitionName } : {}),
  };
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

export async function resolveApplicationBuildPackage(entrypoint: string): Promise<{
  readonly directory: string;
  readonly name?: string;
}> {
  const directory = await findAncestorContaining(dirname(resolve(entrypoint)), 'package.json');
  if (!directory) {
    throw new Error(`Application entrypoint ${entrypoint} is not contained by a package.json. Add an application package with a build script, or pass --skip-app-build for an operator-only application.`);
  }
  const path = resolve(directory, 'package.json');
  let manifest: { readonly name?: unknown; readonly scripts?: unknown };
  try {
    manifest = JSON.parse(await readFile(path, 'utf8')) as { readonly name?: unknown; readonly scripts?: unknown };
  } catch (cause) {
    throw new Error(`Application package manifest ${path} is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
    ? manifest.scripts
    : undefined;
  const build = scripts ? Reflect.get(scripts, 'build') : undefined;
  if (typeof build !== 'string' || !build.trim()) {
    const label = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : directory;
    throw new Error(`Application package ${label} containing ${entrypoint} has no non-empty build script. Add scripts.build, or pass --skip-app-build only when the application has no build-time host assets.`);
  }
  return {
    directory,
    ...(typeof manifest.name === 'string' && manifest.name.trim() ? { name: manifest.name } : {}),
  };
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

async function findAncestorContaining(startDirectory: string, file: string): Promise<string | undefined> {
  let current = resolve(startDirectory);
  while (true) {
    if (await access(resolve(current, file)).then(() => true).catch(() => false)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
