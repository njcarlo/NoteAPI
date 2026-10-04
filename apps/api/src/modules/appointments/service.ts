import { asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  dayBounds,
  utcToZoned,
  type Appointment,
  type AppointmentCreateInput,
  type AppointmentMoveInput,
  type AppointmentSource,
} from '@clinic/shared';
import { appointments, patients, users } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { randomToken, sha256 } from '../../lib/crypto';
import {
  badRequest,
  conflict,
  forbidden,
  isExclusionViolation,
  isUniqueViolation,
  notFound,
} from '../../lib/errors';
import { referenceCode } from '../../lib/reference';
import { iso } from '../../lib/sql';
import { getClinic, getDoctor, lockDoctorDay, slotLengthAt } from '../scheduling/service';

/** Doctors a user may work with in the active clinic; null means every doctor. */
export type DoctorScope = string[] | null;

export function assertDoctorInScope(scope: DoctorScope, doctorId: string) {
  if (scope && !scope.includes(doctorId)) throw forbidden();
}

const selection = {
  appointment: appointments,
  doctorName: users.name,
  patient: {
    id: patients.id,
    firstName: patients.firstName,
    lastName: patients.lastName,
    mobile: patients.mobile,
  },
};

type Row = {
  appointment: typeof appointments.$inferSelect;
  doctorName: string;
  patient: Appointment['patient'];
};

const toAppointment = ({ appointment: a, doctorName, patient }: Row): Appointment => ({
  id: a.id,
  doctorId: a.doctorId,
  doctorName,
  patient,
  startAt: iso(a.startAt),
  endAt: iso(a.endAt),
  type: a.type,
  status: a.status,
  source: a.source,
  reason: a.reason,
  referenceCode: a.referenceCode,
  queueNumber: a.queueNumber,
});

function baseQuery(t: TenantScope) {
  return t.tx
    .select(selection)
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .innerJoin(patients, eq(patients.id, appointments.patientId));
}

export async function getAppointment(
  t: TenantScope,
  id: string,
  scope: DoctorScope,
): Promise<Appointment> {
  const [row] = await baseQuery(t).where(t.where(appointments, eq(appointments.id, id)));
  if (!row || (scope && !scope.includes(row.appointment.doctorId))) throw notFound('Appointment');
  return toAppointment(row);
}

export async function listAppointments(
  t: TenantScope,
  query: { from: string; to: string; doctorId?: string | undefined },
  scope: DoctorScope,
): Promise<Appointment[]> {
  if (query.doctorId) assertDoctorInScope(scope, query.doctorId);
  const clinic = await getClinic(t);
  const rows = await baseQuery(t)
    .where(
      t.where(
        appointments,
        gte(appointments.startAt, dayBounds(query.from, clinic.timezone).start),
        lt(appointments.startAt, dayBounds(query.to, clinic.timezone).end),
        query.doctorId ? eq(appointments.doctorId, query.doctorId) : undefined,
        scope ? inArray(appointments.doctorId, scope) : undefined,
      ),
    )
    .orderBy(asc(appointments.startAt));
  await t.audit({
    action: 'appointment.list',
    entityType: 'appointment',
    metadata: { from: query.from, to: query.to, count: rows.length },
  });
  return rows.map(toAppointment);
}

const overlapError = () => conflict('That time overlaps another appointment for this doctor');

/**
 * Inserts an appointment with a unique reference code and a cancel token.
 * Returns the raw cancel token (only its hash is stored).
 */
export async function insertAppointment(
  t: TenantScope,
  values: {
    doctorId: string;
    patientId: string;
    startAt: Date;
    endAt: Date;
    reason: string | null;
    source: AppointmentSource;
  },
): Promise<{ id: string; referenceCode: string; cancelToken: string }> {
  const cancelToken = randomToken();
  for (let attempt = 0; ; attempt++) {
    const code = referenceCode();
    try {
      // A savepoint keeps the outer transaction usable if the insert fails.
      const [row] = await t.tx.transaction((sp) =>
        sp
          .insert(appointments)
          .values(
            t.values({
              ...values,
              type: 'scheduled' as const,
              referenceCode: code,
              cancelTokenHash: sha256(cancelToken),
            }),
          )
          .returning({ id: appointments.id }),
      );
      if (!row) throw new Error('Insert returned no row');
      await t.audit({
        action: 'appointment.create',
        entityType: 'appointment',
        entityId: row.id,
        metadata: { source: values.source, doctorId: values.doctorId },
      });
      return { id: row.id, referenceCode: code, cancelToken };
    } catch (error) {
      if (isExclusionViolation(error)) throw overlapError();
      if (isUniqueViolation(error, 'appointments_reference_code_unique') && attempt < 3) continue;
      throw error;
    }
  }
}

