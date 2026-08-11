// typecast-file-boundary: TypeScript AST nodes are narrowed by syntax kind before callback declarations and imports are inspected.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';

const applicationCallbackProperties: Readonly<Record<string, readonly string[]>> = {
  query: ['authorize', 'run'],
  view: ['authorize', 'run', 'kubernetes.project'],
  stream: ['partitionBy', 'authorize'],
  subscription: ['authorize'],
  projection: ['project'],
  gateway: ['authorizeCommand', 'deployment.authenticate'],
  on: ['reconcile', 'created', 'updated', 'deleted', 'statusChanged', 'finalize.handler'],
};

/** Preserves callback source provenance while esbuild evaluates an application entrypoint. */
export function decorateApplicationCallbackArguments(
  node: ts.CallExpression,
  file: ts.SourceFile,
  sourceFile: string,
  visit: ts.Visitor,
): readonly ts.Expression[] | undefined {
  if (
    ts.isIdentifier(node.expression)
    && node.expression.text === 'workflow'
    && (node.arguments.length === 3 || node.arguments.length === 4)
  ) {
    const callbackIndex = node.arguments.length - 1;
    const optionsIndex = node.arguments.length === 4 ? 2 : -1;
    const argumentsWithCallbacks = node.arguments.map((argument, index) => {
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === callbackIndex && isApplicationCallbackExpression(visited)
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            'workflow',
            'handler',
          )
        : visited;
    });
    const analysis = directApplicationCallAnalysis(
      node.arguments[callbackIndex] as ts.Expression,
      file,
      sourceFile,
      'workflow',
    );
    const captures = analysis.calls.map((candidate) =>
      ts.visitNode(candidate, visit) as ts.Expression);
    if (captures.length > 0) {
      const generatedProperty = ts.factory.createPropertyAssignment(
        '__generatedCalls',
        ts.factory.createArrayLiteralExpression(captures),
      );
      const generatedBindings = ts.factory.createPropertyAssignment(
        '__generatedBindings',
        ts.factory.createObjectLiteralExpression(
          captures
            .map((capture) =>
              ts.factory.createPropertyAssignment(
                ts.factory.createStringLiteral(capture.getText(file)),
                capture,
              )),
        ),
      );
      if (optionsIndex === -1) {
        argumentsWithCallbacks.splice(
          callbackIndex,
          0,
          ts.factory.createObjectLiteralExpression([
            generatedProperty,
            generatedBindings,
          ]),
        );
      } else {
        const options = argumentsWithCallbacks[optionsIndex];
        if (
          options
          && ts.isObjectLiteralExpression(options)
          && !options.properties.some(
            (property) => objectPropertyName(property.name) === '__generatedCalls',
          )
        ) {
          argumentsWithCallbacks[optionsIndex] =
            ts.factory.updateObjectLiteralExpression(options, [
              ...options.properties,
              generatedProperty,
              generatedBindings,
            ]);
        }
      }
    }
    return argumentsWithCallbacks;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (
    node.expression.name.text === 'from' &&
    ts.isIdentifier(node.expression.expression) &&
    (node.expression.expression.text === 'IdentityProvider' ||
      node.expression.expression.text === 'OAuthAuthorizationServer' ||
      node.expression.expression.text === 'Authorization')
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
  if (
    (registrar === 'post' || registrar === 'webhook')
    && isApplicationHttpPostRegistrar(node.expression.expression, file)
    && node.arguments.length === 4
    && ts.isObjectLiteralExpression(node.arguments[2] as ts.Expression)
    && isApplicationCallbackExpression(node.arguments[3] as ts.Expression)
  ) {
    const registrarName = registrar === 'webhook'
      ? 'app.http.webhook'
      : 'app.http.post';
    const rawContract = node.arguments[2] as ts.ObjectLiteralExpression;
    const contract = ts.visitNode(
      rawContract,
      visit,
    ) as ts.ObjectLiteralExpression;
    const handler = node.arguments[3] as ts.Expression;
    const authentication = registrar === 'webhook'
      ? rawContract.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property)
            && objectPropertyName(property.name) === 'authenticate'
            && isApplicationCallbackExpression(property.initializer),
        )?.initializer
      : undefined;
    const analyses = [handler, ...(authentication ? [authentication] : [])]
      .map((callback) =>
        directApplicationCallAnalysis(
          callback,
          file,
          sourceFile,
          registrarName,
        ));
    const calls = analyses.flatMap((analysis) => analysis.calls)
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex(
            (other) => other.getText(file) === candidate.getText(file),
          ) === index,
      );
    const awaited = analyses.flatMap((analysis) => analysis.awaited)
      .filter(
        (candidate, index, candidates) =>
          candidates.findIndex(
            (other) => other.getText(file) === candidate.getText(file),
          ) === index,
      );
    const captures = calls.map((candidate) =>
      ts.visitNode(candidate, visit) as ts.Expression);
    const generated = captures.length === 0
      ? []
      : [
          ts.factory.createPropertyAssignment(
            '__generatedCalls',
            ts.factory.createArrayLiteralExpression(captures),
          ),
          ts.factory.createPropertyAssignment(
            '__generatedBindings',
            ts.factory.createObjectLiteralExpression(
              captures.map((capture) =>
                ts.factory.createPropertyAssignment(
                  ts.factory.createStringLiteral(capture.getText(file)),
                  capture,
                )),
            ),
          ),
          ...(awaited.length > 0
            ? [
                ts.factory.createPropertyAssignment(
                  '__generatedAwaitedCalls',
                  ts.factory.createObjectLiteralExpression(
                    awaited.map((capture) =>
                      ts.factory.createPropertyAssignment(
                        ts.factory.createStringLiteral(capture.getText(file)),
                        ts.visitNode(capture, visit) as ts.Expression,
                      )),
                  ),
                ),
              ]
            : []),
        ];
    return node.arguments.map((argument, index) => {
      if (index === 2) {
        const decorated = decorateApplicationCallbackObject(
          contract,
          [registrar === 'webhook' ? 'authenticate' : 'authorize'],
          file,
          sourceFile,
          registrarName,
        );
        return ts.factory.updateObjectLiteralExpression(decorated, [
          ...decorated.properties,
          ...generated,
        ]);
      }
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 3
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            registrarName,
            'handler',
          )
        : visited;
    });
  }
  const functionNativeLifecycleRegistrar =
    (registrar === 'create'
      || registrar === 'update'
      || registrar === 'delete')
    && isResourceReconcileRegistrar(node.expression.expression);
  if (
    registrar === 'reconcile'
    && isResourceReconcileRegistrar(node.expression.expression)
    && node.arguments.length === 1
    && isApplicationCallbackExpression(node.arguments[0] as ts.Expression)
  ) {
    return node.arguments.map((argument, index) => {
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 0
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            'Resource.on.reconcile',
            'handler',
          )
        : visited;
    });
  }
  if (
    registrar === 'task'
    || registrar === 'workflow'
    || registrar === 'process'
    || registrar === 'onEvent'
    || registrar === 'onBatch'
    || registrar === 'agent'
    || registrar === 'beforeCommit'
    || functionNativeLifecycleRegistrar
  ) {
    const argumentsWithCallbacks = node.arguments.map((argument, index) => {
      // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      const callbackIndex = registrar === 'onEvent' || registrar === 'onBatch' || registrar === 'process' || registrar === 'beforeCommit'
        ? node.arguments.length - 1
        : functionNativeLifecycleRegistrar
          ? node.arguments.length - 1
        : registrar === 'workflow'
          ? node.arguments.length - 1
          : 2;
      return index === callbackIndex && isApplicationCallbackExpression(visited)
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            registrar === 'process' || registrar === 'onEvent' || registrar === 'onBatch'
              ? `stream.${registrar}`
              : functionNativeLifecycleRegistrar
                ? `Model.on.${registrar}`
                : registrar,
            'handler',
          )
        : visited;
    });
    const capturePositions = registrar === 'workflow'
      ? {
          options:
            node.arguments.length === 4
              ? 2
              : applicationFunctionNativeWorkflowContract(
                    node.arguments[1],
                  )
                ? -2
                : 1,
          callback: node.arguments.length - 1,
        }
      : registrar === 'onEvent' || registrar === 'onBatch'
        ? { options: node.arguments.length === 1 ? -1 : 0, callback: node.arguments.length - 1 }
      : registrar === 'beforeCommit'
          ? { options: 0, callback: 1 }
        : functionNativeLifecycleRegistrar
          ? {
              options: node.arguments.length === 2 ? 0 : 1,
              callback: node.arguments.length - 1,
            }
        : registrar === 'process'
          ? { options: node.arguments.length === 2 ? 0 : 1, callback: node.arguments.length - 1 }
          : undefined;
    if (capturePositions && node.arguments[capturePositions.callback]) {
      const analysis = directApplicationCallAnalysis(
        node.arguments[capturePositions.callback] as ts.Expression,
        file,
        sourceFile,
        registrar,
      );
      const captures = analysis.calls.map((candidate) =>
        ts.visitNode(candidate, visit) as ts.Expression);
      if (captures.length > 0) {
        const generatedProperty = ts.factory.createPropertyAssignment(
          '__generatedCalls',
          ts.factory.createArrayLiteralExpression(captures),
        );
        const generatedBindings = ts.factory.createPropertyAssignment(
          '__generatedBindings',
          ts.factory.createObjectLiteralExpression(
            captures
              .map((capture) =>
                ts.factory.createPropertyAssignment(
                  ts.factory.createStringLiteral(capture.getText(file)),
                  capture,
                )),
          ),
        );
        const generatedModelBindings = registrar === 'beforeCommit'
          ? ts.factory.createPropertyAssignment(
              '__generatedModelBindings',
              ts.factory.createObjectLiteralExpression(
                captures
                  .map((capture) =>
                    ts.factory.createPropertyAssignment(
                      ts.factory.createStringLiteral(capture.getText(file)),
                      capture,
                    )),
                ),
            )
          : undefined;
        const generatedAwaitedCalls =
          registrar === 'beforeCommit' && analysis.awaited.length > 0
            ? ts.factory.createPropertyAssignment(
                '__generatedAwaitedCalls',
                ts.factory.createObjectLiteralExpression(
                  analysis.awaited.map((capture) =>
                    ts.factory.createPropertyAssignment(
                      ts.factory.createStringLiteral(capture.getText(file)),
                      ts.visitNode(capture, visit) as ts.Expression,
                    )),
                ),
              )
            : undefined;
        if (capturePositions.options === -1) {
          argumentsWithCallbacks.unshift(ts.factory.createObjectLiteralExpression([
            generatedProperty,
            generatedBindings,
            ...(generatedModelBindings ? [generatedModelBindings] : []),
            ...(generatedAwaitedCalls ? [generatedAwaitedCalls] : []),
          ]));
        } else if (capturePositions.options === -2) {
          argumentsWithCallbacks.splice(
            capturePositions.callback,
            0,
            ts.factory.createObjectLiteralExpression([
              generatedProperty,
              generatedBindings,
              ...(generatedModelBindings ? [generatedModelBindings] : []),
              ...(generatedAwaitedCalls ? [generatedAwaitedCalls] : []),
            ]),
          );
        } else {
          const options = argumentsWithCallbacks[capturePositions.options];
          if (
            options
            && ts.isObjectLiteralExpression(options)
            && !options.properties.some((property) => objectPropertyName(property.name) === '__generatedCalls')
          ) {
            argumentsWithCallbacks[capturePositions.options] = ts.factory.updateObjectLiteralExpression(options, [
              ...options.properties,
              generatedProperty,
              generatedBindings,
              ...(generatedModelBindings ? [generatedModelBindings] : []),
              ...(generatedAwaitedCalls ? [generatedAwaitedCalls] : []),
            ]);
          }
        }
      }
    }
    return argumentsWithCallbacks;
  }
  if (
    (registrar === 'query' || registrar === 'view') &&
    node.arguments.length === 2 &&
    isApplicationCallbackExpression(node.arguments[1] as ts.Expression)
  ) {
    const contract = node.arguments[0] as ts.Expression;
    const modelNativeKubernetes = ts.isObjectLiteralExpression(contract)
      && contract.properties.some((property) => objectPropertyName(property.name) === 'select');
    return node.arguments.map((argument, index) => {
      // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      if (index === 0 && ts.isObjectLiteralExpression(visited)) {
        return decorateApplicationCallbackObject(
          visited,
          modelNativeKubernetes
            ? [
                'authorize',
                'select.namespace',
                'select.labelSelector',
                'select.fieldSelector',
                'select.where',
                'select.orderBy',
                'select.limit',
              ]
            : ['authorize', 'kubernetes.project'],
          file,
          sourceFile,
          registrar,
        );
      }
      return index === 1
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            registrar,
            modelNativeKubernetes ? 'kubernetes.project' : 'run',
          )
        : visited;
    });
  }
  if (
    registrar === 'project'
    && node.arguments.length === 2
    && isApplicationCallbackExpression(node.arguments[1] as ts.Expression)
  ) {
    return node.arguments.map((argument, index) => {
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 1
        ? decorateApplicationCallbackExpression(
            visited,
            file,
            sourceFile,
            registrar,
            'transform',
          )
        : visited;
    });
  }
  const properties = applicationCallbackProperties[registrar];
  if (!properties) return undefined;
  const optionsIndex = node.arguments.length === 1 ? 0 : 1;
  return node.arguments.map((argument, index) => {
    // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
    const visited = ts.visitNode(argument, visit) as ts.Expression;
    if (index !== optionsIndex || !ts.isObjectLiteralExpression(visited)) return visited;
    return decorateApplicationCallbackObject(visited, properties, file, sourceFile, registrar);
  });
}

