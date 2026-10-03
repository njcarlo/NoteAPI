import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParams, staffCreateSchema, staffSchema, staffUpdateSchema } from '@clinic/shared';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { createStaff, listStaff, updateStaff } from './service';

export const staffRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', requirePermission('staff:manage'));

  app.get('/', { schema: { response: { 200: z.array(staffSchema) } } }, (request) =>
    request.tenant((t) => listStaff(t)),
  );

  app.post(
    '/',
    { schema: { body: staffCreateSchema, response: { 201: staffSchema } } },
    async (request, reply) => {
      const staff = await request.tenant((t) => createStaff(t, request.body));
      return reply.status(201).send(staff);
    },
  );

  app.patch(
    '/:id',
    { schema: { params: idParams, body: staffUpdateSchema, response: { 200: staffSchema } } },
    (request) => {
      const { user } = requireAuth(request);
      return request.tenant((t) => updateStaff(t, user.id, request.params.id, request.body));
    },
  );
};
