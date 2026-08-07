import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './packages/e2e/browser',
  testMatch: '**/agentic-product-golden-path.e2e.test.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  reporter: [
    ['list'],
    ['json', {
      outputFile:
        '.applik8s-tmp/evidence/v0.7/agentic-product-browser-results.json',
    }],
  ],
  use: {
    baseURL:
      process.env.APPLIK8S_AGENTIC_PRODUCT_BASE_URL
      ?? 'http://127.0.0.1:30080',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
