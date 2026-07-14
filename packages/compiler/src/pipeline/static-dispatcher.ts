import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import type { AnyResourceDefinition, Diagnostic, OperatorDefinition, Result } from '@applik8s/core';
import ts from 'typescript';

export function generatedDispatcherEntrypoint(userEntrypoint: string, operator: OperatorDefinition, hasCapabilities: boolean, hasKubernetesRead: boolean, _mode: 'importEntrypoint' | 'staticSerializable' | undefined): Result<string> {
  const staticOperator = staticSerializableOperatorSource(operator, userEntrypoint);
  if (staticOperator.ok) {
    return { ok: true, value: dispatcherProgram(staticOperator.value.source, hasCapabilities, hasKubernetesRead, staticOperator.value.imports) };
  }
  return staticOperator;
}

function dispatcherProgram(operatorSource: string, hasCapabilities: boolean, hasKubernetesRead: boolean, capturedImports: readonly string[] = []): string {
  return `${capturedImports.join('\n')}${capturedImports.length > 0 ? '\n' : ''}${hasCapabilities ? "import { capabilityRequest } from 'applik8s:handler/capabilities';\n" : ''}${hasKubernetesRead ? "import { kubernetesRead } from 'applik8s:handler/kubernetes';\n" : ''}
import { dispatchOperatorHandler } from '@applik8s/sdk';

const selectedExport = { definition: ${operatorSource} };

export async function handle(inputJson: string): Promise<string> {
  try {
    return await dispatchOperatorHandler(selectedExport.definition, inputJson${hasCapabilities || hasKubernetesRead ? `, {${hasCapabilities ? ' capabilityRequest,' : ''}${hasKubernetesRead ? ' kubernetesRead' : ''} }` : ''});
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Handler threw an unknown error.';
    const stack = cause instanceof Error ? cause.stack : undefined;
    throw (stack && !stack.includes(message) ? message + '\\n' + stack : (stack ?? message));
  }
}
`;
}

function staticSerializableOperatorSource(operator: OperatorDefinition, userEntrypoint: string): Result<{ readonly source: string; readonly imports: readonly string[] }> {
  const handlerRegistrations: string[] = [];
  const capturedImports = new Set<string>();
  const entrypointCaptures = staticEntrypointCaptures(userEntrypoint);
  const resourceIdentifiers = staticResourceIdentifiers(operator.resources);
  const allowedFreeIdentifiers = new Set(resourceIdentifiers.map((resource) => resource.identifier));
  for (const registration of operator.handlers) {
    const handler = Reflect.get(registration, 'handler');
    if (typeof handler !== 'function') {
      return error('BUNDLE_INVALID', `Handler ${registration.id} cannot be statically bundled because it does not carry a runnable handler function.`);
    }
    const handlerSource = staticHandlerSource(handler, registration.id, allowedFreeIdentifiers, entrypointCaptures);
    if (!handlerSource.ok) {
      return handlerSource;
    }
    const serializableRegistration = toSerializableJson(registrationWithoutHandler(registration), `handler ${registration.id}`);
    if (!serializableRegistration.ok) {
      return serializableRegistration;
    }
    for (const capturedImport of handlerSource.value.imports) capturedImports.add(capturedImport);
    handlerRegistrations.push(`Object.assign(${JSON.stringify(serializableRegistration.value)}, { handler: (${handlerSource.value.source}) })`);
  }

  const operatorWithoutHandlers = toSerializableJson({ ...operator, handlers: [] }, `operator ${operator.name}`);
  if (!operatorWithoutHandlers.ok) {
    return operatorWithoutHandlers;
  }
  const operatorSource = JSON.stringify(operatorWithoutHandlers.value);
  if (resourceIdentifiers.length === 0) {
    return { ok: true, value: { source: `Object.assign(${operatorSource}, { handlers: [${handlerRegistrations.join(', ')}] })`, imports: [...capturedImports].sort() } };
  }
  const resourceBindings = resourceIdentifiers.map((resource) => `const ${resource.identifier} = __operator.resources[${JSON.stringify(resource.key)}];`).join('\n');
  return {
    ok: true,
    value: { source: `(() => {
const __operator = ${operatorSource};
${resourceBindings}
return Object.assign(__operator, { handlers: [${handlerRegistrations.join(', ')}] });
})()`, imports: [...capturedImports].sort() },
  };
}

