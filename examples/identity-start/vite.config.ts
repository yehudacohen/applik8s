import { applik8sStart } from '@applik8s/tanstack-start/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? '3000'),
  },
  resolve: { tsconfigPaths: true },
  oxc: { jsx: { development: false } },
  plugins: [
    tanstackStart(),
    applik8sStart({ application: './src/application.ts' }),
    react(),
  ],
});
