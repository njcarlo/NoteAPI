import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { clinicProfileInputSchema, clinicProfileSchema, imageUploadSchema } from '@clinic/shared';
import { requireActiveClinic, requirePermission } from '../../plugins/auth';
import { getClinicProfile, setClinicLogo, updateClinicProfile } from './service';

export const clinicRoutes: FastifyPluginAsyncZod = async (app) => {
  const manage = requirePermission('settings:manage');

  app.get('/', { schema: { response: { 200: clinicProfileSchema } } }, (request) => {
    requireActiveClinic(request);
    return request.tenant((t) => getClinicProfile(t));
  });

  app.put(
    '/',
    {
      preHandler: manage,
      schema: { body: clinicProfileInputSchema, response: { 200: clinicProfileSchema } },
    },
    (request) => request.tenant((t) => updateClinicProfile(t, request.body)),
  );

  app.put(
    '/logo',
    {
      preHandler: manage,
      schema: { body: imageUploadSchema, response: { 200: clinicProfileSchema } },
    },
    (request) => request.tenant((t) => setClinicLogo(t, request.body)),
  );

  app.delete(
    '/logo',
    { preHandler: manage, schema: { response: { 200: clinicProfileSchema } } },
    (request) => request.tenant((t) => setClinicLogo(t, null)),
  );
};
