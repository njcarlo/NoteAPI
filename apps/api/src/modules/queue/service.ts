import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import {
  todayIn,
  utcToZoned,
  type CheckInInput,
  type ProfileCompletion,
  type Queue,
  type QueueItem,
  type Vitals,
  type WalkInInput,
} from '@clinic/shared';
import { appointments, patients, users, visits } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { publishAppointmentsChanged } from '../../lib/events';
import { cancelPendingReminders } from '../notifications/outbox';
import { iso } from '../../lib/sql';
import {
  assertDoctorInScope,
  getAppointment,
  insertAppointment,
  type DoctorScope,
} from '../appointments/service';
import { getClinic, getDoctor, lockDoctorDay } from '../scheduling/service';

const numeric = (value: number | null | undefined) => (value == null ? null : String(value));
const toNumber = (value: string | null) => (value == null ? null : Number(value));

/** Vitals as stored on the visit row (numeric columns are strings in Postgres drivers). */
function vitalsColumns(v: Vitals) {
  return {
    bpSystolic: v.bpSystolic ?? null,
    bpDiastolic: v.bpDiastolic ?? null,
    temperatureC: numeric(v.temperatureC),
    heartRate: v.heartRate ?? null,
    respiratoryRate: v.respiratoryRate ?? null,
    weightKg: numeric(v.weightKg),
    heightCm: numeric(v.heightCm),
    o2Sat: v.o2Sat ?? null,
  };
}

/**
 * Selects only the vitals columns of a visit: secretaries never read clinical notes.
 * `visitId` comes first because Drizzle nulls a left-joined nested object when its first column
 * is null, which would hide partial vitals (e.g. only O2 saturation recorded).
 */
const vitalsSelection = {
  visitId: visits.id,
  bpSystolic: visits.bpSystolic,
  bpDiastolic: visits.bpDiastolic,
  temperatureC: visits.temperatureC,
  heartRate: visits.heartRate,
  respiratoryRate: visits.respiratoryRate,
  weightKg: visits.weightKg,
  heightCm: visits.heightCm,
  o2Sat: visits.o2Sat,
};

type VitalsRow = {
  [K in keyof typeof vitalsSelection]: (typeof vitalsSelection)[K]['_']['data'] | null;
};

const vitalsFromRow = (row: VitalsRow | null): QueueItem['vitals'] => ({
  bpSystolic: row?.bpSystolic ?? null,
  bpDiastolic: row?.bpDiastolic ?? null,
  temperatureC: toNumber(row?.temperatureC ?? null),
  heartRate: row?.heartRate ?? null,
  respiratoryRate: row?.respiratoryRate ?? null,
  weightKg: toNumber(row?.weightKg ?? null),
  heightCm: toNumber(row?.heightCm ?? null),
  o2Sat: row?.o2Sat ?? null,
});

/** Next queue number for a doctor's day. Caller must hold the doctor-day lock. */
async function nextQueueNumber(t: TenantScope, doctorId: string, date: string): Promise<number> {
  const [row] = await t.tx
    .select({ max: sql<number | null>`max(${appointments.queueNumber})` })
    .from(appointments)
    .where(
      t.where(appointments, eq(appointments.doctorId, doctorId), eq(appointments.queueDate, date)),
    );
  return (row?.max ?? 0) + 1;
}

async function completeProfile(
  t: TenantScope,
  patientId: string,
  profile: ProfileCompletion | undefined,
) {
  if (!profile) return;
  const changes = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) return;
  await t.tx
    .update(patients)
    .set(changes)
    .where(t.where(patients, eq(patients.id, patientId)));
  await t.audit({
    action: 'patient.update',
    entityType: 'patient',
    entityId: patientId,
    metadata: { fields: Object.keys(changes), via: 'check_in' },
  });
}

