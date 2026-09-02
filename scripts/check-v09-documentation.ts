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
  ],
  'docs-site/src/content/docs/events-reactive-systems.mdx': ['Events and reactive systems', 'output.upsert'],
  'docs-site/src/content/docs/distributed-behavior.mdx': ['Jobs, workflows, Sagas, and actors', 'Schedules select an execution family'],
  'docs-site/src/content/docs/data-analytics.mdx': ['Transactional, streaming, and analytical data', 'Cross-store work'],
  'docs-site/src/content/docs/ai-agents.mdx': ['Agents with evidence and authority', 'causal principal lineage'],
  'docs-site/src/content/docs/security.mdx': ['Identity, authority, and secrets', 'Clients provide application input'],
  'docs-site/src/content/docs/infrastructure-providers.mdx': ['TypeKro authors Kubernetes resources', 'External bindings contribute no infrastructure'],
  'docs-site/src/content/docs/infrastructure-providers/provider-guarantees.mdx': ['Compare provider guarantees', 'does not upgrade maturity'],
  'docs-site/src/content/docs/understand/troubleshooting.mdx': ['V09_BASELINE_RELEASE_UNAVAILABLE', 'JOURNEY_PROVIDER_INCOMPATIBLE'],
  'docs-site/src/content/docs/examples-starts.mdx': ['GuestBook', 'Chirp', 'Agentic Start'],
  'docs-site/src/content/docs/reference/public-contracts.mdx': [
    'v0.9-public-contract.json',
    'does not upgrade',
  ],
  'docs-site/src/content/docs/upgrade/v08-to-v09.mdx': [
    'V09_BASELINE_RELEASE_UNAVAILABLE',
    '`mutationAuthorized: false`',
    'Do not use source-candidate state',
  ],
} as const;

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
}

const config = await readFile('docs-site/astro.config.ts', 'utf8');
for (const expected of [
  "base: '/docs/preview/v0.9'",
  "content: 'noindex,nofollow'",
  "slug: 'build-applications/operations-and-effects'",
  "slug: 'build-applications/profiles-and-providers'",
  "slug: 'upgrade/v08-to-v09'",
  "slug: 'build-applications/decision-guide'",
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
  release: '0.9.0-alpha.1',
  previewBase: '/docs/preview/v0.9',
  pages: Object.keys(requiredPages).length,
  firstPrimitiveGuide: 'operations-and-effects',
}, null, 2));
