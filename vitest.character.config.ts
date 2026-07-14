import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.workspace-aliases.js';

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
