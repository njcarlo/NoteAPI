import { z } from 'zod';
import { SEXES } from '../constants';
import { isoDateSchema, optionalEmail, optionalText, phMobileSchema } from './common';
import { doctorSchema } from './schedules';

export const PUBLIC_BOOKING_DAYS_AHEAD = 30;
export const PUBLIC_BOOKING_LEAD_MINUTES = 60;

export const publicClinicSchema = z.object({
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable(),
  contactNumber: z.string().nullable(),
  logoUrl: z.string().nullable(),
  timezone: z.string(),
  doctors: z.array(doctorSchema),
});
export type PublicClinic = z.infer<typeof publicClinicSchema>;

export const publicDaysQuery = z.object({ doctorId: z.uuid(), from: isoDateSchema });
export const publicDaySchema = z.object({ date: z.string(), available: z.number() });
export type PublicDay = z.infer<typeof publicDaySchema>;

export const publicSlotsQuery = z.object({ doctorId: z.uuid(), date: isoDateSchema });

export const publicBookingSchema = z.object({
  doctorId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  birthdate: isoDateSchema,
  sex: z.enum(SEXES).nullable().optional(),
  mobile: phMobileSchema,
  email: optionalEmail,
  reason: optionalText(300),
  smsOptIn: z.boolean(),
  privacyConsent: z.literal(true, { error: 'Please agree to the privacy notice to continue' }),
  /** Honeypot: hidden from people, filled in by bots. Must stay empty. */
  website: z.string().max(0).optional(),
});
export type PublicBookingInput = z.input<typeof publicBookingSchema>;

export const publicBookingResultSchema = z.object({
  referenceCode: z.string(),
  startAt: z.string(),
  doctorName: z.string(),
  clinicName: z.string(),
  cancelToken: z.string(),
});
export type PublicBookingResult = z.infer<typeof publicBookingResultSchema>;

export const cancelLookupSchema = z.object({
  referenceCode: z.string(),
  clinicName: z.string(),
  doctorName: z.string(),
  startAt: z.string(),
  status: z.string(),
  cancellable: z.boolean(),
});
export type CancelLookup = z.infer<typeof cancelLookupSchema>;

export const cancelTokenParams = z.object({ token: z.string().min(20).max(100) });
