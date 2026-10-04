import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  doctorSchema,
  doctorScheduleSchema,
  idParams,
  scheduleExceptionInputSchema,
  slotQuery,
  slotSchema,
  weeklyScheduleSchema,
} from '@clinic/shared';
import { iso } from '../../lib/sql';
import { doctorScope, requirePermission } from '../../plugins/auth';
import { assertDoctorInScope } from '../appointments/service';
import {
  addException,
  availableSlots,
  deleteException,
  getClinic,
  getSchedule,
  listDoctors,
  replaceSchedule,
} from './service';

export const doctorRoutes: FastifyPluginAsyncZod = async (app) => {
  const canBook = requirePermission('appointments:manage');
  const canConfigure = requirePermission('settings:manage');

  app.get(
    '/',
    { preHandler: canBook, schema: { response: { 200: z.array(doctorSchema) } } },
    (request) => {
      const scope = doctorScope(request);
      return request.tenant(async (t) =>
        (await listDoctors(t)).filter((d) => !scope || scope.includes(d.id)),
      );
    },
  );

  app.get(
    '/:id/schedule',
    { preHandler: canBook, schema: { params: idParams, response: { 200: doctorScheduleSchema } } },
    (request) => {
      assertDoctorInScope(doctorScope(request), request.params.id);
      return request.tenant((t) => getSchedule(t, request.params.id));
    },
  );

  app.put(
    '/:id/schedule',
    {
      preHandler: canConfigure,
      schema: {
        params: idParams,
        body: weeklyScheduleSchema,
        response: { 200: doctorScheduleSchema },
      },
    },
    (request) => request.tenant((t) => replaceSchedule(t, request.params.id, request.body)),
  );

  app.post(
    '/:id/exceptions',
    {
      preHandler: canConfigure,
      schema: {
        params: idParams,
        body: scheduleExceptionInputSchema,
        response: { 201: doctorScheduleSchema },
      },
    },
    async (request, reply) => {
      const schedule = await request.tenant((t) =>
        addException(t, request.params.id, request.body),
      );
      return reply.status(201).send(schedule);
    },
  );

  app.delete(
    '/:id/exceptions/:exceptionId',
    {
      preHandler: canConfigure,
      schema: {
        params: idParams.extend({ exceptionId: z.uuid() }),
        response: { 200: doctorScheduleSchema },
      },
    },
    (request) =>
      request.tenant((t) => deleteException(t, request.params.id, request.params.exceptionId)),
  );

  app.get(
    '/:id/slots',
    {
      preHandler: canBook,
      schema: { params: idParams, querystring: slotQuery, response: { 200: z.array(slotSchema) } },
    },
    (request) => {
      assertDoctorInScope(doctorScope(request), request.params.id);
      return request.tenant(async (t) => {
        const clinic = await getClinic(t);
        const days = await availableSlots(t, {
          doctorId: request.params.id,
          from: request.query.date,
          days: 1,
          timeZone: clinic.timezone,
          now: new Date(),
          minLeadMinutes: 0,
        });
        return (days.get(request.query.date) ?? []).map((s) => ({
          startAt: iso(s.startAt),
          endAt: iso(s.endAt),
        }));
      });
    },
  );
};
