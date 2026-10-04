import { and, asc, eq, gte, lt, lte, notInArray, sql } from 'drizzle-orm';
import {
  addDays,
  dayBounds,
  dayOfWeek,
  generateSlots,
  hhmm,
  todayIn,
  utcToZoned,
  type Doctor,
  type DoctorSchedule,
  type ScheduleExceptionInput,
  type Slot,
  type WeeklyScheduleInput,
} from '@clinic/shared';
import {
  appointments,
  clinics,
  doctorProfiles,
  memberships,
  scheduleExceptions,
  schedules,
  users,
} from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { conflict, notFound } from '../../lib/errors';

export async function getClinic(t: TenantScope) {
  const [clinic] = await t.tx.select().from(clinics).where(eq(clinics.id, t.clinicId));
  if (!clinic) throw notFound('Clinic');
  return clinic;
}

export async function listDoctors(t: TenantScope): Promise<Doctor[]> {
  return t.tx
    .select({ id: users.id, name: users.name, specialty: doctorProfiles.specialty })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(
      doctorProfiles,
      and(
        eq(doctorProfiles.userId, memberships.userId),
        eq(doctorProfiles.clinicId, memberships.clinicId),
      ),
    )
    .where(
      t.where(
        memberships,
        eq(memberships.isActive, true),
        sql`'doctor' = any(${memberships.roles})`,
      ),
    )
    .orderBy(asc(users.name));
}

export async function getDoctor(t: TenantScope, doctorId: string): Promise<Doctor> {
  const doctor = (await listDoctors(t)).find((d) => d.id === doctorId);
  if (!doctor) throw notFound('Doctor');
  return doctor;
}

export async function getSchedule(t: TenantScope, doctorId: string): Promise<DoctorSchedule> {
  await getDoctor(t, doctorId);
  const clinic = await getClinic(t);
  const [blocks, exceptions] = await Promise.all([
    t.tx
      .select()
      .from(schedules)
      .where(t.where(schedules, eq(schedules.doctorId, doctorId)))
      .orderBy(asc(schedules.dayOfWeek), asc(schedules.startTime)),
    t.tx
      .select()
      .from(scheduleExceptions)
      .where(
        t.where(
          scheduleExceptions,
          eq(scheduleExceptions.doctorId, doctorId),
          gte(scheduleExceptions.date, todayIn(clinic.timezone)),
        ),
      )
      .orderBy(asc(scheduleExceptions.date)),
  ]);
  return {
    blocks: blocks.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startTime: hhmm(b.startTime),
      endTime: hhmm(b.endTime),
      slotMinutes: b.slotMinutes,
      maxPatients: b.maxPatients,
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      date: e.date,
      isClosed: e.isClosed,
      startTime: e.startTime && hhmm(e.startTime),
      endTime: e.endTime && hhmm(e.endTime),
      note: e.note,
    })),
  };
}

export async function replaceSchedule(
  t: TenantScope,
  doctorId: string,
  input: WeeklyScheduleInput,
) {
  await getDoctor(t, doctorId);
  await t.tx.delete(schedules).where(t.where(schedules, eq(schedules.doctorId, doctorId)));
  if (input.blocks.length) {
    await t.tx.insert(schedules).values(input.blocks.map((b) => t.values({ ...b, doctorId })));
  }
  await t.audit({
    action: 'schedule.update',
    entityType: 'doctor',
    entityId: doctorId,
    metadata: { blocks: input.blocks.length },
  });
  return getSchedule(t, doctorId);
}

export async function addException(
  t: TenantScope,
  doctorId: string,
  input: ScheduleExceptionInput,
) {
  await getDoctor(t, doctorId);
  const [existing] = await t.tx
    .select({ id: scheduleExceptions.id })
    .from(scheduleExceptions)
    .where(
      t.where(
        scheduleExceptions,
        eq(scheduleExceptions.doctorId, doctorId),
        eq(scheduleExceptions.date, input.date),
      ),
    );
  if (existing) throw conflict('There is already an exception on that date');
  await t.tx.insert(scheduleExceptions).values(
    t.values({
      doctorId,
      date: input.date,
      isClosed: input.isClosed,
      startTime: input.isClosed ? null : (input.startTime ?? null),
      endTime: input.isClosed ? null : (input.endTime ?? null),
      note: input.note ?? null,
    }),
  );
  await t.audit({
    action: 'schedule.exception.create',
    entityType: 'doctor',
    entityId: doctorId,
    metadata: { date: input.date },
  });
  return getSchedule(t, doctorId);
}

