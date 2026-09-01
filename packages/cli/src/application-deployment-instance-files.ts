// typecast-file-boundary: deployment instance staging validates generated JSON/YAML before returning typed identities.
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { parseAllDocuments, stringify } from 'yaml';
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

const typeKroArtifactBindingsSpecField = 'typekroArtifactBindings';

/**
 * Read the authored installation input before composition compilation.
 *
 * This intentionally does not infer a resource kind: the full staging pass
 * verifies that against the emitted RGD after compilation. The precompile
 * view exists only so profile-selected runtime artifacts can be validated
 * against the same concrete schema.spec values as the eventual instance.
 */
export async function readExplicitApplicationInstallationSpec(
  explicitPath: string,
): Promise<Readonly<Record<string, unknown>>> {
  const documents = parseAllDocuments(await readFile(explicitPath, 'utf8'))
    .map((document) => document.toJSON() as unknown)
    .filter((value): value is Record<string, unknown> => Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Reflect.get(value, 'spec')
      && typeof Reflect.get(value, 'spec') === 'object'
      && !Array.isArray(Reflect.get(value, 'spec')),
    ));
  if (documents.length !== 1) {
    throw new Error(
      `Expected exactly one authored Application resource with an object spec in ${explicitPath}, found ${documents.length}.`,
    );
  }
  const authored = applicationAuthoredSpec(
    documents[0]?.spec as Readonly<Record<string, unknown>>,
    explicitPath,
  );
  return authored;
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
  const authoredSpec = applicationAuthoredSpec(
    spec as Readonly<Record<string, unknown>>,
    candidate.sourcePath,
  );
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
      const resolved = resolveApplicationInstallationValues(condition, authoredSpec);
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
    spec: authoredSpec,
    path: stagedPath,
    resourceGraphDefinitionName: graph.metadata.name,
  };
}

/**
 * Separate authored installation input from TypeKro's persisted provider
 * projection. Generated/GitOps instances carry an empty, schema-invariant
 * artifact-binding map before TypeKro materializes provider outputs. That map
 * must remain in the staged YAML, but it is not application input and passing
 * it back through planning would violate TypeKro's reserved-field contract.
 *
 * A populated map is never accepted from a deployment input. Its values are
 * provider-owned immutable artifact references; accepting them here would let
 * an authored manifest bypass Alchemy materialization or replay stale live
 * state into a new deployment.
 */
function applicationAuthoredSpec(
  spec: Readonly<Record<string, unknown>>,
  sourcePath: string,
): Readonly<Record<string, unknown>> {
  if (!Object.hasOwn(spec, typeKroArtifactBindingsSpecField)) return spec;
  const bindings = spec[typeKroArtifactBindingsSpecField];
  if (
    !bindings
    || typeof bindings !== 'object'
    || Array.isArray(bindings)
    || Object.keys(bindings).length > 0
  ) {
    throw new Error(
      `Explicit Application instance ${sourcePath} cannot supply provider-managed spec.${typeKroArtifactBindingsSpecField}. `
      + 'Use an authored installation manifest rather than a previously materialized live instance.',
    );
  }
  const authored = { ...spec };
  delete authored[typeKroArtifactBindingsSpecField];
  return authored;
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
