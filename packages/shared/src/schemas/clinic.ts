import { z } from 'zod';
import { optionalEmail, optionalText } from './common';

export const clinicProfileSchema = z.object({
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable(),
  contactNumber: z.string().nullable(),
  email: z.string().nullable(),
  smsSenderName: z.string().nullable(),
  hasLogo: z.boolean(),
});
export type ClinicProfile = z.infer<typeof clinicProfileSchema>;

export const clinicProfileInputSchema = z.object({
  name: z.string().trim().min(2, 'Required').max(200),
  address: optionalText(500),
  contactNumber: optionalText(50),
  email: optionalEmail,
  /** Registered SMS sender name: letters and digits, 11 characters at most. */
  smsSenderName: z
    .string()
    .trim()
    .max(11, 'At most 11 characters')
    .regex(/^[A-Za-z0-9 ]*$/, 'Letters and numbers only')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
export type ClinicProfileInput = z.input<typeof clinicProfileInputSchema>;

export const IMAGE_MAX_BYTES = 512 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;

/** Small images (logo, signature) sent as base64 JSON; checked again by content on the server. */
export const imageUploadSchema = z.object({
  contentType: z.enum(IMAGE_TYPES),
  data: z
    .string()
    .max(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 4, 'The image must be 512 KB or smaller')
    .regex(/^[A-Za-z0-9+/]+=*$/, 'Invalid image data'),
});
export type ImageUpload = z.infer<typeof imageUploadSchema>;
