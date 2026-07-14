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
  },
});
