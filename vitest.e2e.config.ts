import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.workspace-aliases.js';

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
    server: {
      deps: { inline: [/^typekro(?:\/|$)/] },
    },
  },
});
