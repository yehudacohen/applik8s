import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const roots = ['packages', 'examples', 'scripts', 'vitest.config.ts', 'vitest.e2e.config.ts'];
const failures = [];

for (const root of roots) {
  collectFiles(root).forEach(checkFile);
}

if (failures.length > 0) {
  console.error('Typecast audit failed. Add a nearby comment containing "typecast:" with the reason and purpose.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith('.ts') ? [path] : [];
  }

  const files = [];
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.applik8s' || entry === '.output') {
      continue;
    }
    if (entry === 'routeTree.gen.ts') continue;
    files.push(...collectFiles(join(path, entry)));
  }
  return files;
}

function checkFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = sourceText.split(/\r?\n/);
  const fileBoundary = lines.slice(0, 10).join('\n').includes('typecast-file-boundary:');

  const visit = (node) => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (!fileBoundary && !hasTypecastAnnotation(lines, position.line) && !hasTypecastBoundary(node, sourceFile, lines)) {
        const kind = ts.isNonNullExpression(node) ? 'non-null assertion' : 'type assertion';
        failures.push(`${filePath}:${position.line + 1}:${position.character + 1} ${kind}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function hasTypecastAnnotation(lines, lineIndex) {
  const currentLine = lines[lineIndex] ?? '';
  const previousLine = lines[lineIndex - 1] ?? '';
  return currentLine.includes('typecast:') || previousLine.includes('typecast:');
}

function hasTypecastBoundary(node, sourceFile, lines) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      const line = sourceFile.getLineAndCharacterOfPosition(current.getStart(sourceFile)).line;
      const leading = lines.slice(Math.max(0, line - 4), line + 1).join('\n');
      if (leading.includes('typecast-boundary:')) return true;
    }
    current = current.parent;
  }
  return false;
}
