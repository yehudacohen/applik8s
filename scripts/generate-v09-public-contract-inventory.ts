// typecast-file-boundary: Package manifests and compiler source are repository
// inputs; this generator validates their relevant fields before inventorying
// the public contract surface.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { publishablePackageManifestPaths } from './publishable-packages.mjs';

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string | {
    readonly types?: string;
    readonly import?: string;
    readonly default?: string;
  }>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

interface ResolvedEntrypoint {
  readonly name: string;
  readonly source: string;
}

type PublicContractMaturity =
  | 'stable-1.0-candidate'
  | 'beta'
  | 'preview'
  | 'experimental'
  | 'deprecated'
  | 'internal';
type PublicContractCompatibility =
  | 'authoring'
  | 'artifact'
  | 'runtime'
  | 'generated-source'
  | 'provider'
  | 'lifecycle';
type PublicContractStability =
  | 'stable'
  | 'additive'
  | 'informational'
  | 'experimental'
  | 'opaque';

interface PublicContractDispositionGroup {
  readonly id: string;
  readonly owner: string;
  readonly maturity: PublicContractMaturity;
  readonly compatibility: readonly PublicContractCompatibility[];
  readonly stability: PublicContractStability;
  readonly evidence: readonly string[];
  readonly packages: readonly string[];
}

interface PublicContractDispositionManifest {
  readonly schemaVersion: 1;
  readonly release: '0.9.0';
  readonly status: 'candidate-review-ready' | 'frozen';
  readonly documentation: string;
  readonly overrides?: readonly PublicContractOverride[];
  readonly groups: readonly PublicContractDispositionGroup[];
}

interface PublicContractOverride {
  readonly id: string;
  readonly package: string;
  readonly entrypoints: readonly string[];
  readonly symbolPrefixes?: readonly string[];
  readonly maturity: PublicContractMaturity;
  readonly stability: PublicContractStability;
  readonly owner: string;
  readonly evidence: readonly string[];
  readonly reason: string;
}

const root = resolve(new URL('..', import.meta.url).pathname);
const outputPath = resolve(root, 'docs/v0.9-public-contract.json');
const packageCatalog = await readFile(resolve(root, 'docs/packages.md'), 'utf8');
const dispositionManifest = JSON.parse(
  await readFile(resolve(root, 'docs/v0.9-public-contract-dispositions.json'), 'utf8'),
) as PublicContractDispositionManifest;
if (
  dispositionManifest.schemaVersion !== 1
  || dispositionManifest.release !== '0.9.0'
  || !['candidate-review-ready', 'frozen'].includes(dispositionManifest.status)
) {
  throw new Error('PUBLIC_CONTRACT_DISPOSITION_IDENTITY_INVALID');
}
const manifests = await Promise.all(publishablePackageManifestPaths.map(async (manifestPath) => {
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8')) as PackageManifest;
  if (!manifest.name?.startsWith('@applik8s/') && manifest.name !== 'create-applik8s') {
    throw new Error(`${manifestPath} does not identify an Applik8s public package.`);
  }
  if (!manifest.version || !manifest.description?.trim() || (!manifest.exports && !manifest.bin)) {
    throw new Error(`${manifestPath} lacks version, description, or a public export/command required by the public inventory.`);
  }
  const directory = dirname(manifestPath);
  const entrypoints = await resolveEntrypoints(directory, manifest.exports ?? {});
  return { manifestPath, directory, manifest, entrypoints };
}));

const compilerOptions = readCompilerOptions();
const sourcePaths = [...new Set(manifests.flatMap(({ entrypoints }) => entrypoints.map(({ source }) => resolve(root, source))))];
const program = ts.createProgram(sourcePaths, compilerOptions);
const checker = program.getTypeChecker();
const packageByDirectory = new Map(manifests.map(({ directory, manifest }) => [directory, manifest.name as string]));
const dispositionByPackage = packageDispositions(
  dispositionManifest,
  manifests.map(({ manifest }) => manifest.name as string),
);
const contractOverrides = validateContractOverrides(
  dispositionManifest.overrides ?? [],
  manifests.map(({ manifest }) => manifest.name as string),
);