async function saveVitals(
  t: TenantScope,
  appointment: { id: string; patientId: string; doctorId: string },
  vitals: Vitals | undefined,
) {
  const [existing] = await t.tx
    .select({ id: visits.id, locked: visits.locked })
    .from(visits)
    .where(t.where(visits, eq(visits.appointmentId, appointment.id)));
  if (existing?.locked)
    throw conflict('This visit is finished; vitals can only be changed through an amendment');
  const columns = vitals ? vitalsColumns(vitals) : {};
  if (existing) {
    if (vitals)
      await t.tx
        .update(visits)
        .set(columns)
        .where(t.where(visits, eq(visits.id, existing.id)));
  } else {
    await t.tx.insert(visits).values(
      t.values({
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        ...columns,
      }),
    );
  }
  if (vitals) {
    await t.audit({ action: 'visit.vitals', entityType: 'appointment', entityId: appointment.id });
  }
}

export async function checkIn(
  t: TenantScope,
  appointmentId: string,
  input: CheckInInput & { vitals?: Vitals },
  scope: DoctorScope,
) {
  const [appt] = await t.tx
    .select()
    .from(appointments)
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  if (!appt || (scope && !scope.includes(appt.doctorId))) throw notFound('Appointment');
  if (appt.status !== 'booked') throw conflict('Only booked appointments can be checked in');

  const clinic = await getClinic(t);
  const today = todayIn(clinic.timezone);
  if (utcToZoned(appt.startAt, clinic.timezone).date !== today) {
    throw conflict('Only today’s appointments can be checked in');
  }

  await lockDoctorDay(t, appt.doctorId, today);
  const queueNumber = await nextQueueNumber(t, appt.doctorId, today);
  await t.tx
    .update(appointments)
    .set({ status: 'arrived', arrivedAt: new Date(), queueNumber, queueDate: today })
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  await completeProfile(t, appt.patientId, input.patient);
  await saveVitals(t, appt, input.vitals);
  await cancelPendingReminders(t, appointmentId);
  await t.audit({
    action: 'appointment.check_in',
    entityType: 'appointment',
    entityId: appointmentId,
    metadata: { queueNumber },
  });
  await publishAppointmentsChanged(t, appt.doctorId);
  return getAppointment(t, appointmentId, scope);
}

export async function walkIn(
  t: TenantScope,
  input: WalkInInput & { vitals?: Vitals },
  scope: DoctorScope,
) {
  assertDoctorInScope(scope, input.doctorId);
  await getDoctor(t, input.doctorId);
  const [patient] = await t.tx
    .select({ id: patients.id })
    .from(patients)
    .where(t.where(patients, eq(patients.id, input.patientId)));
  if (!patient) throw notFound('Patient');

  const clinic = await getClinic(t);
  const today = todayIn(clinic.timezone);
  await lockDoctorDay(t, input.doctorId, today);
  const queueNumber = await nextQueueNumber(t, input.doctorId, today);
  const now = new Date();
  const { id } = await insertAppointment(t, {
    doctorId: input.doctorId,
    patientId: input.patientId,
    startAt: now,
    endAt: new Date(now.getTime() + 15 * 60_000),
    reason: input.reason ?? null,
    source: 'staff',
    walkIn: { queueNumber, queueDate: today, arrivedAt: now },
  });
  await completeProfile(t, input.patientId, input.patient);
  await saveVitals(t, { id, patientId: input.patientId, doctorId: input.doctorId }, input.vitals);
  return getAppointment(t, id, scope);
}

export async function updateVitals(
  t: TenantScope,
  appointmentId: string,
  vitals: Vitals,
  scope: DoctorScope,
) {
  const [appt] = await t.tx
    .select()
    .from(appointments)
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  if (!appt || (scope && !scope.includes(appt.doctorId))) throw notFound('Appointment');
  if (appt.status !== 'arrived' && appt.status !== 'in_consult') {
    throw conflict('Vitals can be recorded only for patients who have arrived');
  }
  await saveVitals(t, appt, vitals);
  await publishAppointmentsChanged(t, appt.doctorId);
  return getQueueItem(t, appointmentId);
}

