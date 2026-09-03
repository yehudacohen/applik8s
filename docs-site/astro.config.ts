import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://applik8s.dev',
  base: '/docs/preview/v0.9',
  integrations: [
    starlight({
      title: 'Applik8s',
      description: 'Build distributed TypeScript applications as one typed application graph.',
      customCss: ['./src/styles/theme.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'robots', content: 'noindex,nofollow' },
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/yehudacohen/applik8s',
        },
      ],
      sidebar: [
        { label: 'Start Here', items: [{ label: 'What is Applik8s?', slug: 'start-here' }] },
        {
          label: 'Build Applications',
          items: [
            { label: 'Choose a primitive', slug: 'build-applications/decision-guide' },
            { label: 'Models, queries, and views', slug: 'build-applications/models-queries-views' },
            { label: 'Managed models and reconciliation', slug: 'build-applications/managed-models-and-reconciliation' },
            { label: 'Batch and stream processing', slug: 'build-applications/batch-and-stream-processing' },
            { label: 'Jobs, workflows, and Sagas', slug: 'build-applications/jobs-workflows-sagas' },
            { label: 'Typed ML models', slug: 'build-applications/ml-models' },
            { label: 'Profiles and providers', slug: 'build-applications/profiles-and-providers' },
            { label: 'Operations and effect safety', slug: 'build-applications/operations-and-effects' },
          ],
        },
        { label: 'Events & Reactive Systems', items: [{ label: 'Events and projections', slug: 'events-reactive-systems' }] },
        { label: 'Distributed Behavior', items: [{ label: 'Jobs, workflows, Sagas, and actors', slug: 'distributed-behavior' }] },
        { label: 'Data & Analytics', items: [{ label: 'Transactional, streaming, and analytical data', slug: 'data-analytics' }] },
        { label: 'AI & Agents', items: [{ label: 'Agents with evidence and authority', slug: 'ai-agents' }] },
        { label: 'Security', items: [{ label: 'Identity, authority, and secrets', slug: 'security' }] },
        {
          label: 'Infrastructure & Providers',
          items: [
            { label: 'Provider boundary', slug: 'infrastructure-providers' },
            { label: 'Compare guarantees', slug: 'infrastructure-providers/provider-guarantees' },
          ],
        },
        {
          label: 'Understand & Operate',
          items: [
            { label: 'Read a deployment plan', slug: 'understand/implementation-plans' },
            { label: 'Test a user journey', slug: 'understand/journeys' },
            { label: 'Diagnose a failure', slug: 'understand/troubleshooting' },
          ],
        },
        { label: 'Examples & Starts', items: [{ label: 'GuestBook, Chirp, and Agentic Start', slug: 'examples-starts' }] },
        {
          label: 'Reference',
          items: [{ label: 'Public contract inventory', slug: 'reference/public-contracts' }],
        },
        {
          label: 'Upgrade & Migrate',
          items: [{ label: 'v0.7.1 to v0.9', slug: 'upgrade/v071-to-v09' }],
        },
      ],
    }),
  ],
});
