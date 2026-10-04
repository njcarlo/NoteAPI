import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './appointments';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { notificationChannelEnum, notificationStatusEnum } from './enums';
import { patients } from './patients';

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    event: text().notNull(),
    channel: notificationChannelEnum().notNull(),
    subject: text(),
    body: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.clinicId, t.event, t.channel)],
);

export interface OutboxPayload {
  /** For reminders: the start time the reminder was scheduled for (skipped if it moved). */
  startAt?: string;
  prescriptionId?: string | null;
  followUpDate?: string;
  /** Booked online: also alert clinic staff. */
  public?: boolean;
}

/**
 * Notifications to send, written in the same transaction as the change that causes them.
 * Pending future rows (reminders) are deleted when an appointment is moved or cancelled.
 * The worker relays due rows to pg-boss, which sends them with retries.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    event: text().notNull(),
    appointmentId: uuid().references(() => appointments.id),
    patientId: uuid().references(() => patients.id),
    payload: jsonb().$type<OutboxPayload>().notNull().default({}),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** pending → dispatching (claimed by the relay) → done */
    status: text().notNull().default('pending'),
    claimedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.status, t.runAt), index().on(t.appointmentId)],
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    patientId: uuid().references(() => patients.id),
    /** The outbox row that produced this message; one log per channel per outbox row. */
    outboxId: uuid().references(() => outbox.id),
    event: text().notNull(),
    channel: notificationChannelEnum().notNull(),
    recipient: text().notNull(),
    status: notificationStatusEnum().notNull().default('queued'),
    providerMessageId: text(),
    error: text(),
    sentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.createdAt), uniqueIndex().on(t.outboxId, t.channel)],
);
