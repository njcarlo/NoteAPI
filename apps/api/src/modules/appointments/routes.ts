import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  appointmentCreateSchema,
  appointmentListQuery,
  appointmentMoveSchema,
  appointmentSchema,
  idParams,
} from '@clinic/shared';
import { doctorScope, requirePermission } from '../../plugins/auth';
import {
  createAppointment,
  getAppointment,
  listAppointments,
  moveAppointment,
  setAppointmentStatus,
} from './service';

export const appointmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requirePermission('appointments:manage'));

  app.get(
    '/',
    {
      schema: { querystring: appointmentListQuery, response: { 200: z.array(appointmentSchema) } },
    },
    (request) => request.tenant((t) => listAppointments(t, request.query, doctorScope(request))),
  );

  app.get(
    '/:id',
    { schema: { params: idParams, response: { 200: appointmentSchema } } },
    (request) =>
      request.tenant(async (t) => {
        const appointment = await getAppointment(t, request.params.id, doctorScope(request));
        await t.audit({
          action: 'appointment.view',
          entityType: 'appointment',
          entityId: appointment.id,
        });
        return appointment;
      }),
  );

  app.post(
    '/',
    { schema: { body: appointmentCreateSchema, response: { 201: appointmentSchema } } },
    async (request, reply) => {
      const appointment = await request.tenant((t) =>
        createAppointment(t, request.body, doctorScope(request)),
      );
      return reply.status(201).send(appointment);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: idParams,
        body: appointmentMoveSchema,
        response: { 200: appointmentSchema },
      },
    },
    (request) =>
      request.tenant((t) =>
        moveAppointment(t, request.params.id, request.body, doctorScope(request)),
      ),
  );

  app.post(
    '/:id/cancel',
    { schema: { params: idParams, response: { 200: appointmentSchema } } },
    (request) =>
      request.tenant((t) =>
        setAppointmentStatus(t, request.params.id, 'cancelled', doctorScope(request)),
      ),
  );

  app.post(
    '/:id/no-show',
    { schema: { params: idParams, response: { 200: appointmentSchema } } },
    (request) =>
      request.tenant((t) =>
        setAppointmentStatus(t, request.params.id, 'no_show', doctorScope(request)),
      ),
  );
};
