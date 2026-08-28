// typecast-file-boundary: TypeScript compiler nodes are kind-checked before this source-to-source transformer restores their narrower AST types.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import {
  applicationCallbackDependencyMetadataStatementsByName,
  decorateApplicationCallbackArguments,
} from './entrypoint-application-callbacks.js';

const applicationRuntimeModuleInstrumentationCache = new Map<string, string>();
const maximumApplicationRuntimeModuleInstrumentationEntries = 1_024;

export function handlerSourceMetadataPlugin(
  entrypoint: string,
  options: { readonly includeMaintainedPackages?: boolean } = {},
): Plugin {
  return {
    name: 'applik8s-handler-source-metadata',
    setup(buildContext) {
      buildContext.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (
          args.namespace !== 'file'
          || !applicationCallbackModuleIsInstrumentable(args.path)
        ) return undefined;
        const source = await readFile(args.path, 'utf8');
        const instrumented = instrumentApplicationRuntimeModule(
          entrypoint,
          args.path,
          source,
          options,
        );
        if (instrumented === source) return undefined;
        const extension = extname(args.path);
        const loader = extension === '.tsx'
          ? 'tsx'
          : extension === '.jsx'
            ? 'jsx'
            : extension === '.js' || extension === '.mjs' || extension === '.cjs'
              ? 'js'
              : 'ts';
        return { contents: instrumented, loader, resolveDir: dirname(args.path) };
      });
    },
  };
}

/**
 * Preserve authored callback source and dependency metadata in every generated
 * server-runtime bundle that can transitively import an application module.
 *
 * Discovery, generated workers, and framework-hosted Vite SSR must share this
 * exact transform. Otherwise a production minifier can rename a module-local
 * handle while the imported application replays registration, making runtime
 * behavior diverge from the graph that the compiler admitted.
 *
 * @internal
 */
export function instrumentApplicationRuntimeModule(
  entrypoint: string,
  sourceFile: string,
  source: string,
  options: { readonly includeMaintainedPackages?: boolean } = {},
): string {
  if (!applicationCallbackModuleIsInstrumentable(sourceFile)) return source;
  // Generated callback factories already contain the compiler-admitted source
  // and bindings. Re-instrumenting them embeds output-directory paths in the
  // artifact, breaks reproducible digests, and needlessly parses very large
  // generated runtime modules.
  if (/\.generated\.[cm]?[jt]sx?$/u.test(sourceFile)) return source;
  const applicationOwned = applicationPackageOwnsModule(entrypoint, sourceFile);
  if (!applicationOwned && options.includeMaintainedPackages === false) {
    return source;
  }
  const cacheKey = createHash('sha256')
    .update(entrypoint)
    .update('\0')
    .update(sourceFile)
    .update('\0')
    .update(options.includeMaintainedPackages === false ? 'application' : 'maintained')
    .update('\0')
    .update(source)
    .digest('hex');
  const cached = applicationRuntimeModuleInstrumentationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const instrumented = instrumentApplicationCallbackRegistrations(
    source,
    sourceFile,
    applicationCallbackModuleOwnsDependencies(entrypoint, sourceFile),
    portableApplicationModuleIdentity(entrypoint, sourceFile),
    !applicationOwned,
  );
  if (
    applicationRuntimeModuleInstrumentationCache.size
    >= maximumApplicationRuntimeModuleInstrumentationEntries
  ) {
    const oldest = applicationRuntimeModuleInstrumentationCache.keys().next().value;
    if (oldest) applicationRuntimeModuleInstrumentationCache.delete(oldest);
  }
  applicationRuntimeModuleInstrumentationCache.set(cacheKey, instrumented);
  return instrumented;
}

/**
 * Maintained Applik8s packages are allowed to register callback-bearing
 * framework modules on an application's behalf. Instrument their published
 * JavaScript before esbuild rewrites dynamic imports and module bindings; the
 * authored callback source is otherwise replaced with esbuild-private
 * `init_*`/`*_exports` identifiers that cannot be reconstructed by the static
 * closure compiler.
 *
 * Arbitrary third-party dependencies remain untouched. Their callbacks must be
 * surfaced through application-owned code until a portable package-authored
 * callback metadata contract is introduced.
 */
export function applicationCallbackModuleIsInstrumentable(
  sourceFile: string,
): boolean {
  const normalized = sourceFile.replaceAll('\\', '/');
  const marker = '/node_modules/';
  const dependency = normalized.lastIndexOf(marker);
  if (dependency === -1) return true;
  return normalized
    .slice(dependency + marker.length)
    .startsWith('@applik8s/');
}

/**
 * Instruments every callback-bearing authoring registrar before discovery
 * evaluates the entrypoint. This is an internal compiler regression seam.
 */
