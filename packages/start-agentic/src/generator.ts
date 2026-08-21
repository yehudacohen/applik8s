// typecast-file-boundary: Generator configuration and package metadata are validated before typed template materialization.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationAgenticStartDefinition } from './definition.js';

const agenticStartNitroVersion =
  'npm:nitro-nightly@3.0.1-20260715-190547-7af4fee3';

export interface ApplicationStartCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

export type ApplicationAgenticStartExample = 'product' | 'research';

export interface ApplicationStartProgress {
  readonly phase:
    | 'scaffold'
    | 'templates'
    | 'dependencies'
    | 'migrations'
    | 'routes'
    | 'validation';
  readonly message: string;
}

export interface CreateApplicationAgenticStartOptions {
  readonly targetDirectory: string;
  readonly projectName?: string;
  readonly applik8sVersion?: string;
  readonly install?: boolean;
  readonly context?: string;
  readonly example?: ApplicationAgenticStartExample;
  readonly progress?: (progress: ApplicationStartProgress) => void;
  readonly run?: (command: ApplicationStartCommand) => Promise<void>;
}

export interface CreatedApplicationAgenticStart {
  readonly targetDirectory: string;
  readonly projectName: string;
  readonly example: ApplicationAgenticStartExample;
  readonly files: readonly string[];
  readonly upstream: {
    readonly package: '@tanstack/cli';
    readonly version: string;
  };
}

export async function createApplicationAgenticStart(
  options: CreateApplicationAgenticStartOptions,
): Promise<CreatedApplicationAgenticStart> {
  const targetDirectory = resolve(options.targetDirectory);
  const projectName = normalizedProjectName(
    options.projectName ?? basename(targetDirectory),
  );
  const parent = dirname(targetDirectory);
  const run = options.run ?? runCommand;
  const example = options.example ?? 'product';
  const progress = options.progress ?? (() => undefined);
  const upstream = applicationAgenticStartDefinition.generator.upstream;
  progress({
    phase: 'scaffold',
    message: `Scaffolding the pinned TanStack Start ${upstream.version} application`,
  });
  await run({
    executable: 'bunx',
    arguments: [
      `${upstream.package}@${upstream.version}`,
      'create',
      projectName,
      '--target-dir',
      targetDirectory,
      '--blank',
      '--package-manager',
      'bun',
      '--no-git',
      '--no-install',
      '-y',
    ],
    cwd: parent,
  });
  await assertOfficialScaffold(targetDirectory);
  progress({
    phase: 'templates',
    message: `Applying the Applik8s Agentic ${example} templates`,
  });
  const packageVersion = options.applik8sVersion ?? '^0.8.0';
  const templates = await renderApplicationAgenticStartTemplates(
    projectName,
    example,
  );
  for (const [path, source] of Object.entries(templates)) {
    const output = resolve(targetDirectory, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source);
  }
  await updateGeneratedPackage(
    targetDirectory,
    projectName,
    packageVersion,
    options.context,
    example,
  );
  const managedPackage = renderApplicationAgenticStartManagedPackage(
    projectName,
    example,
    packageVersion,
    options.context,
  );
  const fileDigests = Object.fromEntries(
    Object.entries({ ...templates, 'package.json': managedPackage }).map(
      ([path, source]) => [path, applicationStartTemplateDigest(source)],
    ),
  );
  const templateRevision = applicationStartTemplateDigest(
    JSON.stringify(fileDigests),
  );
  const lineagePath = resolve(
    targetDirectory,
    '.applik8s/start-lineage.json',
  );
  await mkdir(dirname(lineagePath), { recursive: true });
  await writeFile(lineagePath, `${JSON.stringify({
    apiVersion: 'applik8s.startLineage/v1alpha1',
    start: applicationAgenticStartDefinition.name,
    startVersion: applicationAgenticStartDefinition.version,
    generatorVersion: applicationAgenticStartDefinition.version,
    projectName,
    example,
    packageVersion,
    ...(options.context?.trim() ? { context: options.context.trim() } : {}),
    templateRevision,
    files: fileDigests,
    upstream: {
      package: applicationAgenticStartDefinition.generator.upstream.package,
      version: applicationAgenticStartDefinition.generator.upstream.version,
    },
    tanstackStart: applicationAgenticStartDefinition.compatibility.tanstackStart,
  }, null, 2)}\n`);
  if (options.install !== false) {
    progress({
      phase: 'dependencies',
      message: 'Installing pinned application dependencies',
    });
    await run({
      executable: 'bun',
      arguments: ['install'],
      cwd: targetDirectory,
    });
    progress({
      phase: 'migrations',
      message: 'Generating the initial Drizzle migration',
    });
    await run({
      executable: 'bun',
      arguments: ['run', 'db:generate'],
      cwd: targetDirectory,
    });
    progress({
      phase: 'routes',
      message: 'Generating the TanStack route tree',
    });
    await run({
      executable: 'bun',
      arguments: ['run', 'generate-routes'],
      cwd: targetDirectory,
    });
  }
  progress({
    phase: 'validation',
    message: 'Validating the generated project contract',
  });
  return {
    targetDirectory,
    projectName,
    example,
    files: [
      '.applik8s/start-lineage.json',
      ...Object.keys(templates),
      'package.json',
    ],
    upstream: {
      package: upstream.package,
      version: upstream.version,
    },
  };
}

