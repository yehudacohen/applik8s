import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';

const applicationCallbackProperties: Readonly<Record<string, readonly string[]>> = {
  query: ['authorize', 'run'],
  view: ['authorize', 'run'],
  stream: ['partitionBy', 'authorize'],
  subscription: ['authorize'],
  projection: ['project'],
  gateway: ['authorizeCommand', 'deployment.authenticate'],
  on: ['reconcile', 'created', 'updated', 'deleted', 'statusChanged', 'finalize.handler'],
};

/** Preserves callback source provenance while esbuild evaluates an application entrypoint. */
export function decorateApplicationCallbackArguments(node: ts.CallExpression, file: ts.SourceFile, sourceFile: string, visit: ts.Visitor): readonly ts.Expression[] | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (
    node.expression.name.text === 'from'
    && ts.isIdentifier(node.expression.expression)
    && (node.expression.expression.text === 'IdentityProvider'
      || node.expression.expression.text === 'OAuthAuthorizationServer'
      || node.expression.expression.text === 'Authorization')
  ) {
    const registrar = node.expression.expression.text;
    const callbackProperty = registrar === 'IdentityProvider' ? 'authenticate' : 'decide';
    const callbackIndex = registrar === 'OAuthAuthorizationServer' ? 1 : 0;
    const optionsIndex = registrar === 'OAuthAuthorizationServer' ? 2 : 1;
    return node.arguments.map((argument, index) => {
      // typecast: identity/authorization constructors have fixed callback and options positions.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === callbackIndex
        ? decorateApplicationCallbackExpression(visited, file, sourceFile, registrar, callbackProperty)
        : index === optionsIndex && ts.isObjectLiteralExpression(visited)
          ? decorateApplicationCallbackObject(visited, ['ready'], file, sourceFile, registrar)
        : visited;
    });
  }
  const registrar = node.expression.name.text;
  if (registrar === 'task' || registrar === 'workflow' || registrar === 'process') {
    return node.arguments.map((argument, index) => {
      // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 2 ? decorateApplicationCallbackExpression(visited, file, sourceFile, registrar === 'process' ? 'stream.process' : registrar, 'handler') : visited;
    });
  }
  const properties = applicationCallbackProperties[registrar];
  if (!properties) return undefined;
  return node.arguments.map((argument, index) => {
    // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
    const visited = ts.visitNode(argument, visit) as ts.Expression;
    if (index !== 1 || !ts.isObjectLiteralExpression(visited)) return visited;
    return decorateApplicationCallbackObject(visited, properties, file, sourceFile, registrar);
  });
}

function decorateApplicationCallbackObject(object: ts.ObjectLiteralExpression, properties: readonly string[], file: ts.SourceFile, sourceFile: string, registrar: string): ts.ObjectLiteralExpression {
  const direct = new Set(properties.filter((property) => !property.includes('.')));
  const nested = new Map(properties.filter((property) => property.includes('.')).map((property) => {
    const [parent, child] = property.split('.');
    // typecast: Map construction needs each split callback/property path represented as a readonly key/value tuple.
    return [parent ?? '', child ?? ''] as const;
  }));
  const mapped = object.properties.map((property): ts.ObjectLiteralElementLike => {
    const name = objectPropertyName(property.name);
    if (!name) return property;
    if (direct.has(name)) return decorateApplicationCallbackProperty(property, file, sourceFile, registrar, name);
    const child = nested.get(name);
    if (!child || !ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) return property;
    return ts.factory.updatePropertyAssignment(property, property.name, decorateApplicationCallbackObject(property.initializer, [child], file, sourceFile, registrar));
  });
  return ts.factory.updateObjectLiteralExpression(object, mapped);
}

