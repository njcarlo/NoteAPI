import { z } from 'zod';
import { CLINIC_STATUSES } from '../constants';
import { slugSchema } from './auth';

export const platformClinicSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(CLINIC_STATUSES),
  doctorCount: z.number(),
  staffCount: z.number(),
  patientCount: z.number(),
  createdAt: z.string(),
});
export type PlatformClinic = z.infer<typeof platformClinicSchema>;

export const platformClinicCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Required').max(200),
    slug: slugSchema,
    address: z.string().trim().max(500).optional(),
    contactNumber: z.string().trim().max(50).optional(),
    adminName: z.string().trim().min(1, 'Required').max(200),
    adminEmail: z.email().trim().toLowerCase(),
    adminIsDoctor: z.boolean().default(false),
    prcNo: z.string().trim().max(20).optional(),
  })
  .refine((v) => !v.adminIsDoctor || Boolean(v.prcNo), {
    path: ['prcNo'],
    message: 'PRC license number is required for a doctor',
  });
export type PlatformClinicCreateInput = z.input<typeof platformClinicCreateSchema>;

export const platformClinicCreateResponseSchema = z.object({
  clinic: platformClinicSchema,
  adminEmail: z.string(),
  /** Shown once. Null when the admin already had an account. */
  temporaryPassword: z.string().nullable(),
});
export type PlatformClinicCreateResponse = z.infer<typeof platformClinicCreateResponseSchema>;

export const platformClinicUpdateSchema = z.object({
  status: z.enum(CLINIC_STATUSES),
});