const packages = manifests
  .map(({ directory, manifest, entrypoints }) => {
    const name = manifest.name as string;
    const disposition = dispositionByPackage.get(name);
    if (!disposition) throw new Error(`PUBLIC_CONTRACT_PACKAGE_UNCLASSIFIED:${name}`);
    const contract = inheritedContract(disposition, dispositionManifest.documentation);
    return {
      name,
      version: manifest.version as string,
      directory,
      description: manifest.description as string,
      contract,
      replacement: { status: 'canonical', aliases: [] as readonly string[] },
      commands: typeof manifest.bin === 'string'
        ? [manifest.name as string]
        : Object.keys(manifest.bin ?? {}).sort(),
      dependencies: [...new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ].filter((dependency) => dependency.startsWith('@applik8s/')))].sort(),
      entrypoints: entrypoints.map(({ name: entrypoint, source }) => {
        const symbols = exportedSymbols(resolve(root, source));
        const overrides = contractOverrides.filter(candidate =>
          candidate.package === name && candidate.entrypoints.includes(entrypoint)
        );
        const entrypointOverride = overrides.find(candidate => !candidate.symbolPrefixes);
        const symbolContracts = symbols.flatMap(symbol => {
          const override = overrides.find(candidate =>
            candidate.symbolPrefixes?.some(prefix => symbol.startsWith(prefix))
          );
          return override ? [{ name: symbol, contract: explicitOverrideContract(override) }] : [];
        });
        return {
          name: entrypoint,
          source,
          kind: symbols.length === 0 ? 'side-effect' : 'module',
          contract: entrypointOverride
            ? explicitOverrideContract(entrypointOverride)
            : { inherits: `package:${name}` },
          symbols,
          symbolContract: { inherits: `entrypoint:${name}:${entrypoint}` },
          ...(symbolContracts.length > 0 ? { symbolContracts } : {}),
        };
      }),
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

for (const override of contractOverrides) {
  const packageContract = packages.find(candidate => candidate.name === override.package);
  const matchedEntrypoints = packageContract?.entrypoints.filter(candidate =>
    override.entrypoints.includes(candidate.name)
  ) ?? [];
  if (matchedEntrypoints.length !== override.entrypoints.length) {
    throw new Error(`PUBLIC_CONTRACT_OVERRIDE_ENTRYPOINT_STALE:${override.id}`);
  }
  for (const prefix of override.symbolPrefixes ?? []) {
    if (!matchedEntrypoints.some(entrypoint => entrypoint.symbols.some(symbol => symbol.startsWith(prefix)))) {
      throw new Error(`PUBLIC_CONTRACT_OVERRIDE_SYMBOL_PREFIX_STALE:${override.id}:${prefix}`);
    }
  }
}

for (const entry of packages) {
  const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`^\\| ${'`'}${escaped}${'`'} \\|`, 'mu').test(packageCatalog)) {
    throw new Error(`docs/packages.md does not document ${entry.name}.`);
  }
}

const diagnostics = [...collectDiagnostics()]
  .sort((left, right) => left.code.localeCompare(right.code));
const cli = collectCliContracts();
const environmentVariables = collectEnvironmentVariableContracts();
const foundation = JSON.parse(await readFile(resolve(root, 'docs/v0.9-foundation.json'), 'utf8')) as {
  readonly contracts?: readonly unknown[];
};

const inventory = {
  schemaVersion: 1,
  release: '0.9.0',
  status: dispositionManifest.status,
  derivation: {
    packages: 'scripts/publishable-packages.mjs + packages/*/package.json',
    entrypoints: 'package export maps',
    symbols: 'TypeScript module exports resolved from entrypoint source',
    diagnostics: 'typed literal diagnostic/error positions in public package source',
    cli: 'Commander command and option declarations in the public CLI source',
    environmentVariables: 'process.env property reads reachable from public package source',
    dispositions: 'docs/v0.9-public-contract-dispositions.json',
    documentation: 'docs/packages.md',
  },
  compatibility: {
    inheritance: 'Every entrypoint inherits its package contract and every exported symbol inherits its entrypoint contract unless a future explicit symbol override is recorded.',
    disposition: 'Every public package is assigned exactly one owner, maturity, compatibility set, stability class, documentation authority, evidence set, and replacement policy. Maintainer approval is still required before the candidate becomes frozen.',
  },
  packages,
  diagnostics,
  cli,
  environmentVariables,
  contracts: foundation.contracts ?? [],
};

