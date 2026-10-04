import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  appointmentSchema,
  checkInSchema,
  idParams,
  queueItemSchema,
  queueQuery,
  queueSchema,
  vitalsSchema,
  walkInSchema,
} from '@clinic/shared';
import { doctorScope, requireDoctor, requirePermission } from '../../plugins/auth';
import { callPatient, checkIn, getQueue, requeue, updateVitals, walkIn } from './service';

export const queueRoutes: FastifyPluginAsyncZod = async (app) => {
  const manage = requirePermission('queue:manage');
  const vitals = requirePermission('vitals:write');

  app.get(
    '/queue',
    { preHandler: manage, schema: { querystring: queueQuery, response: { 200: queueSchema } } },
    (request) => request.tenant((t) => getQueue(t, request.query.doctorId, doctorScope(request))),
  );

  app.post(
    '/appointments/:id/check-in',
    {
      preHandler: [manage, vitals],
      schema: { params: idParams, body: checkInSchema, response: { 200: appointmentSchema } },
    },
    (request) =>
      request.tenant((t) => checkIn(t, request.params.id, request.body, doctorScope(request))),
  );

  app.put(
    '/appointments/:id/vitals',
    {
      preHandler: vitals,
      schema: { params: idParams, body: vitalsSchema, response: { 200: queueItemSchema } },
    },
    (request) =>
      request.tenant((t) => updateVitals(t, request.params.id, request.body, doctorScope(request))),
  );

  app.post(
    '/walk-ins',
    {
      preHandler: [manage, vitals],
      schema: { body: walkInSchema, response: { 201: appointmentSchema } },
    },
    async (request, reply) => {
      const appointment = await request.tenant((t) =>
        walkIn(t, request.body, doctorScope(request)),
      );
      return reply.status(201).send(appointment);
    },
  );

  app.post('/queue/call-next', { schema: { response: { 200: queueItemSchema } } }, (request) => {
    const doctorId = requireDoctor(request);
    return request.tenant((t) => callPatient(t, doctorId));
  });

  app.post(
    '/appointments/:id/call',
    { schema: { params: idParams, response: { 200: queueItemSchema } } },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => callPatient(t, doctorId, request.params.id));
    },
  );

  app.post(
    '/appointments/:id/requeue',
    { schema: { params: idParams, response: { 200: queueItemSchema } } },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => requeue(t, doctorId, request.params.id));
    },
  );
};
