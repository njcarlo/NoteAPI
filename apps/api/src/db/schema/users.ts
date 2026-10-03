import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { roleEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    name: text().notNull(),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    roles: roleEnum().array().notNull(),
    isActive: boolean().notNull().default(true),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    csrfToken: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ip: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const doctorProfiles = pgTable('doctor_profiles', {
  id: id(),
  clinicId: uuid()
    .notNull()
    .references(() => clinics.id),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => users.id),
  specialty: text(),
  prcNo: text().notNull(),
  ptrNo: text(),
  s2No: text(),
  signatureUrl: text(),
  ...timestamps,
});
