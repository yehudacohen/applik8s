import { defineConfig } from '@playwright/test';

const identityProfile =
  process.env.APPLIK8S_IDENTITY_START_PROFILE ?? 'starter';

export default defineConfig({
  testDir: './packages/e2e/browser',
  testMatch: '**/identity-start-golden-path.e2e.test.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  globalSetup: './packages/e2e/browser/identity-start-evidence-setup.ts',
  reporter: [
    ['list'],
    ['json', {
      outputFile:
        `.applik8s-tmp/evidence/v0.7/identity-start-${identityProfile}-browser-results.json`,
    }],
  ],
  use: {
    baseURL:
      process.env.APPLIK8S_IDENTITY_START_BASE_URL
      ?? 'http://127.0.0.1:30080',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
