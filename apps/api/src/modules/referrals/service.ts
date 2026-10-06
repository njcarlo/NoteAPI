import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ageOn,
  formatPhMobile,
  utcToZoned,
  type Referral,
  type ReferralBox,
  type ReferralStatus,
  type ReferredFrom,
  type referralInputSchema,
} from '@clinic/shared';
import type { z } from 'zod';
import {
  appointments,
  doctorProfiles,
  patients,
  prescriptionItems,
  prescriptions,
  referrals,
  users,
  visits,
} from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { renderReferralPdf } from '../../lib/referral-pdf';
import { iso } from '../../lib/sql';
import { storage } from '../../lib/storage';
import { assertDoctorInScope, createAppointment, type DoctorScope } from '../appointments/service';
import { getClinic, getDoctor } from '../scheduling/service';

type ReferralInput = z.output<typeof referralInputSchema>;

const fromDoctor = alias(users, 'from_doctor');
const toDoctor = alias(users, 'to_doctor');
const scheduled = alias(appointments, 'scheduled');

function baseQuery(t: TenantScope) {
  return t.tx
    .select({
      referral: referrals,
      appointmentId: visits.appointmentId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      fromDoctorName: fromDoctor.name,
      toDoctorName: toDoctor.name,
      scheduledStartAt: scheduled.startAt,
    })
    .from(referrals)
    .innerJoin(visits, eq(visits.id, referrals.visitId))
    .innerJoin(patients, eq(patients.id, referrals.patientId))
    .innerJoin(fromDoctor, eq(fromDoctor.id, referrals.fromDoctorId))
    .leftJoin(toDoctor, eq(toDoctor.id, referrals.toDoctorId))
    .leftJoin(scheduled, eq(scheduled.id, referrals.scheduledAppointmentId));
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['where']>>[number];

/** `clinical`: the caller may see clinical records; otherwise reason and summary are withheld. */
function toReferral(row: Row, clinical: boolean): Referral {
  const r = row.referral;
  return {
    id: r.id,
    visitId: r.visitId,
    appointmentId: row.appointmentId,
    patient: { id: r.patientId, firstName: row.patientFirstName, lastName: row.patientLastName },
    fromDoctorId: r.fromDoctorId,
    fromDoctorName: row.fromDoctorName,
    specialty: r.specialty,
    toDoctorId: r.toDoctorId,
    toDoctorName: row.toDoctorName,
    externalDoctor: r.externalDoctor,
    externalFacility: r.externalFacility,
    urgency: r.urgency,
    status: r.status,
    reason: clinical ? r.reason : null,
    clinicalSummary: clinical ? r.clinicalSummary : null,
    responseNote: clinical ? r.responseNote : null,
    scheduledAppointmentId: r.scheduledAppointmentId,
    scheduledStartAt: row.scheduledStartAt && iso(row.scheduledStartAt),
    createdAt: iso(r.createdAt),
  };
}

// Emergency first, then oldest first: the front desk works the list from the top.
const byPriority = [desc(referrals.urgency), asc(referrals.createdAt)];

async function loadReferral(t: TenantScope, id: string) {
  const [row] = await baseQuery(t).where(t.where(referrals, eq(referrals.id, id)));
  if (!row) throw notFound('Referral');
  return row;
}

export async function getReferral(t: TenantScope, id: string): Promise<Referral> {
  const referral = toReferral(await loadReferral(t, id), true);
  await t.audit({ action: 'referral.view', entityType: 'referral', entityId: id });
  return referral;
}

/** Referrals written during a visit (shown on the consultation screen). */
export async function visitReferrals(t: TenantScope, visitId: string): Promise<Referral[]> {
  const rows = await baseQuery(t)
    .where(t.where(referrals, eq(referrals.visitId, visitId)))
    .orderBy(asc(referrals.createdAt));
  return rows.map((row) => toReferral(row, true));
}

export async function patientReferrals(t: TenantScope, patientId: string): Promise<Referral[]> {
  const [patient] = await t.tx
    .select({ id: patients.id })
    .from(patients)
    .where(t.where(patients, eq(patients.id, patientId)));
  if (!patient) throw notFound('Patient');
  const rows = await baseQuery(t)
    .where(t.where(referrals, eq(referrals.patientId, patientId)))
    .orderBy(desc(referrals.createdAt));
  await t.audit({ action: 'referral.list', entityType: 'patient', entityId: patientId });
  return rows.map((row) => toReferral(row, true));
}

export async function listReferrals(
  t: TenantScope,
  query: { box: ReferralBox; status?: ReferralStatus | undefined },
  caller: { userId: string; isDoctor: boolean; clinical: boolean; scope: DoctorScope },
): Promise<Referral[]> {
  let where;
  if (query.box === 'to_schedule') {
    // In-clinic referrals waiting for a booking, limited to the doctors this user works for.
    where = t.where(
      referrals,
      eq(referrals.status, 'pending'),
      isNotNull(referrals.toDoctorId),
      caller.scope ? inArray(referrals.toDoctorId, caller.scope) : undefined,
    );
  } else {
    if (!caller.isDoctor) throw forbidden();
    where = t.where(
      referrals,
      eq(query.box === 'incoming' ? referrals.toDoctorId : referrals.fromDoctorId, caller.userId),
      query.status ? eq(referrals.status, query.status) : undefined,
    );
  }
  const rows = await baseQuery(t)
    .where(where)
    .orderBy(...byPriority)
    .limit(200);
  await t.audit({
    action: 'referral.list',
    entityType: 'referral',
    metadata: { box: query.box, count: rows.length },
  });
  return rows.map((row) => toReferral(row, caller.clinical));
}

/** A referral is written by the visit's doctor, while the visit is open or after it is finished. */
export async function createReferral(
  t: TenantScope,
  visitId: string,
  doctorId: string,
  input: ReferralInput,
): Promise<Referral> {
  const [visit] = await t.tx
    .select()
    .from(visits)
    .where(t.where(visits, eq(visits.id, visitId)));
  if (!visit) throw notFound('Visit');
  if (visit.doctorId !== doctorId) throw forbidden();

  let target: {
    toDoctorId: string | null;
    externalDoctor: string | null;
    externalFacility: string | null;
  };
  if (input.toDoctorId) {
    if (input.toDoctorId === doctorId) throw badRequest('You cannot refer a patient to yourself');
    const receiving = await getDoctor(t, input.toDoctorId);
    if (receiving.specialty !== input.specialty)
      throw badRequest(`${receiving.name} is not listed under ${input.specialty}`);
    target = { toDoctorId: receiving.id, externalDoctor: null, externalFacility: null };
  } else {
    target = {
      toDoctorId: null,
      externalDoctor: input.externalDoctor ?? null,
      externalFacility: input.externalFacility ?? null,
    };
  }

  const [row] = await t.tx
    .insert(referrals)
    .values(
      t.values({
        visitId,
        patientId: visit.patientId,
        fromDoctorId: doctorId,
        specialty: input.specialty,
        ...target,
        urgency: input.urgency,
        reason: input.reason,
        clinicalSummary: input.clinicalSummary ?? null,
      }),
    )
    .returning({ id: referrals.id });
  await t.audit({
    action: 'referral.create',
    entityType: 'referral',
    entityId: row!.id,
    metadata: {
      specialty: input.specialty,
      internal: Boolean(target.toDoctorId),
      urgency: input.urgency,
    },
  });
  return toReferral(await loadReferral(t, row!.id), true);
}

/** Books an in-clinic referral with the receiving doctor. */
export async function scheduleReferral(
  t: TenantScope,
  id: string,
  startAt: string,
  scope: DoctorScope,
  clinical: boolean,
): Promise<Referral> {
  const { referral } = await loadReferral(t, id);
  if (!referral.toDoctorId) throw badRequest('This referral is to a doctor outside the clinic');
  assertDoctorInScope(scope, referral.toDoctorId);
  if (referral.status !== 'pending')
    throw conflict('This referral is no longer waiting to be booked');

  const appointment = await createAppointment(
    t,
    {
      doctorId: referral.toDoctorId,
      patientId: referral.patientId,
      startAt,
      reason: `Referral: ${referral.specialty}`,
    },
    scope,
  );
  // Guarded on status so two people booking at once cannot both win; the loser's appointment is
  // rolled back with the transaction.
  const [updated] = await t.tx
    .update(referrals)
    .set({ status: 'scheduled', scheduledAppointmentId: appointment.id })
    .where(t.where(referrals, eq(referrals.id, id), eq(referrals.status, 'pending')))
    .returning({ id: referrals.id });
  if (!updated) throw conflict('This referral was just booked by someone else');
  await t.audit({
    action: 'referral.schedule',
    entityType: 'referral',
    entityId: id,
    metadata: { appointmentId: appointment.id },
  });
  return toReferral(await loadReferral(t, id), clinical);
}

export async function declineReferral(
  t: TenantScope,
  id: string,
  doctorId: string,
  note: string,
): Promise<Referral> {
  const { referral } = await loadReferral(t, id);
  if (referral.toDoctorId !== doctorId) throw forbidden();
  if (referral.status !== 'pending')
    throw conflict('Only referrals that are not yet booked can be declined');
  await t.tx
    .update(referrals)
    .set({ status: 'declined', responseNote: note })
    .where(t.where(referrals, eq(referrals.id, id)));
  await t.audit({ action: 'referral.decline', entityType: 'referral', entityId: id });
  return toReferral(await loadReferral(t, id), true);
}

export async function cancelReferral(
  t: TenantScope,
  id: string,
  doctorId: string,
): Promise<Referral> {
  const { referral } = await loadReferral(t, id);
  if (referral.fromDoctorId !== doctorId) throw forbidden();
  if (referral.status !== 'pending')
    throw conflict(
      referral.status === 'scheduled'
        ? 'This referral is already booked. Cancel the appointment first.'
        : 'This referral is already closed',
    );
  await t.tx
    .update(referrals)
    .set({ status: 'cancelled' })
    .where(t.where(referrals, eq(referrals.id, id)));
  await t.audit({ action: 'referral.cancel', entityType: 'referral', entityId: id });
  return toReferral(await loadReferral(t, id), true);
}

/** The referral behind an appointment, for the receiving doctor's consultation screen. */
export async function referredFrom(
  t: TenantScope,
  appointmentId: string,
): Promise<ReferredFrom | null> {
  const [row] = await baseQuery(t).where(
    t.where(referrals, eq(referrals.scheduledAppointmentId, appointmentId)),
  );
  if (!row) return null;
  return {
    id: row.referral.id,
    fromDoctorName: row.fromDoctorName,
    specialty: row.referral.specialty,
    urgency: row.referral.urgency,
    reason: row.referral.reason,
    clinicalSummary: row.referral.clinicalSummary,
    createdAt: iso(row.referral.createdAt),
  };
}

const fullName = (p: { firstName: string; middleName: string | null; lastName: string }) =>
  [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

/** The referral letter, rendered on request (it reflects the referral's current addressee). */
export async function referralPdf(t: TenantScope, id: string): Promise<Buffer> {
  const { referral: r, toDoctorName } = await loadReferral(t, id);
  const clinic = await getClinic(t);
  const [patient] = await t.tx
    .select()
    .from(patients)
    .where(t.where(patients, eq(patients.id, r.patientId)));
  const [doctor] = await t.tx
    .select({ name: users.name, profile: doctorProfiles })
    .from(users)
    .leftJoin(
      doctorProfiles,
      and(eq(doctorProfiles.userId, users.id), eq(doctorProfiles.clinicId, t.clinicId)),
    )
    .where(eq(users.id, r.fromDoctorId));
  if (!patient || !doctor) throw notFound('Referral');
  const medicines = await t.tx
    .select({
      genericName: prescriptionItems.genericName,
      strength: prescriptionItems.strength,
      sig: prescriptionItems.sig,
    })
    .from(prescriptionItems)
    .innerJoin(prescriptions, eq(prescriptions.id, prescriptionItems.prescriptionId))
    .where(t.where(prescriptions, eq(prescriptions.visitId, r.visitId)))
    .orderBy(asc(prescriptionItems.sortOrder));
  const written = utcToZoned(r.createdAt, clinic.timezone).date;

  const [logo, signature] = await Promise.all([
    clinic.logoUrl ? storage.get(clinic.logoUrl) : null,
    doctor.profile?.signatureUrl ? storage.get(doctor.profile.signatureUrl) : null,
  ]);
  return renderReferralPdf({
    logo,
    signature,
    clinic: {
      name: clinic.name,
      address: clinic.address,
      contactNumber: clinic.contactNumber && formatPhMobile(clinic.contactNumber),
    },
    doctor: {
      name: doctor.name,
      specialty: doctor.profile?.specialty ?? null,
      prcNo: doctor.profile?.prcNo ?? '—',
      ptrNo: doctor.profile?.ptrNo ?? null,
    },
    to: {
      doctor: toDoctorName ?? r.externalDoctor,
      facility: r.toDoctorId ? clinic.name : r.externalFacility,
      specialty: r.specialty,
    },
    patient: {
      name: fullName(patient),
      age: patient.birthdate ? ageOn(patient.birthdate, written) : null,
      sex: patient.sex === 'male' ? 'M' : patient.sex === 'female' ? 'F' : null,
      allergies: patient.allergies,
    },
    date: new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(`${written}T00:00:00Z`),
    ),
    urgency: r.urgency,
    reason: r.reason,
    clinicalSummary: r.clinicalSummary,
    medicines: medicines.map((m) =>
      [m.genericName, m.strength, `— ${m.sig}`].filter(Boolean).join(' '),
    ),
  });
}
