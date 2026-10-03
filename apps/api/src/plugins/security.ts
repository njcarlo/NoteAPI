import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token'],
  });
  await app.register(cookie);

  // Counters are per API instance. With N instances the effective limit is N× these numbers.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });
}
