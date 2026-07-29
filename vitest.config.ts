import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.workspace-aliases.js';

export default defineConfig({
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    include: ['packages/**/*.proxy.test.ts', 'packages/**/*.vertical.test.ts'],
    exclude: ['**/node_modules/**', 'packages/internal-research/**'],
    globals: false,
    server: {
      // TypeKro consumes authored value trees by prototype identity. Keep it in
      // Vitest's transformed realm so source-authored Kubernetes objects are
      // not mistaken for cross-realm class instances by strict plan lowering.
      deps: { inline: [/^typekro(?:\/|$)/] },
    },
  },
});