function isApplicationHttpPostRegistrar(
  expression: ts.Expression,
  file: ts.SourceFile,
): boolean {
  if (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
  ) {
    return expression.expression.name.text === 'http';
  }
  if (!ts.isIdentifier(expression)) return false;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name)
        || declaration.name.text !== expression.text
        || !declaration.initializer
        || !ts.isCallExpression(declaration.initializer)
        || !ts.isPropertyAccessExpression(declaration.initializer.expression)
      ) {
        continue;
      }
      if (declaration.initializer.expression.name.text === 'http') return true;
    }
  }
  return false;
}

function applicationFunctionNativeWorkflowContract(
  expression: ts.Expression | undefined,
): boolean {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return false;
  const properties = new Set(
    expression.properties.map((property) => objectPropertyName(property.name)),
  );
  return properties.has('input') && properties.has('output');
}

function isResourceReconcileRegistrar(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false;
  if (expression.name.text === 'on') return true;
  return expression.name.text === 'context'
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === 'on';
}

interface DirectApplicationCallAnalysis {
  readonly calls: readonly ts.Expression[];
  readonly awaited: readonly ts.Expression[];
  readonly returned: readonly ts.Expression[];
}

type AnalyzableApplicationCallback =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | (ts.FunctionDeclaration & { readonly body: ts.Block });

