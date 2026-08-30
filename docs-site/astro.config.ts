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
            { label: 'Profiles and providers', slug: 'build-applications/profiles-and-providers' },
            { label: 'Operations and effect safety', slug: 'build-applications/operations-and-effects' },
          ],
        },
        {
          label: 'Understand & Operate',
          items: [
            { label: 'Read a deployment plan', slug: 'understand/implementation-plans' },
            { label: 'Test a user journey', slug: 'understand/journeys' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Public contract inventory', slug: 'reference/public-contracts' }],
        },
        {
          label: 'Upgrade & Migrate',
          items: [{ label: 'v0.8 to v0.9', slug: 'upgrade/v08-to-v09' }],
        },
      ],
    }),
  ],
});
