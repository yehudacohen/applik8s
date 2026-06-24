import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Plugin } from 'esbuild';
import ts from 'typescript';

import type { Diagnostic, Result } from '@applik8s/core';

export interface HandlerBundleRequest {
  readonly entrypoint: string;
  readonly outDir: string;
  readonly portability?: HandlerBundlePortabilityPolicy;
  readonly portabilitySourceRoot?: string;
}

export interface HandlerBundlePortabilityPolicy {
  readonly allowFilesystemAccess?: boolean;
  readonly allowEnvironmentAccess?: boolean;
  readonly allowNetworkAccess?: boolean;
  readonly allowDynamicImport?: boolean;
}

export interface HandlerBundleResult {
  readonly javascriptBundlePath: string;
  readonly sourceMapPath: string;
  readonly metafilePath: string;
  readonly wasmBackend: 'componentize-js';
  readonly diagnostics: readonly Diagnostic[];
}

export interface HandlerBundler {
  bundle(request: HandlerBundleRequest): Promise<Result<HandlerBundleResult>>;
}

const sourceWorkspaceRoot = fileURLToPath(new URL('../../../..', import.meta.url));

export async function bundleHandlerEntrypoint(request: HandlerBundleRequest): Promise<Result<HandlerBundleResult>> {
  const javascriptBundlePath = join(request.outDir, 'handler.js');
  const sourceMapPath = `${javascriptBundlePath}.map`;
  const metafilePath = join(request.outDir, 'handler.esbuild-meta.json');

  try {
    await mkdir(request.outDir, { recursive: true });
    const portabilityDiagnostics = await validateEntrypointPortability(request);
    if (portabilityDiagnostics.length > 0) {
      return portabilityError(portabilityDiagnostics[0]?.sourceLocation?.file ?? request.entrypoint, portabilityDiagnostics[0]?.message ?? 'Handler entrypoint violates the portability policy.');
    }

    const result = await build({
      entryPoints: [request.entrypoint],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      external: ['applik8s:handler/capabilities'],
      outfile: javascriptBundlePath,
      metafile: true,
      sourcemap: true,
      sourcesContent: false,
      write: true,
      plugins: [applik8sWorkspaceSourcePlugin()],
    });

    const bundledDiagnostics = await validateBundledInputPortability(result.metafile.inputs, request);
    if (bundledDiagnostics.length > 0) {
      return portabilityError(bundledDiagnostics[0]?.sourceLocation?.file ?? request.entrypoint, bundledDiagnostics[0]?.message ?? 'Bundled handler source violates the portability policy.');
    }

    await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);

    return { ok: true, value: { javascriptBundlePath, sourceMapPath, metafilePath, wasmBackend: 'componentize-js', diagnostics: [] } };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: cause instanceof Error ? cause.message : 'esbuild failed to bundle handler entrypoint.',
        severity: 'error',
        context: { sourceFile: request.entrypoint },
        recovery: { summary: 'Check that handler imports are portable and resolvable by esbuild for the WASM component target.' },
      },
    };
  }
}