/**
 * Attaches dependency metadata to top-level functions after their module has
 * initialized. Importing modules can therefore recover transitive capability
 * leaves without requiring private helper dependencies to be re-exported.
 */
export function applicationCallbackDependencyMetadataStatements(
  file: ts.SourceFile,
  sourceFile: string,
): readonly ts.Statement[] {
  return [...applicationCallbackDependencyMetadataStatementsByName(
    file,
    sourceFile,
    sourceFile.split(/[\\/]/).at(-1) ?? sourceFile,
  ).values()].flat();
}

/**
 * Returns compiler metadata keyed by the declaration that owns it. The
 * instrumentation pass places these statements immediately after the
 * declaration, so same-module authority and tool registrations observe the
 * exact same decorated function as imported consumers.
 */
export function applicationCallbackDependencyMetadataStatementsByName(
  file: ts.SourceFile,
  sourceFile: string,
  moduleIdentity: string,
  deferDependencyValueReads = false,
): ReadonlyMap<string, readonly ts.Statement[]> {
  const statements = new Map<string, readonly ts.Statement[]>();
  for (const [name, callable] of topLevelApplicationCallables(file)) {
    const callback = ts.factory.createIdentifier(name);
    const analysis = directApplicationCallAnalysis(
      callback,
      file,
      sourceFile,
      'application helper',
      deferDependencyValueReads,
    );
    const awaited = new Set(
      analysis.awaited.map((candidate) => applicationNodeText(candidate, file)),
    );
    const returned = new Set(
      analysis.returned.map((candidate) => applicationNodeText(candidate, file)),
    );
    const dependencies = analysis.calls.map((candidate) => {
      const identifier = applicationNodeText(candidate, file);
      return ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment(
          'identifier',
          ts.factory.createStringLiteral(identifier),
        ),
        ts.factory.createPropertyAssignment('value', candidate),
        ts.factory.createPropertyAssignment(
          'awaited',
          awaited.has(identifier)
            ? ts.factory.createTrue()
            : ts.factory.createFalse(),
        ),
        ts.factory.createPropertyAssignment(
          'returned',
          returned.has(identifier)
            ? ts.factory.createTrue()
            : ts.factory.createFalse(),
        ),
      ]);
    });
    const ownedStatements: ts.Statement[] = [
      ts.factory.createExpressionStatement(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier('Object'),
            'defineProperty',
          ),
          undefined,
          [
            callback,
            ts.factory.createCallExpression(
              ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('Symbol'),
                'for',
              ),
              undefined,
              [
                ts.factory.createStringLiteral(
                  'applik8s.applicationCallbackDependencies',
                ),
              ],
            ),
            ts.factory.createObjectLiteralExpression([
              ts.factory.createPropertyAssignment(
                'configurable',
                ts.factory.createTrue(),
              ),
              deferDependencyValueReads
                ? ts.factory.createPropertyAssignment(
                    'get',
                    ts.factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      ts.factory.createArrayLiteralExpression(dependencies),
                    ),
                  )
                : ts.factory.createPropertyAssignment(
                    'value',
                    ts.factory.createArrayLiteralExpression(dependencies),
                  ),
            ]),
          ],
        ),
      ),
    ];
    const functionOperation = applicationFunctionOperationMetadata(
      name,
      callable,
      sourceFile,
      moduleIdentity,
      exportedApplicationCallableNames(file).has(name),
    );
    if (functionOperation) {
      ownedStatements.push(functionOperation);
    }
    statements.set(name, ownedStatements);
  }
  return statements;
}

