import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { roleEnum } from './enums';

/** A person's login. Global: one account can belong to several clinics through memberships. */
export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  isActive: boolean().notNull().default(true),
  /** Operates the platform (clinics, billing). Grants no access to any clinic's patient data. */
  isPlatformAdmin: boolean().notNull().default(false),
  failedLoginCount: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  lastLoginAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

/** A user's roles in one clinic. */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    roles: roleEnum().array().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.clinicId, t.userId), index().on(t.userId)],
);

/**
 * Limits a secretary to specific doctors in a clinic. A secretary with no rows sees every doctor.
 */
export const secretaryAssignments = pgTable(
  'secretary_assignments',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    secretaryId: uuid()
      .notNull()
      .references(() => users.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.clinicId, t.secretaryId, t.doctorId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The clinic the user is currently working in; null until one is chosen. */
    activeClinicId: uuid().references(() => clinics.id),
    csrfToken: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ip: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

/** Credentials per clinic: the PTR number is issued by the city where the doctor practices. */
export const doctorProfiles = pgTable(
  'doctor_profiles',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    specialty: text(),
    prcNo: text().notNull(),
    ptrNo: text(),
    s2No: text(),
    signatureUrl: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.clinicId, t.userId)],
);
