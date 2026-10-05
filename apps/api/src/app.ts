import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env';
import { appointmentRoutes } from './modules/appointments/routes';
import { auditRoutes } from './modules/audit/routes';
import { clinicRoutes } from './modules/clinic/routes';
import { consultRoutes } from './modules/consult/routes';
import { authRoutes } from './modules/auth/routes';
import { patientRoutes } from './modules/patients/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { platformRoutes } from './modules/platform/routes';
import { publicRoutes } from './modules/public/routes';
import { queueRoutes } from './modules/queue/routes';
import { doctorRoutes } from './modules/scheduling/routes';
import { staffRoutes } from './modules/staff/routes';
import authPlugin from './plugins/auth';
import { registerErrorHandling } from './plugins/errors';
import eventsPlugin from './plugins/events';
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

  // Route inventory, used by the security tests to make sure every route is classified.
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat())
      if (method !== 'HEAD') routes.push({ method, url: route.url });
  });
  app.decorate('routeList', routes);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await registerSecurity(app);
  await app.register(authPlugin);

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(patientRoutes, { prefix: '/api/patients' });
  await app.register(staffRoutes, { prefix: '/api/staff' });
  await app.register(auditRoutes, { prefix: '/api/audit-logs' });
  await app.register(platformRoutes, { prefix: '/api/platform' });
  await app.register(doctorRoutes, { prefix: '/api/doctors' });
  await app.register(appointmentRoutes, { prefix: '/api/appointments' });
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(queueRoutes, { prefix: '/api' });
  await app.register(consultRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(clinicRoutes, { prefix: '/api/clinic' });
  await app.register(eventsPlugin);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}