async function runCommand(command: ApplicationStartCommand): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command.executable, [...command.arguments], {
      cwd: command.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? '1',
        DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? '1',
      },
      stdio: 'inherit',
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(new Error(
        `${command.executable} ${command.arguments.join(' ')} failed${
          signal ? ` with signal ${signal}` : ` with exit code ${code ?? 1}`
        }.`,
      ));
    });
  });
}

async function assertOfficialScaffold(targetDirectory: string): Promise<void> {
  const packagePath = resolve(targetDirectory, 'package.json');
  const routePath = resolve(targetDirectory, 'src/routes/index.tsx');
  const rootRoutePath = resolve(targetDirectory, 'src/routes/__root.tsx');
  const routerPath = resolve(targetDirectory, 'src/router.tsx');
  try {
    await Promise.all([
      stat(packagePath),
      stat(routePath),
      stat(rootRoutePath),
      stat(routerPath),
    ]);
  } catch {
    throw new Error(
      'The pinned official TanStack CLI did not produce the expected Start file-router scaffold.',
    );
  }
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  if (!packageJson.dependencies?.['@tanstack/react-start']) {
    throw new Error(
      'The upstream scaffold is not a TanStack Start application.',
    );
  }
}

async function updateGeneratedPackage(
  targetDirectory: string,
  projectName: string,
  version: string,
  context: string | undefined,
  example: ApplicationAgenticStartExample,
): Promise<void> {
  const packagePath = resolve(targetDirectory, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    applik8s?: Record<string, string>;
    imports?: Record<string, string>;
  };
  const managed = managedApplicationAgenticStartPackage(
    projectName,
    example,
    version,
    context,
  );
  manifest.name = managed.name;
  manifest.scripts = {
    ...manifest.scripts,
    ...managed.scripts,
  };
  manifest.applik8s = { ...managed.applik8s };
  manifest.imports = { ...manifest.imports, ...managed.imports };
  manifest.dependencies = {
    ...manifest.dependencies,
    ...managed.dependencies,
  };
  manifest.devDependencies = {
    ...manifest.devDependencies,
    ...managed.devDependencies,
  };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

interface ManagedApplicationAgenticStartPackage {
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly applik8s: Readonly<Record<string, string>>;
  readonly imports: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

function managedApplicationAgenticStartPackage(
  projectName: string,
  example: ApplicationAgenticStartExample,
  version: string,
  context?: string,
): ManagedApplicationAgenticStartPackage {
  const maintainedDependencies = {
    '@applik8s/approvals': version,
    '@applik8s/artifacts': version,
    '@applik8s/documents': version,
    '@applik8s/agents': version,
    '@applik8s/knowledge': version,
    '@applik8s/integrations': version,
    '@applik8s/billing': version,
    '@applik8s/billing-stripe': version,
    '@applik8s/conversations': version,
    '@applik8s/data-lifecycle': version,
    '@applik8s/evals': version,
    '@applik8s/identity': version,
    '@applik8s/notifications': version,
    '@applik8s/runtime-hatchet': version,
    '@applik8s/runtime-s3': version,
    '@applik8s/usage': version,
  };
  return Object.freeze({
    name: projectName,
    scripts: Object.freeze({
      build: 'vite build',
      'generate-routes': 'tsr generate',
      typecheck: 'bun run generate-routes && tsc --noEmit',
      test: 'vitest run',
      lint: 'biome lint src test vite.config.ts vitest.config.ts',
      'app:check': 'applik8s build src/application.ts --typekro --composition-name application --out-dir .applik8s/check',
      'db:check': 'drizzle-kit check',
      check: 'bun run typecheck && bun run lint && bun run test && bun run build && bun run app:check && bun run db:check',
      'db:generate': 'drizzle-kit generate',
      doctor: 'applik8s doctor',
      plan: 'bun run build && applik8s plan',
      deploy: 'bun run build && applik8s deploy',
      'dev:cluster': 'bun run build && applik8s deploy --development --instance kubernetes/application.yaml',
      'dev:live': 'bun run build && applik8s deploy --development --instance kubernetes/application.developer.yaml',
      status: 'applik8s status',
      destroy: 'applik8s destroy',
    }),
    applik8s: Object.freeze({
      entrypoint: 'src/application.ts',
      compositionName: 'application',
      instance: 'kubernetes/application.yaml',
      outDir: '.applik8s/deploy',
      ...(context?.trim() ? { context: context.trim() } : {}),
    }),
    imports: Object.freeze({
      '#components/*': './src/components/*.tsx',
      '#lib/*': './src/lib/*.ts',
      '#hooks/*': './src/hooks/*.ts',
    }),
    dependencies: Object.freeze({
      '@tanstack/react-router': applicationAgenticStartDefinition.compatibility.tanstackRouter,
      '@tanstack/react-start': applicationAgenticStartDefinition.compatibility.tanstackStart,
      '@applik8s/ai': version,
      '@applik8s/ai-tanstack': version,
      '@applik8s/applik8s': version,
      '@applik8s/operations': version,
      '@applik8s/operations-ui': version,
      '@applik8s/react': version,
      '@applik8s/start-agentic': version,
      '@applik8s/tanstack-start': version,
      ...maintainedDependencies,
      ...(example === 'research'
        ? {
          '@applik8s/runtime-opensearch': version,
          '@applik8s/search': version,
        }
        : {}),
      '@tanstack/ai': '0.45.1',
      '@tanstack/ai-persistence': '0.1.5',
      '@tanstack/ai-react': applicationAgenticStartDefinition.compatibility.tanstackAIReact,
      arktype: '2.2.1',
      'class-variance-authority': '0.7.1',
      clsx: '2.1.1',
      'drizzle-orm': '^0.45.1',
      'lucide-react': '1.31.0',
      postgres: '^3.4.7',
      'radix-ui': '1.6.7',
      'react-markdown': '10.1.0',
      'remark-gfm': '4.0.1',
      'tailwind-merge': '3.6.0',
      'tw-animate-css': '1.4.0',
    }),
    devDependencies: Object.freeze({
      '@tanstack/router-cli': applicationAgenticStartDefinition.compatibility.tanstackRouterCli,
      '@applik8s/cli': version,
      '@applik8s/testing': version,
      '@biomejs/biome': '^2.2.2',
      '@tailwindcss/vite': '4.3.3',
      'drizzle-kit': '0.31.10',
      nitro: agenticStartNitroVersion,
      shadcn: '4.18.0',
      vitest: '^3.2.4',
      tailwindcss: '4.3.3',
    }),
  });
}

export function renderApplicationAgenticStartManagedPackage(
  projectName: string,
  example: ApplicationAgenticStartExample,
  version: string,
  context?: string,
): string {
  return `${JSON.stringify(
    managedApplicationAgenticStartPackage(projectName, example, version, context),
    null,
    2,
  )}\n`;
}

export function projectApplicationAgenticStartManagedPackage(
  source: string,
  example: ApplicationAgenticStartExample,
): string {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  const shape = managedApplicationAgenticStartPackage(
    typeof parsed.name === 'string' ? parsed.name : 'invalid-project',
    example,
    '__managed_version__',
    '__managed_context__',
  );
  const select = (value: unknown, keys: readonly string[]) => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return Object.fromEntries(keys.filter(key => typeof record[key] === 'string').map(key => [key, record[key]]));
  };
  const projected = {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    scripts: select(parsed.scripts, Object.keys(shape.scripts)),
    applik8s: select(parsed.applik8s, Object.keys(shape.applik8s)),
    imports: select(parsed.imports, Object.keys(shape.imports)),
    dependencies: select(parsed.dependencies, Object.keys(shape.dependencies)),
    devDependencies: select(parsed.devDependencies, Object.keys(shape.devDependencies)),
  };
  return `${JSON.stringify(projected, null, 2)}\n`;
}

function normalizedProjectName(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9-]/gu, '-');
  if (!/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      `Agentic Start project name ${JSON.stringify(value)} must contain a lower-case package name.`,
    );
  }
  return normalized;
}