interface StaticEntrypointCaptures {
  readonly declarations: ReadonlyMap<string, readonly string[]>;
  readonly ambiguousCaptures: ReadonlyMap<string, readonly string[]>;
  readonly factoryObjectParameters: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

function staticHandlerSource(handler: (...args: never[]) => unknown, handlerId: string, allowedFreeIdentifiers: ReadonlySet<string>, entrypointCaptures: StaticEntrypointCaptures): Result<{ readonly source: string; readonly imports: readonly string[] }> {
  const source = handler.toString();
  if (source.includes('[native code]')) {
    return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled because it is native code.`);
  }
  const captures = new Map<string, readonly string[]>();
  const freeCandidates = likelyFreeIdentifiers(source).filter((candidate) => !allowedFreeIdentifiers.has(candidate));
  for (const identifier of freeCandidates) {
    const ambiguousCapture = entrypointCaptures.ambiguousCaptures.get(identifier);
    if (ambiguousCapture) {
      return error(
        'BUNDLE_INVALID',
        `Handler ${handlerId} cannot be statically bundled because capture ${identifier} reaches ambiguous module-local declarations: ${ambiguousCapture.join('; ')}. Rename the colliding top-level declarations to globally unique names so the generated dispatcher cannot silently bind the handler to a different module's implementation.`
      );
    }
    const capture = staticHandlerCapturedImports.get(identifier)
      ?? entrypointCaptures.declarations.get(identifier)
      ?? factoryObjectParameterCapture(identifier, source, entrypointCaptures);
    if (capture) captures.set(identifier, capture);
  }
  const capturedImports = [...captures.values()].flat();
  const freeIdentifiers = freeCandidates.filter((identifier) => !captures.has(identifier));
  if (freeIdentifiers.length > 0) {
    return error(
      'BUNDLE_INVALID',
      `Handler ${handlerId} cannot be statically bundled. The reconcile callback references closure-local identifier(s) that cannot be recovered from the module: ${freeIdentifiers.join(', ')}. Move captured values and helper functions to top-level declarations, keep them inside the handler, or pass literal data through the reconciled resource spec/status. Top-level reachable helpers and imports are serialized into the WASM dispatcher; factory-local lexical state fails closed.`
    );
  }
  try {
    new Function(`return (${source});`);
  } catch (cause) {
    return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled from its function source: ${cause instanceof Error ? cause.message : 'invalid function source'}.`);
  }
  return { ok: true, value: { source, imports: [...new Set(capturedImports)].sort() } };
}

function factoryObjectParameterCapture(identifier: string, handlerSource: string, captures: StaticEntrypointCaptures): readonly string[] | undefined {
  const properties = captures.factoryObjectParameters.get(identifier);
  if (!properties) return undefined;
  const accessed = directlyAccessedProperties(handlerSource, identifier);
  if (accessed.length === 0 || accessed.some((property) => !properties.has(property))) return undefined;
  const selected: Array<readonly [string, string]> = [];
  for (const property of accessed) {
    const expression = properties.get(property);
    if (expression === undefined) return undefined;
    selected.push([property, expression]);
  }
  const dependencies = selected.flatMap(([, expression]) => likelyFreeIdentifiersInStatements(expression)
    .filter((dependency) => dependency !== identifier)
    .flatMap((dependency) => captures.declarations.get(dependency) ?? []));
  const objectSource = selected.map(([property, expression]) => `${JSON.stringify(property)}: (${expression})`).join(', ');
  return [...new Set([...dependencies, `const ${identifier} = { ${objectSource} };`])];
}

function directlyAccessedProperties(handlerSource: string, identifier: string): readonly string[] {
  const file = ts.createSourceFile('applik8s-static-handler-properties.ts', `const __handler = (${handlerSource});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const properties = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier) {
      properties.add(node.name.text);
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier && ts.isStringLiteral(node.argumentExpression)) {
      properties.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...properties].sort();
}

