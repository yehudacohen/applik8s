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
    const sourceMetadata = handlerSourceMetadata(Reflect.get(registration, Symbol.for('applik8s.handlerSourceModule')));
    if (process.env.APPLIK8S_DEBUG_STATIC_CAPTURES === '1') console.error(JSON.stringify({ component: 'static-handler-source-metadata', handlerId: registration.id, sourceMetadata }));
    const handlerSource = staticHandlerSource(handler, registration.id, allowedFreeIdentifiers, entrypointCaptures, sourceMetadata);
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
  createSession(handlerId: string, sourceModule?: string): StaticCaptureSession;
  readonly factoryObjectParameters: ReadonlyMap<string, StaticFactoryObjectCapture>;
  readonly factoryParameterOrigins: ReadonlyMap<string, readonly string[]>;
}

interface StaticCaptureSession {
  readonly sourceModule?: string;
  resolve(identifier: string, modulePath?: string): string | undefined;
  error(identifier: string): string | undefined;
  render(): readonly string[];
}

interface StaticFactoryObjectCapture {
  readonly callsiteModule: string;
  readonly properties: ReadonlyMap<string, string>;
}

interface StaticHandlerSourceMetadata { readonly file: string; readonly line: number; readonly column: number; }

function staticHandlerSource(handler: (...args: never[]) => unknown, handlerId: string, allowedFreeIdentifiers: ReadonlySet<string>, entrypointCaptures: StaticEntrypointCaptures, sourceMetadata?: StaticHandlerSourceMetadata): Result<{ readonly source: string; readonly imports: readonly string[] }> {
  const source = authoredHandlerSource(sourceMetadata) ?? handler.toString();
  if (source.includes('[native code]')) {
    return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled because it is native code.`);
  }
  const session = entrypointCaptures.createSession(handlerId, sourceMetadata?.file);
  const captureExpressions = new Map<string, string>();
  const directImports = new Set<string>();
  const freeCandidates = likelyFreeIdentifiers(source).filter((candidate) => !allowedFreeIdentifiers.has(candidate));
  for (const identifier of freeCandidates) {
    const moduleCapture = session.resolve(identifier);
    if (moduleCapture) {
      captureExpressions.set(identifier, moduleCapture);
      continue;
    }
    const captureError = session.error(identifier);
    if (captureError) {
      return error(
        'BUNDLE_INVALID',
        `Handler ${handlerId} cannot be statically bundled because capture ${identifier} ${captureError}`
      );
    }
    const directImport = staticHandlerCapturedImports.get(identifier);
    if (directImport) {
      for (const statement of directImport) directImports.add(statement);
      continue;
    }
    const factoryCapture = factoryObjectParameterCapture(identifier, source, entrypointCaptures, session);
    if (factoryCapture) captureExpressions.set(identifier, factoryCapture);
  }
  const freeIdentifiers = freeCandidates.filter((identifier) => !captureExpressions.has(identifier) && !staticHandlerCapturedImports.has(identifier));
  if (freeIdentifiers.length > 0) {
    return error(
      'BUNDLE_INVALID',
      `Handler ${handlerId} cannot be statically bundled. The reconcile callback references closure-local identifier(s) that cannot be recovered from the module: ${freeIdentifiers.join(', ')}. Move captured values and helper functions to top-level declarations, keep them inside the handler, or pass literal data through the reconciled resource spec/status. Top-level reachable helpers and imports are serialized into the WASM dispatcher; factory-local lexical state fails closed.`
    );
  }
  const validation = ts.transpileModule(`const __applik8sHandler = (${source});`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const syntaxError = validation.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxError) return error('BUNDLE_INVALID', `Handler ${handlerId} cannot be statically bundled from its function source: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, '\n')}.`);
  const captureNames = [...captureExpressions.keys()].sort();
  const wrappedSource = captureNames.length === 0
    ? source
    : `((${captureNames.join(', ')}) => (${source}))(${captureNames.map((name) => captureExpressions.get(name)).join(', ')})`;
  return { ok: true, value: { source: wrappedSource, imports: [...directImports, ...session.render()] } };
}

function handlerSourceMetadata(value: unknown): StaticHandlerSourceMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const file = Reflect.get(value, 'file');
  const line = Reflect.get(value, 'line');
  const column = Reflect.get(value, 'column');
  return typeof file === 'string' && typeof line === 'number' && typeof column === 'number' ? { file, line, column } : undefined;
}

function authoredHandlerSource(metadata: StaticHandlerSourceMetadata | undefined): string | undefined {
  if (!metadata) return undefined;
  let source: string;
  try {
    source = readFileSync(metadata.file, 'utf8');
  } catch {
    return undefined;
  }
  const file = ts.createSourceFile(metadata.file, source, ts.ScriptTarget.Latest, true, scriptKindForPath(metadata.file));
  const line = Math.max(0, metadata.line - 1);
  const column = Math.max(0, metadata.column - 1);
  const target = file.getPositionOfLineAndCharacter(Math.min(line, file.getLineAndCharacterOfPosition(file.end).line), column);
  const candidates: Array<{ readonly distance: number; readonly size: number; readonly expression: ts.ArrowFunction | ts.FunctionExpression }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.arguments.find((argument): argument is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
      if (expression) {
        const start = node.getStart(file);
        const end = node.getEnd();
        const distance = target < start ? start - target : target > end ? target - end : 0;
        const nodeLine = file.getLineAndCharacterOfPosition(start).line;
        if (distance === 0 || nodeLine === line) candidates.push({ distance, size: end - start, expression });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  candidates.sort((left, right) => left.distance - right.distance || left.size - right.size);
  return candidates[0]?.expression.getText(file);
}

function factoryObjectParameterCapture(identifier: string, handlerSource: string, captures: StaticEntrypointCaptures, session: StaticCaptureSession): string | undefined {
  const exactKey = session.sourceModule ? factoryCaptureKey(session.sourceModule, identifier) : undefined;
  const fallbackOrigins = captures.factoryParameterOrigins.get(identifier) ?? [];
  const key = exactKey && captures.factoryObjectParameters.has(exactKey)
    ? exactKey
    : fallbackOrigins.length === 1 ? fallbackOrigins[0] : undefined;
  const capture = key ? captures.factoryObjectParameters.get(key) : undefined;
  if (!capture) return undefined;
  const accessed = directlyAccessedProperties(handlerSource, identifier);
  if (accessed.length === 0 || accessed.some((property) => !capture.properties.has(property))) return undefined;
  const selected: Array<readonly [string, string]> = [];
  for (const property of accessed) {
    const expression = capture.properties.get(property);
    if (expression === undefined) return undefined;
    selected.push([property, expression]);
  }
  const dependencies = new Map<string, string>();
  for (const [, expression] of selected) {
    for (const dependency of likelyFreeIdentifiersInStatements(expression).filter((candidate) => candidate !== identifier)) {
      const captured = session.resolve(dependency, capture.callsiteModule);
      if (!captured) return undefined;
      dependencies.set(dependency, captured);
    }
  }
  const objectSource = selected.map(([property, expression]) => `${JSON.stringify(property)}: (${expression})`).join(', ');
  const dependencyNames = [...dependencies.keys()].sort();
  if (dependencyNames.length === 0) return `{ ${objectSource} }`;
  return `((${dependencyNames.join(', ')}) => ({ ${objectSource} }))(${dependencyNames.map((name) => dependencies.get(name)).join(', ')})`;
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
  readonly index: number;
  readonly declarations: ReadonlyMap<string, StaticDeclarationRecord>;
  readonly packageImports: ReadonlyMap<string, StaticPackageImport>;
  readonly localImports: ReadonlyMap<string, StaticLocalImport>;
  defaultExport?: string;
}

interface StaticDeclarationRecord { readonly index: number; readonly statement: ts.Statement; readonly names: readonly string[]; }
interface StaticPackageImport { readonly specifier: string; readonly kind: 'default' | 'namespace' | 'named'; readonly imported?: string; }
interface StaticLocalImport { readonly target: string; readonly imported: string; }
interface StaticExternalBinding { readonly expression: string; readonly dependencyModule?: string; }
interface StaticRenderedPackageImport { readonly statement: string; readonly local: string; }

function staticEntrypointCaptures(entrypoint: string): StaticEntrypointCaptures {
  const declarationOrigins = new Map<string, Set<string>>();
  const modules: StaticModuleRecord[] = [];
  const modulesByPath = new Map<string, StaticModuleRecord>();
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
    const declarations = new Map<string, StaticDeclarationRecord>();
    const packageImports = new Map<string, StaticPackageImport>();
    const localImports = new Map<string, StaticLocalImport>();
    let defaultExport: string | undefined;
    const module: StaticModuleRecord = { path: absolutePath, file, index: modules.length, declarations, packageImports, localImports };
    modules.push(module);
    modulesByPath.set(absolutePath, module);
    for (const [statementIndex, statement] of file.statements.entries()) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        const localTarget = resolveStaticLocalImport(absolutePath, specifier);
        if (!localTarget) {
          if (clause?.name && !clause.isTypeOnly) packageImports.set(clause.name.text, { specifier, kind: 'default' });
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) && !clause.isTypeOnly) packageImports.set(clause.namedBindings.name.text, { specifier, kind: 'namespace' });
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.isTypeOnly) {
            for (const element of clause.namedBindings.elements) {
              if (!element.isTypeOnly) packageImports.set(element.name.text, { specifier, kind: 'named', imported: element.propertyName?.text ?? element.name.text });
            }
          }
          continue;
        }
        visitModule(localTarget);
        const target = resolve(localTarget);
        if (clause?.name && !clause.isTypeOnly) localImports.set(clause.name.text, { target, imported: 'default' });
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.isTypeOnly) {
          for (const element of clause.namedBindings.elements) {
            if (!element.isTypeOnly) localImports.set(element.name.text, { target, imported: element.propertyName?.text ?? element.name.text });
          }
        }
        continue;
      }
      const declaredNames = runtimeDeclarationNames(statement);
      if (declaredNames.length === 0) continue;
      for (const name of declaredNames) {
        declarations.set(name, { index: statementIndex, statement, names: declaredNames });
        const origins = declarationOrigins.get(name) ?? new Set<string>();
        origins.add(absolutePath);
        declarationOrigins.set(name, origins);
      }
      if (hasDefaultModifier(statement)) defaultExport = declaredNames[0];
    }
    if (defaultExport) module.defaultExport = defaultExport;
  };

  visitModule(resolve(entrypoint));

  const factoryObjectParameters = new Map<string, StaticFactoryObjectCapture>();
  const factoryParameterOrigins = new Map<string, string[]>();
  for (const module of modules) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && isTopLevelExpression(node)) {
        const localImport = module.localImports.get(node.expression.text);
        const factoryModule = localImport ? modulesByPath.get(localImport.target) : module;
        const importedName = localImport?.imported === 'default' ? factoryModule?.defaultExport : localImport?.imported;
        const factoryName = importedName ?? node.expression.text;
        const declaration = factoryModule?.declarations.get(factoryName);
        const argument = node.arguments[0];
        if (declaration && argument && ts.isObjectLiteralExpression(argument)) {
          const factory = ts.isFunctionDeclaration(declaration.statement) ? declaration.statement : undefined;
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
            if (properties.size > 0 && factoryModule) {
              const key = factoryCaptureKey(factoryModule.path, parameter.name.text);
              if (!factoryObjectParameters.has(key)) {
                factoryObjectParameters.set(key, { callsiteModule: module.path, properties });
                const origins = factoryParameterOrigins.get(parameter.name.text) ?? [];
                origins.push(key);
                factoryParameterOrigins.set(parameter.name.text, origins);
              }
            }
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
      declarations: modules.flatMap((module) => [...module.declarations.keys()].map((name) => `${module.path}#${name}`)).sort(),
      factoryObjectParameters: [...factoryObjectParameters.entries()].map(([key, capture]) => ({ key, properties: [...capture.properties.keys()] })),
    }));
  }
  return {
    factoryObjectParameters,
    factoryParameterOrigins,
    createSession: (handlerId, sourceModule) => createStaticCaptureSession(handlerId, sourceModule, modulesByPath, declarationOrigins),
  };
}

