import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  ageOn,
  ERROR_CODES,
  findAllergyMatches,
  RX_SHARE_DAYS,
  utcToZoned,
  type AmendmentInput,
  type Consult,
  type ConsultDraft,
  type finishVisitSchema,
  type Prescription,
  type Visit,
  type VisitSummary,
} from '@clinic/shared';
import type { z } from 'zod';
import {
  appointments,
  doctorProfiles,
  patients,
  prescriptionItems,
  prescriptions,
  rxShareTokens,
  users,
  visitAmendments,
  visits,
} from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { randomToken, sha256 } from '../../lib/crypto';
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  isExclusionViolation,
  notFound,
} from '../../lib/errors';
import { publishAppointmentsChanged } from '../../lib/events';
import { renderPrescriptionPdf } from '../../lib/rx-pdf';
import { iso } from '../../lib/sql';
import { storage } from '../../lib/storage';
import { insertAppointment } from '../appointments/service';
import { getClinic, lockDoctorDay } from '../scheduling/service';

type FinishInput = z.output<typeof finishVisitSchema>;

const num = (v: string | null) => (v == null ? null : Number(v));
const numeric = (v: number | null | undefined) => (v == null ? null : String(v));

async function loadAppointment(t: TenantScope, appointmentId: string) {
  const [row] = await t.tx
    .select({ appointment: appointments, doctorName: users.name })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  if (!row) throw notFound('Appointment');
  return row;
}

async function loadPrescription(t: TenantScope, visitId: string): Promise<Prescription | null> {
  const [rx] = await t.tx
    .select()
    .from(prescriptions)
    .where(t.where(prescriptions, eq(prescriptions.visitId, visitId)));
  if (!rx) return null;
  const items = await t.tx
    .select()
    .from(prescriptionItems)
    .where(t.where(prescriptionItems, eq(prescriptionItems.prescriptionId, rx.id)))
    .orderBy(asc(prescriptionItems.sortOrder));
  return {
    id: rx.id,
    issuedAt: iso(rx.issuedAt),
    notes: rx.notes,
    items: items.map((i) => ({
      id: i.id,
      drugId: i.drugId,
      genericName: i.genericName,
      brandName: i.brandName,
      strength: i.strength,
      form: i.form,
      sig: i.sig,
      quantity: i.quantity,
    })),
  };
}

async function loadVisit(t: TenantScope, appointmentId: string): Promise<Visit> {
  const { appointment: a, doctorName } = await loadAppointment(t, appointmentId);
  const [v] = await t.tx
    .select()
    .from(visits)
    .where(t.where(visits, eq(visits.appointmentId, appointmentId)));
  if (!v) throw notFound('Visit');
  const clinic = await getClinic(t);
  const amendments = await t.tx
    .select({ amendment: visitAmendments, authorName: users.name })
    .from(visitAmendments)
    .innerJoin(users, eq(users.id, visitAmendments.authorId))
    .where(t.where(visitAmendments, eq(visitAmendments.visitId, v.id)))
    .orderBy(asc(visitAmendments.createdAt));
  return {
    id: v.id,
    appointmentId: a.id,
    doctorId: a.doctorId,
    doctorName,
    date: utcToZoned(a.startAt, clinic.timezone).date,
    status: a.status,
    reason: a.reason,
    vitals: {
      bpSystolic: v.bpSystolic,
      bpDiastolic: v.bpDiastolic,
      temperatureC: num(v.temperatureC),
      heartRate: v.heartRate,
      respiratoryRate: v.respiratoryRate,
      weightKg: num(v.weightKg),
      heightCm: num(v.heightCm),
      o2Sat: v.o2Sat,
    },
    soap: {
      subjective: v.subjective,
      objective: v.objective,
      assessment: v.assessment,
      plan: v.plan,
    },
    followUpDate: v.followUpDate,
    locked: v.locked,
    finishedAt: v.finishedAt && iso(v.finishedAt),
    draft: v.draft ?? null,
    prescription: await loadPrescription(t, v.id),
    amendments: amendments.map(({ amendment: m, authorName }) => ({
      id: m.id,
      field: m.field,
      oldValue: m.oldValue,
      newValue: m.newValue,
      reason: m.reason,
      authorName,
      createdAt: iso(m.createdAt),
    })),
  };
}

