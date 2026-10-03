import { z } from 'zod';
import { ROLES } from '../constants';
import { passwordSchema } from './auth';

export const staffCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  email: z.email().trim().toLowerCase(),
  roles: z.array(z.enum(ROLES)).min(1, 'Pick at least one role'),
  password: passwordSchema,
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  roles: z.array(z.enum(ROLES)).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const staffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(ROLES)),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type Staff = z.infer<typeof staffSchema>;