const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(outputPath, serialized, 'utf8');
  console.log(`Wrote ${relative(root, outputPath)} with ${packages.length} packages, ${packages.reduce((count, entry) => count + entry.entrypoints.length, 0)} entrypoints, and ${diagnostics.length} diagnostics.`);
} else {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== serialized) {
    throw new Error('PUBLIC_CONTRACT_INVENTORY_DIRTY: run bun run generate:v09:public-contracts and commit the result.');
  }
  console.log(JSON.stringify({
    packages: packages.length,
    entrypoints: packages.reduce((count, entry) => count + entry.entrypoints.length, 0),
    symbols: packages.reduce((count, entry) => count + entry.entrypoints.reduce((sum, item) => sum + item.symbols.length, 0), 0),
    diagnostics: diagnostics.length,
    cliCommands: cli.commands.length,
    cliOptions: cli.options.length,
    environmentVariables: environmentVariables.length,
    status: inventory.status,
  }, null, 2));
}

function packageDispositions(
  manifest: PublicContractDispositionManifest,
  packageNames: readonly string[],
): ReadonlyMap<string, PublicContractDispositionGroup> {
  const known = new Set(packageNames);
  const output = new Map<string, PublicContractDispositionGroup>();
  for (const group of manifest.groups) {
    if (!group.id || !group.owner || group.compatibility.length === 0 || group.evidence.length === 0) {
      throw new Error(`PUBLIC_CONTRACT_DISPOSITION_INCOMPLETE:${group.id || '<empty>'}`);
    }
    for (const name of group.packages) {
      if (!known.has(name)) throw new Error(`PUBLIC_CONTRACT_DISPOSITION_UNKNOWN_PACKAGE:${name}`);
      if (output.has(name)) throw new Error(`PUBLIC_CONTRACT_DISPOSITION_DUPLICATED:${name}`);
      output.set(name, group);
    }
  }
  for (const name of known) {
    if (!output.has(name)) throw new Error(`PUBLIC_CONTRACT_PACKAGE_UNCLASSIFIED:${name}`);
  }
  return output;
}

function validateContractOverrides(
  overrides: readonly PublicContractOverride[],
  packageNames: readonly string[],
): readonly PublicContractOverride[] {
  const knownPackages = new Set(packageNames);
  const ids = new Set<string>();
  for (const override of overrides) {
    if (!override.id || ids.has(override.id)) {
      throw new Error(`PUBLIC_CONTRACT_OVERRIDE_ID_INVALID:${override.id || '<empty>'}`);
    }
    ids.add(override.id);
    if (!knownPackages.has(override.package)) {
      throw new Error(`PUBLIC_CONTRACT_OVERRIDE_PACKAGE_UNKNOWN:${override.id}:${override.package}`);
    }
    if (
      override.entrypoints.length === 0
      || !override.owner
      || override.evidence.length === 0
      || !override.reason.trim()
      || override.symbolPrefixes?.some(prefix => !prefix)
    ) {
      throw new Error(`PUBLIC_CONTRACT_OVERRIDE_INCOMPLETE:${override.id}`);
    }
  }
  return overrides;
}

function explicitOverrideContract(override: PublicContractOverride) {
  return {
    override: override.id,
    owner: override.owner,
    maturity: override.maturity,
    stability: override.stability,
    evidence: override.evidence,
    reason: override.reason,
  } as const;
}

function inheritedContract(
  disposition: PublicContractDispositionGroup,
  documentation: string,
) {
  return {
    disposition: disposition.id,
    owner: disposition.owner,
    maturity: disposition.maturity,
    compatibility: [...disposition.compatibility],
    stability: disposition.stability,
    documentation,
    evidence: [...disposition.evidence],
  } as const;
}

function readCompilerOptions(): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('Cannot find root tsconfig.json.');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  return ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
}

