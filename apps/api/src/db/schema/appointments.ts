import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { appointmentSourceEnum, appointmentStatusEnum, appointmentTypeEnum } from './enums';
import { patients } from './patients';
import { users } from './users';

export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    patientId: uuid()
      .notNull()
      .references(() => patients.id),
    startAt: timestamp({ withTimezone: true }).notNull(),
    endAt: timestamp({ withTimezone: true }).notNull(),
    type: appointmentTypeEnum().notNull().default('scheduled'),
    reason: text(),
    status: appointmentStatusEnum().notNull().default('booked'),
    source: appointmentSourceEnum().notNull().default('staff'),
    referenceCode: varchar({ length: 12 }).notNull().unique(),
    cancelTokenHash: text().unique(),
    queueNumber: integer(),
    arrivedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.clinicId, t.startAt),
    index().on(t.clinicId, t.doctorId, t.startAt),
    index().on(t.patientId),
  ],
);
