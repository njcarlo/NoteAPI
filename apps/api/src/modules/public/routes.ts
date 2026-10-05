import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ERROR_CODES } from '@clinic/shared';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { clinics } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { contentTypeForKey } from '../../lib/images';
import { storage } from '../../lib/storage';
import {
  cancelLookupSchema,
  cancelTokenParams,
  publicBookingResultSchema,
  publicBookingSchema,
  publicClinicSchema,
  publicDaySchema,
  publicDaysQuery,
  publicSlotsQuery,
  rxShareInfoSchema,
  rxShareOpenSchema,
  slotSchema,
} from '@clinic/shared';
import {
  book,
  cancelByToken,
  cancelLookup,
  inPublicClinic,
  publicClinic,
  publicDays,
  publicSlots,
  withCancelToken,
} from './service';
import { openShare, shareInfo } from '../consult/share';
import { env } from '../../config/env';

const slugParams = z.object({ slug: z.string().min(1).max(63) });

/** Unauthenticated endpoints for patients. They never use the staff session or its CSRF token. */
export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = {
    public: true,
    skipCsrfToken: true,
    rateLimit: { max: 60, timeWindow: '1 minute' },
  };
  const write = {
    public: true,
    skipCsrfToken: true,
    rateLimit: { max: env.PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
  };

  app.get(
    '/clinics/:slug',
    { config: read, schema: { params: slugParams, response: { 200: publicClinicSchema } } },
    (request) =>
      inPublicClinic(request.params.slug, request.ip, (t, clinic) => publicClinic(t, clinic)),
  );

  /** The clinic logo is the only file served publicly (it is shown on the booking page). */
  app.get(
    '/clinics/:slug/logo',
    { config: read, schema: { params: slugParams } },
    async (request, reply) => {
      const [clinic] = await db
        .select({ logoUrl: clinics.logoUrl })
        .from(clinics)
        .where(and(eq(clinics.slug, request.params.slug), eq(clinics.status, 'active')));
      const file = clinic?.logoUrl ? await storage.get(clinic.logoUrl) : null;
      if (!clinic?.logoUrl || !file) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Not found');
      return reply
        .type(contentTypeForKey(clinic.logoUrl))
        .header('cache-control', 'public, max-age=3600')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(file);
    },
  );

  app.get(
    '/clinics/:slug/days',
    {
      config: read,
      schema: {
        params: slugParams,
        querystring: publicDaysQuery,
        response: { 200: z.array(publicDaySchema) },
      },
    },
    (request) =>
      inPublicClinic(request.params.slug, request.ip, (t, clinic) =>
        publicDays(t, clinic, request.query.doctorId, request.query.from),
      ),
  );

  app.get(
    '/clinics/:slug/slots',
    {
      config: read,
      schema: {
        params: slugParams,
        querystring: publicSlotsQuery,
        response: { 200: z.array(slotSchema) },
      },
    },
    (request) =>
      inPublicClinic(request.params.slug, request.ip, (t, clinic) =>
        publicSlots(t, clinic, request.query.doctorId, request.query.date),
      ),
  );

  app.post(
    '/clinics/:slug/bookings',
    {
      config: write,
      schema: {
        params: slugParams,
        body: publicBookingSchema,
        response: { 201: publicBookingResultSchema },
      },
    },
    async (request, reply) => {
      const result = await inPublicClinic(request.params.slug, request.ip, (t, clinic) =>
        book(t, clinic, request.body),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/cancel/:token',
    { config: read, schema: { params: cancelTokenParams, response: { 200: cancelLookupSchema } } },
    (request) => withCancelToken(request.params.token, request.ip, cancelLookup),
  );

  app.get(
    '/rx/:token',
    { config: read, schema: { params: cancelTokenParams, response: { 200: rxShareInfoSchema } } },
    (request) => shareInfo(request.params.token, request.ip),
  );

  app.post(
    '/rx/:token',
    { config: write, schema: { params: cancelTokenParams, body: rxShareOpenSchema } },
    async (request, reply) => {
      const pdf = await openShare(request.params.token, request.body.birthdate, request.ip);
      if (!pdf)
        throw new AppError(403, ERROR_CODES.FORBIDDEN, 'That birthdate does not match our records');
      return reply
        .type('application/pdf')
        .header('content-disposition', 'inline; filename="prescription.pdf"')
        .send(pdf);
    },
  );

  app.post(
    '/cancel/:token',
    { config: write, schema: { params: cancelTokenParams, response: { 200: cancelLookupSchema } } },
    (request) => withCancelToken(request.params.token, request.ip, cancelByToken),
  );
};
