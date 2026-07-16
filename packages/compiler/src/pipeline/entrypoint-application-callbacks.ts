import ts from 'typescript';

const applicationCallbackProperties: Readonly<Record<string, readonly string[]>> = {
  query: ['authorize', 'run'],
  stream: ['partitionBy', 'authorize'],
  subscription: ['authorize'],
  projection: ['project'],
  gateway: ['authorizeCommand', 'deployment.authenticate'],
};

/** Preserves callback source provenance while esbuild evaluates an application entrypoint. */
export function decorateApplicationCallbackArguments(node: ts.CallExpression, file: ts.SourceFile, sourceFile: string, visit: ts.Visitor): readonly ts.Expression[] | undefined {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'createApplik8sStart') {
    return node.arguments.map((argument, index) => {
      // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      if (index !== 0 || !ts.isObjectLiteralExpression(visited)) return visited;
      return decorateApplicationCallbackObject(visited, ['authenticate'], file, sourceFile, 'createApplik8sStart');
    });
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (
    node.expression.name.text === 'from'
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'RequestIdentity'
  ) {
    return node.arguments.map((argument, index) => {
      // typecast: RequestIdentity.from's first argument is the authentication callback expression.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 0
        ? decorateApplicationCallbackExpression(visited, file, sourceFile, 'RequestIdentity', 'authenticate')
        : visited;
    });
  }
  const registrar = node.expression.name.text;
  if (registrar === 'task' || registrar === 'workflow') {
    return node.arguments.map((argument, index) => {
      // typecast: the TypeScript visitor preserves expression arguments while recursively instrumenting their children.
      const visited = ts.visitNode(argument, visit) as ts.Expression;
      return index === 2 ? decorateApplicationCallbackExpression(visited, file, sourceFile, registrar, 'handler') : visited;
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
  const position = file.getLineAndCharacterOfPosition(expression.getStart(file));
  const candidate = ts.factory.createIdentifier('__applik8sApplicationCallback');
  const originalSource = explicitSource ?? (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) ? expression.getText(file) : undefined);
  const metadata = ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(sourceFile)),
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

function objectPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