export function applik8sWorkspaceSourcePlugin(): Plugin {
  const workspaceRoot = process.env.APPLIK8S_WORKSPACE_ROOT ?? sourceWorkspaceRoot;
  const packageAliases = new Map<string, string>([
    ['@applik8s/applik8s', resolve(workspaceRoot, 'packages/applik8s/src/index.ts')],
    ['@applik8s/core', resolve(workspaceRoot, 'packages/core/src/index.ts')],
    ['@applik8s/sdk', resolve(workspaceRoot, 'packages/sdk/src/index.ts')],
    ['@applik8s/testing', resolve(workspaceRoot, 'packages/testing/src/index.ts')],
    ['@applik8s/compiler', resolve(workspaceRoot, 'packages/compiler/src/index.ts')],
    ['@applik8s/runtime-contract', resolve(workspaceRoot, 'packages/runtime-contract/src/index.ts')],
    ['@applik8s/typekro-adapter', resolve(workspaceRoot, 'packages/typekro-adapter/src/index.ts')],
    ['@applik8s/typekro-adapter/targets', resolve(workspaceRoot, 'packages/typekro-adapter/src/operation-targets.ts')],
    ['@applik8s/typetainer', resolve(workspaceRoot, 'packages/typetainer/src/index.ts')],
  ]);

  return {
    name: 'applik8s-workspace-source',
    setup(build) {
      build.onResolve({ filter: /^@applik8s\// }, async (args) => {
        const alias = packageAliases.get(args.path);
        if (alias && await fileExists(alias)) {
          return { path: alias };
        }
        return undefined;
      });

      build.onResolve({ filter: /^\/.*\.[cm]?[tj]s$/ }, async (args) => {
        if (await fileExists(args.path)) {
          return { path: args.path };
        }
        return undefined;
      });

      build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, async (args) => {
        if (!args.importer.includes(`${workspaceRoot}/packages/`)) {
          return undefined;
        }
        const tsCandidate = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
        if (await fileExists(tsCandidate)) {
          return { path: tsCandidate };
        }
        return undefined;
      });
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateEntrypointPortability(request: HandlerBundleRequest): Promise<readonly Diagnostic[]> {
  return validateLocalSourceGraphPortability(request.entrypoint, request.portabilitySourceRoot ?? dirname(request.entrypoint), request.portability ?? {});
}

async function validateLocalSourceGraphPortability(entrypoint: string, sourceRoot: string, policy: HandlerBundlePortabilityPolicy): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const visited = new Set<string>();

  const visit = async (sourceFile: string): Promise<void> => {
    const normalizedSourceFile = resolve(sourceFile);
    if (visited.has(normalizedSourceFile)) {
      return;
    }
    visited.add(normalizedSourceFile);

    const source = await readFile(normalizedSourceFile, 'utf8');
    diagnostics.push(...validateSourcePortability(source, normalizedSourceFile, policy));
    for (const specifier of localModuleSpecifiers(source, normalizedSourceFile)) {
      const resolved = await resolveLocalModule(specifier, normalizedSourceFile, sourceRoot);
      if (resolved) {
        await visit(resolved);
      }
    }
  };

  await visit(entrypoint);
  return diagnostics;
}

async function validateBundledInputPortability(inputs: Record<string, unknown>, request: HandlerBundleRequest): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const input of Object.keys(inputs)) {
    try {
      const resolved = await readMetafileInput(input, request);
      const { source, sourceFile } = resolved;
      if (isWithinSourceRoot(sourceFile, request.portabilitySourceRoot ?? dirname(request.entrypoint)) || sourceFile === request.entrypoint) {
        diagnostics.push(...validateSourcePortability(source, sourceFile, request.portability ?? {}));
      }
    } catch {
      // esbuild metafiles can contain virtual or external inputs; only local readable files are policy-scanned here.
    }
  }

  return diagnostics;
}

async function readMetafileInput(input: string, request: HandlerBundleRequest): Promise<{ readonly sourceFile: string; readonly source: string }> {
  const candidates = [
    isAbsolute(input) ? input : resolve(input),
    resolve(dirname(request.entrypoint), input),
    resolve(request.outDir, input),
  ];

  for (const candidate of [...new Set(candidates)]) {
    try {
      return { sourceFile: candidate, source: await readFile(candidate, 'utf8') };
    } catch {
      // Try the next plausible esbuild metafile path interpretation.
    }
  }

  throw new Error(`Unable to read bundled input ${input}`);
}

function validateSourcePortability(source: string, sourceFile: string, policy: HandlerBundlePortabilityPolicy): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const sourceAst = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, scriptKindForSourceFile(sourceFile));

  const visit = (node: ts.Node): void => {
    if (!policy.allowDynamicImport && isDynamicImport(node)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Dynamic import is not portable in handler source.'));
    }

    if (!policy.allowDynamicImport && isDynamicRequire(node)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Dynamic require is not portable in handler source.'));
    }

    if (!policy.allowEnvironmentAccess && isProcessEnvAccess(node)) {
      diagnostics.push(
        diagnosticForNode(
          sourceAst,
          sourceFile,
          node,
          'Environment access must be represented as deployment configuration or a declared capability.'
        )
      );
    }

    if (!policy.allowEnvironmentAccess && (isUnsupportedProcessAccess(node) || isNodeGlobalAssumption(node))) {
      diagnostics.push(
        diagnosticForNode(
          sourceAst,
          sourceFile,
          node,
          'Node.js process globals are not portable in handler source; represent environment-specific state as deployment configuration or declared capabilities.'
        )
      );
    }

    if (!policy.allowFilesystemAccess && importsAnyModule(node, FILESYSTEM_MODULES)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Filesystem access is not portable in handler source.'));
    }

    if (!policy.allowFilesystemAccess && containsLocalCredentialPath(node)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Local credential paths must not be captured in handler artifacts; pass secrets by reference through Kubernetes Secret refs or declared capabilities.'));
    }

    if (!policy.allowNetworkAccess && (importsAnyModule(node, NETWORK_MODULES) || isRawNetworkApiUse(node))) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Raw network access other than fetch must go through a declared capability.'));
    }

    if (importsAnyModule(node, UNSUPPORTED_NATIVE_MODULES)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Node.js native modules are not portable in handler source unless represented by an explicit capability.'));
    }

    if (containsHardcodedSecretMaterial(node)) {
      diagnostics.push(diagnosticForNode(sourceAst, sourceFile, node, 'Likely secret material must not be embedded in handler artifacts; pass secrets by reference through Kubernetes Secret refs or declared capabilities.'));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceAst);

  return diagnostics;
}