function applicationFunctionOperationMetadata(
  name: string,
  callable: AnalyzableApplicationCallback,
  sourceFile: string,
  moduleIdentity: string,
  exported: boolean,
): ts.Statement | undefined {
  if (!exported) return undefined;
  if (callable.parameters.length !== 1) return undefined;
  const input = applicationSchemaExpressionForType(callable.parameters[0]?.type);
  const output = applicationSchemaExpressionForReturnType(callable.type);
  if (!input || !output) return undefined;
  const callback = ts.factory.createIdentifier(name);
  const contract = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment(
      'apiVersion',
      ts.factory.createStringLiteral('applik8s.operation/v1alpha1'),
    ),
    ts.factory.createPropertyAssignment(
      'kind',
      ts.factory.createStringLiteral('applicationOperation'),
    ),
    ts.factory.createPropertyAssignment(
      'id',
      ts.factory.createStringLiteral(
        `applik8s://functions/${encodeURIComponent(`${moduleIdentity}#${name}`)}/operations/invoke`,
      ),
    ),
    ts.factory.createPropertyAssignment(
      'model',
      ts.factory.createStringLiteral('Function'),
    ),
    ts.factory.createPropertyAssignment(
      'name',
      ts.factory.createStringLiteral(name),
    ),
    ts.factory.createPropertyAssignment(
      'operation',
      ts.factory.createStringLiteral('custom'),
    ),
    ts.factory.createPropertyAssignment(
      'transport',
      ts.factory.createStringLiteral('command'),
    ),
    ts.factory.createPropertyAssignment(
      'version',
      ts.factory.createStringLiteral('v1'),
    ),
  ]);
  return ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier('Object'),
        'defineProperty',
      ),
      undefined,
      [
        callback,
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier('Symbol'),
            'for',
          ),
          undefined,
          [
            ts.factory.createStringLiteral(
              'applik8s.generatedFunctionOperation',
            ),
          ],
        ),
        ts.factory.createObjectLiteralExpression([
          ts.factory.createPropertyAssignment(
            'configurable',
            ts.factory.createTrue(),
          ),
          ts.factory.createPropertyAssignment(
            'value',
            ts.factory.createObjectLiteralExpression([
              ts.factory.createPropertyAssignment('contract', contract),
              ts.factory.createPropertyAssignment(
                'schemas',
                ts.factory.createObjectLiteralExpression([
                  ts.factory.createPropertyAssignment('input', input),
                  ts.factory.createPropertyAssignment('output', output),
                ]),
              ),
              ts.factory.createPropertyAssignment(
                'sourceFile',
                ts.factory.createStringLiteral(sourceFile),
              ),
              ts.factory.createPropertyAssignment(
                'moduleIdentity',
                ts.factory.createStringLiteral(moduleIdentity),
              ),
            ]),
          ),
        ]),
      ],
    ),
  );
}

