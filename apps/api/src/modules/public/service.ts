import { and, asc, eq, sql } from 'drizzle-orm';
import {
  addDays,
  ERROR_CODES,
  PUBLIC_BOOKING_DAYS_AHEAD,
  PUBLIC_BOOKING_LEAD_MINUTES,
  todayIn,
  utcToZoned,
  type CancelLookup,
  type PublicBookingResult,
  type PublicClinic,
  type PublicDay,
  type SlotDto,
} from '@clinic/shared';
import type { z } from 'zod';
import type { publicBookingSchema } from '@clinic/shared';
import { db } from '../../db/client';
import { appointments, clinics, patients, schedules, users } from '../../db/schema';
import { withTenant, type TenantScope } from '../../db/tenant';
import { sha256 } from '../../lib/crypto';
import { publishAppointmentsChanged, publishClinicEvent } from '../../lib/events';
import { cancelPendingReminders, enqueue } from '../notifications/outbox';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { iso } from '../../lib/sql';
import { insertAppointment } from '../appointments/service';
import { availableSlots, listDoctors, lockDoctorDay } from '../scheduling/service';

type BookingData = z.output<typeof publicBookingSchema>;

async function findClinic(slug: string) {
  const [clinic] = await db
    .select()
    .from(clinics)
    .where(and(eq(clinics.slug, slug), eq(clinics.status, 'active')));
  if (!clinic) throw notFound('Clinic');
  return clinic;
}

type Clinic = Awaited<ReturnType<typeof findClinic>>;

/** Runs `fn` inside the clinic named by `slug`, as an anonymous public actor. */
export async function inPublicClinic<T>(
  slug: string,
  ip: string | null,
  fn: (t: TenantScope, clinic: Clinic) => Promise<T>,
): Promise<T> {
  const clinic = await findClinic(slug);
  return withTenant(clinic.id, { userId: null, ip }, (t) => fn(t, clinic));
}

/** Doctors who have published hours; only they can be booked online. */
async function bookableDoctors(t: TenantScope) {
  const withHours = await t.tx
    .selectDistinct({ doctorId: schedules.doctorId })
    .from(schedules)
    .where(t.where(schedules));
  const ids = new Set(withHours.map((r) => r.doctorId));
  return (await listDoctors(t)).filter((d) => ids.has(d.id));
}

async function bookableDoctor(t: TenantScope, doctorId: string) {
  const doctor = (await bookableDoctors(t)).find((d) => d.id === doctorId);
  if (!doctor) throw notFound('Doctor');
  return doctor;
}

export async function publicClinic(t: TenantScope, clinic: Clinic): Promise<PublicClinic> {
  return {
    name: clinic.name,
    slug: clinic.slug,
    address: clinic.address,
    contactNumber: clinic.contactNumber,
    logoUrl: clinic.logoUrl,
    timezone: clinic.timezone,
    doctors: await bookableDoctors(t),
  };
}

function bookingWindow(clinic: Clinic) {
  const today = todayIn(clinic.timezone);
  return { first: today, last: addDays(today, PUBLIC_BOOKING_DAYS_AHEAD) };
}

const slotOptions = (clinic: Clinic) => ({
  timeZone: clinic.timezone,
  now: new Date(),
  minLeadMinutes: PUBLIC_BOOKING_LEAD_MINUTES,
});

/** Up to 14 days of availability counts, clipped to the booking window. */
export async function publicDays(
  t: TenantScope,
  clinic: Clinic,
  doctorId: string,
  from: string,
): Promise<PublicDay[]> {
  await bookableDoctor(t, doctorId);
  const { first, last } = bookingWindow(clinic);
  const start = from < first ? first : from;
  if (start > last) return [];
  const days = Math.min(14, Math.round((Date.parse(last) - Date.parse(start)) / 86_400_000) + 1);
  const slots = await availableSlots(t, { doctorId, from: start, days, ...slotOptions(clinic) });
  return [...slots].map(([date, list]) => ({ date, available: list.length }));
}

export async function publicSlots(
  t: TenantScope,
  clinic: Clinic,
  doctorId: string,
  date: string,
): Promise<SlotDto[]> {
  await bookableDoctor(t, doctorId);
  const { first, last } = bookingWindow(clinic);
  if (date < first || date > last) return [];
  const slots = await availableSlots(t, { doctorId, from: date, days: 1, ...slotOptions(clinic) });
  return (slots.get(date) ?? []).map((s) => ({ startAt: iso(s.startAt), endAt: iso(s.endAt) }));
}

