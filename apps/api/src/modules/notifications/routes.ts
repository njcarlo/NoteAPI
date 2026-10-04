import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ERROR_CODES,
  normalizePhMobile,
  notificationLogQuery,
  notificationLogSchema,
  optOutInfoSchema,
  optOutParams,
  smsInboundSchema,
  templateInputSchema,
  templateParams,
  templateSchema,
} from '@clinic/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { clinics, patients } from '../../db/schema';
import { withTenant, type TenantScope } from '../../db/tenant';
import { safeEqual } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { patientFromOptOutToken } from '../../lib/tokens';
import { requirePermission } from '../../plugins/auth';
import { listLogs, listTemplates, resetTemplate, saveTemplate } from './templates';

const invalidLink = () => new AppError(404, ERROR_CODES.NOT_FOUND, 'This link is invalid');

/** Runs `fn` in the clinic of the patient named by a signed opt-out token. */
async function withOptOutToken<T>(
  token: string,
  ip: string | null,
  fn: (t: TenantScope, patientId: string) => Promise<T>,
): Promise<T> {
  const patientId = patientFromOptOutToken(token);
  if (!patientId) throw invalidLink();
  const [row] = await db.execute<{ clinic_id: string | null }>(
    sql`select patient_clinic(${patientId}) as clinic_id`,
  );
  if (!row?.clinic_id) throw invalidLink();
  return withTenant(row.clinic_id, { userId: null, ip }, (t) => fn(t, patientId));
}

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const manage = requirePermission('settings:manage');

  app.get(
    '/notification-templates',
    { preHandler: manage, schema: { response: { 200: z.array(templateSchema) } } },
    (request) => request.tenant((t) => listTemplates(t)),
  );

  app.put(
    '/notification-templates/:event/:channel',
    {
      preHandler: manage,
      schema: {
        params: templateParams,
        body: templateInputSchema,
        response: { 200: templateSchema },
      },
    },
    (request) =>
      request.tenant((t) =>
        saveTemplate(t, request.params.event, request.params.channel, request.body),
      ),
  );

  app.post(
    '/notification-templates/:event/:channel/reset',
    { preHandler: manage, schema: { params: templateParams, response: { 200: templateSchema } } },
    (request) =>
      request.tenant((t) => resetTemplate(t, request.params.event, request.params.channel)),
  );

  app.get(
    '/notification-logs',
    {
      preHandler: manage,
      schema: {
        querystring: notificationLogQuery,
        response: { 200: z.array(notificationLogSchema) },
      },
    },
    (request) => request.tenant((t) => listLogs(t, request.query.limit, request.query.offset)),
  );

  const publicRead = { skipCsrfToken: true, rateLimit: { max: 60, timeWindow: '1 minute' } };
  const publicWrite = {
    skipCsrfToken: true,
    rateLimit: { max: env.PUBLIC_WRITE_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
  };

  app.get(
    '/public/opt-out/:token',
    { config: publicRead, schema: { params: optOutParams, response: { 200: optOutInfoSchema } } },
    (request) =>
      withOptOutToken(request.params.token, request.ip, async (t, patientId) => {
        const [row] = await t.tx
          .select({ clinicName: clinics.name, smsOptIn: patients.smsOptIn })
          .from(patients)
          .innerJoin(clinics, eq(clinics.id, patients.clinicId))
          .where(t.where(patients, eq(patients.id, patientId)));
        if (!row) throw invalidLink();
        return row;
      }),
  );

  app.post(
    '/public/opt-out/:token',
    { config: publicWrite, schema: { params: optOutParams, response: { 200: optOutInfoSchema } } },
    (request) =>
      withOptOutToken(request.params.token, request.ip, async (t, patientId) => {
        await t.tx
          .update(patients)
          .set({ smsOptIn: false })
          .where(t.where(patients, eq(patients.id, patientId)));
        await t.audit({
          action: 'patient.sms_opt_out',
          entityType: 'patient',
          entityId: patientId,
          metadata: { via: 'link' },
        });
        const [clinic] = await t.tx
          .select({ name: clinics.name })
          .from(clinics)
          .where(eq(clinics.id, t.clinicId));
        return { clinicName: clinic?.name ?? '', smsOptIn: false };
      }),
  );

  /** Inbound SMS from the gateway. "STOP" opts the sender's number out. */
  app.post(
    '/webhooks/sms/inbound',
    {
      config: publicWrite,
      schema: { body: smsInboundSchema, response: { 200: z.object({ optedOut: z.number() }) } },
    },
    async (request) => {
      const secret = request.headers['x-webhook-secret'];
      if (
        !env.SMS_WEBHOOK_SECRET ||
        typeof secret !== 'string' ||
        !safeEqual(secret, env.SMS_WEBHOOK_SECRET)
      ) {
        throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Not found');
      }
      const mobile = normalizePhMobile(request.body.from);
      const keyword = request.body.message.trim().split(/\s+/)[0]?.toUpperCase();
      if (!mobile || !keyword || !['STOP', 'UNSUBSCRIBE', 'END', 'QUIT'].includes(keyword))
        return { optedOut: 0 };
      const [row] = await db.execute<{ changed: number }>(
        sql`select sms_opt_out_by_mobile(${mobile}) as changed`,
      );
      return { optedOut: Number(row?.changed ?? 0) };
    },
  );
};