function exportedApplicationCallableNames(
  file: ts.SourceFile,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      (
        ts.isFunctionDeclaration(statement)
        || ts.isVariableStatement(statement)
      )
      && statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      for (const name of topLevelCallableNamesForExport(statement)) {
        names.add(name);
      }
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && !statement.moduleSpecifier
    ) {
      for (const element of statement.exportClause.elements) {
        names.add(element.propertyName?.text ?? element.name.text);
      }
    }
  }
  return names;
}

function topLevelCallableNamesForExport(
  statement: ts.FunctionDeclaration | ts.VariableStatement,
): readonly string[] {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name ? [statement.name.text] : [];
  }
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

function applicationSchemaExpressionForReturnType(
  type: ts.TypeNode | undefined,
): ts.Expression | undefined {
  if (
    type
    && ts.isTypeReferenceNode(type)
    && ts.isIdentifier(type.typeName)
    && type.typeName.text === 'Promise'
  ) {
    return applicationSchemaExpressionForType(type.typeArguments?.[0]);
  }
  return applicationSchemaExpressionForType(type);
}

function applicationSchemaExpressionForType(
  type: ts.TypeNode | undefined,
): ts.Expression | undefined {
  if (!type || !ts.isTypeQueryNode(type)) return undefined;
  let expression = type.exprName;
  if (
    ts.isQualifiedName(expression)
    && expression.right.text === 'infer'
  ) {
    expression = expression.left;
  }
  return entityNameExpression(expression);
}

function entityNameExpression(
  name: ts.EntityName,
): ts.Expression {
  return ts.isIdentifier(name)
    ? ts.factory.createIdentifier(name.text)
    : ts.factory.createPropertyAccessExpression(
        entityNameExpression(name.left),
        name.right.text,
      );
}

function directApplicationCallAnalysis(
  callback: ts.Expression,
  file: ts.SourceFile,
  sourceFile: string,
  registrar: string,
  ignoreMutableModuleState = false,
): DirectApplicationCallAnalysis {
  const resolved = analyzableApplicationCallback(callback, file);
  if (!resolved) {
    if (
      ts.isIdentifier(callback)
      && applicationCallbackIsImported(callback.text, file)
    ) {
      const position = file.getLineAndCharacterOfPosition(callback.getStart(file));
      if (importedApplicationCallbackProvenance(callback, file, sourceFile)) {
        return { calls: [callback], awaited: [], returned: [] };
      }
      throw new Error(
        `${registrar} callback ${callback.getText(file)} at ${sourceFile}:${position.line + 1}:${position.character + 1} cannot be analyzed for application dependencies. Import it from a statically resolvable local module, declare it inline or in the same file, or provide an explicit authority envelope.`,
      );
    }
    return { calls: [], awaited: [], returned: [] };
  }
  const localNames = new Set<string>();
  for (const parameter of resolved.parameters) collectBindingNames(parameter.name, localNames);
  if (resolved.name) localNames.add(resolved.name.text);
  if (ts.isIdentifier(callback)) localNames.add(callback.text);
  const candidates = new Map<string, ts.Expression>();
  const awaited = new Map<string, ts.Expression>();
  const returned = new Map<string, ts.Expression>();
  const topLevelCallables = topLevelApplicationCallables(file);
  const mutableModuleState = ignoreMutableModuleState
    ? topLevelMutableApplicationBindings(file)
    : new Set<string>();
  const resolvingHelpers = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)) collectBindingNames(node.name, localNames);
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        collectBindingNames(parameter.name, localNames);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) localNames.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(node.variableDeclaration.name, localNames);
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'emitSignal'
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'workflow'
      ) {
        const signal = node.arguments[0];
        const root = signal ? expressionRootIdentifier(signal) : undefined;
        if (signal && root && !localNames.has(root.text)) {
          const identity = applicationNodeText(signal, file);
          candidates.set(identity, signal);
        }
        for (const argument of node.arguments) ts.forEachChild(argument, visit);
        return;
      }
      const candidate = directCallTarget(node.expression);
      const root = candidate ? expressionRootIdentifier(candidate) : undefined;
      if (
        candidate
        && root
        && !localNames.has(root.text)
        && !mutableModuleState.has(root.text)
        && !knownRuntimeGlobal(root.text)
      ) {
        if (
          ts.isPropertyAccessExpression(candidate)
          && candidate.name.text === 'delete'
        ) {
          const owner = candidate.expression;
          const ownerRoot = expressionRootIdentifier(owner);
          if (
            ownerRoot
            && !localNames.has(ownerRoot.text)
            && !mutableModuleState.has(ownerRoot.text)
            && !knownRuntimeGlobal(ownerRoot.text)
          ) {
            candidates.set(applicationNodeText(owner, file), owner);
          }
        }
        const helperName = ts.isIdentifier(candidate)
          ? candidate.text
          : undefined;
        const helper = helperName
          ? topLevelCallables.get(helperName)
          : undefined;
        if (helper && helperName) {
          if (resolvingHelpers.has(helperName)) {
            const position = file.getLineAndCharacterOfPosition(
              candidate.getStart(file),
            );
            throw new Error(
              `${registrar} callback helper graph at ${sourceFile}:${position.line + 1}:${position.character + 1} contains a cycle through ${helperName}.`,
            );
          }
          resolvingHelpers.add(helperName);
          const helperLocals = new Set<string>();
          for (const parameter of helper.parameters) {
            collectBindingNames(parameter.name, helperLocals);
          }
          if (helper.name) helperLocals.add(helper.name.text);
          const addedHelperLocals = [...helperLocals].filter(
            (name) => !localNames.has(name),
          );
          for (const name of addedHelperLocals) localNames.add(name);
          try {
            visit(helper.body);
          } finally {
            for (const name of addedHelperLocals) localNames.delete(name);
            resolvingHelpers.delete(helperName);
          }
          return;
        }
        const identity = applicationNodeText(candidate, file);
        candidates.set(identity, candidate);
        if (applicationCallIsAwaited(node)) awaited.set(identity, candidate);
        if (applicationCallIsReturned(node, helperOwner(node))) {
          returned.set(identity, candidate);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(resolved.body);
  return {
    calls: [...candidates.values()],
    awaited: [...awaited.values()],
    returned: [...returned.values()],
  };
}

function topLevelMutableApplicationBindings(file: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement)
      || (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) continue;
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
  }
  return names;
}