async function resolveEntrypoints(
  directory: string,
  exportsMap: NonNullable<PackageManifest['exports']>,
): Promise<readonly ResolvedEntrypoint[]> {
  const output: ResolvedEntrypoint[] = [];
  for (const [name, contract] of Object.entries(exportsMap).sort(([left], [right]) => left.localeCompare(right))) {
    const typesPath = typeof contract === 'string' ? contract : contract.types;
    if (!typesPath?.startsWith('./dist/') || !typesPath.endsWith('.d.ts')) {
      throw new Error(`${directory} export ${name} lacks a conventional public declaration target.`);
    }
    const sourcePattern = `${directory}/src/${typesPath.slice('./dist/'.length, -'.d.ts'.length)}.ts`;
    if (name.includes('*') || sourcePattern.includes('*')) {
      const sourceDirectory = dirname(sourcePattern);
      const basenamePattern = sourcePattern.slice(sourceDirectory.length + 1);
      const [prefix, suffix] = basenamePattern.split('*');
      for (const file of (await readdir(resolve(root, sourceDirectory))).sort()) {
        if (!file.startsWith(prefix ?? '') || !file.endsWith(suffix ?? '')) continue;
        const wildcard = file.slice((prefix ?? '').length, file.length - (suffix ?? '').length);
        output.push({ name: name.replace('*', wildcard), source: `${sourceDirectory}/${file}` });
      }
      continue;
    }
    if (!(await exists(resolve(root, sourcePattern)))) {
      throw new Error(`${directory} export ${name} resolves to missing source ${sourcePattern}.`);
    }
    output.push({ name, source: sourcePattern });
  }
  return output;
}

function exportedSymbols(path: string): readonly string[] {
  const source = program.getSourceFile(path);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`Cannot resolve TypeScript module exports for ${relative(root, path)}.`);
  return checker.getExportsOfModule(module).map(({ name }) => name).sort();
}

function collectDiagnostics(): readonly {
  readonly code: string;
  readonly owner: string;
  readonly sources: readonly string[];
  readonly maturity: PublicContractMaturity;
  readonly compatibility: readonly PublicContractCompatibility[];
  readonly stability: PublicContractStability;
  readonly documentation: string;
  readonly evidence: readonly string[];
}[] {
  const sourcesByCode = new Map<string, Set<string>>();
  for (const source of program.getSourceFiles()) {
    const path = relative(root, source.fileName);
    if (!path.startsWith('packages/') || path.includes('/dist/') || path.includes('/test/')) continue;
    visit(source, source);
  }
  return [...sourcesByCode.entries()].map(([code, sources]) => {
    const packagesForDiagnostic = [...new Set([...sources].map(packageForSource))]
      .filter((name) => name !== 'unknown');
    const disposition = mostConservativeDisposition(packagesForDiagnostic);
    return {
      code,
      owner: packagesForDiagnostic.length === 1 ? `package:${packagesForDiagnostic[0]}` : 'workspace:cross-package',
      sources: [...sources].sort(),
      maturity: disposition.maturity,
      compatibility: ['runtime'] as const,
      stability: disposition.stability,
      documentation: dispositionManifest.documentation,
      evidence: [...disposition.evidence],
    };
  });

  function visit(node: ts.Node, source: ts.SourceFile): void {
    if (ts.isStringLiteralLike(node) && /^[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+$/u.test(node.text) && isDiagnosticPosition(node)) {
      const sources = sourcesByCode.get(node.text) ?? new Set<string>();
      sources.add(relative(root, source.fileName));
      sourcesByCode.set(node.text, sources);
    }
    ts.forEachChild(node, (child) => visit(child, source));
  }
}

function collectCliContracts(): {
  readonly commands: readonly {
    readonly name: string;
    readonly source: string;
    readonly line: number;
    readonly contract: ReturnType<typeof inheritedContract>;
  }[];
  readonly options: readonly {
    readonly flags: string;
    readonly required: boolean;
    readonly source: string;
    readonly line: number;
    readonly contract: ReturnType<typeof inheritedContract>;
  }[];
} {
  const disposition = dispositionByPackage.get('@applik8s/cli');
  if (!disposition) throw new Error('PUBLIC_CONTRACT_PACKAGE_UNCLASSIFIED:@applik8s/cli');
  const contract = inheritedContract(disposition, dispositionManifest.documentation);
  const commands = new Map<string, { name: string; source: string; line: number; contract: typeof contract }>();
  const options = new Map<string, { flags: string; required: boolean; source: string; line: number; contract: typeof contract }>();
  for (const source of program.getSourceFiles()) {
    const path = relative(root, source.fileName);
    if (!path.startsWith('packages/cli/src/') || path.includes('/dist/')) continue;
    visit(source, source, path);
  }
  return {
    commands: [...commands.values()].sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source) || left.line - right.line),
    options: [...options.values()].sort((left, right) => left.flags.localeCompare(right.flags) || left.source.localeCompare(right.source) || left.line - right.line),
  };

  function visit(node: ts.Node, source: ts.SourceFile, path: string): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (method === 'command') {
          const key = `${first.text}\0${path}\0${line}`;
          commands.set(key, { name: first.text, source: path, line, contract });
        }
        if (method === 'option' || method === 'requiredOption') {
          const key = `${first.text}\0${path}\0${line}`;
          options.set(key, { flags: first.text, required: method === 'requiredOption', source: path, line, contract });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, source, path));
  }
}

