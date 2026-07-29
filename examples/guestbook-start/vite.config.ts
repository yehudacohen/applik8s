import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { applik8sStart } from '@applik8s/tanstack-start/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Nitro's secondary SSR environment must use the production JSX runtime.
  // Without this explicit boundary, current Nitro nightlies can emit jsxDEV
  // while bundling React's production jsx-dev-runtime, where jsxDEV is absent.
  oxc: { jsx: { development: false } },
  plugins: [
    tanstackStart(),
    applik8sStart({ application: './src/application.ts' }),
    react(),
  ],
});
