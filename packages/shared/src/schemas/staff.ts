import { z } from 'zod';
import { ROLES } from '../constants';
import { passwordSchema } from './auth';

const rolesSchema = z.array(z.enum(ROLES)).min(1, 'Pick at least one role');

export const staffCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  email: z.email().trim().toLowerCase(),
  roles: rolesSchema,
  /** Required for a new account; ignored when the email already has an account (e.g. a doctor who also works elsewhere). */
  password: z.union([z.literal(''), passwordSchema]).optional(),
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  roles: rolesSchema.optional(),
  isActive: z.boolean().optional(),
  /** Secretaries only: limit to these doctors. An empty list means all doctors. */
  doctorIds: z.array(z.uuid()).optional(),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const staffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(ROLES)),
  isActive: z.boolean(),
  doctorIds: z.array(z.uuid()),
  createdAt: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;

export const staffCreateResponseSchema = staffSchema.extend({
  /** True when an existing account was added to this clinic instead of creating a new one. */
  linkedExistingAccount: z.boolean(),
});
export type StaffCreateResponse = z.infer<typeof staffCreateResponseSchema>;
