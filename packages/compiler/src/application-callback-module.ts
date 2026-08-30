import { resolve } from 'node:path';
import type { ApplicationHandlerDependencies } from '@applik8s/core';
import ts from 'typescript';

export interface GeneratedCallbackFactoryModuleOptions {
  readonly source: string;
  readonly dependencies?: ApplicationHandlerDependencies;
  readonly injectedIdentifiers: readonly string[];
  /** Exact admitted leaves; roots may still expose ordinary maintained functions. */
  readonly injectedBindingPaths?: readonly string[];
  /**
   * Injected roots whose captured declaration has already been proven to be
   * the authoring-time facade for the admitted runtime binding. These roots
   * are excluded while slicing the dependency module so their application
   * setup is not replayed in a worker.
   */
  readonly replacedCapturedIdentifiers?: readonly string[];
  readonly exportName: string;
}

/**
 * Proves that a captured identifier is the authoring-time result of
 * `application.inject(...)`. Generated runtimes replace that facade with the
 * admitted static provider operation instead of replaying application setup.
 */
export function capturedApplicationInjectFacade(
  source: string | undefined,
  identifier: string,
): boolean {
  if (!source?.trim()) return false;
  const file = ts.createSourceFile(
    'application-provider-capture.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const appFactories = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@applik8s/applik8s'
      || !statement.importClause?.namedBindings
      || !ts.isNamedImports(statement.importClause.namedBindings)
    ) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'app') {
        appFactories.add(element.name.text);
      }
    }
  }
  const applicationBindings = new Set<string>();
  forEachVariableDeclaration(file, (declaration) => {
    if (
      ts.isIdentifier(declaration.name)
      && declaration.initializer
      && ts.isCallExpression(declaration.initializer)
      && ts.isIdentifier(declaration.initializer.expression)
      && appFactories.has(declaration.initializer.expression.text)
    ) applicationBindings.add(declaration.name.text);
  });
  let matched = false;
  forEachVariableDeclaration(file, (declaration) => {
    if (
      matched
      || !ts.isIdentifier(declaration.name)
      || declaration.name.text !== identifier
      || !declaration.initializer
      || !ts.isCallExpression(declaration.initializer)
      || !ts.isPropertyAccessExpression(declaration.initializer.expression)
      || declaration.initializer.expression.name.text !== 'inject'
      || !ts.isIdentifier(declaration.initializer.expression.expression)
    ) return;
    matched = applicationBindings.has(
      declaration.initializer.expression.expression.text,
    );
  });
  return matched;
}

function forEachVariableDeclaration(
  node: ts.Node,
  visitDeclaration: (declaration: ts.VariableDeclaration) => void,
): void {
  if (ts.isVariableDeclaration(node)) visitDeclaration(node);
  ts.forEachChild(node, (child) =>
    forEachVariableDeclaration(child, visitDeclaration));
}

/**
 * Emits an ordinary ESM module whose only runtime ceremony is binding the
 * application handles captured by a function-native callback.
 */
