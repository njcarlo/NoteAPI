import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  Facility,
  FacilityInput,
  LabBox,
  LabRequest,
  LabResultUpload,
  facilityUpdateSchema,
  labRequestInputSchema,
} from '@clinic/shared';
import type { z } from 'zod';
import {
  labRequests,
  labResults,
  partnerFacilities,
  patients,
  users,
  visits,
} from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { decodeLabResult, RESULT_EXT } from '../../lib/files';
import { renderLabRequestPdf } from '../../lib/lab-pdf';
import { iso } from '../../lib/sql';
import { storage } from '../../lib/storage';
import type { DoctorScope } from '../appointments/service';
import { loadSlipData } from '../consult/service';

type LabRequestInput = z.output<typeof labRequestInputSchema>;
type FacilityUpdate = z.output<typeof facilityUpdateSchema>;

const facilityColumns = {
  id: partnerFacilities.id,
  name: partnerFacilities.name,
  kind: partnerFacilities.kind,
  address: partnerFacilities.address,
  contactNumber: partnerFacilities.contactNumber,
  isActive: partnerFacilities.isActive,
};

export function listFacilities(t: TenantScope, includeInactive: boolean): Promise<Facility[]> {
  return t.tx
    .select(facilityColumns)
    .from(partnerFacilities)
    .where(
      t.where(
        partnerFacilities,
        includeInactive ? undefined : eq(partnerFacilities.isActive, true),
      ),
    )
    .orderBy(asc(partnerFacilities.kind), asc(partnerFacilities.name));
}

export async function createFacility(t: TenantScope, input: FacilityInput): Promise<Facility> {
  const [row] = await t.tx
    .insert(partnerFacilities)
    .values(
      t.values({
        name: input.name,
        kind: input.kind,
        address: input.address ?? null,
        contactNumber: input.contactNumber ?? null,
      }),
    )
    .returning(facilityColumns);
  await t.audit({ action: 'facility.create', entityType: 'facility', entityId: row!.id });
  return row!;
}