function topLevelApplicationCallables(
  file: ts.SourceFile,
): ReadonlyMap<string, AnalyzableApplicationCallback> {
  const callables = new Map<string, AnalyzableApplicationCallback>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      callables.set(
        statement.name.text,
        statement as ts.FunctionDeclaration & { readonly body: ts.Block },
      );
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.initializer
        && (
          ts.isArrowFunction(declaration.initializer)
          || ts.isFunctionExpression(declaration.initializer)
        )
      ) {
        callables.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return callables;
}

function helperOwner(node: ts.Node): ts.SignatureDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function analyzableApplicationCallback(
  callback: ts.Expression,
  file: ts.SourceFile,
): AnalyzableApplicationCallback | undefined {
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) return callback;
  if (!ts.isIdentifier(callback)) return undefined;
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === callback.text
      && statement.body
    ) {
      return statement as ts.FunctionDeclaration & { readonly body: ts.Block };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === callback.text
        && declaration.initializer
        && (
          ts.isArrowFunction(declaration.initializer)
          || ts.isFunctionExpression(declaration.initializer)
        )
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

function applicationCallbackIsImported(
  name: string,
  file: ts.SourceFile,
): boolean {
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      return false;
    }
    if (statement.importClause.name?.text === name) return true;
    const bindings = statement.importClause.namedBindings;
    if (!bindings) return false;
    if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;
    return bindings.elements.some(
      (element) => element.name.text === name,
    );
  });
}

function applicationCallIsAwaited(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (
    current.parent
    && (
      ts.isParenthesizedExpression(current.parent)
      || ts.isAsExpression(current.parent)
      || ts.isTypeAssertionExpression(current.parent)
      || ts.isNonNullExpression(current.parent)
      || ts.isSatisfiesExpression(current.parent)
    )
  ) {
    current = current.parent;
  }
  return Boolean(current.parent && ts.isAwaitExpression(current.parent));
}

function applicationCallIsReturned(
  call: ts.CallExpression,
  owner: ts.SignatureDeclaration | undefined,
): boolean {
  let current: ts.Node = call;
  while (
    current.parent
    && (
      ts.isParenthesizedExpression(current.parent)
      || ts.isAsExpression(current.parent)
      || ts.isTypeAssertionExpression(current.parent)
      || ts.isNonNullExpression(current.parent)
      || ts.isSatisfiesExpression(current.parent)
    )
  ) {
    current = current.parent;
  }
  if (current.parent && ts.isReturnStatement(current.parent)) return true;
  return Boolean(
    owner
    && ts.isArrowFunction(owner)
    && owner.body === current,
  );
}

function directCallTarget(expression: ts.LeftHandSideExpression): ts.Expression | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression) && !ts.isCallExpression(expression.expression)) {
    if (new Set([
      'emit',
      'reconcile',
      'start',
      'schedule',
      'signal',
      'put',
      'get',
      'find',
      'head',
      'signUpload',
      'signDownload',
      'rebuild',
      'retire',
      // Drizzle-compatible database handles expose guarded getters. Capture
      // the handle itself; evaluating Database.select while instrumenting the
      // authoring module would execute the managed-runtime guard.
      'select',
      'transaction',
      'execute',
    ]).has(expression.name.text)) {
      return expression.expression;
    }
    return expression;
  }
  return undefined;
}

function expressionRootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  return ts.isPropertyAccessExpression(expression)
    ? expressionRootIdentifier(expression.expression)
    : undefined;
}

function collectBindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, target);
  }
}

function knownRuntimeGlobal(name: string): boolean {
  return new Set([
    'Array',
    'BigInt',
    'Boolean',
    'Date',
    'Error',
    'JSON',
    'Map',
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
  ]).has(name);
}

/**
 * Callback instrumentation may visit an expression after one of its children
 * has already been rewritten. TypeScript then returns a synthesized parent
 * whose `getText()` assertion fails even though its original authored node is
 * still attached. Prefer that authored node and fall back to printing only
 * when no source-backed original exists.
 */
function applicationNodeText(node: ts.Node, file: ts.SourceFile): string {
  const authored = ts.getOriginalNode(node);
  if (authored.pos >= 0 && authored.end >= authored.pos) {
    return authored.getText(file);
  }
  return ts.createPrinter({ removeComments: true }).printNode(
    ts.EmitHint.Unspecified,
    node,
    file,
  );
}

function isApplicationCallbackExpression(expression: ts.Expression): boolean {
  return (
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  );
}

