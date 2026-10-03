import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idParams,
  platformClinicCreateResponseSchema,
  platformClinicCreateSchema,
  platformClinicSchema,
  platformClinicUpdateSchema,
} from '@clinic/shared';
import { requirePlatformAdmin } from '../../plugins/auth';
import { createClinic, listClinics, setClinicStatus } from './service';

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requirePlatformAdmin);

  app.get('/clinics', { schema: { response: { 200: z.array(platformClinicSchema) } } }, (request) =>
    request.platform((p) => listClinics(p)),
  );

  app.post(
    '/clinics',
    {
      schema: {
        body: platformClinicCreateSchema,
        response: { 201: platformClinicCreateResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await request.platform((p) => createClinic(p, request.body));
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/clinics/:id',
    {
      schema: {
        params: idParams,
        body: platformClinicUpdateSchema,
        response: { 200: platformClinicSchema },
      },
    },
    (request) =>
      request.platform((p) => setClinicStatus(p, request.params.id, request.body.status)),
  );
};