/**
 * Renders the maintained overlay without running the upstream scaffold or any
 * application code. The read-only update checker uses this data-only boundary
 * to compare a generated project with the current Start release.
 */
export async function renderApplicationAgenticStartTemplates(
  projectName: string,
  example: ApplicationAgenticStartExample,
): Promise<Readonly<Record<string, string>>> {
  const templateRoot = fileURLToPath(
    new URL(`./templates/${example}/`, import.meta.url),
  );
  const files = await readTemplateDirectory(templateRoot);
  const kind = applicationKind(projectName);
  const rendered = Object.fromEntries(
    Object.entries(files).map(([path, source]) => {
      const projectSource = source
        .replaceAll('Applik8sTemplateProject', kind)
        .replaceAll('applik8s-template-project', projectName);
      // The checked-in template is nested below Applik8s's own Biome root, but
      // the generated application must be a self-contained project when it is
      // created outside this monorepo. Materialize that ownership boundary at
      // generation time so neither environment depends on ambient config.
      return [
        path,
        path === 'biome.json'
          ? projectSource.replace('"root": false', '"root": true')
          : projectSource,
      ];
    }),
  );
  return Object.freeze(rendered);
}

export function applicationStartTemplateDigest(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

async function readTemplateDirectory(
  root: string,
  directory = root,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await readTemplateDirectory(root, path));
    } else if (entry.isFile()) {
      files[relative(root, path).replace(/\.tmpl$/u, '')] = await readFile(
        path,
        'utf8',
      );
    }
  }
  return files;
}

function applicationKind(projectName: string): string {
  return projectName
    .split('-')
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join('');
}
