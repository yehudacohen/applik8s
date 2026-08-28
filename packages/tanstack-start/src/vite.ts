import { applik8sVite, type Applik8sViteOptions } from '@applik8s/vite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { nitro } from 'nitro/vite';
import type { PluginOption } from 'vite';

export type Applik8sStartViteOptions = Omit<
  Applik8sViteOptions,
  'browserAdapterModule' | 'serverArtifact'
>;

/**
 * Thin TanStack Start adapter over the framework-neutral Applik8s Vite plugin.
 * Nitro owns Start hosting; graph discovery, facades, dependency zones, and
 * immutable artifact metadata remain in @applik8s/vite.
 */
export function applik8sStart(options: Applik8sStartViteOptions = {}): PluginOption[] {
  let root = process.cwd();
  const generatedHandler = () => resolve(root, '.applik8s/generated/nitro-handler.generated.ts');
  const generatedHealthHandler = () => resolve(root, '.applik8s/generated/nitro-health.generated.ts');
  const generatedPlugin = () => resolve(root, '.applik8s/generated/nitro-plugin.generated.ts');
  const writeGeneratedAdapters = async () => {
    const handlerPath = generatedHandler();
    await mkdir(dirname(handlerPath), { recursive: true });
    const hasGateway = await access(resolve(root, '.applik8s/generated/gateway.generated.ts'))
      .then(() => true, () => false);
    await writeFile(handlerPath, hasGateway
      ? [
          "import { defineEventHandler } from 'nitro/h3';",
          "import { gateway } from './gateway.generated.js';",
          'export default defineEventHandler((event) => gateway.handle(event.req));',
          '',
        ].join('\n')
      : [
          "import { defineEventHandler } from 'nitro/h3';",
          "export default defineEventHandler(() => new Response('Not Found', { status: 404 }));",
          '',
        ].join('\n'));
    await writeFile(generatedHealthHandler(), [
      "import { defineEventHandler } from 'nitro/h3';",
      ...(hasGateway
        ? [
            "import { gateway } from './gateway.generated.js';",
            '// Importing the generated gateway makes readiness fail closed when a',
            '// runtime dependency cannot hydrate, without dispatching a domain request.',
            'void gateway;',
          ]
        : []),
      "export default defineEventHandler(() => ({ ok: true, component: 'applik8s-start' }));",
      '',
    ].join('\n'));
    await writeFile(generatedPlugin(), hasGateway
      ? [
          "import { installApplik8sNitroRequestRuntime } from '@applik8s/tanstack-start/server';",
          "import { gateway } from './gateway.generated.js';",
          'export default () => installApplik8sNitroRequestRuntime({ gateway });',
          '',
        ].join('\n')
      : 'export default () => undefined;\n');
  };
  const applicationPlugin = applik8sVite({
      ...options,
      // TanStack Start is React-specific. Install the adapter through the
      // generated facade so application authors never need a magic side-effect
      // import while @applik8s/vite remains framework neutral.
      browserAdapterModule: '@applik8s/react',
      serverArtifact: { outputDirectory: '.output', entrypoint: 'server/index.mjs' },
    });
  const fetchAdapter = {
      name: '@applik8s/tanstack-start-fetch-adapter',
      enforce: 'pre',
      async configResolved(config) {
        root = config.root;
        await writeGeneratedAdapters();
      },
      async buildStart() {
        await writeGeneratedAdapters();
      },
    } satisfies Exclude<PluginOption, false | null | undefined | readonly PluginOption[]>;
  const nitroPlugins = nitro({
    // Native provider bindings must remain runtime dependencies. Nitro's
    // nested server build does not inherit the outer Vite SSR external list.
          rollupConfig: {
            external: [
              /^@sentry\//,
              /^@duckdb\//,
            ],
          },
    experimental: { asyncContext: true },
    plugins: ['.applik8s/generated/nitro-plugin.generated.ts'],
    handlers: [
      { route: '/-/healthz', handler: '.applik8s/generated/nitro-health.generated.ts' },
      { route: '/__applik8s/v1/**', handler: '.applik8s/generated/nitro-handler.generated.ts' },
    ],
  });
  return [
    // Both framework-owned generators must finish their buildStart hooks before
    // Nitro resolves the generated handler and plugin. Putting Nitro first can
    // expose the Start shell while gateway.generated.js is still absent, making
    // the first pod start return 500 for every Applik8s route.
    applicationPlugin,
    fetchAdapter,
    ...nitroPlugins,
  ];
}
