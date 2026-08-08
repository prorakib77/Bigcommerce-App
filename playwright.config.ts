import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public';

const sharedEnv = {
  NODE_ENV: 'development',
  MOCK_MODE: 'true',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: BASE_URL,
  BIGCOMMERCE_AUTH_CALLBACK_URL: `${BASE_URL}/api/bigcommerce/auth`,
  BIGCOMMERCE_LOAD_CALLBACK_URL: `${BASE_URL}/api/bigcommerce/load`,
  BIGCOMMERCE_UNINSTALL_CALLBACK_URL: `${BASE_URL}/api/bigcommerce/uninstall`,
  BIGCOMMERCE_REMOVE_USER_CALLBACK_URL: `${BASE_URL}/api/bigcommerce/remove-user`,
  BIGCOMMERCE_CLIENT_ID: 'e2e_client_id',
  BIGCOMMERCE_CLIENT_SECRET: 'e2e_client_secret',
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_DATABASE_URL: E2E_DATABASE_URL,
  MASTER_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  APP_SESSION_SIGNING_KEY: Buffer.alloc(48, 4).toString('base64'),
  KICKFLIP_ALLOWED_IMAGE_HOSTS: 'cdn.mycustomizer.com,images.mycustomizer.com',
  IMPORT_GLOBAL_CONCURRENCY: '5',
  IMPORT_PER_STORE_CONCURRENCY: '2',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Two processes, matching production: the Next.js web app plus the
  // pg-boss worker that actually processes import jobs — without it,
  // imports would stay QUEUED forever and the "observe job progress /
  // see successful mapping" scenario couldn't be exercised.
  webServer: [
    {
      // Migrate + seed once, then start the web app — all against a
      // dedicated E2E database, never the developer's local one.
      command: `pnpm exec prisma migrate deploy && pnpm exec tsx e2e/seed.ts && pnpm exec next dev -p ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...sharedEnv, PORT: String(PORT) },
    },
    {
      command: 'pnpm exec tsx src/jobs/worker.ts',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: sharedEnv,
    },
  ],
});