export async function createAppointment(
  t: TenantScope,
  input: AppointmentCreateInput,
  scope: DoctorScope,
): Promise<Appointment> {
  assertDoctorInScope(scope, input.doctorId);
  await getDoctor(t, input.doctorId);
  const [patient] = await t.tx
    .select({ id: patients.id })
    .from(patients)
    .where(t.where(patients, eq(patients.id, input.patientId)));
  if (!patient) throw notFound('Patient');

  const clinic = await getClinic(t);
  const startAt = new Date(input.startAt);
  if (startAt.getTime() < Date.now() - 5 * 60_000) throw badRequest('Choose a time in the future');
  const minutes =
    input.durationMinutes ?? (await slotLengthAt(t, input.doctorId, startAt, clinic.timezone));
  await lockDoctorDay(t, input.doctorId, utcToZoned(startAt, clinic.timezone).date);

  const { id } = await insertAppointment(t, {
    doctorId: input.doctorId,
    patientId: input.patientId,
    startAt,
    endAt: new Date(startAt.getTime() + minutes * 60_000),
    reason: input.reason ?? null,
    source: 'staff',
  });
  return getAppointment(t, id, scope);
}

async function loadForChange(t: TenantScope, id: string, scope: DoctorScope) {
  const [row] = await t.tx
    .select()
    .from(appointments)
    .where(t.where(appointments, eq(appointments.id, id)));
  if (!row || (scope && !scope.includes(row.doctorId))) throw notFound('Appointment');
  return row;
}

export async function moveAppointment(
  t: TenantScope,
  id: string,
  input: AppointmentMoveInput,
  scope: DoctorScope,
): Promise<Appointment> {
  const current = await loadForChange(t, id, scope);
  if (current.status !== 'booked') throw conflict('Only booked appointments can be moved');
  const doctorId = input.doctorId ?? current.doctorId;
  assertDoctorInScope(scope, doctorId);
  if (doctorId !== current.doctorId) await getDoctor(t, doctorId);

  const startAt = new Date(input.startAt);
  if (startAt.getTime() < Date.now() - 5 * 60_000) throw badRequest('Choose a time in the future');
  const duration = current.endAt.getTime() - current.startAt.getTime();
  const clinic = await getClinic(t);
  await lockDoctorDay(t, doctorId, utcToZoned(startAt, clinic.timezone).date);
  try {
    await t.tx.transaction((sp) =>
      sp
        .update(appointments)
        .set({ doctorId, startAt, endAt: new Date(startAt.getTime() + duration) })
        .where(t.where(appointments, eq(appointments.id, id))),
    );
  } catch (error) {
    if (isExclusionViolation(error)) throw overlapError();
    throw error;
  }
  await t.audit({
    action: 'appointment.reschedule',
    entityType: 'appointment',
    entityId: id,
    metadata: { from: iso(current.startAt), to: iso(startAt), doctorId },
  });
  return getAppointment(t, id, scope);
}

export async function setAppointmentStatus(
  t: TenantScope,
  id: string,
  status: 'cancelled' | 'no_show',
  scope: DoctorScope,
): Promise<Appointment> {
  const current = await loadForChange(t, id, scope);
  if (current.status !== 'booked') {
    throw conflict(
      status === 'cancelled'
        ? 'Only booked appointments can be cancelled'
        : 'Only booked appointments can be marked as no-show',
    );
  }
  if (status === 'no_show' && current.startAt > new Date()) {
    throw conflict('An appointment can be marked as no-show only after its start time');
  }
  await t.tx
    .update(appointments)
    .set({ status })
    .where(t.where(appointments, eq(appointments.id, id)));
  await t.audit({
    action: status === 'cancelled' ? 'appointment.cancel' : 'appointment.no_show',
    entityType: 'appointment',
    entityId: id,
  });
  return getAppointment(t, id, scope);
}