function decorateApplicationCallbackObject(
  object: ts.ObjectLiteralExpression,
  properties: readonly string[],
  file: ts.SourceFile,
  sourceFile: string,
  registrar: string,
): ts.ObjectLiteralExpression {
  const direct = new Set(properties.filter((property) => !property.includes('.')));
  const nested = new Map<string, string[]>();
  for (const property of properties.filter((candidate) => candidate.includes('.'))) {
    const [parent = '', child = ''] = property.split('.');
    nested.set(parent, [...(nested.get(parent) ?? []), child]);
  }
  const mapped = object.properties.map((property): ts.ObjectLiteralElementLike => {
    const name = objectPropertyName(property.name);
    if (!name) return property;
    if (direct.has(name)) return decorateApplicationCallbackProperty(property, file, sourceFile, registrar, name);
    const children = nested.get(name);
    if (!children || !ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer))
      return property;
    return ts.factory.updatePropertyAssignment(
      property,
      property.name,
      decorateApplicationCallbackObject(property.initializer, children, file, sourceFile, registrar),
    );
  });
  return ts.factory.updateObjectLiteralExpression(object, mapped);
}

function decorateApplicationCallbackProperty(
  property: ts.ObjectLiteralElementLike,
  file: ts.SourceFile,
  sourceFile: string,
  registrar: string,
  name: string,
): ts.ObjectLiteralElementLike {
  if (ts.isPropertyAssignment(property)) {
    if (!isApplicationCallbackExpression(property.initializer)) return property;
    return ts.factory.updatePropertyAssignment(
      property,
      property.name,
      decorateApplicationCallbackExpression(property.initializer, file, sourceFile, registrar, name),
    );
  }
  if (ts.isMethodDeclaration(property) && property.body) {
    const modifiers = property.modifiers?.filter(ts.isModifier);
    const expression = ts.factory.createFunctionExpression(
      modifiers,
      property.asteriskToken,
      undefined,
      property.typeParameters,
      property.parameters,
      property.type,
      property.body,
    );
    const methodSource = property
      .getText(file)
      .replace(
        /^(async\s+)?[$A-Z_a-z][$\w]*\s*\(/,
        (_match, asyncPrefix: string | undefined) => `${asyncPrefix ?? ''}function (`,
      );
    return ts.factory.createPropertyAssignment(
      property.name,
      decorateApplicationCallbackExpression(expression, file, sourceFile, registrar, name, methodSource),
    );
  }
  return property;
}

function decorateApplicationCallbackExpression(
  expression: ts.Expression,
  file: ts.SourceFile,
  sourceFile: string,
  registrar: string,
  property: string,
  explicitSource?: string,
): ts.Expression {
  const provenance =
    importedApplicationCallbackProvenance(expression, file, sourceFile)
    ?? localApplicationCallbackProvenance(expression, file, sourceFile);
  const metadataFile = provenance?.file ?? sourceFile;
  const position = provenance?.position ?? file.getLineAndCharacterOfPosition(expression.getStart(file));
  const candidate = ts.factory.createIdentifier('__applik8sApplicationCallback');
  const dependencyAnalysis =
    ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
      ? directApplicationCallAnalysis(expression, file, sourceFile, registrar)
      : undefined;
  const originalSource =
    explicitSource ??
    provenance?.source ??
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
      ? applicationNodeText(expression, file)
      : undefined);
  const authoredName = applicationCallbackExpressionName(expression);
  const metadata = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(metadataFile)),
    ts.factory.createPropertyAssignment('line', ts.factory.createNumericLiteral(position.line + 1)),
    ts.factory.createPropertyAssignment('column', ts.factory.createNumericLiteral(position.character + 1)),
    ts.factory.createPropertyAssignment('registrar', ts.factory.createStringLiteral(registrar)),
    ts.factory.createPropertyAssignment('property', ts.factory.createStringLiteral(property)),
    ...(authoredName
      ? [ts.factory.createPropertyAssignment('name', ts.factory.createStringLiteral(authoredName))]
      : []),
    ...(originalSource
      ? [ts.factory.createPropertyAssignment('source', ts.factory.createStringLiteral(originalSource))]
      : []),
  ]);
  const sourceDecorated = ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'defineProperty'),
    undefined,
    [
      candidate,
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'),
        undefined,
        [ts.factory.createStringLiteral('applik8s.applicationCallbackSource')],
      ),
      ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment('configurable', ts.factory.createTrue()),
        ts.factory.createPropertyAssignment('value', metadata),
      ]),
    ],
  );
  const decorated = dependencyAnalysis && dependencyAnalysis.calls.length > 0
    ? ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier('Object'),
          'defineProperty',
        ),
        undefined,
        [
          sourceDecorated,
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('Symbol'),
              'for',
            ),
            undefined,
            [
              ts.factory.createStringLiteral(
                'applik8s.applicationCallbackDependencies',
              ),
            ],
          ),
          ts.factory.createObjectLiteralExpression([
            ts.factory.createPropertyAssignment(
              'configurable',
              ts.factory.createTrue(),
            ),
            ts.factory.createPropertyAssignment(
              'value',
              ts.factory.createArrayLiteralExpression(
                dependencyAnalysis.calls.map((dependency) =>
                  ts.factory.createObjectLiteralExpression([
                    ts.factory.createPropertyAssignment(
                      'identifier',
                      ts.factory.createStringLiteral(applicationNodeText(dependency, file)),
                    ),
                    ts.factory.createPropertyAssignment('value', dependency),
                    ts.factory.createPropertyAssignment(
                      'awaited',
                      dependencyAnalysis.awaited.some(
                        (candidate) =>
                          applicationNodeText(candidate, file) === applicationNodeText(dependency, file),
                      )
                        ? ts.factory.createTrue()
                        : ts.factory.createFalse(),
                    ),
                    ts.factory.createPropertyAssignment(
                      'returned',
                      dependencyAnalysis.returned.some(
                        (candidate) =>
                          applicationNodeText(candidate, file) === applicationNodeText(dependency, file),
                      )
                        ? ts.factory.createTrue()
                        : ts.factory.createFalse(),
                    ),
                  ]),
                ),
              ),
            ),
          ]),
        ],
      )
    : sourceDecorated;
  const alreadyDecorated = ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Object'), 'hasOwn'),
    undefined,
    [
      candidate,
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Symbol'), 'for'),
        undefined,
        [ts.factory.createStringLiteral('applik8s.applicationCallbackSource')],
      ),
    ],
  );
  const decorator = ts.factory.createArrowFunction(
    undefined,
    undefined,
    [ts.factory.createParameterDeclaration(undefined, undefined, candidate)],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createConditionalExpression(
      alreadyDecorated,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      candidate,
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      decorated,
    ),
  );
  return ts.factory.createCallExpression(ts.factory.createParenthesizedExpression(decorator), undefined, [expression]);
}

function applicationCallbackExpressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isFunctionExpression(expression) && expression.name) return expression.name.text;
  return undefined;
}

interface ApplicationCallbackProvenance {
  readonly file: string;
  readonly position: ts.LineAndCharacter;
  readonly source?: string;
}

function localApplicationCallbackProvenance(
  expression: ts.Expression,
  file: ts.SourceFile,
  sourceFile: string,
): ApplicationCallbackProvenance | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = file.statements.find((statement) =>
    runtimeCallbackDeclarationNames(statement).includes(expression.text));
  if (!declaration) return undefined;
  const source = callbackDeclarationExpression(declaration, expression.text, file);
  return {
    file: sourceFile,
    position: file.getLineAndCharacterOfPosition(declaration.getStart(file)),
    ...(source ? { source } : {}),
  };
}

/**
 * Imported callbacks retain the defining module, not merely the registrar
 * callsite. The dependency serializer needs that provenance to close over
 * same-module helper declarations without guessing among identically named
 * helpers elsewhere in a modular application.
 */
function importedApplicationCallbackProvenance(
  expression: ts.Expression,
  file: ts.SourceFile,
  sourceFile: string,
): ApplicationCallbackProvenance | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause)
      continue;
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
  const element = clause.namedBindings.elements.find(
    (candidate) => !candidate.isTypeOnly && candidate.name.text === localName,
  );
  return element ? (element.propertyName?.text ?? element.name.text) : undefined;
}

function callbackDeclarationProvenance(
  modulePath: string,
  exportedName: string,
  visited: Set<string>,
): ApplicationCallbackProvenance | undefined {
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
    if (
      exportedName === 'default' &&
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      const expression = callbackDeclarationExpression(statement, exportedName, file);
      return {
        file: absolute,
        position: file.getLineAndCharacterOfPosition(statement.getStart(file)),
        ...(expression ? { source: expression } : {}),
      };
    }
    if (
      runtimeCallbackDeclarationNames(statement).includes(exportedName) &&
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const expression = callbackDeclarationExpression(statement, exportedName, file);
      return {
        file: absolute,
        position: file.getLineAndCharacterOfPosition(statement.getStart(file)),
        ...(expression ? { source: expression } : {}),
      };
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const element = statement.exportClause.elements.find((candidate) => candidate.name.text === exportedName);
      if (!element) continue;
      const original = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveCallbackModule(absolute, statement.moduleSpecifier.text);
        return target ? callbackDeclarationProvenance(target, original, visited) : undefined;
      }
      const declaration = file.statements.find((candidate) =>
        runtimeCallbackDeclarationNames(candidate).includes(original),
      );
      if (!declaration) return undefined;
      const source = callbackDeclarationExpression(declaration, original, file);
      return {
        file: absolute,
        position: file.getLineAndCharacterOfPosition(declaration.getStart(file)),
        ...(source ? { source } : {}),
      };
    }
  }
  return undefined;
}

function callbackDeclarationExpression(
  statement: ts.Statement,
  name: string,
  file: ts.SourceFile,
): string | undefined {
  if (ts.isFunctionDeclaration(statement)) {
    if (name !== 'default' && statement.name?.text !== name) return undefined;
    return statement.getText(file).replace(/^\s*export\s+(?:default\s+)?/, '');
  }
  if (!ts.isVariableStatement(statement)) return undefined;
  const declaration = statement.declarationList.declarations.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
  );
  return declaration?.initializer?.getText(file);
}

function resolveCallbackModule(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined;
  const base = resolve(dirname(importer), specifier);
  const extension = extname(base);
  const candidates = [
    base,
    ...(extension === '.js' || extension === '.mjs' || extension === '.cjs'
      ? [`${base.slice(0, -extension.length)}.ts`, `${base.slice(0, -extension.length)}.tsx`]
      : []),
    ...(!extension
      ? [
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.js`,
          join(base, 'index.ts'),
          join(base, 'index.tsx'),
          join(base, 'index.js'),
        ]
      : []),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function runtimeCallbackDeclarationNames(statement: ts.Statement): readonly string[] {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name)
    return [statement.name.text];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) =>
    ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
  );
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
