import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { users } from './users';

export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    /** 0 = Sunday … 6 = Saturday */
    dayOfWeek: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    slotMinutes: integer().notNull().default(15),
    /** Daily cap for this doctor on this weekday; null means limited only by slots. */
    maxPatients: integer(),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.doctorId, t.dayOfWeek)],
);

export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    date: date().notNull(),
    isClosed: boolean().notNull().default(true),
    startTime: time(),
    endTime: time(),
    note: text(),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.doctorId, t.date)],
);