export function instrumentApplicationCallbackRegistrations(
  source: string,
  sourceFile: string,
  attachDependencyMetadata = true,
  moduleIdentity = portableApplicationModuleIdentity(sourceFile, sourceFile),
  deferDependencyValueReads = false,
): string {
  const file = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFile.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : sourceFile.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : sourceFile.endsWith('.js') || sourceFile.endsWith('.mjs') || sourceFile.endsWith('.cjs')
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
  );
  const dependencyMetadata = attachDependencyMetadata
    ? applicationCallbackDependencyMetadataStatementsByName(
        file,
        sourceFile,
        moduleIdentity,
        deferDependencyValueReads,
      )
    : new Map<string, readonly ts.Statement[]>();
  let changed = false;
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isCallExpression(node)) {
        const applicationArguments = decorateApplicationCallbackArguments(node, file, sourceFile, visit);
        if (isHandlerRegistrationCall(node) && node.arguments.length > 0) {
          const visitedArguments = applicationArguments
            ?? node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression);
          const decoratedArguments = visitedArguments.map((argument, index) =>
            decorateHandlerCandidate(argument, file, sourceFile, visit, true, node.arguments[index]));
          changed = true;
          return ts.factory.updateCallExpression(
            node,
            ts.visitNode(node.expression, visit) as ts.Expression,
            node.typeArguments,
            decoratedArguments,
          );
        }
        if (applicationArguments) {
          changed = true;
          return ts.factory.updateCallExpression(
            node,
            ts.visitNode(node.expression, visit) as ts.Expression,
            node.typeArguments,
            applicationArguments,
          );
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit) as ts.SourceFile;
  };
  const transformed = ts.transform(file, [transformer]);
  try {
    const transformedFile = transformed.transformed[0] as ts.SourceFile;
    const statements = dependencyMetadata.size > 0
      ? transformedFile.statements.flatMap((statement) => [
          statement,
          ...topLevelCallableNames(statement).flatMap(
            (name) => dependencyMetadata.get(name) ?? [],
          ),
        ])
      : transformedFile.statements;
    const output = statements === transformedFile.statements
      ? transformedFile
      : ts.factory.updateSourceFile(transformedFile, statements);
    return changed || dependencyMetadata.size > 0
      ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(output)
      : source;
  } finally {
    transformed.dispose();
  }
}

function topLevelCallableNames(statement: ts.Statement): readonly string[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return [statement.name.text];
  }
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) =>
    ts.isIdentifier(declaration.name)
    && declaration.initializer
    && (
      ts.isArrowFunction(declaration.initializer)
      || ts.isFunctionExpression(declaration.initializer)
    )
      ? [declaration.name.text]
      : []);
}

/** Internal regression seam for monorepo callback-discovery ownership. */
export function applicationPackageOwnsModule(entrypoint: string, sourceFile: string): boolean {
  return applicationPackageRoot(entrypoint) === applicationPackageRoot(sourceFile);
}

/**
 * Recursive callback dependency metadata is trusted for application-authored
 * modules and maintained Applik8s packages. Workspace source aliases and packed
 * dependencies must receive the same treatment; otherwise a maintained package
 * callback can be discovered while its module-local helper graph is discarded.
 */
export function applicationCallbackModuleOwnsDependencies(
  entrypoint: string,
  sourceFile: string,
): boolean {
  if (applicationPackageOwnsModule(entrypoint, sourceFile)) return true;
  const normalized = sourceFile.replaceAll('\\', '/');
  const dependencyMarker = '/node_modules/';
  const dependency = normalized.lastIndexOf(dependencyMarker);
  if (
    dependency !== -1
    && normalized.slice(dependency + dependencyMarker.length).startsWith('@applik8s/')
  ) return true;
  return applicationPackageName(sourceFile)?.startsWith('@applik8s/') ?? false;
}

function applicationPackageRoot(entrypoint: string): string {
  // CLI entrypoints are commonly authored relative to the consumer cwd while
  // esbuild onLoad paths are absolute. Package ownership must not depend on
  // that representational difference or production artifact builds will skip
  // the application callback transform even though discovery admitted it.
  let current = dirname(resolve(entrypoint));
  const filesystemRoot = dirname(current) === current ? current : undefined;
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current || current === filesystemRoot) return dirname(entrypoint);
    current = parent;
  }
}

function applicationPackageName(sourceFile: string): string | undefined {
  const root = applicationPackageRoot(sourceFile);
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      readonly name?: unknown;
    };
    return typeof manifest.name === 'string' ? manifest.name : undefined;
  } catch {
    return undefined;
  }
}

function portableApplicationModuleIdentity(
  entrypoint: string,
  sourceFile: string,
): string {
  const value = relative(applicationPackageRoot(entrypoint), sourceFile)
    .replaceAll('\\', '/');
  return value.startsWith('../') || value === ''
    ? sourceFile.split(/[\\/]/).at(-1) ?? sourceFile
    : value;
}

function decorateHandlerCandidate(
  argument: ts.Expression,
  file: ts.SourceFile,
  sourceFile: string,
  visit: ts.Visitor,
  alreadyVisited = false,
  sourceArgument?: ts.Expression,
): ts.Expression {
  const position = file.getLineAndCharacterOfPosition((sourceArgument ?? argument).getStart(file));
  const candidate = ts.factory.createIdentifier('__applik8sHandlerCandidate');
  const metadata = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(sourceFile)),
    ts.factory.createPropertyAssignment('line', ts.factory.createNumericLiteral(position.line + 1)),
    ts.factory.createPropertyAssignment('column', ts.factory.createNumericLiteral(position.character + 1)),
  ]);
  const decorated = ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'defineProperty'),
    undefined,
    [
      candidate,
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'),
        undefined,
        [ts.factory.createStringLiteral('applik8s.handlerSourceModule')],
      ),
      ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment('configurable', ts.factory.createTrue()),
        ts.factory.createPropertyAssignment('value', metadata),
      ]),
    ],
  );
  const decorateIfFunction = ts.factory.createArrowFunction(
    undefined,
    undefined,
    [ts.factory.createParameterDeclaration(undefined, undefined, candidate)],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createConditionalExpression(
      ts.factory.createBinaryExpression(
        ts.factory.createTypeOfExpression(candidate),
        ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        ts.factory.createStringLiteral('function'),
      ),
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      decorated,
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      candidate,
    ),
  );
  return ts.factory.createCallExpression(
    ts.factory.createParenthesizedExpression(decorateIfFunction),
    undefined,
    [alreadyVisited ? argument : ts.visitNode(argument, visit) as ts.Expression],
  );
}

function isHandlerRegistrationCall(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression)
    && ['reconcile', 'created', 'updated', 'deleted', 'finalize', 'statusChanged'].includes(node.expression.name.text);
}
