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

const root = resolve(new URL('..', import.meta.url).pathname);
const outputPath = resolve(root, 'docs/v0.9-public-contract.json');
const packageCatalog = await readFile(resolve(root, 'docs/packages.md'), 'utf8');
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

const packages = manifests
  .map(({ directory, manifest, entrypoints }) => ({
    name: manifest.name as string,
    version: manifest.version as string,
    directory,
    description: manifest.description as string,
    owner: `package:${manifest.name}`,
    maturity: 'candidate-review-required',
    documentation: 'docs/packages.md',
    commands: typeof manifest.bin === 'string'
      ? [manifest.name as string]
      : Object.keys(manifest.bin ?? {}).sort(),
    dependencies: [...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].filter((name) => name.startsWith('@applik8s/')))].sort(),
    entrypoints: entrypoints.map(({ name, source }) => ({
      name,
      source,
      symbols: exportedSymbols(resolve(root, source)),
    })),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

for (const entry of packages) {
  const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`^\\| ${'`'}${escaped}${'`'} \\|`, 'mu').test(packageCatalog)) {
    throw new Error(`docs/packages.md does not document ${entry.name}.`);
  }
}

const diagnostics = [...collectDiagnostics()]
  .sort((left, right) => left.code.localeCompare(right.code));
const foundation = JSON.parse(await readFile(resolve(root, 'docs/v0.9-foundation.json'), 'utf8')) as {
  readonly contracts?: readonly unknown[];
};

const inventory = {
  schemaVersion: 1,
  release: '0.9.0-alpha.1',
  status: 'foundation-in-progress',
  derivation: {
    packages: 'scripts/publishable-packages.mjs + packages/*/package.json',
    entrypoints: 'package export maps',
    symbols: 'TypeScript module exports resolved from entrypoint source',
    diagnostics: 'typed literal diagnostic/error positions in public package source',
    documentation: 'docs/packages.md',
  },
  compatibility: {
    defaultMaturity: 'candidate-review-required',
    note: 'Package, entrypoint, symbol, and diagnostic discovery is complete; per-symbol owner, maturity, docs, compatibility, and evidence review remains an alpha.1 gate.',
  },
  packages,
  diagnostics,
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
    status: inventory.status,
  }, null, 2));
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
  readonly maturity: 'candidate-review-required';
}[] {
  const sourcesByCode = new Map<string, Set<string>>();
  for (const source of program.getSourceFiles()) {
    const path = relative(root, source.fileName);
    if (!path.startsWith('packages/') || path.includes('/dist/') || path.includes('/test/')) continue;
    visit(source, source);
  }
  return [...sourcesByCode.entries()].map(([code, sources]) => {
    const packagesForDiagnostic = [...new Set([...sources].map(packageForSource))];
    return {
      code,
      owner: packagesForDiagnostic.length === 1 ? `package:${packagesForDiagnostic[0]}` : 'workspace:cross-package',
      sources: [...sources].sort(),
      maturity: 'candidate-review-required' as const,
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
