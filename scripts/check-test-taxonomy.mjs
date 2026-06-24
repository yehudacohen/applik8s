import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages', 'examples'];
const allowedSuffixes = [
  '.character.test.ts',
  '.proxy.test.ts',
  '.vertical.test.ts',
  '.e2e.test.ts',
];
const failures = [];

for (const root of roots) {
  collectFiles(root).forEach(checkFile);
}

if (failures.length > 0) {
  console.error('Test taxonomy audit failed. Use one of: .character.test.ts, .proxy.test.ts, .vertical.test.ts, .e2e.test.ts');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function collectFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith('.test.ts') || path.endsWith('.spec.ts') ? [path] : [];
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
  if (!allowedSuffixes.some((suffix) => filePath.endsWith(suffix))) {
    failures.push(filePath);
  }
}
