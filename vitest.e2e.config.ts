import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Live source-tree tests intentionally exercise the just-built Rust host.
// Published consumers use the compiler's immutable default instead.
process.env.APPLIK8S_BASE_IMAGE ??= 'ghcr.io/applik8s/applik8s-operator-host:dev';

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    include: ['packages/**/*.e2e.test.ts', 'examples/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', 'packages/internal-research/**'],
    globals: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});

function workspaceAliases(): Record<string, string> {
  return {
    '@applik8s/applik8s/processor-runtime': fileURLToPath(new URL('./packages/applik8s/src/processor-runtime.ts', import.meta.url)),
    '@applik8s/applik8s/dsl': fileURLToPath(new URL('./packages/applik8s/src/dsl.ts', import.meta.url)),
    '@applik8s/applik8s': fileURLToPath(new URL('./packages/applik8s/src/index.ts', import.meta.url)),
    '@applik8s/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    '@applik8s/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    '@applik8s/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    '@applik8s/compiler/kubernetes-schema': fileURLToPath(new URL('./packages/compiler/src/kubernetes-schema/index.ts', import.meta.url)),
    '@applik8s/compiler': fileURLToPath(new URL('./packages/compiler/src/index.ts', import.meta.url)),
    '@applik8s/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    '@applik8s/runtime-contract': fileURLToPath(new URL('./packages/runtime-contract/src/index.ts', import.meta.url)),
    '@applik8s/typekro-adapter': fileURLToPath(new URL('./packages/typekro-adapter/src/index.ts', import.meta.url)),
    '@applik8s/typetainer': fileURLToPath(new URL('./packages/typetainer/src/index.ts', import.meta.url)),
    'typekro/advanced': fileURLToPath(new URL('../typekro/src/advanced/index.ts', import.meta.url)),
  };
}