export function generatedCallbackFactoryModule(
  options: GeneratedCallbackFactoryModuleOptions,
): string {
  assertIdentifier(options.exportName, 'callback factory export');
  const injectedIdentifiers = [...new Set(options.injectedIdentifiers)];
  for (const identifier of injectedIdentifiers) {
    assertIdentifier(identifier, 'injected callback binding');
  }
  const rawDependencySource = options.dependencies?.source
    ? absoluteDependencyImports(
        options.dependencies.source,
        options.dependencies.resolveDir,
      )
    : '';
  const replacedCapturedIdentifiers = new Set(
    options.replacedCapturedIdentifiers ?? [],
  );
  for (const identifier of replacedCapturedIdentifiers) {
    assertIdentifier(identifier, 'replaced captured callback binding');
    if (!injectedIdentifiers.includes(identifier)) {
      throw new Error(
        `Replaced captured callback binding ${identifier} is not an injected runtime binding.`,
      );
    }
  }
  const focusedDependencySource = rewriteCallbackRuntimeImports(
    focusedCallbackDependencySource(
      rawDependencySource,
      options.source,
      replacedCapturedIdentifiers,
    ),
  );
  const preservedRoots = preservedInjectedImportRoots(
    `${options.source}\n${focusedDependencySource}`,
    injectedIdentifiers,
    options.injectedBindingPaths ?? injectedIdentifiers,
  );
  const preparedDependencies = dependencySourceWithoutInjectedBindings(
    focusedDependencySource,
    new Set(injectedIdentifiers),
    preservedRoots,
  );
  const dependencySource = preparedDependencies.source;
  assertNoCapturedHandleDeclarations(dependencySource, injectedIdentifiers);
  assertNoUnboundApplicationIdentityReferences(
    options.source,
    dependencySource,
    injectedIdentifiers,
  );
  const collisions = moduleBindingNames(dependencySource).filter((identifier) =>
    injectedIdentifiers.includes(identifier),
  );
  if (collisions.length > 0) {
    throw new Error(
      `Generated callback cannot bind ${collisions.join(', ')} because the captured dependency module declares the same identifier(s). Rename the module-local declaration or the application handle; ambiguous callback capture fails closed.`,
    );
  }
  const bindings = injectedIdentifiers
    .map(
      (identifier) =>
        preparedDependencies.capturedImports.has(identifier)
          ? `const ${identifier} = __applik8sMergeCapturedBinding(${preparedDependencies.capturedImports.get(identifier)}, __applik8sBindings[${JSON.stringify(identifier)}]);`
          : `const ${identifier} = __applik8sBindings[${JSON.stringify(identifier)}];`,
    )
    .join('\n');
  const dependencyModule = callbackDependencyModule(dependencySource);
  const mergeHelper = preparedDependencies.capturedImports.size > 0
    ? `${capturedBindingMergeSource}\n\n`
    : '';
  return `${dependencyModule.imports}${dependencyModule.imports ? '\n\n' : ''}${mergeHelper}export function ${options.exportName}(__applik8sBindings = {}) {
${bindings}
${dependencyModule.locals}
return (${options.source});
}
`;
}

/**
 * Application identity handles are authoring-time graph values. A callback may
 * use one only when closure discovery retained its declaration or the runtime
 * explicitly injects it. In particular, a handle declared inside a
 * `module(..., application => { ... })` factory cannot be recreated by a
 * generated worker. Reject that dangling capture during compilation instead
 * of emitting a callback that throws `ReferenceError` only after deployment.
 */
function assertNoUnboundApplicationIdentityReferences(
  callbackSource: string,
  dependencySource: string,
  injectedIdentifiers: readonly string[],
): void {
  const available = new Set([
    ...moduleBindingNames(dependencySource),
    ...injectedIdentifiers,
  ]);
  const file = ts.createSourceFile(
    'applik8s-callback-identity-references.ts',
    `const __applik8sCallback = (${callbackSource});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const locallyDeclared = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      || ts.isParameter(node)
      || ts.isBindingElement(node)
    ) {
      collectBindingNames(node.name, locallyDeclared);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name
    ) {
      locallyDeclared.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && node.name.text === 'id'
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'identity'
      && ts.isIdentifier(node.expression.expression)
    ) {
      const identifier = node.expression.expression.text;
      if (!available.has(identifier) && !locallyDeclared.has(identifier)) {
        throw new Error(
          `Generated callback references application identity ${identifier}.identity.id without a captured declaration or admitted runtime binding. Compare trusted principal identity fields with a handler-safe constant, or declare the identity in a capturable module scope. Dangling application identity captures fail closed.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/**
 * Authoring entrypoints may deliberately re-export small handler-safe values.
 * Generated callbacks bind those values to their narrow runtime authority
 * rather than bundling the entire authoring module (and its infrastructure
 * dependencies) into a deployed worker.
 */
function rewriteCallbackRuntimeImports(source: string): string {
  if (!source.includes("@applik8s/applik8s/dsl")) return source;
  const file = ts.createSourceFile(
    'applik8s-callback-runtime-imports.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements: ts.Statement[] = [];
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@applik8s/applik8s/dsl'
      || !statement.importClause?.namedBindings
      || !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      statements.push(statement);
      continue;
    }
    const arktype = statement.importClause.namedBindings.elements.filter(
      (element) => (element.propertyName?.text ?? element.name.text) === 'type',
    );
    const remaining = statement.importClause.namedBindings.elements.filter(
      (element) => (element.propertyName?.text ?? element.name.text) !== 'type',
    );
    if (arktype.length > 0) {
      statements.push(ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          false,
          undefined,
          ts.factory.createNamedImports(arktype),
        ),
        ts.factory.createStringLiteral('arktype'),
      ));
    }
    if (remaining.length > 0 || statement.importClause.name) {
      statements.push(ts.factory.updateImportDeclaration(
        statement,
        statement.modifiers,
        ts.factory.updateImportClause(
          statement.importClause,
          statement.importClause.isTypeOnly,
          statement.importClause.name,
          remaining.length > 0
            ? ts.factory.updateNamedImports(
                statement.importClause.namedBindings,
                remaining,
              )
            : undefined,
        ),
        statement.moduleSpecifier,
        statement.attributes,
      ));
    }
  }
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printList(
      ts.ListFormat.MultiLine,
      ts.factory.createNodeArray(statements),
      file,
    )
    .trim();
}