function localModuleSpecifiers(source: string, sourceFile: string): readonly string[] {
  const specifiers: string[] = [];
  const sourceAst = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, scriptKindForSourceFile(sourceFile));
  const visit = (node: ts.Node): void => {
    const moduleSpecifier = moduleSpecifierText(node) ?? requireModuleSpecifierText(node);
    if (moduleSpecifier !== undefined) {
      specifiers.push(moduleSpecifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceAst);
  return specifiers;
}

async function resolveLocalModule(specifier: string, importer: string, sourceRoot: string): Promise<string | undefined> {
  if (!specifier.startsWith('.') && !isAbsolute(specifier)) {
    return undefined;
  }
  const unresolved = specifier.startsWith('.') ? resolve(dirname(importer), specifier) : resolve(specifier);
  if (!isWithinSourceRoot(unresolved, sourceRoot)) {
    return undefined;
  }
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.js`,
    `${unresolved}.mjs`,
    `${unresolved}.cjs`,
    join(unresolved, 'index.ts'),
    join(unresolved, 'index.tsx'),
    join(unresolved, 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // Try the next TypeScript/JavaScript module resolution candidate.
    }
  }
  return undefined;
}

function isWithinSourceRoot(sourceFile: string, sourceRoot: string): boolean {
  const fromRoot = relative(resolve(sourceRoot), resolve(sourceFile));
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

function portabilityError(sourceFile: string, message: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'BUNDLE_INVALID',
      message,
      severity: 'error',
      context: { sourceFile },
      recovery: { summary: 'Declare an explicit capability or enable the corresponding portability policy exception.' },
    },
  };
}

const FILESYSTEM_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);
const NETWORK_MODULES = new Set(['http', 'https', 'net', 'tls', 'dns', 'node:http', 'node:https', 'node:net', 'node:tls', 'node:dns']);
const UNSUPPORTED_NATIVE_MODULES = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'module',
  'os',
  'path',
  'perf_hooks',
  'process',
  'readline',
  'repl',
  'stream',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
  'node:assert',
  'node:buffer',
  'node:child_process',
  'node:cluster',
  'node:console',
  'node:crypto',
  'node:dgram',
  'node:module',
  'node:os',
  'node:path',
  'node:perf_hooks',
  'node:process',
  'node:readline',
  'node:repl',
  'node:stream',
  'node:tty',
  'node:url',
  'node:util',
  'node:v8',
  'node:vm',
  'node:worker_threads',
  'node:zlib',
]);
const LOCAL_CREDENTIAL_PATH_PATTERNS = [
  /(?:^|[/\\])\.aws[/\\]credentials(?:$|[/\\])/i,
  /(?:^|[/\\])\.azure(?:$|[/\\])/i,
  /(?:^|[/\\])\.docker[/\\]config\.json$/i,
  /(?:^|[/\\])\.env(?:\.[^/\\]+)?$/i,
  /(?:^|[/\\])\.config[/\\]gcloud[/\\]application_default_credentials\.json$/i,
  /(?:^|[/\\])\.kube[/\\]config$/i,
  /(?:^|[/\\])\.netrc$/i,
  /(?:^|[/\\])\.npmrc$/i,
  /(?:^|[/\\])\.ssh(?:$|[/\\])/i,
  /^file:\/\/(?:Users|home)\//i,
  /^[/\\](?:Users|home)\//i,
  /^[A-Za-z]:\\Users\\/i,
  /^~[/\\]/,
];
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^AKIA[0-9A-Z]{16}$/,
  /^ASIA[0-9A-Z]{16}$/,
  /^ghp_[A-Za-z0-9_]{20,}$/,
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{20,}$/,
  /^sk-[A-Za-z0-9]{20,}$/,
  /^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}$/,
];

function scriptKindForSourceFile(sourceFile: string): ts.ScriptKind {
  if (sourceFile.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (sourceFile.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (sourceFile.endsWith('.js') || sourceFile.endsWith('.mjs') || sourceFile.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isDynamicImport(node: ts.Node): boolean {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isDynamicRequire(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') {
    return false;
  }
  const [specifier] = node.arguments;
  return node.arguments.length !== 1 || !specifier || !ts.isStringLiteral(specifier);
}

function isProcessEnvAccess(node: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process' && node.name.text === 'env') ||
    (ts.isElementAccessExpression(node) &&
      node.expression.getText() === 'process' &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === 'env')
  );
}

function isUnsupportedProcessAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process') {
    return node.name.text !== 'env';
  }
  if (ts.isElementAccessExpression(node) && node.expression.getText() === 'process') {
    return !ts.isStringLiteral(node.argumentExpression) || node.argumentExpression.text !== 'env';
  }
  if (ts.isIdentifier(node) && node.text === 'process') {
    return !isAllowedProcessIdentifierReference(node);
  }
  return false;
}

function isAllowedProcessIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'env') {
    return true;
  }
  return ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteral(parent.argumentExpression) && parent.argumentExpression.text === 'env';
}

function isNodeGlobalAssumption(node: ts.Node): boolean {
  return ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename' || node.text === 'Buffer');
}

function importsAnyModule(node: ts.Node, blockedModules: ReadonlySet<string>): boolean {
  const moduleSpecifier = moduleSpecifierText(node);
  if (moduleSpecifier !== undefined) {
    return blockedModules.has(moduleSpecifier);
  }

  const requireModule = requireModuleSpecifierText(node);
  return requireModule !== undefined && blockedModules.has(requireModule);
}

function moduleSpecifierText(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  return undefined;
}

function requireModuleSpecifierText(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'require') {
    return undefined;
  }
  const [specifier] = node.arguments;
  if (
    node.arguments.length === 1 &&
    specifier &&
    ts.isStringLiteral(specifier)
  ) {
    return specifier.text;
  }
  return undefined;
}

function containsLocalCredentialPath(node: ts.Node): boolean {
  if (isStaticModuleSpecifier(node)) {
    return false;
  }
  const value = stringLiteralText(node);
  return value !== undefined && LOCAL_CREDENTIAL_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

function isStaticModuleSpecifier(node: ts.Node): boolean {
  return (
    (ts.isStringLiteral(node) && ts.isImportDeclaration(node.parent) && node.parent.moduleSpecifier === node) ||
    (ts.isStringLiteral(node) && ts.isExportDeclaration(node.parent) && node.parent.moduleSpecifier === node)
  );
}

function containsHardcodedSecretMaterial(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(node.text));
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return containsSensitiveNamedString(node.name.text, node.initializer);
  }
  if (ts.isPropertyAssignment(node)) {
    return containsSensitiveNamedString(propertyNameText(node.name), node.initializer);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return containsSensitiveNamedString(assignmentTargetName(node.left), node.right);
  }
  return false;
}

function containsSensitiveNamedString(name: string | undefined, expression: ts.Expression | undefined): boolean {
  const value = expression ? stringLiteralText(expression) : undefined;
  return Boolean(name && value && isSensitiveName(name) && looksLikeSecretValue(value));
}

function stringLiteralText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function assignmentTargetName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function isSensitiveName(name: string): boolean {
  const normalized = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return ['secret', 'token', 'password', 'passwd', 'credential', 'apikey', 'accesskey', 'privatekey', 'clientsecret'].some((part) => normalized.includes(part));
}

function looksLikeSecretValue(value: string): boolean {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }
  if (value.length < 24) {
    return false;
  }
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[_+/=-]/.test(value);
}

function isRawNetworkApiUse(node: ts.Node): boolean {
  return (
    (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'WebSocket') ||
    (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'WebSocket')
  );
}

function diagnosticForNode(sourceAst: ts.SourceFile, sourceFile: string, node: ts.Node, message: string): Diagnostic {
  const position = sourceAst.getLineAndCharacterOfPosition(node.getStart(sourceAst));
  return {
    severity: 'error',
    code: 'BUNDLE_INVALID',
    message,
    sourceLocation: { file: sourceFile, line: position.line + 1, column: position.character + 1 },
  };
}
