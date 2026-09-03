// typecast-file-boundary: The documentation gate owns this static checked-in path/content contract and narrows it only for deterministic iteration.
import { readFile } from 'node:fs/promises';

const requiredPages = {
  'docs-site/src/content/docs/index.mdx': [
    'Build distributed TypeScript applications as one typed application graph',
    'v0.9 preview',
    'link: /docs/preview/v0.9/start-here/',
    'link: /docs/preview/v0.9/build-applications/operations-and-effects/',
  ],
  'docs-site/src/content/docs/start-here.mdx': [
    'What is Applik8s?',
    "application.profile('local'",
    'implemented as a preview contract',
  ],
  'docs-site/src/content/docs/build-applications/operations-and-effects.mdx': [
    'await Billing.changePlan',
    'defineEffectContract',
    '`unknown` is a real durable state',
    'There is no public `operation()` or `effect()` registrar',
  ],
  'docs-site/src/content/docs/build-applications/profiles-and-providers.mdx': [
    "application.profile('production'",
    "Database.postgres",
    "config.env.url('DATABASE_ENDPOINT')",
    'never reads or serializes the Secret value',
  ],
  'docs-site/src/content/docs/understand/implementation-plans.mdx': [
    'Implementation:',
    'fails before mutation',
    'application-implementation-plans.json',
    'explicit migration before 1.0',
  ],
  'docs-site/src/content/docs/understand/journeys.mdx': [
    "context.browser()",
    "browser.expectText(",
    '`blocked`, never',
    'fails closed and is discarded',
  ],
  'docs-site/src/content/docs/build-applications/decision-guide.mdx': [
    'Choose the right primitive',
    '`Model.create/update/delete`',
    '`workflow(...)`',
  ],
  'docs-site/src/content/docs/build-applications/models-queries-views.mdx': [
    'Models, queries, and views',
    '`Entry.create(...)`',
    'bounded one-time query',
    'Views are persistent application read contracts',
  ],
  'docs-site/src/content/docs/build-applications/managed-models-and-reconciliation.mdx': [
    'Model.on.reconcile',
    'ManagedModelStore.kubernetes',
    'at least once',
  ],
  'docs-site/src/content/docs/build-applications/batch-and-stream-processing.mdx': [
    'Query.onBatch',
    'Stream.onBatch',
    'monotonic frontier',
  ],
  'docs-site/src/content/docs/build-applications/jobs-workflows-sagas.mdx': [
    'application.job',
    'application.workflow',
    'application.transaction.saga',
    'unknown outcome',
  ],
  'docs-site/src/content/docs/build-applications/ml-models.mdx': [
    'ML.model',
    'artifact digest',
    "partialFailure: 'collect'",
  ],
  'docs-site/src/content/docs/events-reactive-systems.mdx': ['Events and reactive systems', 'output.upsert'],
  'docs-site/src/content/docs/distributed-behavior.mdx': ['Jobs, workflows, Sagas, and actors', 'Schedules select an execution family'],
  'docs-site/src/content/docs/data-analytics.mdx': ['Transactional, streaming, and analytical data', 'Cross-store work'],
  'docs-site/src/content/docs/ai-agents.mdx': ['Agents with evidence and authority', 'causal principal lineage'],
  'docs-site/src/content/docs/security.mdx': ['Identity, authority, and secrets', 'Clients provide application input'],
  'docs-site/src/content/docs/infrastructure-providers.mdx': ['TypeKro authors Kubernetes resources', 'External bindings contribute no infrastructure'],
  'docs-site/src/content/docs/infrastructure-providers/provider-guarantees.mdx': ['Compare provider guarantees', 'does not upgrade maturity'],
  'docs-site/src/content/docs/understand/troubleshooting.mdx': ['V09_MIGRATION_EXECUTION_UNQUALIFIED', 'JOURNEY_PROVIDER_INCOMPATIBLE'],
  'docs-site/src/content/docs/examples-starts.mdx': ['GuestBook', 'Chirp', 'Agentic Start'],
  'docs-site/src/content/docs/reference/public-contracts.mdx': [
    'v0.9-public-contract.json',
    'does not upgrade',
  ],
  'docs-site/src/content/docs/upgrade/v071-to-v09.mdx': [
    '--migrate-from 0.7.1',
    'same complete stack-identity lease',
    'both direct and KRO deployments',
    'v0.8 engineering line',
  ],
} as const;

