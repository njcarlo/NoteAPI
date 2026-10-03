import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { appointments } from './appointments';
import { clinics } from './clinics';
import { patients } from './patients';
import { users } from './users';

export const visits = pgTable(
  'visits',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    appointmentId: uuid()
      .notNull()
      .unique()
      .references(() => appointments.id),
    patientId: uuid()
      .notNull()
      .references(() => patients.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    bpSystolic: integer(),
    bpDiastolic: integer(),
    temperatureC: numeric({ precision: 4, scale: 1 }),
    heartRate: integer(),
    respiratoryRate: integer(),
    weightKg: numeric({ precision: 5, scale: 2 }),
    heightCm: numeric({ precision: 5, scale: 1 }),
    o2Sat: integer(),
    subjective: text(),
    objective: text(),
    assessment: text(),
    plan: text(),
    followUpDate: date(),
    finishedAt: timestamp({ withTimezone: true }),
    locked: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.patientId)],
);

export const visitAmendments = pgTable(
  'visit_amendments',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    visitId: uuid()
      .notNull()
      .references(() => visits.id),
    authorId: uuid()
      .notNull()
      .references(() => users.id),
    field: text().notNull(),
    oldValue: text(),
    newValue: text(),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.visitId)],
);

export const drugs = pgTable(
  'drugs',
  {
    id: id(),
    genericName: text().notNull(),
    brandName: text(),
    form: text().notNull(),
    strength: text().notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.genericName)],
);

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    visitId: uuid()
      .notNull()
      .unique()
      .references(() => visits.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    patientId: uuid()
      .notNull()
      .references(() => patients.id),
    notes: text(),
    /** Storage key of the generated PDF; served only through authenticated or share-token routes. */
    pdfUrl: text(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.patientId)],
);

export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    prescriptionId: uuid()
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    drugId: uuid().references(() => drugs.id),
    genericName: text().notNull(),
    brandName: text(),
    strength: text(),
    form: text(),
    sig: text().notNull(),
    quantity: text().notNull(),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index().on(t.prescriptionId)],
);

export interface RxFavoriteItem {
  drugId: string | null;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  form: string | null;
  sig: string;
  quantity: string;
}

export const rxFavorites = pgTable(
  'rx_favorites',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    items: jsonb().$type<RxFavoriteItem[]>().notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.doctorId)],
);

export const rxShareTokens = pgTable('rx_share_tokens', {
  id: id(),
  clinicId: uuid()
    .notNull()
    .references(() => clinics.id),
  prescriptionId: uuid()
    .notNull()
    .references(() => prescriptions.id, { onDelete: 'cascade' }),
  tokenHash: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  accessedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
