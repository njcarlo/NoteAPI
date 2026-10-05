import { defineConfig, devices } from '@playwright/test';
import { API_PORT, apiEnv, WEB_PORT, WEB_URL } from './env';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @clinic/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @clinic/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}`, PATH: process.env.PATH ?? '' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