interface StaticModuleRecord {
  readonly path: string;
  readonly file: ts.SourceFile;
}

function staticEntrypointCaptures(entrypoint: string): StaticEntrypointCaptures {
  const declarations = new Map<string, string>();
  const declarationOrigins = new Map<string, Set<string>>();
  const packageImports = new Map<string, string>();
  const localAliases = new Map<string, string>();
  const modules: StaticModuleRecord[] = [];
  const visited = new Set<string>();

  const visitModule = (modulePath: string): void => {
    const absolutePath = resolve(modulePath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch {
      return;
    }
    const file = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, scriptKindForPath(absolutePath));
    modules.push({ path: absolutePath, file });
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        const localTarget = resolveStaticLocalImport(absolutePath, specifier);
        if (!localTarget) {
          const text = statement.getText(file);
          if (clause?.name && !clause.isTypeOnly) packageImports.set(clause.name.text, text);
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) && !clause.isTypeOnly) packageImports.set(clause.namedBindings.name.text, text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.isTypeOnly) {
            for (const element of clause.namedBindings.elements) {
              if (!element.isTypeOnly) packageImports.set(element.name.text, text);
            }
          }
          continue;
        }
        visitModule(localTarget);
        if (clause?.name && !clause.isTypeOnly) localAliases.set(clause.name.text, 'default');
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.isTypeOnly) {
          for (const element of clause.namedBindings.elements) {
            if (!element.isTypeOnly) localAliases.set(element.name.text, element.propertyName?.text ?? element.name.text);
          }
        }
        continue;
      }
      const declaredNames = runtimeDeclarationNames(statement);
      if (declaredNames.length === 0) continue;
      const text = statement.getText(file);
      for (const name of declaredNames) {
        if (!declarations.has(name)) declarations.set(name, text);
        const origins = declarationOrigins.get(name) ?? new Set<string>();
        origins.add(absolutePath);
        declarationOrigins.set(name, origins);
      }
    }
  };

  visitModule(resolve(entrypoint));

  const ambiguousDeclarationOrigins = new Map<string, readonly string[]>();
  for (const [name, origins] of declarationOrigins) {
    if (origins.size > 1) ambiguousDeclarationOrigins.set(name, [...origins].sort());
  }

  const statements = new Map<string, string>();
  for (const [name, statement] of declarations) statements.set(name, statement);

  const resolved = new Map<string, readonly string[]>();
  const captureAmbiguities = new Map<string, readonly string[]>();
  const resolving = new Set<string>();
  const resolveCapture = (identifier: string): readonly string[] | undefined => {
    const cached = resolved.get(identifier);
    if (cached) return cached;
    const imported = packageImports.get(identifier);
    if (imported) {
      const result = [imported];
      resolved.set(identifier, result);
      return result;
    }
    const aliased = localAliases.get(identifier);
    const statement = statements.get(identifier) ?? (aliased ? statements.get(aliased) : undefined);
    if (!statement || resolving.has(identifier)) return undefined;
    const ambiguityTarget = ambiguousDeclarationOrigins.has(identifier)
      ? identifier
      : aliased && ambiguousDeclarationOrigins.has(aliased)
        ? aliased
        : undefined;
    if (ambiguityTarget) {
      captureAmbiguities.set(identifier, [`${ambiguityTarget} (${ambiguousDeclarationOrigins.get(ambiguityTarget)?.join(', ')})`]);
      return undefined;
    }
    resolving.add(identifier);
    const dependencies: string[] = [];
    const ambiguities = new Set<string>();
    for (const dependency of likelyFreeIdentifiersInStatements(statement).filter((candidate) => candidate !== identifier)) {
      dependencies.push(...(resolveCapture(dependency) ?? []));
      for (const ambiguity of captureAmbiguities.get(dependency) ?? []) ambiguities.add(ambiguity);
    }
    resolving.delete(identifier);
    if (ambiguities.size > 0) captureAmbiguities.set(identifier, [...ambiguities].sort());
    const aliasStatement = aliased && aliased !== identifier && aliased !== 'default' ? `const ${identifier} = ${aliased};` : undefined;
    const result = [...new Set([...dependencies, statement, ...(aliasStatement ? [aliasStatement] : [])])];
    resolved.set(identifier, result);
    return result;
  };
  for (const identifier of statements.keys()) resolveCapture(identifier);
  for (const identifier of localAliases.keys()) resolveCapture(identifier);

  const factoryObjectParameters = new Map<string, ReadonlyMap<string, string>>();
  for (const module of modules) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && isTopLevelExpression(node)) {
        const factoryName = localAliases.get(node.expression.text) ?? node.expression.text;
        const declarationSource = declarations.get(factoryName);
        const argument = node.arguments[0];
        if (declarationSource && argument && ts.isObjectLiteralExpression(argument)) {
          const declarationFile = ts.createSourceFile('applik8s-static-factory.ts', declarationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
          const factory = declarationFile.statements.find(ts.isFunctionDeclaration);
          const parameter = factory?.parameters[0];
          if (parameter && ts.isIdentifier(parameter.name)) {
            const properties = new Map<string, string>();
            for (const property of argument.properties) {
              if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
                properties.set(property.name.text, property.initializer.getText(module.file));
              } else if (ts.isShorthandPropertyAssignment(property)) {
                properties.set(property.name.text, property.name.text);
              }
            }
            if (properties.size > 0 && !factoryObjectParameters.has(parameter.name.text)) factoryObjectParameters.set(parameter.name.text, properties);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.file);
  }
  if (process.env.APPLIK8S_DEBUG_STATIC_CAPTURES === '1') {
    console.error(JSON.stringify({
      component: 'static-entrypoint-capture-analysis',
      modules: modules.map((module) => module.path),
      declarations: [...resolved.keys()].sort(),
      factoryObjectParameters: [...factoryObjectParameters.entries()].map(([parameter, properties]) => ({ parameter, properties: [...properties.keys()] })),
    }));
  }
  return { declarations: resolved, ambiguousCaptures: captureAmbiguities, factoryObjectParameters };
}