export async function deleteException(t: TenantScope, doctorId: string, exceptionId: string) {
  const [row] = await t.tx
    .delete(scheduleExceptions)
    .where(
      t.where(
        scheduleExceptions,
        eq(scheduleExceptions.id, exceptionId),
        eq(scheduleExceptions.doctorId, doctorId),
      ),
    )
    .returning({ date: scheduleExceptions.date });
  if (!row) throw notFound('Exception');
  await t.audit({
    action: 'schedule.exception.delete',
    entityType: 'doctor',
    entityId: doctorId,
    metadata: { date: row.date },
  });
  return getSchedule(t, doctorId);
}

const INACTIVE = ['cancelled', 'no_show'] as const;

/** Bookable slots per date for one doctor, for `days` consecutive dates starting at `from`. */
export async function availableSlots(
  t: TenantScope,
  opts: {
    doctorId: string;
    from: string;
    days: number;
    timeZone: string;
    now: Date;
    minLeadMinutes: number;
  },
): Promise<Map<string, Slot[]>> {
  const to = addDays(opts.from, opts.days - 1);
  const rangeStart = dayBounds(opts.from, opts.timeZone).start;
  const rangeEnd = dayBounds(to, opts.timeZone).end;

  const [blocks, exceptions, busy] = await Promise.all([
    t.tx
      .select()
      .from(schedules)
      .where(t.where(schedules, eq(schedules.doctorId, opts.doctorId))),
    t.tx
      .select()
      .from(scheduleExceptions)
      .where(
        t.where(
          scheduleExceptions,
          eq(scheduleExceptions.doctorId, opts.doctorId),
          gte(scheduleExceptions.date, opts.from),
          lte(scheduleExceptions.date, to),
        ),
      ),
    t.tx
      .select({ startAt: appointments.startAt, endAt: appointments.endAt })
      .from(appointments)
      .where(
        t.where(
          appointments,
          eq(appointments.doctorId, opts.doctorId),
          eq(appointments.type, 'scheduled'),
          notInArray(appointments.status, [...INACTIVE]),
          lt(appointments.startAt, rangeEnd),
          gte(appointments.endAt, rangeStart),
        ),
      ),
  ]);

  const result = new Map<string, Slot[]>();
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    const exception = exceptions.find((e) => e.date === date);
    result.set(
      date,
      generateSlots({
        date,
        timeZone: opts.timeZone,
        blocks: blocks
          .filter((b) => b.dayOfWeek === dayOfWeek(date))
          .map((b) => ({ ...b, startTime: hhmm(b.startTime), endTime: hhmm(b.endTime) })),
        exception: exception
          ? {
              isClosed: exception.isClosed,
              startTime: exception.startTime && hhmm(exception.startTime),
              endTime: exception.endTime && hhmm(exception.endTime),
            }
          : null,
        busy,
        now: opts.now,
        minLeadMinutes: opts.minLeadMinutes,
      }),
    );
  }
  return result;
}

/** Slot length the doctor's schedule uses at a given time; falls back to 15 minutes. */
export async function slotLengthAt(
  t: TenantScope,
  doctorId: string,
  startAt: Date,
  timeZone: string,
) {
  const { date, time: local } = utcToZoned(startAt, timeZone);
  const rows = await t.tx
    .select()
    .from(schedules)
    .where(
      t.where(
        schedules,
        eq(schedules.doctorId, doctorId),
        eq(schedules.dayOfWeek, dayOfWeek(date)),
      ),
    );
  const block = rows.find((b) => hhmm(b.startTime) <= local && local < hhmm(b.endTime));
  return block?.slotMinutes ?? rows[0]?.slotMinutes ?? 15;
}

/** Serializes bookings for one doctor-day so caps and slot checks are race-free. */
export async function lockDoctorDay(t: TenantScope, doctorId: string, date: string) {
  await t.tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${doctorId}:${date}`}, 0))`,
  );
}
