import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templateRoot = resolve(root, 'packages/start-agentic/src/templates/product');
const researchTemplateRoot = resolve(root, 'packages/start-agentic/src/templates/research');
const budget = JSON.parse(await readFile(resolve(root, 'docs/v07-agentic-start-source-budget.json'), 'utf8'));
const files = await sourceFiles(templateRoot);
const findings = [];
const counts = { features: 0, routes: 0, design: 0, deployment: 0, other: 0 };
const featureCounts = new Map();
const ownership = {
  applicationBehavior: { files: 0, nonblankLines: 0 },
  routeDeclaration: { files: 0, nonblankLines: 0 },
  designPrimitive: { files: 0, nonblankLines: 0 },
  deploymentScaffold: { files: 0, nonblankLines: 0 },
};
const sourceByPath = new Map();

for (const absolute of files) {
  const path = relative(templateRoot, absolute).replaceAll('\\', '/');
  const source = await readFile(absolute, 'utf8');
  sourceByPath.set(path, source);
  const nonblank = source.split(/\r?\n/u).filter(line => line.trim()).length;
  if (nonblank > budget.maximumNonblankLines) {
    findings.push(`${path} has ${nonblank} nonblank lines; maximum is ${budget.maximumNonblankLines}.`);
  }
  const category = sourceCategory(path);
  counts[category] += 1;
  const owner = sourceOwner(path);
  ownership[owner].files += 1;
  ownership[owner].nonblankLines += nonblank;
  if (
    owner === 'routeDeclaration'
    && nonblank > budget.ownership.maximumRouteDeclarationNonblankLines
  ) findings.push(`${path} contains ${nonblank} route lines; maximum is ${budget.ownership.maximumRouteDeclarationNonblankLines}. Move reusable route behavior into a maintained controller.`);
  if (
    owner === 'designPrimitive'
    && nonblank > budget.ownership.maximumDesignPrimitiveNonblankLines
  ) findings.push(`${path} contains ${nonblank} design lines; maximum is ${budget.ownership.maximumDesignPrimitiveNonblankLines}. Split application composition from the source-owned primitive.`);
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

for (const retired of [
  'src/features/billing-contracts.ts.tmpl',
  'src/features/lifecycle/schema.ts.tmpl',
]) {
  if (sourceByPath.has(retired)) {
    findings.push(`${retired} duplicates maintained framework mechanism inside generated source.`);
  }
}
const conversationView = sourceByPath.get('src/features/conversations/view.tsx.tmpl') ?? '';
if (!conversationView.includes('persistence: true')) {
  findings.push('conversation view must use TanStack server-authoritative persistence.');
}
if (/hydrateApplicationConversationMessage|initialMessages|setMessages/u.test(conversationView)) {
  findings.push('conversation view reconstructs a parallel transcript instead of using TanStack persistence.');
}
const researchConversationView = await readFile(
  resolve(researchTemplateRoot, 'src/features/research/view.tsx.tmpl'),
  'utf8',
);
if (!researchConversationView.includes('persistence: true')) {
  findings.push('research conversation view must use TanStack server-authoritative persistence.');
}
if (/hydrateApplicationConversationMessage|initialMessages|setMessages/u.test(researchConversationView)) {
  findings.push('research conversation view reconstructs a parallel transcript instead of using TanStack persistence.');
}
const billing = sourceByPath.get('src/features/billing.tsx.tmpl') ?? '';
if (!billing.includes("from '@applik8s/billing'")) {
  findings.push('billing feature does not consume maintained billing contracts.');
}
const lifecycle = sourceByPath.get('src/features/lifecycle/model.ts.tmpl') ?? '';
if (!lifecycle.includes("from '@applik8s/data-lifecycle'")) {
  findings.push('data lifecycle feature duplicates the maintained request model.');
}
const library = sourceByPath.get('src/features/library/model.ts.tmpl') ?? '';
if (!library.includes('listApplicationArtifacts')) {
  findings.push('Library does not delegate generic artifact querying to @applik8s/artifacts.');
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
if (ownership.applicationBehavior.files > budget.ownership.maximumApplicationBehaviorFiles) {
  findings.push(`application behavior contains ${ownership.applicationBehavior.files} files; maximum is ${budget.ownership.maximumApplicationBehaviorFiles}.`);
}
if (ownership.applicationBehavior.nonblankLines > budget.ownership.maximumApplicationBehaviorNonblankLines) {
  findings.push(`application behavior contains ${ownership.applicationBehavior.nonblankLines} nonblank lines; maximum is ${budget.ownership.maximumApplicationBehaviorNonblankLines}.`);
}

const definition = await readFile(resolve(root, 'packages/start-agentic/src/definition.ts'), 'utf8');
const inventory = [
  '.applik8s-start.json',
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
console.log(`Agentic Start source budget passed: ${inventory.length} generated files; ${ownership.applicationBehavior.files} application-behavior files / ${ownership.applicationBehavior.nonblankLines} nonblank lines; route, design, deployment, largest-file, and category ceilings hold.`);

function sourceCategory(path) {
  if (path.startsWith('src/features/')) return 'features';
  if (path.startsWith('src/routes/')) return 'routes';
  if (path.startsWith('src/components/') || path === 'src/brand.ts.tmpl' || path === 'src/styles.css') return 'design';
  if (path.startsWith('kubernetes/') || path.startsWith('drizzle/') || path === '.env.example' || path === 'README.md') return 'deployment';
  return 'other';
}

function sourceOwner(path) {
  if (path.startsWith('src/routes/')) return 'routeDeclaration';
  if (
    path.startsWith('src/components/')
    || path === 'components.json'
    || path === 'src/lib/utils.ts.tmpl'
    || path === 'src/brand.ts.tmpl'
    || path === 'src/styles.css'
  ) return 'designPrimitive';
  if (
    path.startsWith('kubernetes/')
    || path.startsWith('drizzle/')
    || path === '.env.example'
    || path === 'README.md'
    || path === 'drizzle.config.ts.tmpl'
    || path === 'vite.config.ts.tmpl'
    || path === 'package.json'
  ) return 'deploymentScaffold';
  return 'applicationBehavior';
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
