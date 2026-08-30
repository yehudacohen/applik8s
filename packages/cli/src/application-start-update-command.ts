import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  applicationAgenticStartLineagePath,
  applicationAgenticStartDefinition,
  applicationStartTemplateRevision,
  projectApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartManagedPackage,
  renderApplicationAgenticStartTemplates,
} from '@applik8s/start-agentic';

export type ApplicationStartUpdatePathState =
  | 'unchanged'
  | 'application-edited'
  | 'upstream-added'
  | 'upstream-removed'
  | 'cleanly-applicable'
  | 'conflict';

export interface ApplicationStartUpdatePath {
  readonly path: string;
  readonly state: ApplicationStartUpdatePathState;
  readonly securityRelevant: boolean;
  readonly compatibilityChanging: boolean;
  readonly baselineDigest?: string;
  readonly applicationDigest?: string;
  readonly availableDigest?: string;
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

export interface AppliedApplicationStartUpdate {
  readonly apiVersion: 'applik8s.startUpdateResult/v1alpha1';
  readonly applied: readonly string[];
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly report: ApplicationStartUpdateReport;
}

interface ApplicationStartLineage {
  readonly apiVersion:
    | 'applik8s.startLineage/v1alpha1'
    | 'applik8s.startLineage/v1alpha2';
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
  const currentTemplateRevision = lineage.apiVersion
    === 'applik8s.startLineage/v1alpha1'
    ? digest(JSON.stringify(currentDigests))
    : applicationStartTemplateRevision(currentDigests);
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
      ...(baselineDigest ? { baselineDigest } : {}),
      ...(applicationDigest ? { applicationDigest } : {}),
      ...(currentDigest ? { availableDigest: currentDigest } : {}),
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
    conflicts: results.some(({ state }) => state === 'conflict'),
    paths: Object.freeze(results),
  });
}

/**
 * Applies only a conflict-free semantic Start update. Application-owned files
 * and application-owned package.json entries are retained. The optimistic
 * digest check closes the gap between planning and mutation.
 */
export async function applyApplicationStartUpdate(
  projectRoot: string,
): Promise<AppliedApplicationStartUpdate> {
  const root = await realpath(resolve(projectRoot));
  const lineage = await readLineage(root);
  const report = await checkApplicationStartUpdate(root);
  if (report.conflicts) {
    const paths = report.paths
      .filter(({ state }) => state === 'conflict')
      .map(({ path }) => path)
      .join(', ');
    throw new Error(
      `Start update has conflicts and made no changes: ${paths}. Resolve or preserve them explicitly before applying.`,
    );
  }

  const templates = await renderApplicationAgenticStartTemplates(
    lineage.projectName,
    lineage.example,
  );
  const available: Readonly<Record<string, string>> = Object.freeze({
    ...templates,
    ...('package.json' in lineage.files
      ? {
        'package.json': renderApplicationAgenticStartManagedPackage(
          lineage.projectName,
          lineage.example,
          lineage.packageVersion ?? `^${applicationAgenticStartDefinition.version}`,
          lineage.context,
        ),
      }
      : {}),
  });
  const applied: string[] = [];
  const removed: string[] = [];
  const preserved: string[] = [];

  // Complete the optimistic-concurrency preflight before the first write. A
  // late application edit must never leave a partially applied Start update.
  for (const pathPlan of report.paths) {
    validateTemplatePath(pathPlan.path);
    const observedDigest = await projectFileDigest(
      root,
      pathPlan.path,
      lineage.example,
    );
    if (observedDigest !== pathPlan.applicationDigest) {
      throw new Error(
        `Start update made no changes because ${pathPlan.path} changed after planning. Run the command again.`,
      );
    }
  }

  for (const pathPlan of report.paths) {
    if (pathPlan.state === 'application-edited') {
      preserved.push(pathPlan.path);
      continue;
    }
    if (pathPlan.state === 'upstream-removed') {
      await unlink(resolve(root, pathPlan.path));
      removed.push(pathPlan.path);
      continue;
    }
    if (
      pathPlan.state !== 'cleanly-applicable'
      && pathPlan.state !== 'upstream-added'
    ) {
      continue;
    }
    const source = available[pathPlan.path];
    if (source === undefined) {
      throw new Error(
        `Start update plan for ${pathPlan.path} has no maintained source.`,
      );
    }
    const output = resolve(root, pathPlan.path);
    await mkdir(resolve(output, '..'), { recursive: true });
    if (pathPlan.path === 'package.json' && pathPlan.applicationDigest) {
      const applicationSource = await readFile(output, 'utf8');
      await writeFile(
        output,
        mergeManagedPackageSource(applicationSource, source),
      );
    } else {
      await writeFile(output, source);
    }
    applied.push(pathPlan.path);
  }

  const files = Object.fromEntries(
    Object.entries(available).map(([path, source]) => [path, digest(source)]),
  );
  const trackedLineage = {
    apiVersion: 'applik8s.startLineage/v1alpha2',
    start: applicationAgenticStartDefinition.name,
    startVersion: applicationAgenticStartDefinition.version,
    generatorVersion: applicationAgenticStartDefinition.version,
    projectName: lineage.projectName,
    example: lineage.example,
    ...(lineage.packageVersion ? { packageVersion: lineage.packageVersion } : {}),
    ...(lineage.context ? { context: lineage.context } : {}),
    templateRevision: applicationStartTemplateRevision(files),
    files,
    upstream: applicationAgenticStartDefinition.generator.upstream,
    tanstackStart: applicationAgenticStartDefinition.compatibility.tanstackStart,
  };
  const lineagePath = resolve(root, applicationAgenticStartLineagePath);
  const temporaryLineagePath = `${lineagePath}.tmp-${process.pid}`;
  await writeFile(
    temporaryLineagePath,
    `${JSON.stringify(trackedLineage, null, 2)}\n`,
  );
  await rename(temporaryLineagePath, lineagePath);

  return Object.freeze({
    apiVersion: 'applik8s.startUpdateResult/v1alpha1',
    applied: Object.freeze(applied),
    removed: Object.freeze(removed),
    preserved: Object.freeze(preserved),
    report: await checkApplicationStartUpdate(root),
  });
}