async function loadHistory(
  t: TenantScope,
  patientId: string,
  excludeVisitId: string,
): Promise<VisitSummary[]> {
  const clinic = await getClinic(t);
  const rows = await t.tx
    .select({ visit: visits, startAt: appointments.startAt, doctorName: users.name })
    .from(visits)
    .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
    .innerJoin(users, eq(users.id, visits.doctorId))
    .where(
      t.where(
        visits,
        eq(visits.patientId, patientId),
        eq(visits.locked, true),
        ne(visits.id, excludeVisitId),
      ),
    )
    .orderBy(desc(appointments.startAt))
    .limit(20);
  const ids = rows.map((r) => r.visit.id);
  const meds = ids.length
    ? await t.tx
        .select({
          visitId: prescriptions.visitId,
          genericName: prescriptionItems.genericName,
          strength: prescriptionItems.strength,
        })
        .from(prescriptionItems)
        .innerJoin(prescriptions, eq(prescriptions.id, prescriptionItems.prescriptionId))
        .where(t.where(prescriptions, inArray(prescriptions.visitId, ids)))
        .orderBy(asc(prescriptionItems.sortOrder))
    : [];
  return rows.map(({ visit, startAt, doctorName }) => ({
    id: visit.id,
    appointmentId: visit.appointmentId,
    date: utcToZoned(startAt, clinic.timezone).date,
    doctorName,
    assessment: visit.assessment,
    medicines: meds
      .filter((m) => m.visitId === visit.id)
      .map((m) => [m.genericName, m.strength].filter(Boolean).join(' ')),
  }));
}

/** The consultation screen's data. Any doctor in the clinic may read; edits are limited below. */
export async function getConsult(
  t: TenantScope,
  appointmentId: string,
  userId: string,
): Promise<Consult> {
  const { appointment } = await loadAppointment(t, appointmentId);
  const [existing] = await t.tx
    .select({ id: visits.id })
    .from(visits)
    .where(t.where(visits, eq(visits.appointmentId, appointmentId)));
  if (!existing) {
    if (appointment.status !== 'in_consult' || appointment.doctorId !== userId)
      throw notFound('Visit');
    await t.tx
      .insert(visits)
      .values(
        t.values({
          appointmentId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
        }),
      );
  }
  const [patient] = await t.tx
    .select()
    .from(patients)
    .where(t.where(patients, eq(patients.id, appointment.patientId)));
  if (!patient) throw notFound('Patient');
  const visit = await loadVisit(t, appointmentId);
  await t.audit({ action: 'visit.view', entityType: 'visit', entityId: visit.id });
  return {
    patient: {
      id: patient.id,
      firstName: patient.firstName,
      middleName: patient.middleName,
      lastName: patient.lastName,
      birthdate: patient.birthdate,
      sex: patient.sex,
      mobile: patient.mobile,
      address: patient.address,
      allergies: patient.allergies,
      conditions: patient.conditions,
    },
    visit,
    history: await loadHistory(t, patient.id, visit.id),
  };
}

/** Loads an appointment the signed-in doctor is consulting on right now. */
async function ownOpenConsult(t: TenantScope, appointmentId: string, userId: string) {
  const { appointment } = await loadAppointment(t, appointmentId);
  if (appointment.doctorId !== userId) throw forbidden();
  const [visit] = await t.tx
    .select()
    .from(visits)
    .where(t.where(visits, eq(visits.appointmentId, appointmentId)));
  if (!visit) throw notFound('Visit');
  if (visit.locked)
    throw conflict('This visit is already finished. Use an amendment to change it.');
  if (appointment.status !== 'in_consult')
    throw conflict('Call the patient before starting the consultation');
  return { appointment, visit };
}

export async function saveDraft(
  t: TenantScope,
  appointmentId: string,
  userId: string,
  draft: ConsultDraft,
) {
  const { visit } = await ownOpenConsult(t, appointmentId, userId);
  await t.tx
    .update(visits)
    .set({ draft })
    .where(t.where(visits, eq(visits.id, visit.id)));
  await t.audit({ action: 'visit.draft', entityType: 'visit', entityId: visit.id });
  return { savedAt: new Date().toISOString() };
}

/**
 * Finishing a visit is one transaction: save notes and vitals, issue the prescription, book the
 * follow-up, mark the appointment done and lock the visit. The PDF is rendered after commit.
 */