function createStaticCaptureSession(handlerId: string, sourceModule: string | undefined, modulesByPath: ReadonlyMap<string, StaticModuleRecord>, declarationOrigins: ReadonlyMap<string, ReadonlySet<string>>): StaticCaptureSession {
  const prefix = `__applik8s_${handlerId.replace(/[^A-Za-z0-9_$]/g, '_')}`;
  const selected = new Map<string, Map<number, StaticDeclarationRecord>>();
  const bindings = new Map<string, Map<string, StaticExternalBinding>>();
  const packageStatements = new Map<string, StaticRenderedPackageImport>();
  const errors = new Map<string, string>();
  const resolving = new Set<string>();
  const normalizedSourceModule = matchStaticModule(sourceModule, modulesByPath);
  let packageIndex = 0;

  const namespaceFor = (module: StaticModuleRecord): string => `${prefix}_m${module.index}`;
  const resolveFrom = (modulePath: string | undefined, identifier: string): string | undefined => {
    const module = modulePath ? modulesByPath.get(modulePath) : undefined;
    if (!module) {
      const origins = [...(declarationOrigins.get(identifier) ?? [])];
      if (origins.length > 1) {
        errors.set(identifier, `has no defining-module provenance and matches multiple module-local declarations: ${origins.sort().join(', ')}.`);
        return undefined;
      }
      if (origins.length === 1) return resolveFrom(origins[0], identifier);
      return undefined;
    }
    const key = `${module.path}\0${identifier}`;
    if (resolving.has(key)) {
      errors.set(identifier, `participates in an unsupported cyclic static capture rooted at ${module.path}.`);
      return undefined;
    }
    const packageImport = module.packageImports.get(identifier);
    if (packageImport) {
      const importKey = `${module.path}\0${identifier}`;
      if (!packageStatements.has(importKey)) {
        const local = `${prefix}_pkg${packageIndex++}`;
        const statement = packageImport.kind === 'default'
          ? `import ${local} from ${JSON.stringify(packageImport.specifier)};`
          : packageImport.kind === 'namespace'
            ? `import * as ${local} from ${JSON.stringify(packageImport.specifier)};`
            : `import { ${packageImport.imported}${packageImport.imported === local ? '' : ` as ${local}`} } from ${JSON.stringify(packageImport.specifier)};`;
        packageStatements.set(importKey, { statement, local });
      }
      return packageStatements.get(importKey)?.local;
    }
    const localImport = module.localImports.get(identifier);
    if (localImport) {
      const target = modulesByPath.get(localImport.target);
      const targetName = localImport.imported === 'default' ? target?.defaultExport : localImport.imported;
      if (!target || !targetName) return undefined;
      const expression = resolveFrom(target.path, targetName);
      if (expression) {
        const moduleBindings = bindings.get(module.path) ?? new Map<string, StaticExternalBinding>();
        moduleBindings.set(identifier, { expression, dependencyModule: target.path });
        bindings.set(module.path, moduleBindings);
      }
      return expression;
    }
    const declaration = module.declarations.get(identifier);
    if (!declaration) return undefined;
    resolving.add(key);
    const moduleSelected = selected.get(module.path) ?? new Map<number, StaticDeclarationRecord>();
    moduleSelected.set(declaration.index, declaration);
    selected.set(module.path, moduleSelected);
    for (const dependency of likelyFreeIdentifiersInStatements(declaration.statement.getText(module.file)).filter((candidate) => candidate !== identifier)) {
      if (module.declarations.has(dependency)) {
        if (!resolveFrom(module.path, dependency)) errors.set(identifier, `depends on unresolved module-local declaration ${dependency} in ${module.path}.`);
        continue;
      }
      const expression = resolveFrom(module.path, dependency);
      if (!expression) {
        errors.set(identifier, `depends on unresolved identifier ${dependency} in ${module.path}.`);
        continue;
      }
      const moduleBindings = bindings.get(module.path) ?? new Map<string, StaticExternalBinding>();
      const dependencyModule = module.localImports.get(dependency)?.target;
      if (!moduleBindings.has(dependency)) moduleBindings.set(dependency, { expression, ...(dependencyModule ? { dependencyModule } : {}) });
      bindings.set(module.path, moduleBindings);
    }
    resolving.delete(key);
    return `${namespaceFor(module)}.${identifier}`;
  };

  return {
    ...(normalizedSourceModule ? { sourceModule: normalizedSourceModule } : {}),
    resolve: (identifier, modulePath) => resolveFrom(matchStaticModule(modulePath, modulesByPath) ?? normalizedSourceModule, identifier),
    error: (identifier) => errors.get(identifier),
    render: () => {
      const output = [...packageStatements.values()].map(({ statement }) => statement);
      const rendered = new Set<string>();
      const rendering = new Set<string>();
      const renderModule = (path: string): void => {
        if (rendered.has(path) || rendering.has(path)) return;
        rendering.add(path);
        for (const binding of bindings.get(path)?.values() ?? []) {
          if (binding.dependencyModule && selected.has(binding.dependencyModule)) renderModule(binding.dependencyModule);
        }
        const module = modulesByPath.get(path);
        const statements = [...(selected.get(path)?.values() ?? [])].sort((left, right) => left.index - right.index);
        if (module && statements.length > 0) {
          const moduleBindings = [...(bindings.get(path)?.entries() ?? [])].sort(([left], [right]) => left.localeCompare(right));
          const body = statements.map((record) => stripStaticExport(record.statement.getText(module.file))).join('\n');
          const exportedNames = [...new Set(statements.flatMap((record) => record.names))].sort();
          output.push(`const ${namespaceFor(module)} = ((${moduleBindings.map(([name]) => name).join(', ')}) => {\n${body}\nreturn { ${exportedNames.join(', ')} };\n})(${moduleBindings.map(([, binding]) => binding.expression).join(', ')});`);
        }
        rendering.delete(path);
        rendered.add(path);
      };
      for (const path of selected.keys()) renderModule(path);
      return output;
    },
  };
}

function matchStaticModule(sourceModule: string | undefined, modulesByPath: ReadonlyMap<string, StaticModuleRecord>): string | undefined {
  if (!sourceModule) return undefined;
  const absolute = resolve(sourceModule.replace(/^file:\/\//, ''));
  if (modulesByPath.has(absolute)) return absolute;
  const extension = extname(absolute);
  const base = extension === '.js' || extension === '.mjs' || extension === '.cjs' ? absolute.slice(0, -extension.length) : absolute;
  return [...modulesByPath.keys()].find((candidate) => candidate === `${base}.ts` || candidate === `${base}.tsx` || candidate === `${base}.js`);
}

function factoryCaptureKey(modulePath: string, parameter: string): string {
  return `${resolve(modulePath)}\0${parameter}`;
}

function stripStaticExport(source: string): string {
  return source.replace(/^\s*export\s+(?:default\s+)?/, '');
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return Boolean(ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
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