function mergeManagedPackageSource(
  applicationSource: string,
  managedSource: string,
): string {
  const application = parsePackageRecord(applicationSource);
  const managed = parsePackageRecord(managedSource);
  const merge = (key: string) => ({
    ...objectRecord(application[key]),
    ...objectRecord(managed[key]),
  });
  return `${JSON.stringify({
    ...application,
    name: managed.name,
    scripts: merge('scripts'),
    applik8s: merge('applik8s'),
    imports: merge('imports'),
    dependencies: merge('dependencies'),
    devDependencies: merge('devDependencies'),
  }, null, 2)}\n`;
}

function parsePackageRecord(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Generated package.json must contain an object.');
  }
  // typecast: the object/array guard above establishes a keyed package record.
  return parsed as Record<string, unknown>;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    // typecast: the preceding runtime guard establishes a plain keyed object.
    ? value as Record<string, unknown>
    : {};
}

function updatePathState(
  baseline: string | undefined,
  current: string | undefined,
  application: string | undefined,
): ApplicationStartUpdatePathState {
  if (!baseline) return application ? 'conflict' : 'upstream-added';
  if (!current) {
    if (!application) return 'unchanged';
    return application === baseline ? 'upstream-removed' : 'conflict';
  }
  if (application === current) return 'unchanged';
  if (baseline === current) {
    return application === baseline ? 'unchanged' : 'application-edited';
  }
  if (application === baseline) return 'cleanly-applicable';
  return 'conflict';
}

async function readLineage(root: string): Promise<ApplicationStartLineage> {
  const tracked = resolve(root, applicationAgenticStartLineagePath);
  const legacy = resolve(root, '.applik8s/start-lineage.json');
  const path = await lstat(tracked).then(() => tracked).catch((cause) => {
    if (isNotFoundError(cause)) return legacy;
    throw cause;
  });
  const label = relative(root, path).split(sep).join('/');
  await assertRegularProjectFile(root, path, label);
  // typecast: JSON.parse is deliberately reintroduced as unknown before the complete lineage validation below.
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Start lineage must be a JSON object.');
  }
  // typecast: the preceding object guard permits keyed inspection while every public field remains validated below.
  const value = parsed as Record<string, unknown>;
  const files = value.files;
  if (
    (value.apiVersion !== 'applik8s.startLineage/v1alpha1'
      && value.apiVersion !== 'applik8s.startLineage/v1alpha2')
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