export async function updateFacility(
  t: TenantScope,
  id: string,
  input: FacilityUpdate,
): Promise<Facility> {
  if (Object.keys(input).length === 0) throw badRequest('Nothing to change');
  const [row] = await t.tx
    .update(partnerFacilities)
    .set(input)
    .where(t.where(partnerFacilities, eq(partnerFacilities.id, id)))
    .returning(facilityColumns);
  if (!row) throw notFound('Facility');
  await t.audit({
    action: 'facility.update',
    entityType: 'facility',
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return row;
}

function baseQuery(t: TenantScope) {
  return t.tx
    .select({
      request: labRequests,
      appointmentId: visits.appointmentId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      doctorName: users.name,
    })
    .from(labRequests)
    .innerJoin(visits, eq(visits.id, labRequests.visitId))
    .innerJoin(patients, eq(patients.id, labRequests.patientId))
    .innerJoin(users, eq(users.id, labRequests.doctorId));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['where']>>[number];

/** `clinical`: the caller may see clinical records; otherwise tests, notes and files are withheld. */
async function toLabRequests(
  t: TenantScope,
  rows: Row[],
  clinical: boolean,
): Promise<LabRequest[]> {
  const ids = rows.map((r) => r.request.id);
  const files = ids.length
    ? await t.tx
        .select({ result: labResults, uploadedByName: users.name })
        .from(labResults)
        .innerJoin(users, eq(users.id, labResults.uploadedBy))
        .where(t.where(labResults, inArray(labResults.labRequestId, ids)))
        .orderBy(asc(labResults.createdAt))
    : [];
  return rows.map(({ request: r, ...row }) => {
    const results = files
      .filter((f) => f.result.labRequestId === r.id)
      .map(({ result, uploadedByName }) => ({
        id: result.id,
        fileName: result.fileName,
        contentType: result.contentType,
        sizeBytes: result.sizeBytes,
        uploadedByName,
        createdAt: iso(result.createdAt),
      }));
    return {
      id: r.id,
      visitId: r.visitId,
      appointmentId: row.appointmentId,
      patient: { id: r.patientId, firstName: row.patientFirstName, lastName: row.patientLastName },
      doctorId: r.doctorId,
      doctorName: row.doctorName,
      facilityId: r.facilityId,
      facilityName: r.facilityName,
      tests: clinical ? r.tests : [],
      testCount: r.tests.length,
      fasting: r.fasting,
      clinicalImpression: clinical ? r.clinicalImpression : null,
      notes: clinical ? r.notes : null,
      status: r.status,
      reviewNote: clinical ? r.reviewNote : null,
      reviewedAt: r.reviewedAt && iso(r.reviewedAt),
      results: clinical ? results : [],
      resultCount: results.length,
      createdAt: iso(r.createdAt),
    };
  });
}

async function loadRow(t: TenantScope, id: string): Promise<Row> {
  const [row] = await baseQuery(t).where(t.where(labRequests, eq(labRequests.id, id)));
  if (!row) throw notFound('Lab request');
  return row;
}

async function loadOne(t: TenantScope, id: string, clinical = true): Promise<LabRequest> {
  return (await toLabRequests(t, [await loadRow(t, id)], clinical))[0]!;
}

/** The patient's lab requests from every visit, for the consultation screen (newest first). */
export async function consultLabRequests(t: TenantScope, patientId: string) {
  const rows = await baseQuery(t)
    .where(t.where(labRequests, eq(labRequests.patientId, patientId)))
    .orderBy(desc(labRequests.createdAt))
    .limit(20);
  return toLabRequests(t, rows, true);
}

export async function patientLabRequests(t: TenantScope, patientId: string) {
  const [patient] = await t.tx
    .select({ id: patients.id })
    .from(patients)
    .where(t.where(patients, eq(patients.id, patientId)));
  if (!patient) throw notFound('Patient');
  const rows = await baseQuery(t)
    .where(t.where(labRequests, eq(labRequests.patientId, patientId)))
    .orderBy(desc(labRequests.createdAt));
  await t.audit({ action: 'lab_request.list', entityType: 'patient', entityId: patientId });
  return toLabRequests(t, rows, true);
}

export async function listLabRequests(
  t: TenantScope,
  box: LabBox,
  caller: { userId: string; isDoctor: boolean; clinical: boolean; scope: DoctorScope },
): Promise<LabRequest[]> {
  let where;
  if (box === 'to_review') {
    if (!caller.isDoctor) throw forbidden();
    where = t.where(
      labRequests,
      eq(labRequests.doctorId, caller.userId),
      eq(labRequests.status, 'results_in'),
    );
  } else {
    // Patients bring results back to the front desk, so every pending request is listed
    // (limited to the doctors a secretary works for).
    where = t.where(
      labRequests,
      eq(labRequests.status, 'requested'),
      caller.scope ? inArray(labRequests.doctorId, caller.scope) : undefined,
    );
  }
  const rows = await baseQuery(t)
    .where(where)
    .orderBy(box === 'to_review' ? asc(labRequests.updatedAt) : desc(labRequests.createdAt))
    .limit(200);
  await t.audit({
    action: 'lab_request.list',
    entityType: 'lab_request',
    metadata: { box, count: rows.length },
  });
  return toLabRequests(t, rows, caller.clinical);
}

export async function createLabRequest(
  t: TenantScope,
  visitId: string,
  doctorId: string,
  input: LabRequestInput,
): Promise<LabRequest> {
  const [visit] = await t.tx
    .select()
    .from(visits)
    .where(t.where(visits, eq(visits.id, visitId)));
  if (!visit) throw notFound('Visit');
  if (visit.doctorId !== doctorId) throw forbidden();

  let facilityName = input.facilityName ?? null;
  if (input.facilityId) {
    const [facility] = await t.tx
      .select()
      .from(partnerFacilities)
      .where(
        t.where(
          partnerFacilities,
          eq(partnerFacilities.id, input.facilityId),
          eq(partnerFacilities.isActive, true),
        ),
      );
    if (!facility) throw notFound('Facility');
    facilityName = facility.name;
  }

  const [row] = await t.tx
    .insert(labRequests)
    .values(
      t.values({
        visitId,
        patientId: visit.patientId,
        doctorId,
        facilityId: input.facilityId ?? null,
        facilityName,
        tests: input.tests,
        fasting: input.fasting,
        clinicalImpression: input.clinicalImpression ?? null,
        notes: input.notes ?? null,
      }),
    )
    .returning({ id: labRequests.id });
  await t.audit({
    action: 'lab_request.create',
    entityType: 'lab_request',
    entityId: row!.id,
    metadata: { tests: input.tests.length, partner: Boolean(input.facilityId) },
  });
  return loadOne(t, row!.id);
}

/** Attaches a result file. Front-desk staff may upload but not open results afterwards. */
export async function addLabResult(
  t: TenantScope,
  id: string,
  userId: string,
  upload: LabResultUpload,
  scope: DoctorScope,
  clinical: boolean,
): Promise<LabRequest> {
  const { request } = await loadRow(t, id);
  if (scope && !scope.includes(request.doctorId)) throw notFound('Lab request');
  if (request.status === 'cancelled') throw conflict('This lab request was cancelled');
  const data = decodeLabResult(upload);
  // The file is stored first under a fresh id; result rows are insert-only, written once.
  const resultId = randomUUID();
  const key = `clinics/${t.clinicId}/lab-results/${resultId}.${RESULT_EXT[upload.contentType]}`;
  await storage.put(key, data);
  await t.tx.insert(labResults).values(
    t.values({
      id: resultId,
      labRequestId: id,
      storageKey: key,
      fileName: upload.fileName,
      contentType: upload.contentType,
      sizeBytes: data.length,
      uploadedBy: userId,
    }),
  );
  await t.tx
    .update(labRequests)
    .set({ status: 'results_in' })
    .where(t.where(labRequests, eq(labRequests.id, id)));
  await t.audit({
    action: 'lab_result.upload',
    entityType: 'lab_request',
    entityId: id,
    metadata: { resultId, contentType: upload.contentType, bytes: data.length },
  });
  return loadOne(t, id, clinical);
}

/** A result file, for doctors only. Every opening is audited. */
export async function getLabResultFile(t: TenantScope, resultId: string) {
  const [result] = await t.tx
    .select()
    .from(labResults)
    .where(t.where(labResults, eq(labResults.id, resultId)));
  if (!result) throw notFound('Result');
  const data = await storage.get(result.storageKey);
  if (!data) throw notFound('Result');
  await t.audit({
    action: 'lab_result.view',
    entityType: 'lab_request',
    entityId: result.labRequestId,
    metadata: { resultId },
  });
  return { data, contentType: result.contentType, fileName: result.fileName };
}

export async function reviewLabRequest(
  t: TenantScope,
  id: string,
  doctorId: string,
  note: string | null,
): Promise<LabRequest> {
  const { request } = await loadRow(t, id);
  if (request.doctorId !== doctorId) throw forbidden();
  if (request.status !== 'results_in') throw conflict('There are no new results to review');
  await t.tx
    .update(labRequests)
    .set({ status: 'reviewed', reviewNote: note, reviewedAt: new Date() })
    .where(t.where(labRequests, eq(labRequests.id, id)));
  await t.audit({ action: 'lab_request.review', entityType: 'lab_request', entityId: id });
  return loadOne(t, id);
}

export async function cancelLabRequest(
  t: TenantScope,
  id: string,
  doctorId: string,
): Promise<LabRequest> {
  const { request } = await loadRow(t, id);
  if (request.doctorId !== doctorId) throw forbidden();
  if (request.status !== 'requested')
    throw conflict('Results were already received for this request');
  await t.tx
    .update(labRequests)
    .set({ status: 'cancelled' })
    .where(t.where(labRequests, eq(labRequests.id, id)));
  await t.audit({ action: 'lab_request.cancel', entityType: 'lab_request', entityId: id });
  return loadOne(t, id);
}

export async function labRequestPdf(t: TenantScope, id: string): Promise<Buffer> {
  const { request: r } = await loadRow(t, id);
  const slip = await loadSlipData(t, r.doctorId, r.patientId, r.createdAt);
  if (!slip) throw notFound('Lab request');
  const [facility] = r.facilityId
    ? await t.tx
        .select()
        .from(partnerFacilities)
        .where(t.where(partnerFacilities, eq(partnerFacilities.id, r.facilityId)))
    : [];
  return renderLabRequestPdf({
    ...slip,
    facility: [r.facilityName, facility?.address].filter(Boolean).join(', ') || null,
    tests: r.tests,
    fasting: r.fasting,
    clinicalImpression: r.clinicalImpression,
    notes: r.notes,
  });
}
