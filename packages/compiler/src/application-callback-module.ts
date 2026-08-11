import { resolve } from 'node:path';
import type { ApplicationHandlerDependencies } from '@applik8s/core';
import ts from 'typescript';

export interface GeneratedCallbackFactoryModuleOptions {
  readonly source: string;
  readonly dependencies?: ApplicationHandlerDependencies;
  readonly injectedIdentifiers: readonly string[];
  readonly exportName: string;
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
  const dependencySource = dependencySourceWithoutInjectedBindings(
    rawDependencySource,
    new Set(injectedIdentifiers),
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
        `const ${identifier} = __applik8sBindings[${JSON.stringify(identifier)}];`,
    )
    .join('\n');
  const dependencyModule = callbackDependencyModule(dependencySource);
  return `${dependencyModule.imports}${dependencyModule.imports ? '\n\n' : ''}export function ${options.exportName}(__applik8sBindings = {}) {
${bindings}
${dependencyModule.locals}
return (${options.source});
}
`;
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
): string {
  if (!source.trim() || injected.size === 0) return source;
  const file = ts.createSourceFile(
    'applik8s-generated-callback-dependencies.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements: ts.Statement[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      const name = clause.name && !injected.has(clause.name.text)
        ? clause.name
        : undefined;
      let namedBindings = clause.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        if (injected.has(namedBindings.name.text)) namedBindings = undefined;
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        const elements = namedBindings.elements.filter(
          (element) => element.isTypeOnly || !injected.has(element.name.text),
        );
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
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printList(
      ts.ListFormat.MultiLine,
      ts.factory.createNodeArray(statements),
      file,
    )
    .trim();
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