export async function book(
  t: TenantScope,
  clinic: Clinic,
  input: BookingData,
): Promise<PublicBookingResult> {
  if (input.website) throw badRequest('The booking could not be completed');
  const doctor = await bookableDoctor(t, input.doctorId);

  const startAt = new Date(input.startAt);
  const date = utcToZoned(startAt, clinic.timezone).date;
  await lockDoctorDay(t, doctor.id, date);
  const slots =
    (
      await availableSlots(t, { doctorId: doctor.id, from: date, days: 1, ...slotOptions(clinic) })
    ).get(date) ?? [];
  const slot = slots.find((s) => s.startAt.getTime() === startAt.getTime());
  if (!slot || date > bookingWindow(clinic).last) {
    throw conflict('That time was just taken. Please choose another slot.');
  }

  // Returning patients are matched by mobile number and birthdate.
  const [existing] = await t.tx
    .select({ id: patients.id })
    .from(patients)
    .where(
      t.where(patients, eq(patients.mobile, input.mobile), eq(patients.birthdate, input.birthdate)),
    )
    .orderBy(asc(patients.createdAt))
    .limit(1);

  let patientId: string;
  if (existing) {
    patientId = existing.id;
    await t.tx
      .update(patients)
      .set({
        privacyConsentAt: new Date(),
        smsOptIn: input.smsOptIn,
        ...(input.email ? { email: input.email } : {}),
      })
      .where(t.where(patients, eq(patients.id, patientId)));
  } else {
    const [created] = await t.tx
      .insert(patients)
      .values(
        t.values({
          firstName: input.firstName,
          lastName: input.lastName,
          birthdate: input.birthdate,
          sex: input.sex ?? null,
          mobile: input.mobile,
          email: input.email ?? null,
          smsOptIn: input.smsOptIn,
          emailOptIn: Boolean(input.email),
          privacyConsentAt: new Date(),
        }),
      )
      .returning({ id: patients.id });
    if (!created) throw new Error('Insert returned no row');
    patientId = created.id;
    await t.audit({
      action: 'patient.create',
      entityType: 'patient',
      entityId: patientId,
      metadata: { source: 'public' },
    });
  }

  const booking = await insertAppointment(t, {
    doctorId: doctor.id,
    patientId,
    startAt: slot.startAt,
    endAt: slot.endAt,
    reason: input.reason ?? null,
    source: 'public',
  });
  await publishClinicEvent(t, {
    type: 'booking.created',
    doctorId: doctor.id,
    startAt: iso(slot.startAt),
  });
  return {
    referenceCode: booking.referenceCode,
    startAt: iso(slot.startAt),
    doctorName: doctor.name,
    clinicName: clinic.name,
    cancelToken: booking.cancelToken,
  };
}

interface TokenRow extends Record<string, unknown> {
  id: string;
  clinic_id: string;
}

/** Resolves a cancel link to its appointment, inside that clinic's scope. */
export async function withCancelToken<T>(
  token: string,
  ip: string | null,
  fn: (t: TenantScope, appointmentId: string) => Promise<T>,
): Promise<T> {
  const [row] = await db.execute<TokenRow>(
    sql`select * from appointment_by_cancel_token(${sha256(token)})`,
  );
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'This link is invalid or has expired');
  return withTenant(row.clinic_id, { userId: null, ip }, (t) => fn(t, row.id));
}

async function loadForCancel(t: TenantScope, appointmentId: string) {
  const [row] = await t.tx
    .select({ appointment: appointments, doctorName: users.name, clinicName: clinics.name })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  if (!row) throw notFound('Appointment');
  return row;
}

const isCancellable = (a: typeof appointments.$inferSelect) =>
  a.status === 'booked' && a.startAt > new Date();

export async function cancelLookup(t: TenantScope, appointmentId: string): Promise<CancelLookup> {
  const { appointment, doctorName, clinicName } = await loadForCancel(t, appointmentId);
  return {
    referenceCode: appointment.referenceCode,
    clinicName,
    doctorName,
    startAt: iso(appointment.startAt),
    status: appointment.status,
    cancellable: isCancellable(appointment),
  };
}

export async function cancelByToken(t: TenantScope, appointmentId: string): Promise<CancelLookup> {
  const { appointment } = await loadForCancel(t, appointmentId);
  if (!isCancellable(appointment))
    throw conflict('This appointment can no longer be cancelled online');
  await t.tx
    .update(appointments)
    .set({ status: 'cancelled' })
    .where(t.where(appointments, eq(appointments.id, appointmentId)));
  await t.audit({
    action: 'appointment.cancel',
    entityType: 'appointment',
    entityId: appointmentId,
    metadata: { via: 'link' },
  });
  await cancelPendingReminders(t, appointmentId);
  await enqueue(t, {
    event: 'appointment.cancelled',
    appointmentId,
    patientId: appointment.patientId,
  });
  await publishAppointmentsChanged(t, appointment.doctorId);
  return cancelLookup(t, appointmentId);
}