export async function finishVisit(
  t: TenantScope,
  appointmentId: string,
  userId: string,
  input: FinishInput,
) {
  const { appointment, visit } = await ownOpenConsult(t, appointmentId, userId);
  const [patient] = await t.tx
    .select()
    .from(patients)
    .where(t.where(patients, eq(patients.id, appointment.patientId)));
  if (!patient) throw notFound('Patient');

  const items = input.rx?.items ?? [];
  const matches = findAllergyMatches(
    items.map((i) => i.genericName),
    patient.allergies,
  );
  if (matches.length && !input.allergyAcknowledged) {
    throw new AppError(
      409,
      ERROR_CODES.ALLERGY_WARNING,
      'Check the allergy warning before finishing',
      matches,
    );
  }

  const now = new Date();
  const v = input.vitals;
  await t.tx
    .update(visits)
    .set({
      ...input.soap,
      ...(v
        ? {
            bpSystolic: v.bpSystolic ?? null,
            bpDiastolic: v.bpDiastolic ?? null,
            temperatureC: numeric(v.temperatureC),
            heartRate: v.heartRate ?? null,
            respiratoryRate: v.respiratoryRate ?? null,
            weightKg: numeric(v.weightKg),
            heightCm: numeric(v.heightCm),
            o2Sat: v.o2Sat ?? null,
          }
        : {}),
      followUpDate: input.followUpDate ?? null,
      finishedAt: now,
      locked: true,
      draft: null,
    })
    .where(t.where(visits, eq(visits.id, visit.id)));

  let prescriptionId: string | null = null;
  if (items.length) {
    const [rx] = await t.tx
      .insert(prescriptions)
      .values(
        t.values({
          visitId: visit.id,
          doctorId: userId,
          patientId: patient.id,
          notes: input.rx?.notes ?? null,
          issuedAt: now,
        }),
      )
      .returning({ id: prescriptions.id });
    prescriptionId = rx!.id;
    await t.tx.insert(prescriptionItems).values(
      items.map((item, sortOrder) =>
        t.values({
          prescriptionId: prescriptionId as string,
          drugId: item.drugId ?? null,
          genericName: item.genericName,
          brandName: item.brandName ?? null,
          strength: item.strength ?? null,
          form: item.form ?? null,
          sig: item.sig,
          quantity: item.quantity,
          sortOrder,
        }),
      ),
    );
    await t.audit({
      action: 'prescription.create',
      entityType: 'prescription',
      entityId: prescriptionId,
      metadata: { items: items.length, allergyWarningAcknowledged: matches.length > 0 },
    });
  }

  await t.tx
    .update(appointments)
    .set({ status: 'done' })
    .where(t.where(appointments, eq(appointments.id, appointmentId)));

  if (input.followUpStartAt) {
    const startAt = new Date(input.followUpStartAt);
    if (startAt <= now) throw badRequest('The follow-up must be in the future');
    const clinic = await getClinic(t);
    await lockDoctorDay(t, userId, utcToZoned(startAt, clinic.timezone).date);
    const minutes = (appointment.endAt.getTime() - appointment.startAt.getTime()) / 60_000;
    try {
      await insertAppointment(t, {
        doctorId: userId,
        patientId: patient.id,
        startAt,
        endAt: new Date(
          startAt.getTime() + (appointment.type === 'walk_in' ? 15 : minutes) * 60_000,
        ),
        reason: 'Follow-up',
        source: 'staff',
      });
    } catch (error) {
      if (error instanceof AppError || isExclusionViolation(error))
        throw conflict('That follow-up time was just taken');
      throw error;
    }
  }

  await t.audit({
    action: 'visit.finish',
    entityType: 'visit',
    entityId: visit.id,
    metadata: { prescription: Boolean(prescriptionId) },
  });
  await publishAppointmentsChanged(t, userId);
  return { visit: await loadVisit(t, appointmentId), prescriptionId };
}

const fieldColumn = {
  subjective: 'subjective',
  objective: 'objective',
  assessment: 'assessment',
  plan: 'plan',
  followUpDate: 'followUpDate',
} as const;