const capturedBindingMergeSource = `function __applik8sMergeCapturedBinding(captured, injected) {
  if (captured == null) return injected;
  if (injected == null) return captured;
  const capturedObject = typeof captured === 'object' || typeof captured === 'function';
  const injectedObject = typeof injected === 'object' || typeof injected === 'function';
  if (!capturedObject || !injectedObject) return injected;
  const target = typeof captured === 'function'
    ? function (...args) { return Reflect.apply(captured, this, args); }
    : {};
  return new Proxy(target, {
    get(_target, property) {
      if (!Reflect.has(injected, property)) {
        return Reflect.get(captured, property, captured);
      }
      return __applik8sMergeCapturedBinding(
        Reflect.get(captured, property, captured),
        Reflect.get(injected, property),
      );
    },
    has(_target, property) {
      return Reflect.has(injected, property) || Reflect.has(captured, property);
    },
  });
}`;

const applicationHandleFactoryMethods = new Set([
  'project',
  'projection',
  'query',
  'search',
  'view',
]);

/**
 * A module-local declaration such as `const Recent = Model.view(...)` is an
 * application handle, not an ordinary helper value. If discovery did not
 * promote that handle into an injected runtime binding, replaying the
 * declaration inside the callback factory creates an authoring-time facade
 * from a deliberately narrowed runtime model binding. Fail during compilation
 * instead of producing a handler that traps later with `view is not a
 * function`.
 */
function assertNoCapturedHandleDeclarations(
  source: string,
  injectedIdentifiers: readonly string[],
): void {
  if (!source.trim() || injectedIdentifiers.length === 0) return;
  const injected = new Set(injectedIdentifiers);
  const file = ts.createSourceFile(
    'applik8s-captured-handle-declarations.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      let invalidFactory: string | undefined;
      const visit = (node: ts.Node): void => {
        if (invalidFactory) return;
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && applicationHandleFactoryMethods.has(node.expression.name.text)
          && injected.has(propertyAccessRoot(node.expression.expression) ?? '')
        ) {
          invalidFactory = node.expression.name.text;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(declaration.initializer);
      if (invalidFactory) {
        throw new Error(
          `Generated callback cannot reconstruct module-local application handle ${declaration.name.text} declared with .${invalidFactory}(). Export and register the handle so compiler discovery can inject it, or replace it with an ordinary helper that uses the callback context. Captured application handles fail closed instead of becoming partial runtime facades.`,
        );
      }
    }
  }
}

