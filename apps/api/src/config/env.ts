import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  /** Defaults to PORT (set by Cloud Run), then 3000. */
  API_PORT: z.coerce
    .number()
    .int()
    .default(Number(process.env.PORT ?? 3000)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  MIGRATION_DATABASE_URL: z.url(),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.url().default('http://localhost:5173'),
  COOKIE_SECURE: booleanString,
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(720),
  /**
   * Session cookie name. Defaults to "__Host-sid" with secure cookies and "sid" otherwise. Behind
   * Firebase Hosting it must be "__session": that is the only cookie Hosting forwards to Cloud Run.
   */
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[\w-]+$/)
    .optional(),
  /** Live-update streams are closed after this long and reconnect (Firebase Hosting allows 60 s). */
  /** Online booking only offers slots at least this many minutes ahead. */
  PUBLIC_BOOKING_LEAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
  SSE_MAX_STREAM_SECONDS: z.coerce.number().int().min(10).max(3600).default(1800),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  TRUST_PROXY: booleanString,
  STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
  /** Cloud Storage bucket (private) when STORAGE_DRIVER=gcs. Credentials come from the runtime. */
  GCS_BUCKET: z.string().optional(),
  /** Signs cancel and opt-out links so they can be re-created for reminders without storing them. */
  TOKEN_SECRET: z.string().min(32, 'TOKEN_SECRET must be at least 32 characters'),
  /** Connection for the worker's job queue (pg-boss); must own the `pgboss` schema. Worker only. */
  JOBS_DATABASE_URL: z.url().optional(),
  SMS_PROVIDER: z.enum(['console', 'semaphore', 'memory']).default('console'),
  SEMAPHORE_API_KEY: z.string().optional(),
  SMS_SENDER_NAME: z.string().max(11).default('CLINIC'),
  /** Shared secret the SMS gateway sends with inbound messages (STOP replies). */
  SMS_WEBHOOK_SECRET: z.string().min(16).optional(),
  EMAIL_PROVIDER: z.enum(['smtp', 'resend', 'memory']).default('smtp'),
  EMAIL_FROM: z.string().default('Clinic <no-reply@clinic.local>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  STORAGE_DIR: z.string().default('./storage'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  if (parsed.data.STORAGE_DRIVER === 'gcs' && !parsed.data.GCS_BUCKET) {
    throw new Error('GCS_BUCKET is required when STORAGE_DRIVER=gcs');
  }
  if (parsed.data.SMS_PROVIDER === 'semaphore' && !parsed.data.SEMAPHORE_API_KEY) {
    throw new Error('SEMAPHORE_API_KEY is required when SMS_PROVIDER=semaphore');
  }
  if (parsed.data.EMAIL_PROVIDER === 'resend' && !parsed.data.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }
  if (
    parsed.data.NODE_ENV === 'production' &&
    (parsed.data.SMS_PROVIDER === 'memory' || parsed.data.EMAIL_PROVIDER === 'memory')
  ) {
    throw new Error('The memory notification providers are for tests only');
  }
  return parsed.data;
}

export const env = loadEnv();
