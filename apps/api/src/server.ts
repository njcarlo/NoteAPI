import { buildApp } from './app';
import { env } from './config/env';
import { dbClient } from './db/client';

const app = await buildApp();

const shutdown = async () => {
  await app.close();
  await dbClient.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
