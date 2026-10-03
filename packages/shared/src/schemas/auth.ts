import { z } from 'zod';
import { ROLES } from '../constants';

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200);

export const sessionUserSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  clinicName: z.string(),
  name: z.string(),
  email: z.email(),
  roles: z.array(z.enum(ROLES)),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
