import { boolean, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { sexEnum } from './enums';

export const patients = pgTable(
  'patients',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    firstName: text().notNull(),
    middleName: text(),
    lastName: text().notNull(),
    birthdate: date(),
    sex: sexEnum(),
    mobile: text().notNull(),
    email: text(),
    address: text(),
    allergies: text(),
    conditions: text(),
    smsOptIn: boolean().notNull().default(true),
    emailOptIn: boolean().notNull().default(true),
    privacyConsentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.mobile, t.birthdate), index().on(t.clinicId, t.lastName)],
);
