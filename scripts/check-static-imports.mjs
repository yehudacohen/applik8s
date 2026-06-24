import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const roots = ['packages', 'examples', 'scripts', 'vitest.config.ts', 'vitest.e2e.config.ts'];
const failures = [];

for (const root of roots) {
  collectFiles(root).forEach(checkFile);
}

if (failures.length > 0) {
  console.error('Static import audit failed. Prefer static imports. Add a nearby "static-import-exception:" comment only when dynamic loading is required.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.mjs') ? [path] : [];
  }

  const files = [];
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    files.push(...collectFiles(join(path, entry)));
  }
  return files;
}

function checkFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const lines = sourceText.split(/\r?\n/);

  const visit = (node) => {
    if (isDynamicImport(node) || isRequireCall(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (!hasStaticImportException(lines, position.line)) {
        const kind = isDynamicImport(node) ? 'dynamic import()' : 'CommonJS require()';
        failures.push(`${filePath}:${position.line + 1}:${position.character + 1} ${kind}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function isDynamicImport(node) {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isRequireCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function hasStaticImportException(lines, lineIndex) {
  const currentLine = lines[lineIndex] ?? '';
  const previousLine = lines[lineIndex - 1] ?? '';
  return currentLine.includes('static-import-exception:') || previousLine.includes('static-import-exception:');
}
