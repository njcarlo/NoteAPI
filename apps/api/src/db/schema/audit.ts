import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './_shared';
import { clinics } from './clinics';
import { users } from './users';

/** Append-only: the application role is granted INSERT and SELECT only. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id),
    userId: uuid().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.clinicId, t.createdAt), index().on(t.clinicId, t.entityType, t.entityId)],
);
