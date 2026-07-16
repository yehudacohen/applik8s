import { applik8sVite, type Applik8sViteOptions } from '@applik8s/vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { nitro } from 'nitro/vite';
import type { PluginOption } from 'vite';

export type Applik8sStartViteOptions = Applik8sViteOptions;

/**
 * Thin TanStack Start adapter over the framework-neutral Applik8s Vite plugin.
 * Nitro owns Start hosting; graph discovery, facades, dependency zones, and
 * immutable artifact metadata remain in @applik8s/vite.
 */
export function applik8sStart(options: Applik8sStartViteOptions = {}): PluginOption[] {
  let root = process.cwd();
  const generatedHandler = () => resolve(root, '.applik8s/generated/nitro-handler.generated.ts');
  return [
    ...nitro({
      rollupConfig: { external: [/^@sentry\//] },
      handlers: [{ route: '/__applik8s/v1/**', handler: '.applik8s/generated/nitro-handler.generated.ts' }],
    }),
    applik8sVite(options),
    {
      name: '@applik8s/tanstack-start-fetch-adapter',
      enforce: 'pre',
      configResolved(config) {
        root = config.root;
      },
      async buildStart() {
        const path = generatedHandler();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, [
          "import { defineEventHandler } from 'nitro/h3';",
          "import { gateway } from './gateway.generated.js';",
          'export default defineEventHandler((event) => gateway.handle(event.req));',
          '',
        ].join('\n'));
      },
    },
  ];
}
