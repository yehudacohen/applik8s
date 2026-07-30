import { rmSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

import type { Diagnostic, OperatorDefinition, Result } from '@applik8s/core';
import type { Plugin } from 'esbuild';
import { build } from 'esbuild';
import ts from 'typescript';

import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import type { CompileResult } from '../interfaces.js';
import { decorateApplicationCallbackArguments } from './entrypoint-application-callbacks.js';

export interface EntrypointExports {
  readonly operators: readonly OperatorDefinition[];
  readonly typeKroCompositions: readonly TypeKroCompositionExport[];
}

export interface TypeKroCompositionExport {
  readonly name?: string;
  readonly operatorInstalls: readonly { readonly operatorName: string; readonly operator?: unknown }[];
  resolveOperatorInstalls(options: { readonly manifests: readonly CompileResult[] }): Result<unknown>;
}

export async function discoverExportedOperators(entrypoint: string): Promise<Result<{ readonly operators: readonly OperatorDefinition[] }>> {
  const discovered = await discoverEntrypointExports(entrypoint);
  return discovered.ok ? { ok: true, value: { operators: discovered.value.operators } } : discovered;
}

export async function discoverEntrypointExports(entrypoint: string): Promise<Result<EntrypointExports>> {
  const bundleRoot = join(process.cwd(), '.applik8s-tmp', `discovery-${process.pid}-${Date.now()}`);
  const discoveryBundle = join(bundleRoot, 'entrypoint.mjs');
  try {
    await mkdir(bundleRoot, { recursive: true });
    await build({
      entryPoints: [entrypoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      nodePaths: [join(process.cwd(), 'node_modules')],
      tsconfigRaw: { compilerOptions: {} },
      outfile: discoveryBundle,
      banner: {
        js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);",
      },
      external: ['applik8s:handler/capabilities', 'applik8s:handler/kubernetes', '@applik8s/compiler', '@applik8s/compiler/*', 'esbuild', 'typekro', 'typekro/*', '@napi-rs/lzma-*', '@oxc-parser/binding-*'],
      plugins: [handlerSourceMetadataPlugin(), applik8sWorkspaceSourcePlugin()],
    });
    const discoverySpecifier = `${pathToFileURL(discoveryBundle).href}?applik8s=${Date.now()}`;
    const discoveryEntrypointKey = Symbol.for('applik8s.discovery.entrypoint');
    const previousDiscoveryEntrypoint = Reflect.get(globalThis, discoveryEntrypointKey);
    Reflect.set(globalThis, discoveryEntrypointKey, entrypoint);
    let imported: Record<string, unknown>;
    try {
      // static-import-exception: compiler discovery loads a generated local ESM bundle and narrows every exported value structurally. typecast: import() exposes unknown exports which the following structural filters validate.
      imported = (await import(/* @vite-ignore */ discoverySpecifier)) as Record<string, unknown>;
    } finally {
      if (previousDiscoveryEntrypoint === undefined) Reflect.deleteProperty(globalThis, discoveryEntrypointKey);
      else Reflect.set(globalThis, discoveryEntrypointKey, previousDiscoveryEntrypoint);
    }
    const operators = Object.values(imported).filter(isExportedOperator).map((value) => value.definition);
    const duplicate = firstDuplicate(operators.map((operator) => operator.name));
    if (duplicate) return error('BUNDLE_INVALID', `Entrypoint exports multiple operators named ${duplicate}.`);
    const typeKroCompositions: TypeKroCompositionExport[] = [];
    for (const [name, value] of Object.entries(imported)) {
      if (isExportedTypeKroComposition(value)) typeKroCompositions.push(Object.assign(value, { name }));
    }
    return { ok: true, value: { operators, typeKroCompositions } };
  } catch (cause) {
    return error('BUNDLE_INVALID', cause instanceof Error ? cause.message : `Failed to discover exported entrypoint exports: ${inspect(cause)}`);
  } finally {
    deferTemporaryDirectoryCleanup(bundleRoot);
  }
}

function handlerSourceMetadataPlugin(): Plugin {
  return {
    name: 'applik8s-handler-source-metadata',
    setup(buildContext) {
      buildContext.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (args.namespace !== 'file' || args.path.includes('/node_modules/')) return undefined;
        const source = await readFile(args.path, 'utf8');
        const instrumented = instrumentApplicationCallbackRegistrations(source, args.path);
        if (instrumented === source) return undefined;
        const extension = extname(args.path);
        const loader = extension === '.tsx' ? 'tsx' : extension === '.jsx' ? 'jsx' : extension === '.js' || extension === '.mjs' || extension === '.cjs' ? 'js' : 'ts';
        return { contents: instrumented, loader, resolveDir: dirname(args.path) };
      });
    },
  };
}

