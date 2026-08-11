import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templateRoot = resolve(root, 'packages/start-agentic/src/templates/product');
const budget = JSON.parse(await readFile(resolve(root, 'docs/v07-agentic-start-source-budget.json'), 'utf8'));
const files = await sourceFiles(templateRoot);
const findings = [];
const counts = { features: 0, routes: 0, design: 0, deployment: 0, other: 0 };
const featureCounts = new Map();

for (const absolute of files) {
  const path = relative(templateRoot, absolute).replaceAll('\\', '/');
  const source = await readFile(absolute, 'utf8');
  const nonblank = source.split(/\r?\n/u).filter(line => line.trim()).length;
  if (nonblank > budget.maximumNonblankLines) {
    findings.push(`${path} has ${nonblank} nonblank lines; maximum is ${budget.maximumNonblankLines}.`);
  }
  const category = sourceCategory(path);
  counts[category] += 1;
  const feature = /^src\/features\/([^/]+)\//u.exec(path)?.[1];
  if (feature) featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
  const browserOwned = path.startsWith('src/routes/')
    || path.startsWith('src/components/')
    || /\/view\.tsx\.tmpl$/u.test(path)
    || path === 'src/features/account/identity-flow.tsx.tmpl';
  if (
    browserOwned
    && /from ['"](?:\.\.\/)+(?:installation|providers|modules)['"]/u.test(source)
  ) findings.push(`${path} imports server/deployment composition into browser-owned UI.`);
}

for (const [category, value] of Object.entries(counts)) {
  const categoryBudget = budget.categories[category];
  if (!categoryBudget || value > categoryBudget.maximum) {
    findings.push(`${category} contains ${value} files; reviewed maximum is ${categoryBudget?.maximum ?? 0}.`);
  }
}
for (const [feature, count] of featureCounts) {
  if (count > budget.maximumFilesPerFeature) {
    findings.push(`feature ${feature} contains ${count} files; maximum is ${budget.maximumFilesPerFeature}.`);
  }
}

const definition = await readFile(resolve(root, 'packages/start-agentic/src/definition.ts'), 'utf8');
const inventory = [
  '.applik8s/start-lineage.json',
  'package.json',
  ...files.map(file => relative(templateRoot, file).replaceAll('\\', '/').replace(/\.tmpl$/u, '')),
].sort();
for (const path of inventory) {
  if (!definition.includes(`'${path}'`)) findings.push(`definition inventory omits ${path}.`);
}
const ceiling = Number(/maximumApplicationFiles:\s*(\d+)/u.exec(definition)?.[1]);
if (ceiling !== inventory.length) {
  findings.push(`definition maximumApplicationFiles is ${ceiling}; exact reviewed inventory is ${inventory.length}.`);
}

if (findings.length > 0) {
  throw new Error(`Agentic Start source budget failed:\n- ${findings.join('\n- ')}`);
}
console.log(`Agentic Start source budget passed: ${inventory.length} generated files; largest-file and category ceilings hold.`);

function sourceCategory(path) {
  if (path.startsWith('src/features/')) return 'features';
  if (path.startsWith('src/routes/')) return 'routes';
  if (path.startsWith('src/components/') || path === 'src/brand.ts.tmpl' || path === 'src/styles.css') return 'design';
  if (path.startsWith('kubernetes/') || path.startsWith('drizzle/') || path === '.env.example' || path === 'README.md') return 'deployment';
  return 'other';
}

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
