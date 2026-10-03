import { z } from 'zod';
import { normalizePhMobile } from '../phone';

export const uuidSchema = z.uuid();

export const isoDateSchema = z.iso.date();

export const phMobileSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a PH mobile number like 09171234567' });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const optionalEmail = z
  .union([z.literal(''), z.email().trim().toLowerCase()])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParams = z.object({ id: uuidSchema });
