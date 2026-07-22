import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/e2e/browser',
  testMatch: '**/*.e2e.test.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  globalSetup: './packages/e2e/browser/chirp-evidence-setup.ts',
  reporter: [
    ['list'],
    ['json', { outputFile: '.applik8s-tmp/evidence/v0.6/chirp-browser-results.json' }],
  ],
  use: {
    baseURL: process.env.APPLIK8S_CHIRP_BASE_URL ?? 'http://127.0.0.1:30080',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
