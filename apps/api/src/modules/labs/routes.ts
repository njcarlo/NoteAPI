import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  facilityInputSchema,
  facilityListQuery,
  facilitySchema,
  facilityUpdateSchema,
  hasPermission,
  idParams,
  labListQuery,
  labRequestInputSchema,
  labRequestSchema,
  labResultUploadSchema,
  labReviewSchema,
  LAB_RESULT_MAX_BYTES,
} from '@clinic/shared';
import { safeFileName } from '../../lib/files';
import { forbidden } from '../../lib/errors';
import {
  doctorScope,
  requireActiveClinic,
  requireDoctor,
  requirePermission,
} from '../../plugins/auth';
import {
  addLabResult,
  cancelLabRequest,
  createFacility,
  createLabRequest,
  getLabResultFile,
  labRequestPdf,
  listFacilities,
  listLabRequests,
  patientLabRequests,
  reviewLabRequest,
  updateFacility,
} from './service';

export const labRoutes: FastifyPluginAsyncZod = async (app) => {
  const readClinical = requirePermission('clinical:read');
  const writeClinical = requirePermission('clinical:write');
  const manageSettings = requirePermission('settings:manage');
  const canReadClinical = (request: Parameters<typeof requireActiveClinic>[0]) =>
    hasPermission(requireActiveClinic(request).clinic.roles, 'clinical:read');

  app.get(
    '/facilities',
    { schema: { querystring: facilityListQuery, response: { 200: z.array(facilitySchema) } } },
    (request) => {
      requireActiveClinic(request);
      return request.tenant((t) => listFacilities(t, request.query.all === 'true'));
    },
  );

  app.post(
    '/facilities',
    {
      preHandler: manageSettings,
      schema: { body: facilityInputSchema, response: { 201: facilitySchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await request.tenant((t) => createFacility(t, request.body))),
  );

  app.patch(
    '/facilities/:id',
    {
      preHandler: manageSettings,
      schema: { params: idParams, body: facilityUpdateSchema, response: { 200: facilitySchema } },
    },
    (request) => request.tenant((t) => updateFacility(t, request.params.id, request.body)),
  );

  app.get(
    '/lab-requests',
    { schema: { querystring: labListQuery, response: { 200: z.array(labRequestSchema) } } },
    (request) => {
      const { session, clinic } = requireActiveClinic(request);
      const permission = request.query.box === 'awaiting' ? 'patients:write' : 'clinical:read';
      if (!hasPermission(clinic.roles, permission)) throw forbidden();
      return request.tenant((t) =>
        listLabRequests(t, request.query.box, {
          userId: session.user.id,
          isDoctor: clinic.roles.includes('doctor'),
          clinical: canReadClinical(request),
          scope: doctorScope(request),
        }),
      );
    },
  );

  app.get(
    '/patients/:id/lab-requests',
    {
      preHandler: readClinical,
      schema: { params: idParams, response: { 200: z.array(labRequestSchema) } },
    },
    (request) => request.tenant((t) => patientLabRequests(t, request.params.id)),
  );

  app.post(
    '/visits/:id/lab-requests',
    {
      preHandler: writeClinical,
      schema: {
        params: idParams,
        body: labRequestInputSchema,
        response: { 201: labRequestSchema },
      },
    },
    async (request, reply) => {
      const doctorId = requireDoctor(request);
      return reply
        .status(201)
        .send(
          await request.tenant((t) =>
            createLabRequest(t, request.params.id, doctorId, request.body),
          ),
        );
    },
  );

  app.get(
    '/lab-requests/:id/pdf',
    { preHandler: readClinical, schema: { params: idParams } },
    async (request, reply) => {
      const pdf = await request.tenant(async (t) => {
        const file = await labRequestPdf(t, request.params.id);
        await t.audit({
          action: 'lab_request.print',
          entityType: 'lab_request',
          entityId: request.params.id,
        });
        return file;
      });
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `inline; filename="lab-request-${request.params.id.slice(0, 8)}.pdf"`,
        )
        .send(pdf);
    },
  );

  app.post(
    '/lab-requests/:id/results',
    {
      // Results are scanned at the front desk; base64 adds a third to the 5 MB file limit.
      bodyLimit: Math.ceil((LAB_RESULT_MAX_BYTES * 4) / 3) + 64 * 1024,
      preHandler: requirePermission('patients:write'),
      schema: {
        params: idParams,
        body: labResultUploadSchema,
        response: { 201: labRequestSchema },
      },
    },
    async (request, reply) => {
      const { session } = requireActiveClinic(request);
      const updated = await request.tenant((t) =>
        addLabResult(
          t,
          request.params.id,
          session.user.id,
          request.body,
          doctorScope(request),
          canReadClinical(request),
        ),
      );
      return reply.status(201).send(updated);
    },
  );

  app.get(
    '/lab-results/:id',
    { preHandler: readClinical, schema: { params: idParams } },
    async (request, reply) => {
      const file = await request.tenant((t) => getLabResultFile(t, request.params.id));
      return reply
        .type(file.contentType)
        .header('content-disposition', `inline; filename="${safeFileName(file.fileName)}"`)
        .send(file.data);
    },
  );

  app.post(
    '/lab-requests/:id/review',
    {
      preHandler: writeClinical,
      schema: { params: idParams, body: labReviewSchema, response: { 200: labRequestSchema } },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) =>
        reviewLabRequest(t, request.params.id, doctorId, request.body.note ?? null),
      );
    },
  );

  app.post(
    '/lab-requests/:id/cancel',
    {
      preHandler: writeClinical,
      schema: { params: idParams, response: { 200: labRequestSchema } },
    },
    (request) => {
      const doctorId = requireDoctor(request);
      return request.tenant((t) => cancelLabRequest(t, request.params.id, doctorId));
    },
  );
};