function queueQuery(t: TenantScope) {
  return t.tx
    .select({
      appointment: appointments,
      doctorName: users.name,
      patient: {
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        birthdate: patients.birthdate,
        sex: patients.sex,
        allergies: patients.allergies,
      },
      vitals: vitalsSelection,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(visits, eq(visits.appointmentId, appointments.id));
}

type QueueRow = Awaited<ReturnType<ReturnType<typeof queueQuery>['execute']>>[number];

const toQueueItem = ({ appointment: a, doctorName, patient, vitals }: QueueRow): QueueItem => ({
  appointmentId: a.id,
  doctorId: a.doctorId,
  doctorName,
  status: a.status,
  queueNumber: a.queueNumber,
  arrivedAt: a.arrivedAt && iso(a.arrivedAt),
  type: a.type,
  startAt: iso(a.startAt),
  patient,
  vitals: vitalsFromRow(vitals),
});

async function getQueueItem(t: TenantScope, appointmentId: string): Promise<QueueItem> {
  const [row] = await queueQuery(t).where(
    t.where(appointments, eq(appointments.id, appointmentId)),
  );
  if (!row) throw notFound('Appointment');
  return toQueueItem(row);
}

export async function getQueue(
  t: TenantScope,
  doctorId: string | undefined,
  scope: DoctorScope,
): Promise<Queue> {
  if (doctorId) assertDoctorInScope(scope, doctorId);
  const clinic = await getClinic(t);
  const today = todayIn(clinic.timezone);
  const doctorFilter = doctorId
    ? eq(appointments.doctorId, doctorId)
    : scope
      ? inArray(appointments.doctorId, scope)
      : undefined;

  const [rows, [done]] = await Promise.all([
    queueQuery(t)
      .where(
        t.where(
          appointments,
          eq(appointments.queueDate, today),
          inArray(appointments.status, ['arrived', 'in_consult']),
          doctorFilter,
        ),
      )
      .orderBy(asc(appointments.queueNumber)),
    t.tx
      .select({ value: count() })
      .from(appointments)
      .where(
        t.where(
          appointments,
          eq(appointments.queueDate, today),
          eq(appointments.status, 'done'),
          doctorFilter,
        ),
      ),
  ]);
  await t.audit({
    action: 'queue.view',
    entityType: 'appointment',
    metadata: { count: rows.length },
  });
  const items = rows.map(toQueueItem);
  return {
    date: today,
    inConsult: items.filter((i) => i.status === 'in_consult'),
    waiting: items.filter((i) => i.status === 'arrived'),
    doneCount: done?.value ?? 0,
  };
}

/** A doctor calls a waiting patient (a specific one, or the next by queue number). */
export async function callPatient(
  t: TenantScope,
  doctorId: string,
  appointmentId?: string,
): Promise<QueueItem> {
  const clinic = await getClinic(t);
  const today = todayIn(clinic.timezone);
  const [appt] = await t.tx
    .select()
    .from(appointments)
    .where(
      t.where(
        appointments,
        appointmentId ? eq(appointments.id, appointmentId) : undefined,
        eq(appointments.doctorId, doctorId),
        eq(appointments.queueDate, today),
        eq(appointments.status, 'arrived'),
      ),
    )
    .orderBy(asc(appointments.queueNumber))
    .limit(1)
    .for('update', { skipLocked: true });
  if (!appt) throw appointmentId ? notFound('Waiting patient') : conflict('No one is waiting');

  await t.tx
    .update(appointments)
    .set({ status: 'in_consult' })
    .where(t.where(appointments, eq(appointments.id, appt.id)));
  await t.audit({
    action: 'queue.call',
    entityType: 'appointment',
    entityId: appt.id,
    metadata: { queueNumber: appt.queueNumber },
  });
  await publishAppointmentsChanged(t, doctorId);
  return getQueueItem(t, appt.id);
}

/** Sends a patient in consult back to the waiting list (e.g. called by mistake). */
export async function requeue(
  t: TenantScope,
  doctorId: string,
  appointmentId: string,
): Promise<QueueItem> {
  const [appt] = await t.tx
    .select()
    .from(appointments)
    .where(
      t.where(
        appointments,
        eq(appointments.id, appointmentId),
        eq(appointments.doctorId, doctorId),
      ),
    );
  if (!appt) throw forbidden();
  if (appt.status !== 'in_consult') throw conflict('This patient is not in consult');
  await t.tx
    .update(appointments)
    .set({ status: 'arrived' })
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  await t.audit({ action: 'queue.requeue', entityType: 'appointment', entityId: appointmentId });
  await publishAppointmentsChanged(t, doctorId);
  return getQueueItem(t, appointmentId);
}