function decorateApplicationCallbackProperty(property: ts.ObjectLiteralElementLike, file: ts.SourceFile, sourceFile: string, registrar: string, name: string): ts.ObjectLiteralElementLike {
  if (ts.isPropertyAssignment(property)) {
    return ts.factory.updatePropertyAssignment(property, property.name, decorateApplicationCallbackExpression(property.initializer, file, sourceFile, registrar, name));
  }
  if (ts.isMethodDeclaration(property) && property.body) {
    const modifiers = property.modifiers?.filter(ts.isModifier);
    const expression = ts.factory.createFunctionExpression(modifiers, property.asteriskToken, undefined, property.typeParameters, property.parameters, property.type, property.body);
    const methodSource = property.getText(file).replace(/^(async\s+)?[$A-Z_a-z][$\w]*\s*\(/, (_match, asyncPrefix: string | undefined) => `${asyncPrefix ?? ''}function (`);
    return ts.factory.createPropertyAssignment(property.name, decorateApplicationCallbackExpression(expression, file, sourceFile, registrar, name, methodSource));
  }
  return property;
}

function decorateApplicationCallbackExpression(expression: ts.Expression, file: ts.SourceFile, sourceFile: string, registrar: string, property: string, explicitSource?: string): ts.Expression {
  const provenance = importedApplicationCallbackProvenance(expression, file, sourceFile);
  const metadataFile = provenance?.file ?? sourceFile;
  const position = provenance?.position ?? file.getLineAndCharacterOfPosition(expression.getStart(file));
  const candidate = ts.factory.createIdentifier('__applik8sApplicationCallback');
  const originalSource = explicitSource ?? (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) ? expression.getText(file) : undefined);
  const metadata = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(metadataFile)),
    ts.factory.createPropertyAssignment('line', ts.factory.createNumericLiteral(position.line + 1)),
    ts.factory.createPropertyAssignment('column', ts.factory.createNumericLiteral(position.character + 1)),
    ts.factory.createPropertyAssignment('registrar', ts.factory.createStringLiteral(registrar)),
    ts.factory.createPropertyAssignment('property', ts.factory.createStringLiteral(property)),
    ...(originalSource ? [ts.factory.createPropertyAssignment('source', ts.factory.createStringLiteral(originalSource))] : []),
  ]);
  const decorated = ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'defineProperty'), undefined, [
    candidate,
    ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'), undefined, [ts.factory.createStringLiteral('applik8s.applicationCallbackSource')]),
    ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment('configurable', ts.factory.createTrue()), ts.factory.createPropertyAssignment('value', metadata)]),
  ]);
  const alreadyDecorated = ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'hasOwn'), undefined, [
    candidate,
    ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'), undefined, [ts.factory.createStringLiteral('applik8s.applicationCallbackSource')]),
  ]);
  const decorator = ts.factory.createArrowFunction(undefined, undefined, [ts.factory.createParameterDeclaration(undefined, undefined, candidate)], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.factory.createConditionalExpression(alreadyDecorated, ts.factory.createToken(ts.SyntaxKind.QuestionToken), candidate, ts.factory.createToken(ts.SyntaxKind.ColonToken), decorated));
  return ts.factory.createCallExpression(ts.factory.createParenthesizedExpression(decorator), undefined, [expression]);
}

interface ApplicationCallbackProvenance {
  readonly file: string;
  readonly position: ts.LineAndCharacter;
}

/**
 * Imported callbacks retain the defining module, not merely the registrar
 * callsite. The dependency serializer needs that provenance to close over
 * same-module helper declarations without guessing among identically named
 * helpers elsewhere in a modular application.
 */
function importedApplicationCallbackProvenance(expression: ts.Expression, file: ts.SourceFile, sourceFile: string): ApplicationCallbackProvenance | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const imported = importedCallbackName(statement.importClause, expression.text);
    if (!imported) continue;
    const target = resolveCallbackModule(sourceFile, statement.moduleSpecifier.text);
    if (!target) return undefined;
    return callbackDeclarationProvenance(target, imported, new Set());
  }
  return undefined;
}

function importedCallbackName(clause: ts.ImportClause, localName: string): string | undefined {
  if (!clause.isTypeOnly && clause.name?.text === localName) return 'default';
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return undefined;
  const element = clause.namedBindings.elements.find((candidate) => !candidate.isTypeOnly && candidate.name.text === localName);
  return element ? element.propertyName?.text ?? element.name.text : undefined;
}

function callbackDeclarationProvenance(modulePath: string, exportedName: string, visited: Set<string>): ApplicationCallbackProvenance | undefined {
  const absolute = resolve(modulePath);
  if (visited.has(absolute)) return undefined;
  visited.add(absolute);
  let source: string;
  try {
    source = readFileSync(absolute, 'utf8');
  } catch {
    return undefined;
  }
  const file = ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, callbackScriptKind(absolute));
  for (const statement of file.statements) {
    if (exportedName === 'default' && ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      return { file: absolute, position: file.getLineAndCharacterOfPosition(statement.getStart(file)) };
    }
    if (runtimeCallbackDeclarationNames(statement).includes(exportedName) && ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return { file: absolute, position: file.getLineAndCharacterOfPosition(statement.getStart(file)) };
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const element = statement.exportClause.elements.find((candidate) => candidate.name.text === exportedName);
      if (!element) continue;
      const original = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveCallbackModule(absolute, statement.moduleSpecifier.text);
        return target ? callbackDeclarationProvenance(target, original, visited) : undefined;
      }
      const declaration = file.statements.find((candidate) => runtimeCallbackDeclarationNames(candidate).includes(original));
      return declaration ? { file: absolute, position: file.getLineAndCharacterOfPosition(declaration.getStart(file)) } : undefined;
    }
  }
  return undefined;
}

function resolveCallbackModule(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined;
  const base = resolve(dirname(importer), specifier);
  const extension = extname(base);
  const candidates = [
    base,
    ...(extension === '.js' || extension === '.mjs' || extension === '.cjs' ? [`${base.slice(0, -extension.length)}.ts`, `${base.slice(0, -extension.length)}.tsx`] : []),
    ...(!extension ? [`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js')] : []),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function runtimeCallbackDeclarationNames(statement: ts.Statement): readonly string[] {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return [statement.name.text];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
}

function callbackScriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function objectPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
