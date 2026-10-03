import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loginSchema, sessionResponseSchema } from '@clinic/shared';
import { env } from '../../config/env';
import {
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie,
} from '../../plugins/auth';
import { login, logout } from './service';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      schema: { body: loginSchema, response: { 200: sessionResponseSchema } },
      config: {
        skipCsrfToken: true,
        rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { token, session } = await login({
        ...request.body,
        ip: request.ip,
        previousToken: request.cookies[SESSION_COOKIE],
      });
      setSessionCookie(reply, token);
      return { user: session.user, csrfToken: session.csrfToken };
    },
  );

  app.post('/logout', async (request, reply) => {
    const session = requireAuth(request);
    await logout(session.id);
    await request.tenant((t) =>
      t.audit({ action: 'auth.logout', entityType: 'user', entityId: session.user.id }),
    );
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', { schema: { response: { 200: sessionResponseSchema } } }, async (request) => {
    const session = requireAuth(request);
    return { user: session.user, csrfToken: session.csrfToken };
  });
};
