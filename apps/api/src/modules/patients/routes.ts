import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParams,
  patientInputSchema,
  patientListQuery,
  patientSchema,
  patientUpdateSchema,
} from '@clinic/shared';
import { requirePermission } from '../../plugins/auth';
import { createPatient, getPatient, listPatients, updatePatient } from './service';

export const patientRoutes: FastifyPluginAsyncZod = async (app) => {
  const canRead = requirePermission('patients:read');
  const canWrite = requirePermission('patients:write');

  app.get(
    '/',
    {
      preHandler: canRead,
      schema: {
        querystring: patientListQuery,
        response: { 200: z.object({ items: z.array(patientSchema), total: z.number() }) },
      },
    },
    (request) => request.tenant((t) => listPatients(t, request.query)),
  );

  app.get(
    '/:id',
    { preHandler: canRead, schema: { params: idParams, response: { 200: patientSchema } } },
    (request) => request.tenant((t) => getPatient(t, request.params.id)),
  );

  app.post(
    '/',
    { preHandler: canWrite, schema: { body: patientInputSchema, response: { 201: patientSchema } } },
    async (request, reply) => {
      const patient = await request.tenant((t) => createPatient(t, request.body));
      return reply.status(201).send(patient);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: canWrite,
      schema: { params: idParams, body: patientUpdateSchema, response: { 200: patientSchema } },
    },
    (request) => request.tenant((t) => updatePatient(t, request.params.id, request.body)),
  );
};
