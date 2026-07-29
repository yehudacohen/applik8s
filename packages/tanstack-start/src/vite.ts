import { applik8sVite, type Applik8sViteOptions } from '@applik8s/vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { nitro } from 'nitro/vite';
import type { PluginOption } from 'vite';

export type Applik8sStartViteOptions = Omit<Applik8sViteOptions, 'serverArtifact'>;

/**
 * Thin TanStack Start adapter over the framework-neutral Applik8s Vite plugin.
 * Nitro owns Start hosting; graph discovery, facades, dependency zones, and
 * immutable artifact metadata remain in @applik8s/vite.
 */
export function applik8sStart(options: Applik8sStartViteOptions = {}): PluginOption[] {
  let root = process.cwd();
  const generatedHandler = () => resolve(root, '.applik8s/generated/nitro-handler.generated.ts');
  const generatedPlugin = () => resolve(root, '.applik8s/generated/nitro-plugin.generated.ts');
  return [
    ...nitro({
      rollupConfig: { external: [/^@sentry\//] },
      experimental: { asyncContext: true },
      plugins: ['.applik8s/generated/nitro-plugin.generated.ts'],
      handlers: [{ route: '/__applik8s/v1/**', handler: '.applik8s/generated/nitro-handler.generated.ts' }],
    }),
    applik8sVite({
      ...options,
      serverArtifact: { outputDirectory: '.output', entrypoint: 'server/index.mjs' },
    }),
    {
      name: '@applik8s/tanstack-start-fetch-adapter',
      enforce: 'pre',
      configResolved(config) {
        root = config.root;
      },
      async buildStart() {
        const handlerPath = generatedHandler();
        await mkdir(dirname(handlerPath), { recursive: true });
        await writeFile(handlerPath, [
          "import { defineEventHandler } from 'nitro/h3';",
          "import { gateway } from './gateway.generated.js';",
          'export default defineEventHandler((event) => gateway.handle(event.req));',
          '',
        ].join('\n'));
        await writeFile(generatedPlugin(), [
          "import { installApplik8sNitroRequestRuntime } from '@applik8s/tanstack-start/server';",
          "import { gateway } from './gateway.generated.js';",
          'export default () => installApplik8sNitroRequestRuntime({ gateway });',
          '',
        ].join('\n'));
      },
    },
  ];
}