function propertyAccessRoot(expression: ts.Expression): string | undefined {
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

function preservedInjectedImportRoots(
  source: string,
  injectedIdentifiers: readonly string[],
  injectedBindingPaths: readonly string[],
): ReadonlySet<string> {
  const injected = new Set(injectedIdentifiers);
  const paths = new Set(injectedBindingPaths);
  const preserved = new Set<string>();
  if (!source.trim()) return preserved;
  const file = ts.createSourceFile(
    'applik8s-captured-binding-uses.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && !(
        ts.isPropertyAccessExpression(node.parent)
        && node.parent.expression === node
      )
    ) {
      const path = propertyAccessPath(node);
      const root = path?.split('.')[0];
      if (
        path
        && root
        && injected.has(root)
        && ![...paths].some(
          (candidate) =>
            candidate === path
            || candidate.startsWith(`${path}.`)
            || (!candidate.includes('.') && path.startsWith(`${candidate}.`)),
        )
      ) {
        preserved.add(root);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const root = propertyAccessRoot(node.expression);
      if (root && injected.has(root)) preserved.add(root);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return preserved;
}

function propertyAccessPath(expression: ts.Expression): string | undefined {
  const segments: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    segments.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return undefined;
  segments.unshift(current.text);
  return segments.join('.');
}

/**
 * Closure discovery may need to retain an enclosing module while it proves a
 * nested callback. Generated runtimes must not execute that whole authoring
 * module: keep only declarations transitively reached by the callback and
 * the exact import bindings those declarations use.
 */
function focusedCallbackDependencySource(
  source: string,
  callbackSource: string,
  replacedCapturedIdentifiers: ReadonlySet<string> = new Set(),
): string {
  if (!source.trim()) return source;
  const file = ts.createSourceFile(
    'applik8s-focused-callback-dependencies.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements = file.statements.map((statement) => ({
    statement,
    bindings: statementBindingNames(statement),
  }));
  const required = new Set(
    referencedIdentifiers(callbackSource).filter(
      (identifier) => !replacedCapturedIdentifiers.has(identifier),
    ),
  );
  const retained = new Set<ts.Statement>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of statements) {
      if (retained.has(entry.statement)) continue;
      if (
        entry.bindings.length === 0
        || !entry.bindings.some((binding) => required.has(binding))
      ) {
        continue;
      }
      retained.add(entry.statement);
      for (const identifier of referencedIdentifiers(entry.statement.getText(file))) {
        if (
          !replacedCapturedIdentifiers.has(identifier)
          && !required.has(identifier)
        ) {
          required.add(identifier);
          changed = true;
        }
      }
    }
  }
  const focused = file.statements.flatMap((statement) => {
    if (!retained.has(statement)) return [];
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      return [statement];
    }
    const clause = statement.importClause;
    const name = clause.name && required.has(clause.name.text)
      ? clause.name
      : undefined;
    let namedBindings = clause.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      if (!required.has(namedBindings.name.text)) namedBindings = undefined;
    } else if (namedBindings && ts.isNamedImports(namedBindings)) {
      const elements = namedBindings.elements.filter(
        (element) => element.isTypeOnly || required.has(element.name.text),
      );
      namedBindings = elements.length > 0
        ? ts.factory.updateNamedImports(namedBindings, elements)
        : undefined;
    }
    if (!name && !namedBindings) return [];
    return [ts.factory.updateImportDeclaration(
      statement,
      statement.modifiers,
      ts.factory.updateImportClause(
        clause,
        clause.isTypeOnly,
        name,
        namedBindings,
      ),
      statement.moduleSpecifier,
      statement.attributes,
    )];
  });
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printList(
      ts.ListFormat.MultiLine,
      ts.factory.createNodeArray(focused),
      file,
    )
    .trim();
}

function statementBindingNames(statement: ts.Statement): readonly string[] {
  const names = new Set<string>();
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name) names.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  } else if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    && statement.name
  ) {
    names.add(statement.name.text);
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
  }
  return [...names];
}

function referencedIdentifiers(source: string): readonly string[] {
  if (!source.trim()) return [];
  const file = ts.createSourceFile(
    'applik8s-callback-references.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const identifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && identifierIsReference(node)) {
      identifiers.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...identifiers];
}

function identifierIsReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
    || (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isNamespaceImport(parent) && parent.name === node)
  ) {
    return false;
  }
  return true;
}

/**
 * Imports remain at module scope, while executable helper declarations live
 * in the callback factory beside admitted runtime handles. Recursive closure
 * capture otherwise leaves helpers referring to module-scope `workflow`,
 * model, signal, or operation aliases that only exist inside the factory.
 */
function callbackDependencyModule(source: string): {
  readonly imports: string;
  readonly locals: string;
} {
  if (!source.trim()) return { imports: '', locals: '' };
  const file = ts.createSourceFile(
    'applik8s-generated-callback-dependencies.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: ts.Statement[] = [];
  const locals: ts.Statement[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) imports.push(statement);
    else locals.push(localCallbackDependencyStatement(statement));
  }
  const print = (statements: readonly ts.Statement[]): string =>
    ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
      .printList(
        ts.ListFormat.MultiLine,
        ts.factory.createNodeArray(statements),
        file,
      )
      .trim();
  return { imports: print(imports), locals: print(locals) };
}

function localCallbackDependencyStatement(statement: ts.Statement): ts.Statement {
  if (!ts.canHaveModifiers(statement)) return statement;
  const modifiers = ts.getModifiers(statement)?.filter(
    (modifier) =>
      modifier.kind !== ts.SyntaxKind.ExportKeyword
      && modifier.kind !== ts.SyntaxKind.DefaultKeyword,
  );
  if (ts.isFunctionDeclaration(statement)) {
    return ts.factory.updateFunctionDeclaration(
      statement,
      modifiers,
      statement.asteriskToken,
      statement.name,
      statement.typeParameters,
      statement.parameters,
      statement.type,
      statement.body,
    );
  }
  if (ts.isClassDeclaration(statement)) {
    return ts.factory.updateClassDeclaration(
      statement,
      modifiers,
      statement.name,
      statement.typeParameters,
      statement.heritageClauses,
      statement.members,
    );
  }
  if (ts.isVariableStatement(statement)) {
    return ts.factory.updateVariableStatement(
      statement,
      modifiers,
      statement.declarationList,
    );
  }
  return statement;
}

