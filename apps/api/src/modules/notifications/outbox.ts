import { and, eq, inArray } from 'drizzle-orm';
import { addDays, utcToZoned, zonedToUtc, type NotificationEvent } from '@clinic/shared';
import { outbox, type OutboxPayload } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';

interface Enqueue {
  event: NotificationEvent;
  appointmentId?: string | null;
  patientId?: string | null;
  payload?: OutboxPayload;
  runAt?: Date;
}

/** Queues a notification inside the caller's transaction: it exists only if the change commits. */
export async function enqueue(t: TenantScope, item: Enqueue): Promise<void> {
  await t.tx.insert(outbox).values(
    t.values({
      event: item.event,
      appointmentId: item.appointmentId ?? null,
      patientId: item.patientId ?? null,
      payload: item.payload ?? {},
      runAt: item.runAt ?? new Date(),
    }),
  );
}

/** Reminder times: 6 PM the day before and 7 AM the same day (clinic time), if still ahead. */
export function reminderTimes(startAt: Date, timeZone: string, now = new Date()): Date[] {
  const date = utcToZoned(startAt, timeZone).date;
  return [
    zonedToUtc(addDays(date, -1), '18:00', timeZone),
    zonedToUtc(date, '07:00', timeZone),
  ].filter((at) => at > now && at < startAt);
}

export async function scheduleReminders(
  t: TenantScope,
  appointment: { id: string; patientId: string; startAt: Date },
  timeZone: string,
): Promise<void> {
  for (const runAt of reminderTimes(appointment.startAt, timeZone)) {
    await enqueue(t, {
      event: 'appointment.reminder',
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      payload: { startAt: appointment.startAt.toISOString() },
      runAt,
    });
  }
}

/** Drops reminders that have not been handed to the worker yet (moved, cancelled, arrived). */
export async function cancelPendingReminders(t: TenantScope, appointmentId: string): Promise<void> {
  await t.tx
    .delete(outbox)
    .where(
      t.where(
        outbox,
        and(
          eq(outbox.appointmentId, appointmentId),
          eq(outbox.status, 'pending'),
          inArray(outbox.event, ['appointment.reminder']),
        ),
      ),
    );
}

/** A nudge to book the follow-up: two days before the date at 9 AM, or soon if that has passed. */
export function followUpReminderTime(
  followUpDate: string,
  timeZone: string,
  now = new Date(),
): Date {
  const at = zonedToUtc(addDays(followUpDate, -2), '09:00', timeZone);
  return at > now ? at : new Date(now.getTime() + 60 * 60_000);
}
