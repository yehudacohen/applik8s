export const applicationStartDefinitionApiVersion =
  'applik8s.startDefinition/v1alpha1' as const;

export interface ApplicationStartCompatibility {
  readonly applik8s: string;
  readonly tanstackCli: string;
  readonly tanstackStart: string;
  readonly tanstackAI: string;
  readonly typekro: string;
}

export interface ApplicationStartPackageContribution {
  readonly package: string;
  readonly purpose: string;
  readonly dependencyZone: 'browser-safe' | 'authoring' | 'server-only';
  readonly required: boolean;
}

export interface ApplicationStartProfileContribution {
  readonly name: string;
  readonly production: boolean;
  readonly credentialFree: boolean;
  readonly description: string;
}

export interface ApplicationStartRouteContribution {
  readonly id: string;
  readonly path: string;
  readonly module: string;
  readonly authority: 'application-operation';
}

export interface ApplicationStartDiagnosticContribution {
  readonly id: string;
  readonly description: string;
  readonly severity: 'info' | 'warning' | 'error';
}

export interface ApplicationStartGeneratorOverlay {
  readonly upstream: {
    readonly package: '@tanstack/cli';
    readonly version: string;
    readonly mode: 'start-file-router';
    readonly blank: true;
  };
  readonly maximumApplicationFiles: number;
  readonly maximumIntegrationLines: number;
  readonly files: readonly string[];
}

export interface ApplicationStartDefinition {
  readonly apiVersion: typeof applicationStartDefinitionApiVersion;
  readonly name: string;
  readonly version: string;
  readonly compatibility: ApplicationStartCompatibility;
  readonly packages: readonly ApplicationStartPackageContribution[];
  readonly profiles: readonly ApplicationStartProfileContribution[];
  readonly routes: readonly ApplicationStartRouteContribution[];
  readonly diagnostics: readonly ApplicationStartDiagnosticContribution[];
  readonly generator: ApplicationStartGeneratorOverlay;
}

export interface ApplicationStartDefinitionFinding {
  readonly code:
    | 'START_IDENTITY_INVALID'
    | 'START_DUPLICATE_PACKAGE'
    | 'START_DUPLICATE_PROFILE'
    | 'START_DUPLICATE_ROUTE'
    | 'START_GENERATOR_UNPINNED'
    | 'START_GENERATOR_BUDGET'
    | 'START_GENERATOR_PATH';
  readonly path: string;
  readonly message: string;
}

export function validateApplicationStartDefinition(
  definition: ApplicationStartDefinition,
): readonly ApplicationStartDefinitionFinding[] {
  const findings: ApplicationStartDefinitionFinding[] = [];
  if (
    definition.apiVersion !== applicationStartDefinitionApiVersion
    || !definition.name.trim()
    || !definition.version.trim()
  ) {
    findings.push({
      code: 'START_IDENTITY_INVALID',
      path: 'definition',
      message: 'A Start requires a supported API version, name, and version.',
    });
  }
  checkUnique(
    definition.packages,
    (entry) => entry.package,
    'packages',
    'START_DUPLICATE_PACKAGE',
    findings,
  );
  checkUnique(
    definition.profiles,
    (entry) => entry.name,
    'profiles',
    'START_DUPLICATE_PROFILE',
    findings,
  );
  checkUnique(
    definition.routes,
    (entry) => entry.id,
    'routes',
    'START_DUPLICATE_ROUTE',
    findings,
  );
  if (
    !exactVersion(definition.generator.upstream.version)
    || definition.generator.upstream.package !== '@tanstack/cli'
  ) {
    findings.push({
      code: 'START_GENERATOR_UNPINNED',
      path: 'generator.upstream.version',
      message:
        'A Start generator must pin the exact official @tanstack/cli version.',
    });
  }
  if (
    definition.generator.maximumApplicationFiles < 1
    || definition.generator.files.length
      > definition.generator.maximumApplicationFiles
    || definition.generator.maximumIntegrationLines < 1
  ) {
    findings.push({
      code: 'START_GENERATOR_BUDGET',
      path: 'generator',
      message:
        'A Start generator must declare and remain within positive file and line budgets.',
    });
  }
  for (const [index, file] of definition.generator.files.entries()) {
    if (!safeRelativePath(file)) {
      findings.push({
        code: 'START_GENERATOR_PATH',
        path: `generator.files[${index}]`,
        message: `Generated path ${JSON.stringify(file)} must remain relative to the application root.`,
      });
    }
  }
  return findings;
}

function checkUnique<TValue>(
  values: readonly TValue[],
  identity: (value: TValue) => string,
  path: string,
  code:
    | 'START_DUPLICATE_PACKAGE'
    | 'START_DUPLICATE_PROFILE'
    | 'START_DUPLICATE_ROUTE',
  findings: ApplicationStartDefinitionFinding[],
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const id = identity(value);
    if (!id.trim() || seen.has(id)) {
      findings.push({
        code,
        path: `${path}[${index}]`,
        message: `${path} identity ${JSON.stringify(id)} is empty or duplicated.`,
      });
    }
    seen.add(id);
  }
}

function exactVersion(version: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(
    version,
  );
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0
    && !path.startsWith('/')
    && !path.startsWith('\\')
    && !path.split(/[\\/]/u).some((segment) => segment === '..')
  );
}
