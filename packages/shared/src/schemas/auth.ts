import { z } from 'zod';
import { ROLES } from '../constants';

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes');

export const clinicMembershipSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  roles: z.array(z.enum(ROLES)),
});
export type ClinicMembership = z.infer<typeof clinicMembershipSchema>;

export const activeClinicSchema = clinicMembershipSchema.extend({
  /** Doctors this secretary is limited to; null means every doctor in the clinic. */
  assignedDoctorIds: z.array(z.uuid()).nullable(),
});
export type ActiveClinic = z.infer<typeof activeClinicSchema>;

export const sessionUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  isPlatformAdmin: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  clinics: z.array(clinicMembershipSchema),
  activeClinic: activeClinicSchema.nullable(),
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const selectClinicSchema = z.object({ clinicId: z.uuid() });
