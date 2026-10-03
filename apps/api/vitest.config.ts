import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://clinic_app:clinic_app@localhost:5432/clinic_test',
      MIGRATION_DATABASE_URL:
        process.env.TEST_MIGRATION_DATABASE_URL ??
        'postgres://clinic:clinic@localhost:5432/clinic_test',
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    },
  },
});
