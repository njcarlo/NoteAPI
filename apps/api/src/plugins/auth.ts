import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ERROR_CODES, hasPermission, type Permission } from '@clinic/shared';
import { env } from '../config/env';
import { withTenant, type TenantScope } from '../db/tenant';
import { safeEqual } from '../lib/crypto';
import { AppError, forbidden, unauthenticated } from '../lib/errors';
import { resolveSession, type ActiveSession } from '../modules/auth/service';

export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-sid' : 'sid';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Skip the per-session CSRF token check (the origin check still applies). */
    skipCsrfToken?: boolean;
  }
  interface FastifyRequest {
    session: ActiveSession | null;
    /** Runs `fn` in a transaction scoped to the signed-in user's clinic. */
    tenant<T>(fn: (scope: TenantScope) => Promise<T>): Promise<T>;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_IDLE_MINUTES * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', secure: env.COOKIE_SECURE, sameSite: 'lax' });
}

export function requireAuth(request: FastifyRequest): ActiveSession {
  if (!request.session) throw unauthenticated();
  return request.session;
}

/** Route preHandler: signed in and holding the permission. */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest) => {
    const session = requireAuth(request);
    if (!hasPermission(session.user.roles, permission)) throw forbidden();
  };
}

const allowedOrigins = new Set([
  new URL(env.WEB_ORIGIN).origin,
  new URL(env.PUBLIC_APP_URL).origin,
]);

export default fp(async (app: FastifyInstance) => {
  app.decorateRequest('session', null);
  app.decorateRequest('tenant', function <
    T,
  >(this: FastifyRequest, fn: (scope: TenantScope) => Promise<T>) {
    const session = requireAuth(this);
    return withTenant(session.user.clinicId, { userId: session.user.id, ip: this.ip }, fn);
  });

  app.addHook('onRequest', async (request) => {
    // Cross-site request forgery: unsafe requests must come from our own origin.
    if (UNSAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const fetchSite = request.headers['sec-fetch-site'];
      if ((origin && !allowedOrigins.has(origin)) || (!origin && fetchSite === 'cross-site')) {
        throw new AppError(403, ERROR_CODES.CSRF, 'Request blocked');
      }
    }

    const token = request.cookies[SESSION_COOKIE];
    if (token) request.session = await resolveSession(token, request.ip);

    // Signed-in unsafe requests must also echo the per-session CSRF token.
    if (
      request.session &&
      UNSAFE_METHODS.has(request.method) &&
      !request.routeOptions.config.skipCsrfToken
    ) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, request.session.csrfToken)) {
        throw new AppError(403, ERROR_CODES.CSRF, 'Your session expired. Please reload the page.');
      }
    }
  });
});