function collectEnvironmentVariableContracts(): readonly {
  readonly name: string;
  readonly owners: readonly string[];
  readonly sources: readonly string[];
  readonly maturity: PublicContractMaturity;
  readonly compatibility: readonly ['runtime'];
  readonly stability: PublicContractStability;
  readonly documentation: string;
  readonly evidence: readonly string[];
}[] {
  const sourcesByName = new Map<string, Set<string>>();
  const propertyPattern = /process\.env\.([A-Z][A-Z0-9_]*)/gu;
  const elementPattern = /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/gu;
  for (const source of program.getSourceFiles()) {
    const path = relative(root, source.fileName);
    if (!path.startsWith('packages/') || path.includes('/dist/') || path.includes('/test/')) continue;
    for (const pattern of [propertyPattern, elementPattern]) {
      pattern.lastIndex = 0;
      for (const match of source.text.matchAll(pattern)) {
        const name = match[1];
        if (!name) continue;
        const sources = sourcesByName.get(name) ?? new Set<string>();
        sources.add(path);
        sourcesByName.set(name, sources);
      }
    }
  }
  return [...sourcesByName.entries()].map(([name, sources]) => {
    const owners = [...new Set([...sources].map(packageForSource))]
      .filter((owner) => owner !== 'unknown')
      .sort();
    const disposition = mostConservativeDisposition(owners);
    return {
      name,
      owners,
      sources: [...sources].sort(),
      maturity: disposition.maturity,
      compatibility: ['runtime'] as const,
      stability: disposition.stability,
      documentation: dispositionManifest.documentation,
      evidence: [...disposition.evidence],
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function mostConservativeDisposition(
  packageNames: readonly string[],
): PublicContractDispositionGroup {
  const dispositions = packageNames
    .map((name) => dispositionByPackage.get(name))
    .filter((value): value is PublicContractDispositionGroup => value !== undefined);
  if (dispositions.length === 0) {
    throw new Error(`PUBLIC_CONTRACT_OWNER_UNAVAILABLE:${packageNames.join(',') || '<none>'}`);
  }
  const rank: Readonly<Record<PublicContractMaturity, number>> = {
    internal: 0,
    deprecated: 1,
    experimental: 2,
    preview: 3,
    beta: 4,
    'stable-1.0-candidate': 5,
  };
  return [...dispositions].sort((left, right) => rank[left.maturity] - rank[right.maturity])[0] as PublicContractDispositionGroup;
}

function isDiagnosticPosition(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && propertyName(parent.name) === 'code') return true;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.[0] === node) {
    const callee = ts.isCallExpression(parent) ? parent.expression.getText() : parent.expression.getText();
    return /error|diagnostic|fail|reject/iu.test(callee);
  }
  return false;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function packageForSource(source: string): string {
  const match = /^(packages\/[^/]+)/u.exec(source);
  return (match?.[1] && packageByDirectory.get(match[1])) ?? 'unknown';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
