import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    include: ['packages/**/*.character.test.ts', 'examples/**/*.character.test.ts'],
    exclude: ['**/node_modules/**', 'packages/internal-research/**'],
    globals: false,
  },
});

function workspaceAliases(): Record<string, string> {
  return {
    '@applik8s/applik8s': fileURLToPath(new URL('./packages/applik8s/src/index.ts', import.meta.url)),
    '@applik8s/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@applik8s/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    '@applik8s/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    '@applik8s/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
    '@applik8s/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    '@applik8s/runtime-contract': fileURLToPath(new URL('./packages/runtime-contract/src/index.ts', import.meta.url)),
    '@applik8s/typekro-adapter': fileURLToPath(new URL('./packages/typekro-adapter/src/index.ts', import.meta.url)),
    '@applik8s/typetainer': fileURLToPath(new URL('./packages/typetainer/src/index.ts', import.meta.url)),
    'typekro/advanced': fileURLToPath(new URL('../typekro/src/advanced/index.ts', import.meta.url)),
  };
}
