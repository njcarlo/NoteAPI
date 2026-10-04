import { PgBoss } from 'pg-boss';
import { env } from './config/env';
import { dbClient } from './db/client';
import { processOutbox, relayDueOutbox } from './modules/notifications/dispatch';
import { providersFromEnv } from './modules/notifications/providers';

const QUEUE = 'notify';
const RETRY_LIMIT = 3;
const RELAY_EVERY_MS = 5_000;

interface NotifyJob {
  outboxId: string;
  clinicId: string;
}

if (!env.JOBS_DATABASE_URL) throw new Error('JOBS_DATABASE_URL is required for the worker');

const providers = providersFromEnv();
const boss = new PgBoss({ connectionString: env.JOBS_DATABASE_URL });
boss.on('error', (error: Error) => console.error(`[worker] queue error: ${error.message}`));
await boss.start();
if (!(await boss.getQueue(QUEUE))) {
  await boss.createQueue(QUEUE, {
    retryLimit: RETRY_LIMIT,
    retryBackoff: true,
    retryDelay: 30,
    expireInSeconds: 120,
  });
}

await boss.work<NotifyJob>(QUEUE, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  await processOutbox(job.data.outboxId, job.data.clinicId, providers, {
    finalAttempt: job.retryCount >= RETRY_LIMIT,
  });
});

let relaying = false;
const relay = setInterval(() => {
  if (relaying) return;
  relaying = true;
  relayDueOutbox((data) => boss.send(QUEUE, data, { singletonKey: data.outboxId }))
    .catch((error: Error) => console.error(`[worker] relay failed: ${error.message}`))
    .finally(() => {
      relaying = false;
    });
}, RELAY_EVERY_MS);

console.log(`[worker] started: sms=${env.SMS_PROVIDER} email=${env.EMAIL_PROVIDER}`);

const shutdown = async () => {
  clearInterval(relay);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await dbClient.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
