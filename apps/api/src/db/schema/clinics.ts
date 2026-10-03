import { pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { CLINIC_TIMEZONE } from '@clinic/shared';
import { id, timestamps } from './_shared';

export const clinics = pgTable('clinics', {
  id: id(),
  slug: varchar({ length: 63 }).notNull().unique(),
  name: text().notNull(),
  address: text(),
  contactNumber: text(),
  email: text(),
  logoUrl: text(),
  timezone: text().notNull().default(CLINIC_TIMEZONE),
  smsSenderName: varchar({ length: 11 }),
  ...timestamps,
});