/** Changes to a finished visit: recorded with old value, new value, reason and author. */
export async function amendVisit(
  t: TenantScope,
  visitId: string,
  userId: string,
  input: AmendmentInput,
) {
  const [v] = await t.tx
    .select()
    .from(visits)
    .where(t.where(visits, eq(visits.id, visitId)));
  if (!v) throw notFound('Visit');
  if (v.doctorId !== userId) throw forbidden();
  if (!v.locked) throw conflict('This visit is still open; edit it directly');
  const column = fieldColumn[input.field];
  const oldValue = v[column];
  const newValue = input.newValue?.trim() ? input.newValue : null;
  if ((oldValue ?? null) === newValue)
    throw badRequest('The new value is the same as the current one');

  await t.tx
    .update(visits)
    .set({ [column]: newValue })
    .where(t.where(visits, eq(visits.id, visitId)));
  await t.tx
    .insert(visitAmendments)
    .values(
      t.values({
        visitId,
        authorId: userId,
        field: input.field,
        oldValue,
        newValue,
        reason: input.reason,
      }),
    );
  await t.audit({
    action: 'visit.amend',
    entityType: 'visit',
    entityId: visitId,
    metadata: { field: input.field },
  });
  return loadVisit(t, v.appointmentId);
}

/** Returns the stored PDF, rendering (and storing) it first if needed. */
export async function prescriptionPdf(t: TenantScope, prescriptionId: string): Promise<Buffer> {
  const [rx] = await t.tx
    .select()
    .from(prescriptions)
    .where(t.where(prescriptions, eq(prescriptions.id, prescriptionId)));
  if (!rx) throw notFound('Prescription');
  if (rx.pdfUrl) {
    const stored = await storage.get(rx.pdfUrl);
    if (stored) return stored;
  }

  const clinic = await getClinic(t);
  const [patient] = await t.tx
    .select()
    .from(patients)
    .where(t.where(patients, eq(patients.id, rx.patientId)));
  const [doctor] = await t.tx
    .select({ name: users.name, profile: doctorProfiles })
    .from(users)
    .leftJoin(
      doctorProfiles,
      and(eq(doctorProfiles.userId, users.id), eq(doctorProfiles.clinicId, t.clinicId)),
    )
    .where(eq(users.id, rx.doctorId));
  if (!patient || !doctor) throw notFound('Prescription');
  const items = await t.tx
    .select()
    .from(prescriptionItems)
    .where(t.where(prescriptionItems, eq(prescriptionItems.prescriptionId, rx.id)))
    .orderBy(asc(prescriptionItems.sortOrder));
  const issued = utcToZoned(rx.issuedAt, clinic.timezone).date;

  const pdf = await renderPrescriptionPdf({
    clinic: { name: clinic.name, address: clinic.address, contactNumber: clinic.contactNumber },
    doctor: {
      name: doctor.name,
      specialty: doctor.profile?.specialty ?? null,
      prcNo: doctor.profile?.prcNo ?? '—',
      ptrNo: doctor.profile?.ptrNo ?? null,
      s2No: doctor.profile?.s2No ?? null,
    },
    patient: {
      name: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      age: patient.birthdate ? ageOn(patient.birthdate, issued) : null,
      sex: patient.sex === 'male' ? 'M' : patient.sex === 'female' ? 'F' : null,
      address: patient.address,
    },
    date: new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${issued}T00:00:00Z`),
    ),
    items,
    notes: rx.notes,
  });
  const key = `clinics/${t.clinicId}/prescriptions/${rx.id}.pdf`;
  await storage.put(key, pdf);
  await t.tx
    .update(prescriptions)
    .set({ pdfUrl: key })
    .where(t.where(prescriptions, eq(prescriptions.id, rx.id)));
  return pdf;
}

export async function createShareLink(t: TenantScope, prescriptionId: string) {
  const [rx] = await t.tx
    .select({ id: prescriptions.id })
    .from(prescriptions)
    .where(t.where(prescriptions, eq(prescriptions.id, prescriptionId)));
  if (!rx) throw notFound('Prescription');
  const token = randomToken();
  const expiresAt = new Date(Date.now() + RX_SHARE_DAYS * 86_400_000);
  await t.tx
    .insert(rxShareTokens)
    .values(t.values({ prescriptionId, tokenHash: sha256(token), expiresAt }));
  await t.audit({
    action: 'prescription.share',
    entityType: 'prescription',
    entityId: prescriptionId,
  });
  return { token, expiresAt: iso(expiresAt) };
}