/**
 * Captured dependency modules can contain the authored binding for a
 * capability leaf that the generated runtime must replace with its admitted
 * handle. Imports and simple aliases are provenance for that same leaf, not
 * competing executable helpers, so remove them before installing the runtime
 * binding. Function, class, and destructuring collisions remain ambiguous and
 * continue to fail closed below.
 */
function dependencySourceWithoutInjectedBindings(
  source: string,
  injected: ReadonlySet<string>,
  preservedImports: ReadonlySet<string> = new Set(),
): {
  readonly source: string;
  readonly capturedImports: ReadonlyMap<string, string>;
} {
  if (!source.trim() || injected.size === 0) {
    return { source, capturedImports: new Map() };
  }
  const file = ts.createSourceFile(
    'applik8s-generated-callback-dependencies.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements: ts.Statement[] = [];
  const capturedImports = new Map<string, string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      let name = clause.name;
      if (name && injected.has(name.text)) {
        if (preservedImports.has(name.text)) {
          const alias = capturedImportAlias(name.text);
          capturedImports.set(name.text, alias);
          name = ts.factory.createIdentifier(alias);
        } else {
          name = undefined;
        }
      }
      let namedBindings = clause.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        if (injected.has(namedBindings.name.text)) {
          if (preservedImports.has(namedBindings.name.text)) {
            const alias = capturedImportAlias(namedBindings.name.text);
            capturedImports.set(namedBindings.name.text, alias);
            namedBindings = ts.factory.createNamespaceImport(
              ts.factory.createIdentifier(alias),
            );
          } else {
            namedBindings = undefined;
          }
        }
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        const elements = namedBindings.elements.flatMap((element) => {
          if (element.isTypeOnly || !injected.has(element.name.text)) {
            return [element];
          }
          if (!preservedImports.has(element.name.text)) return [];
          const alias = capturedImportAlias(element.name.text);
          capturedImports.set(element.name.text, alias);
          return [ts.factory.updateImportSpecifier(
            element,
            element.isTypeOnly,
            element.propertyName ?? element.name,
            ts.factory.createIdentifier(alias),
          )];
        });
        namedBindings = elements.length > 0
          ? ts.factory.updateNamedImports(namedBindings, elements)
          : undefined;
      }
      if (!name && !namedBindings) continue;
      statements.push(
        ts.factory.updateImportDeclaration(
          statement,
          statement.modifiers,
          ts.factory.updateImportClause(
            clause,
            clause.isTypeOnly,
            name,
            namedBindings,
          ),
          statement.moduleSpecifier,
          statement.attributes,
        ),
      );
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations.filter(
        (declaration) =>
          !ts.isIdentifier(declaration.name)
          || !injected.has(declaration.name.text),
      );
      if (declarations.length === 0) continue;
      statements.push(
        ts.factory.updateVariableStatement(
          statement,
          statement.modifiers,
          ts.factory.updateVariableDeclarationList(
            statement.declarationList,
            declarations,
          ),
        ),
      );
      continue;
    }
    statements.push(statement);
  }
  return {
    source: ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printList(
      ts.ListFormat.MultiLine,
      ts.factory.createNodeArray(statements),
      file,
    )
    .trim(),
    capturedImports,
  };
}

function capturedImportAlias(identifier: string): string {
  return `__applik8sCaptured${identifier[0]?.toUpperCase() ?? ''}${identifier.slice(1)}`;
}

function absoluteDependencyImports(source: string, resolveDir: string): string {
  return source
    .replace(
      /(\bfrom\s+['"])(\.[^'"]+)(['"])/g,
      (_match, prefix: string, specifier: string, suffix: string) =>
        `${prefix}${resolve(resolveDir, specifier)}${suffix}`,
    )
    .replace(
      /(^|\n)(\s*import\s+['"])(\.[^'"]+)(['"])/g,
      (
        _match,
        line: string,
        prefix: string,
        specifier: string,
        suffix: string,
      ) => `${line}${prefix}${resolve(resolveDir, specifier)}${suffix}`,
    );
}

function moduleBindingNames(source: string): readonly string[] {
  if (!source.trim()) return [];
  const file = ts.createSourceFile(
    'applik8s-generated-callback-dependencies.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        names.add(clause.namedBindings.name.text);
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) names.add(element.name.text);
        }
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    }
  }
  return [...names].sort();
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is not a JavaScript identifier.`);
  }
}
