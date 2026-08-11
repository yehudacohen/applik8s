import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  applicationAgenticStartDefinition,
  projectApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartTemplates,
} from '@applik8s/start-agentic';

export type ApplicationStartUpdatePathState =
  | 'unchanged'
  | 'application-modified'
  | 'added'
  | 'removed'
  | 'template-changed'
  | 'conflicting';

export interface ApplicationStartUpdatePath {
  readonly path: string;
  readonly state: ApplicationStartUpdatePathState;
  readonly securityRelevant: boolean;
  readonly compatibilityChanging: boolean;
}

export interface ApplicationStartUpdateReport {
  readonly apiVersion: 'applik8s.startUpdateReport/v1alpha1';
  readonly start: string;
  readonly projectName: string;
  readonly installedVersion: string;
  readonly availableVersion: string;
  readonly installedTemplateRevision: string;
  readonly currentTemplateRevision: string;
  readonly updateAvailable: boolean;
  readonly conflicts: boolean;
  readonly paths: readonly ApplicationStartUpdatePath[];
}

interface ApplicationStartLineage {
  readonly apiVersion: 'applik8s.startLineage/v1alpha1';
  readonly start: string;
  readonly startVersion: string;
  readonly projectName: string;
  readonly example: 'product' | 'research';
  readonly packageVersion?: string;
  readonly context?: string;
  readonly templateRevision: string;
  readonly files: Readonly<Record<string, string>>;
}

export async function checkApplicationStartUpdate(
  projectRoot: string,
): Promise<ApplicationStartUpdateReport> {
  const root = await realpath(resolve(projectRoot));
  const lineage = await readLineage(root);
  if (lineage.start !== applicationAgenticStartDefinition.name) {
    throw new Error(
      `Start lineage names ${lineage.start}, but this CLI can check only ${applicationAgenticStartDefinition.name}.`,
    );
  }
  const currentTemplates = await renderApplicationAgenticStartTemplates(
    lineage.projectName,
    lineage.example,
  );
  const current = Object.freeze({
    ...currentTemplates,
    ...('package.json' in lineage.files
      ? {
        'package.json': renderApplicationAgenticStartManagedPackage(
          lineage.projectName,
          lineage.example,
          lineage.packageVersion ?? `^${lineage.startVersion}`,
          lineage.context,
        ),
      }
      : {}),
  });
  const currentDigests = Object.fromEntries(
    Object.entries(current).map(([path, source]) => [path, digest(source)]),
  );
  const currentTemplateRevision = digest(JSON.stringify(currentDigests));
  const paths = [...new Set([
    ...Object.keys(lineage.files),
    ...Object.keys(currentDigests),
  ])].sort();
  const results: ApplicationStartUpdatePath[] = [];
  for (const path of paths) {
    validateTemplatePath(path);
    const baselineDigest = lineage.files[path];
    const currentDigest = currentDigests[path];
    const applicationDigest = await projectFileDigest(
      root,
      path,
      lineage.example,
    );
    results.push({
      path,
      state: updatePathState(
        baselineDigest,
        currentDigest,
        applicationDigest,
      ),
      securityRelevant: isSecurityRelevantStartPath(path),
      compatibilityChanging: isCompatibilityChangingStartPath(path),
    });
  }
  const updateAvailable =
    lineage.startVersion !== applicationAgenticStartDefinition.version
    || lineage.templateRevision !== currentTemplateRevision;
  return Object.freeze({
    apiVersion: 'applik8s.startUpdateReport/v1alpha1',
    start: lineage.start,
    projectName: lineage.projectName,
    installedVersion: lineage.startVersion,
    availableVersion: applicationAgenticStartDefinition.version,
    installedTemplateRevision: lineage.templateRevision,
    currentTemplateRevision,
    updateAvailable,
    conflicts: results.some(({ state }) => state === 'conflicting'),
    paths: Object.freeze(results),
  });
}

function updatePathState(
  baseline: string | undefined,
  current: string | undefined,
  application: string | undefined,
): ApplicationStartUpdatePathState {
  if (!baseline) return application ? 'conflicting' : 'added';
  if (!current) return application === baseline ? 'removed' : 'conflicting';
  if (application === current) return 'unchanged';
  if (baseline === current) {
    return application === baseline ? 'unchanged' : 'application-modified';
  }
  if (application === baseline) return 'template-changed';
  return 'conflicting';
}

async function readLineage(root: string): Promise<ApplicationStartLineage> {
  const path = resolve(root, '.applik8s/start-lineage.json');
  await assertRegularProjectFile(root, path, '.applik8s/start-lineage.json');
  // typecast: JSON.parse is deliberately reintroduced as unknown before the complete lineage validation below.
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Start lineage must be a JSON object.');
  }
  // typecast: the preceding object guard permits keyed inspection while every public field remains validated below.
  const value = parsed as Record<string, unknown>;
  const files = value.files;
  if (
    value.apiVersion !== 'applik8s.startLineage/v1alpha1'
    || typeof value.start !== 'string'
    || typeof value.startVersion !== 'string'
    || typeof value.projectName !== 'string'
    || !/^[a-z][a-z0-9-]*$/u.test(value.projectName)
    || (value.example !== 'product' && value.example !== 'research')
    || typeof value.templateRevision !== 'string'
    || !files
    || typeof files !== 'object'
    || Array.isArray(files)
  ) {
    throw new Error(
      'Start lineage is incomplete. Regenerate the application with a current v0.7 Start before checking updates.',
    );
  }
  for (const [path, fileDigest] of Object.entries(files)) {
    validateTemplatePath(path);
    if (typeof fileDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(fileDigest)) {
      throw new Error(`Start lineage digest for ${path} is invalid.`);
    }
  }
  // typecast: all lineage fields and every file digest have been validated before exposing the trusted contract.
  return value as unknown as ApplicationStartLineage;
}

async function projectFileDigest(
  root: string,
  relativePath: string,
  example: 'product' | 'research',
): Promise<string | undefined> {
  const path = resolve(root, relativePath);
  try {
    await assertRegularProjectFile(root, path, relativePath);
  } catch (cause) {
    if (isNotFoundError(cause)) return undefined;
    throw cause;
  }
  const source = await readFile(path, 'utf8');
  return digest(
    relativePath === 'package.json'
      ? projectApplicationAgenticStartManagedPackage(source, example)
      : source,
  );
}

async function assertRegularProjectFile(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Start update check refuses symbolic link ${label}.`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Start update path ${label} must be a regular file.`);
  }
  const canonical = await realpath(path);
  const escaped = relative(root, canonical);
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new Error(`Start update path ${label} escapes the project root.`);
  }
}

function validateTemplatePath(path: string): void {
  if (
    !path
    || path.includes('\\')
    || isAbsolute(path)
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Start lineage contains unsafe template path ${JSON.stringify(path)}.`);
  }
}

function isSecurityRelevantStartPath(path: string): boolean {
  return /(?:^|\/)(?:package\.json|installation\.ts|providers\.ts|modules\.ts|session-loader\.ts|__root\.tsx|vite\.config\.ts)$/u.test(path)
    || path.startsWith('kubernetes/');
}

function isCompatibilityChangingStartPath(path: string): boolean {
  return path === 'package.json'
    || path === 'src/application.ts'
    || path === 'src/database-schema.ts'
    || path === 'src/installation.ts'
    || path === 'src/providers.ts'
    || path.startsWith('kubernetes/');
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isNotFoundError(cause: unknown): boolean {
  return Boolean(
    cause
      && typeof cause === 'object'
      && Reflect.get(cause, 'code') === 'ENOENT',
  );
}
