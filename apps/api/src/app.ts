import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env';
import { auditRoutes } from './modules/audit/routes';
import { authRoutes } from './modules/auth/routes';
import { patientRoutes } from './modules/patients/routes';
import { staffRoutes } from './modules/staff/routes';
import authPlugin from './plugins/auth';
import { registerErrorHandling } from './plugins/errors';
import { registerSecurity } from './plugins/security';

/** Request logs carry method, path (no query string, which may hold search terms) and status only. */
const logger: FastifyServerOptions['logger'] = {
  level: env.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
  serializers: {
    req: (req) => ({ method: req.method, path: req.url.split('?')[0], reqId: req.id }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
};

export async function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await registerSecurity(app);
  await app.register(authPlugin);

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(patientRoutes, { prefix: '/api/patients' });
  await app.register(staffRoutes, { prefix: '/api/staff' });
  await app.register(auditRoutes, { prefix: '/api/audit-logs' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