/**
 * Instruments every callback-bearing authoring registrar before discovery
 * evaluates the entrypoint. Exported for a focused compiler regression test;
 * this remains an internal pipeline contract rather than public API.
 */
export function instrumentApplicationCallbackRegistrations(source: string, sourceFile: string): string {
  const file = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, sourceFile.endsWith('.tsx') ? ts.ScriptKind.TSX : sourceFile.endsWith('.jsx') ? ts.ScriptKind.JSX : sourceFile.endsWith('.js') || sourceFile.endsWith('.mjs') || sourceFile.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  let changed = false;
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isCallExpression(node) && isHandlerRegistrationCall(node) && node.arguments.length > 0) {
        const decoratedArguments = node.arguments.map((argument) => decorateHandlerCandidate(argument, file, sourceFile, visit));
        changed = true;
        // typecast: visiting an existing call expression cannot remove its callee, but the TypeScript visitor result is Node | undefined.
        return ts.factory.updateCallExpression(node, ts.visitNode(node.expression, visit) as ts.Expression, node.typeArguments, decoratedArguments);
      }
      if (ts.isCallExpression(node)) {
        const decoratedArguments = decorateApplicationCallbackArguments(node, file, sourceFile, visit);
        if (decoratedArguments) {
          changed = true;
          // typecast: visiting an existing call expression cannot remove its callee, but the TypeScript visitor result is Node | undefined.
          return ts.factory.updateCallExpression(node, ts.visitNode(node.expression, visit) as ts.Expression, node.typeArguments, decoratedArguments);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    // typecast: the transformer is rooted at a SourceFile and this visitor never replaces or removes that root.
    return (root) => ts.visitNode(root, visit) as ts.SourceFile;
  };
  const transformed = ts.transform(file, [transformer]);
  try {
    // typecast: a SourceFile transformer produces a SourceFile at index zero when given one SourceFile input.
    return changed ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] as ts.SourceFile) : source;
  } finally {
    transformed.dispose();
  }
}

function decorateHandlerCandidate(argument: ts.Expression, file: ts.SourceFile, sourceFile: string, visit: ts.Visitor): ts.Expression {
  const position = file.getLineAndCharacterOfPosition(argument.getStart(file));
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
      ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'), undefined, [ts.factory.createStringLiteral('applik8s.handlerSourceModule')]),
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
  // typecast: visitNode preserves each existing call argument as an Expression; this visitor does not remove arguments.
  return ts.factory.createCallExpression(ts.factory.createParenthesizedExpression(decorateIfFunction), undefined, [ts.visitNode(argument, visit) as ts.Expression]);
}

function isHandlerRegistrationCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  return ['reconcile', 'created', 'updated', 'deleted', 'finalize', 'statusChanged'].includes(node.expression.name.text);
}

const deferredTemporaryDirectoryCleanups = new Set<string>();
let temporaryDirectoryCleanupRegistered = false;

function deferTemporaryDirectoryCleanup(directory: string): void {
  if (process.env.APPLIK8S_KEEP_TMP === '1') return;
  deferredTemporaryDirectoryCleanups.add(directory);
  if (temporaryDirectoryCleanupRegistered) return;
  temporaryDirectoryCleanupRegistered = true;
  process.once('exit', () => {
    for (const cleanupDirectory of deferredTemporaryDirectoryCleanups) rmSync(cleanupDirectory, { recursive: true, force: true });
    deferredTemporaryDirectoryCleanups.clear();
  });
}

function isExportedOperator(value: unknown): value is { readonly definition: OperatorDefinition } {
  return Boolean(value && typeof value === 'function' && typeof Reflect.get(value, 'definition') === 'object');
}

function isExportedTypeKroComposition(value: unknown): value is TypeKroCompositionExport {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && Array.isArray(Reflect.get(value, 'operatorInstalls')) && typeof Reflect.get(value, 'resolveOperatorInstalls') === 'function');
}

function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