const substantivePages: Readonly<Record<string, {
  readonly minimumLines: number;
  readonly minimumTypeScriptExamples: number;
  readonly minimumSections: number;
}>> = {
  'docs-site/src/content/docs/build-applications/decision-guide.mdx': { minimumLines: 50, minimumTypeScriptExamples: 0, minimumSections: 3 },
  'docs-site/src/content/docs/build-applications/models-queries-views.mdx': { minimumLines: 70, minimumTypeScriptExamples: 3, minimumSections: 4 },
  'docs-site/src/content/docs/build-applications/managed-models-and-reconciliation.mdx': { minimumLines: 75, minimumTypeScriptExamples: 2, minimumSections: 4 },
  'docs-site/src/content/docs/build-applications/batch-and-stream-processing.mdx': { minimumLines: 85, minimumTypeScriptExamples: 2, minimumSections: 4 },
  'docs-site/src/content/docs/build-applications/jobs-workflows-sagas.mdx': { minimumLines: 100, minimumTypeScriptExamples: 3, minimumSections: 4 },
  'docs-site/src/content/docs/build-applications/ml-models.mdx': { minimumLines: 70, minimumTypeScriptExamples: 2, minimumSections: 4 },
  'docs-site/src/content/docs/build-applications/operations-and-effects.mdx': { minimumLines: 80, minimumTypeScriptExamples: 2, minimumSections: 3 },
  'docs-site/src/content/docs/events-reactive-systems.mdx': { minimumLines: 75, minimumTypeScriptExamples: 4, minimumSections: 4 },
  'docs-site/src/content/docs/ai-agents.mdx': { minimumLines: 65, minimumTypeScriptExamples: 1, minimumSections: 4 },
  'docs-site/src/content/docs/security.mdx': { minimumLines: 65, minimumTypeScriptExamples: 2, minimumSections: 5 },
  'docs-site/src/content/docs/infrastructure-providers.mdx': { minimumLines: 65, minimumTypeScriptExamples: 1, minimumSections: 5 },
  'docs-site/src/content/docs/infrastructure-providers/provider-guarantees.mdx': { minimumLines: 65, minimumTypeScriptExamples: 0, minimumSections: 5 },
  'docs-site/src/content/docs/examples-starts.mdx': { minimumLines: 65, minimumTypeScriptExamples: 0, minimumSections: 4 },
  'docs-site/src/content/docs/reference/public-contracts.mdx': { minimumLines: 50, minimumTypeScriptExamples: 0, minimumSections: 3 },
  'docs-site/src/content/docs/understand/troubleshooting.mdx': { minimumLines: 65, minimumTypeScriptExamples: 0, minimumSections: 8 },
};

const findings: string[] = [];
for (const [path, required] of Object.entries(requiredPages)) {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    findings.push(`V09_DOCUMENTATION_PAGE_MISSING: ${path}`);
    continue;
  }
  for (const expected of required) {
    if (!source.includes(expected)) {
      findings.push(`V09_DOCUMENTATION_CONTRACT_MISSING: ${path} must contain ${JSON.stringify(expected)}.`);
    }
  }
  const substance = substantivePages[path];
  if (substance) {
    const lineCount = source.split(/\r?\n/u).length;
    const exampleCount = source.match(/```ts\b/gu)?.length ?? 0;
    const sectionCount = source.match(/^##(?:#)? /gmu)?.length ?? 0;
    if (lineCount < substance.minimumLines) {
      findings.push(`V09_DOCUMENTATION_TOO_SHALLOW: ${path} has ${lineCount} lines; expected at least ${substance.minimumLines}.`);
    }
    if (exampleCount < substance.minimumTypeScriptExamples) {
      findings.push(`V09_DOCUMENTATION_EXAMPLES_MISSING: ${path} has ${exampleCount} TypeScript examples; expected at least ${substance.minimumTypeScriptExamples}.`);
    }
    if (sectionCount < substance.minimumSections) {
      findings.push(`V09_DOCUMENTATION_SECTIONS_MISSING: ${path} has ${sectionCount} sections; expected at least ${substance.minimumSections}.`);
    }
  }
}

const config = await readFile('docs-site/astro.config.ts', 'utf8');
for (const expected of [
  "base: '/docs/preview/v0.9'",
  "content: 'noindex,nofollow'",
  "slug: 'build-applications/operations-and-effects'",
  "slug: 'build-applications/profiles-and-providers'",
  "slug: 'upgrade/v071-to-v09'",
  "slug: 'build-applications/decision-guide'",
  "slug: 'build-applications/managed-models-and-reconciliation'",
  "slug: 'build-applications/batch-and-stream-processing'",
  "slug: 'build-applications/jobs-workflows-sagas'",
  "slug: 'build-applications/ml-models'",
  "slug: 'distributed-behavior'",
  "slug: 'infrastructure-providers/provider-guarantees'",
]) {
  if (!config.includes(expected)) {
    findings.push(`V09_DOCUMENTATION_SITE_INVALID: Astro configuration must contain ${JSON.stringify(expected)}.`);
  }
}

if (findings.length > 0) {
  throw new Error(`v0.9 documentation check failed:\n${findings.map(finding => `- ${finding}`).join('\n')}`);
}

console.log(JSON.stringify({
  release: '0.9.0',
  previewBase: '/docs/preview/v0.9',
  pages: Object.keys(requiredPages).length,
  firstPrimitiveGuide: 'operations-and-effects',
}, null, 2));
