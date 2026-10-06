import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared';
import { clinics } from './clinics';
import { visits } from './clinical';
import { facilityKindEnum, labRequestStatusEnum } from './enums';
import { patients } from './patients';
import { users } from './users';

/** The clinic's partner laboratories, imaging centers, hospitals and specialist clinics. */
export const partnerFacilities = pgTable(
  'partner_facilities',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    name: text().notNull(),
    kind: facilityKindEnum().notNull(),
    address: text(),
    contactNumber: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [index().on(t.clinicId, t.kind)],
);

/** Tests the doctor asks a laboratory or imaging center to do; results come back as files. */
export const labRequests = pgTable(
  'lab_requests',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    visitId: uuid()
      .notNull()
      .references(() => visits.id),
    patientId: uuid()
      .notNull()
      .references(() => patients.id),
    doctorId: uuid()
      .notNull()
      .references(() => users.id),
    facilityId: uuid().references(() => partnerFacilities.id),
    /** Copied from the facility when requested, so the record keeps the name it was printed with. */
    facilityName: text(),
    tests: text().array().notNull(),
    fasting: boolean().notNull().default(false),
    clinicalImpression: text(),
    notes: text(),
    status: labRequestStatusEnum().notNull().default('requested'),
    reviewNote: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.clinicId, t.status),
    index().on(t.clinicId, t.patientId),
    index().on(t.clinicId, t.doctorId, t.status),
  ],
);

export const labResults = pgTable(
  'lab_results',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    labRequestId: uuid()
      .notNull()
      .references(() => labRequests.id),
    /** Private storage key; served only through the access-checked results route. */
    storageKey: text().notNull(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    uploadedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.labRequestId)],
);
