import { z } from 'zod';
import { SEXES } from '../constants';
import { isoDateSchema, optionalEmail, optionalText, paginationQuery, phMobileSchema } from './common';

const patientFields = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  middleName: optionalText(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  birthdate: isoDateSchema.nullable().optional(),
  sex: z.enum(SEXES).nullable().optional(),
  mobile: phMobileSchema,
  email: optionalEmail,
  address: optionalText(500),
  allergies: optionalText(2000),
  conditions: optionalText(2000),
  smsOptIn: z.boolean(),
  emailOptIn: z.boolean(),
});

export const patientInputSchema = patientFields.extend({
  smsOptIn: z.boolean().default(true),
  emailOptIn: z.boolean().default(true),
});
export type PatientInput = z.input<typeof patientInputSchema>;
export type PatientData = z.output<typeof patientInputSchema>;

export const patientUpdateSchema = patientFields.partial();

export const patientListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
});

export const patientSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  birthdate: z.string().nullable(),
  sex: z.enum(SEXES).nullable(),
  mobile: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  allergies: z.string().nullable(),
  conditions: z.string().nullable(),
  smsOptIn: z.boolean(),
  emailOptIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Patient = z.infer<typeof patientSchema>;