function resolveStaticLocalImport(importer: string, specifier: string): string | undefined {
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

function scriptKindForPath(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function runtimeDeclarationNames(statement: ts.Statement): readonly string[] {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
}

function isTopLevelExpression(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
  return Boolean(current.parent && ts.isSourceFile(current.parent));
}

const staticHandlerCapturedImports = new Map<string, readonly string[]>([
  ['KubeConfig', ["import { KubeConfig } from '@kubernetes/client-node';"]],
  ['ObjectCoreV1Api', ["import { CoreV1Api as ObjectCoreV1Api } from '@kubernetes/client-node';"]],
  ['ObjectAppsV1Api', ["import { AppsV1Api as ObjectAppsV1Api } from '@kubernetes/client-node';"]],
  ['ObjectCustomObjectsApi', ["import { CustomObjectsApi as ObjectCustomObjectsApi } from '@kubernetes/client-node';"]],
]);

function staticResourceIdentifiers(resources: Readonly<Record<string, AnyResourceDefinition>>): readonly { readonly identifier: string; readonly key: string }[] {
  const identifiers = new Map<string, string>();
  for (const [key, resource] of Object.entries(resources)) {
    for (const candidate of [key, resource.kind, uncapitalize(resource.kind)]) {
      if (isJavaScriptIdentifier(candidate) && !staticHandlerKnownGlobals.has(candidate) && !staticHandlerKeywords.has(candidate) && !identifiers.has(candidate)) {
        identifiers.set(candidate, key);
      }
    }
  }
  return [...identifiers.entries()].map(([identifier, key]) => ({ identifier, key }));
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}

function uncapitalize(value: string): string {
  return value ? value[0]?.toLowerCase() + value.slice(1) : value;
}

const staticHandlerKnownGlobals = new Set([
  'Array',
  'Boolean',
  'Date',
  'Error',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'URL',
  'console',
  'decodeURIComponent',
  'encodeURIComponent',
  'globalThis',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'process',
  'undefined',
]);

const staticHandlerKeywords = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

function likelyFreeIdentifiers(source: string): readonly string[] {
  const file = ts.createSourceFile('applik8s-static-handler.ts', `const __applik8sHandler = (${source});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return likelyFreeIdentifiersInFile(file);
}

function likelyFreeIdentifiersInStatements(source: string): readonly string[] {
  return likelyFreeIdentifiersInFile(ts.createSourceFile('applik8s-static-capture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
}

function likelyFreeIdentifiersInFile(file: ts.SourceFile): readonly string[] {
  const declared = new Set<string>();
  const collectBindingName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      declared.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) collectBindingName(element.name);
    }
  };
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) collectBindingName(node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) collectBindingName(node.variableDeclaration.name);
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(file);
  const free = new Set<string>();
  const collectReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const identifier = node.text;
      if (!declared.has(identifier) && !staticHandlerKnownGlobals.has(identifier) && isStaticHandlerIdentifierReference(node)) {
        free.add(identifier);
        if (process.env.APPLIK8S_DEBUG_STATIC_CAPTURES === '1') {
          console.error(JSON.stringify({ component: 'static-handler-capture-analysis', identifier, node: node.getText(file), parent: ts.SyntaxKind[node.parent.kind], context: node.parent.getText(file).slice(0, 240) }));
        }
      }
    }
    ts.forEachChild(node, collectReferences);
  };
  collectReferences(file);
  return [...free].sort();
}

function isStaticHandlerIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.propertyName === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)
    || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
    || (ts.isQualifiedName(parent) && parent.right === node)
    || ts.isImportSpecifier(parent)
    || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent)) {
    return false;
  }
  return !isTypeOnlyStaticHandlerIdentifier(node);
}

function isTypeOnlyStaticHandlerIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    current = current.parent;
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

function registrationWithoutHandler(registration: object): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(registration)) {
    if (key !== 'handler') {
      output[key] = value;
    }
  }
  return output;
}

function toSerializableJson(value: unknown, path: string): Result<unknown> {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (isRuntimeSchemaForStaticSerialization(value)) {
    const schema = value.emitJsonSchema();
    if (!schema.ok) {
      return schema;
    }
    return {
      ok: true,
      value: {
        source: schema.value,
        contract: value.contract,
      },
    };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const [index, item] of value.entries()) {
      const serialized = toSerializableJson(item, `${path}[${index}]`);
      if (!serialized.ok) {
        return serialized;
      }
      items.push(serialized.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value === 'function') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return { ok: true, value: undefined };
    }
    return toSerializableJson(Object.fromEntries(entries), path);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        continue;
      }
      const serialized = toSerializableJson(child, `${path}.${key}`);
      if (!serialized.ok) {
        return serialized;
      }
      if (serialized.value === undefined) {
        continue;
      }
      output[key] = serialized.value;
    }
    return { ok: true, value: output };
  }

  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return error('BUNDLE_INVALID', `${path} contains a value that cannot be statically serialized.`);
}

function isRuntimeSchemaForStaticSerialization(value: unknown): value is { readonly contract: unknown; emitJsonSchema(): Result<unknown> } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'contract' in value &&
      typeof Reflect.get(value, 'emitJsonSchema') === 'function'
  );
}

function error<T = never>(code: Diagnostic['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
