import { existsSync } from 'node:fs';

const rootEnv = new URL('../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const API_PORT = 3100;
export const WEB_PORT = 5180;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Environment for the API and seed in the end-to-end run. Uses its own database. */
export const apiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  API_PORT: String(API_PORT),
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ?? 'postgres://clinic_app:clinic_app@localhost:5432/clinic_e2e',
  MIGRATION_DATABASE_URL:
    process.env.E2E_MIGRATION_DATABASE_URL ?? 'postgres://clinic:clinic@localhost:5432/clinic_e2e',
  WEB_ORIGIN: WEB_URL,
  PUBLIC_APP_URL: WEB_URL,
  TOKEN_SECRET: 'e2e-token-secret-0123456789abcdefghijklmnop',
  PUBLIC_BOOKING_LEAD_MINUTES: '0',
  LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
  PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE: '1000',
  STORAGE_DIR: './storage-e2e',
  SMS_PROVIDER: 'memory',
  EMAIL_PROVIDER: 'memory',
  PATH: process.env.PATH ?? '',
};
