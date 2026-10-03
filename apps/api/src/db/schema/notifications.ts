import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    patientId: uuid().references(() => patients.id),
    event: text().notNull(),
    channel: notificationChannelEnum().notNull(),
    recipient: text().notNull(),
    status: notificationStatusEnum().notNull().default('queued'),
    providerMessageId: text(),
    error: text(),
    sentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.createdAt)],
);
