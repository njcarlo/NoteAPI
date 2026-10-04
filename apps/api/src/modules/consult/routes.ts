import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  amendmentInputSchema,
  consultDraftSchema,
  consultSchema,
  doctorProfileInputSchema,
  doctorProfileSchema,
  drugQuery,
  drugSchema,
  finishVisitSchema,
  idParams,
  rxFavoriteInputSchema,
  rxFavoriteSchema,
  rxShareResponseSchema,
  soapTemplateInputSchema,
  soapTemplateSchema,
  visitSchema,
} from '@clinic/shared';
import { forbidden } from '../../lib/errors';
import { requireActiveClinic, requireDoctor, requirePermission } from '../../plugins/auth';
import {
  createFavorite,
  createTemplate,
  deleteFavorite,
  deleteTemplate,
  getDoctorProfile,
  listFavorites,
  listTemplates,
  saveDoctorProfile,
  searchDrugs,
} from './library';
import {
  amendVisit,
  createShareLink,
  finishVisit,
  getConsult,
  prescriptionPdf,
  saveDraft,
} from './service';

export const consultRoutes: FastifyPluginAsyncZod = async (app) => {
  const readClinical = requirePermission('clinical:read');
  const writeClinical = requirePermission('clinical:write');
  const readRx = requirePermission('prescriptions:read');
  const writeRx = requirePermission('prescriptions:write');

  app.get(
    '/consult/:id',
    { preHandler: readClinical, schema: { params: idParams, response: { 200: consultSchema } } },
    (request) => {
      const { session } = requireActiveClinic(request);
      return request.tenant((t) => getConsult(t, request.params.id, session.user.id));
    },
  );

  app.put(
    '/consult/:id/draft',
    {
      preHandler: writeClinical,
      schema: {
        params: idParams,
        body: consultDraftSchema,
        response: { 200: z.object({ savedAt: z.string() }) },
      },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => saveDraft(t, request.params.id, doctorId, request.body));
    },
  );

  app.post(
    '/consult/:id/finish',
    {
      preHandler: [writeClinical, writeRx],
      schema: { params: idParams, body: finishVisitSchema, response: { 200: visitSchema } },
    },
    async (request) => {
      const doctorId = requireDoctor(request);
      const { visit, prescriptionId } = await request.tenant((t) =>
        finishVisit(t, request.params.id, doctorId, request.body),
      );
      if (prescriptionId) {
        // Rendered after commit so a slow or failed render never rolls back the visit.
        await request
          .tenant((t) => prescriptionPdf(t, prescriptionId))
          .catch((error: Error) => {
            request.log.error(
              { err: { name: error.name, message: error.message } },
              'Prescription PDF render failed',
            );
          });
      }
      return visit;
    },
  );

  app.post(
    '/visits/:id/amendments',
    {
      preHandler: writeClinical,
      schema: { params: idParams, body: amendmentInputSchema, response: { 200: visitSchema } },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => amendVisit(t, request.params.id, doctorId, request.body));
    },
  );

  app.get(
    '/prescriptions/:id/pdf',
    { preHandler: readRx, schema: { params: idParams } },
    async (request, reply) => {
      const pdf = await request.tenant(async (t) => {
        const file = await prescriptionPdf(t, request.params.id);
        await t.audit({
          action: 'prescription.view',
          entityType: 'prescription',
          entityId: request.params.id,
        });
        return file;
      });
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `inline; filename="prescription-${request.params.id.slice(0, 8)}.pdf"`,
        )
        .send(pdf);
    },
  );

  app.post(
    '/prescriptions/:id/share',
    { preHandler: writeRx, schema: { params: idParams, response: { 201: rxShareResponseSchema } } },
    async (request, reply) =>
      reply.status(201).send(await request.tenant((t) => createShareLink(t, request.params.id))),
  );

  app.get(
    '/drugs',
    {
      preHandler: writeRx,
      schema: { querystring: drugQuery, response: { 200: z.array(drugSchema) } },
    },
    (request) => searchDrugs(request.query.q),
  );

  app.get(
    '/rx-favorites',
    { preHandler: writeRx, schema: { response: { 200: z.array(rxFavoriteSchema) } } },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => listFavorites(t, doctorId));
    },
  );

  app.post(
    '/rx-favorites',
    {
      preHandler: writeRx,
      schema: { body: rxFavoriteInputSchema, response: { 201: rxFavoriteSchema } },
    },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      return reply
        .status(201)
        .send(await request.tenant((t) => createFavorite(t, doctorId, request.body)));
    },
  );

  app.delete(
    '/rx-favorites/:id',
    { preHandler: writeRx, schema: { params: idParams } },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      await request.tenant((t) => deleteFavorite(t, doctorId, request.params.id));
      return reply.status(204).send();
    },
  );

  app.get(
    '/soap-templates',
    { preHandler: writeClinical, schema: { response: { 200: z.array(soapTemplateSchema) } } },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => listTemplates(t, doctorId));
    },
  );

  app.post(
    '/soap-templates',
    {
      preHandler: writeClinical,
      schema: { body: soapTemplateInputSchema, response: { 201: soapTemplateSchema } },
    },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      return reply
        .status(201)
        .send(await request.tenant((t) => createTemplate(t, doctorId, request.body)));
    },
  );

  app.delete(
    '/soap-templates/:id',
    { preHandler: writeClinical, schema: { params: idParams } },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      await request.tenant((t) => deleteTemplate(t, doctorId, request.params.id));
      return reply.status(204).send();
    },
  );

  /** Credentials printed on prescriptions: editable by admins, or by the doctor themselves. */
  const ownOrAdmin = async (
    request: Parameters<typeof requireActiveClinic>[0] & { params: { id: string } },
  ) => {
    const { session, clinic } = requireActiveClinic(request);
    if (session.user.id !== request.params.id && !clinic.roles.includes('admin')) throw forbidden();
  };

  app.get(
    '/doctors/:id/profile',
    {
      preHandler: ownOrAdmin,
      schema: { params: idParams, response: { 200: doctorProfileSchema } },
    },
    (request) => request.tenant((t) => getDoctorProfile(t, request.params.id)),
  );

  app.put(
    '/doctors/:id/profile',
    {
      preHandler: ownOrAdmin,
      schema: {
        params: idParams,
        body: doctorProfileInputSchema,
        response: { 200: doctorProfileSchema },
      },
    },
    (request) => request.tenant((t) => saveDoctorProfile(t, request.params.id, request.body)),
  );
};
