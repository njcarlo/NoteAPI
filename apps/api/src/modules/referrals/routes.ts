import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  hasPermission,
  idParams,
  referralDeclineSchema,
  referralInputSchema,
  referralListQuery,
  referralScheduleSchema,
  referralSchema,
} from '@clinic/shared';
import { forbidden } from '../../lib/errors';
import {
  doctorScope,
  requireActiveClinic,
  requireDoctor,
  requirePermission,
} from '../../plugins/auth';
import {
  cancelReferral,
  createReferral,
  declineReferral,
  getReferral,
  listReferrals,
  patientReferrals,
  referralPdf,
  scheduleReferral,
} from './service';

export const referralRoutes: FastifyPluginAsyncZod = async (app) => {
  const readClinical = requirePermission('clinical:read');
  const writeClinical = requirePermission('clinical:write');
  const manageAppointments = requirePermission('appointments:manage');
  const canReadClinical = (request: Parameters<typeof requireActiveClinic>[0]) =>
    hasPermission(requireActiveClinic(request).clinic.roles, 'clinical:read');

  app.get(
    '/referrals',
    { schema: { querystring: referralListQuery, response: { 200: z.array(referralSchema) } } },
    (request) => {
      const { session, clinic } = requireActiveClinic(request);
      const permission =
        request.query.box === 'to_schedule' ? 'appointments:manage' : 'clinical:read';
      if (!hasPermission(clinic.roles, permission)) throw forbidden();
      return request.tenant((t) =>
        listReferrals(t, request.query, {
          userId: session.user.id,
          isDoctor: clinic.roles.includes('doctor'),
          clinical: canReadClinical(request),
          scope: doctorScope(request),
        }),
      );
    },
  );

  app.get(
    '/referrals/:id',
    { preHandler: readClinical, schema: { params: idParams, response: { 200: referralSchema } } },
    (request) => request.tenant((t) => getReferral(t, request.params.id)),
  );

  app.get(
    '/referrals/:id/pdf',
    { preHandler: readClinical, schema: { params: idParams } },
    async (request, reply) => {
      const pdf = await request.tenant(async (t) => {
        const file = await referralPdf(t, request.params.id);
        await t.audit({
          action: 'referral.print',
          entityType: 'referral',
          entityId: request.params.id,
        });
        return file;
      });
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `inline; filename="referral-${request.params.id.slice(0, 8)}.pdf"`,
        )
        .send(pdf);
    },
  );

  app.get(
    '/patients/:id/referrals',
    {
      preHandler: readClinical,
      schema: { params: idParams, response: { 200: z.array(referralSchema) } },
    },
    (request) => request.tenant((t) => patientReferrals(t, request.params.id)),
  );

  app.post(
    '/visits/:id/referrals',
    {
      preHandler: writeClinical,
      schema: { params: idParams, body: referralInputSchema, response: { 201: referralSchema } },
    },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      return reply
        .status(201)
        .send(
          await request.tenant((t) => createReferral(t, request.params.id, doctorId, request.body)),
        );
    },
  );

  app.post(
    '/referrals/:id/schedule',
    {
      preHandler: manageAppointments,
      schema: { params: idParams, body: referralScheduleSchema, response: { 200: referralSchema } },
    },
    (request) =>
      request.tenant((t) =>
        scheduleReferral(
          t,
          request.params.id,
          request.body.startAt,
          doctorScope(request),
          canReadClinical(request),
        ),
      ),
  );

  app.post(
    '/referrals/:id/decline',
    {
      preHandler: writeClinical,
      schema: { params: idParams, body: referralDeclineSchema, response: { 200: referralSchema } },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) =>
        declineReferral(t, request.params.id, doctorId, request.body.note),
      );
    },
  );

  app.post(
    '/referrals/:id/cancel',
    {
      preHandler: writeClinical,
      schema: { params: idParams, response: { 200: referralSchema } },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => cancelReferral(t, request.params.id, doctorId));
    },
  );
};
