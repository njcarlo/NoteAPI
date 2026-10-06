import { z } from 'zod';
import { FACILITY_KINDS, LAB_REQUEST_STATUSES } from '../constants';
import { optionalText } from './common';

export const facilitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(FACILITY_KINDS),
  address: z.string().nullable(),
  contactNumber: z.string().nullable(),
  isActive: z.boolean(),
});
export type Facility = z.infer<typeof facilitySchema>;

export const facilityInputSchema = z.object({
  name: z.string().trim().min(2, 'Required').max(200),
  kind: z.enum(FACILITY_KINDS),
  address: optionalText(500),
  contactNumber: optionalText(50),
});
export type FacilityInput = z.input<typeof facilityInputSchema>;

export const facilityUpdateSchema = facilityInputSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const facilityListQuery = z.object({
  /** Include deactivated facilities (Settings); forms only offer active ones. */
  all: z.enum(['true', 'false']).optional(),
});

export const labRequestInputSchema = z.object({
  /** A partner facility, or a typed name for a one-off place. */
  facilityId: z.uuid().nullable().optional(),
  facilityName: optionalText(200),
  tests: z
    .array(z.string().trim().min(1).max(120))
    .min(1, 'Choose at least one test')
    .max(40)
    .refine((tests) => new Set(tests).size === tests.length, 'A test is listed twice'),
  fasting: z.boolean().default(false),
  clinicalImpression: optionalText(1000),
  notes: optionalText(1000),
});
export type LabRequestInput = z.input<typeof labRequestInputSchema>;

export const labResultSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  uploadedByName: z.string(),
  createdAt: z.string(),
});
export type LabResult = z.infer<typeof labResultSchema>;

export const labRequestSchema = z.object({
  id: z.uuid(),
  visitId: z.uuid(),
  appointmentId: z.uuid(),
  patient: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  doctorId: z.uuid(),
  doctorName: z.string(),
  facilityId: z.uuid().nullable(),
  facilityName: z.string().nullable(),
  /** Clinical fields (tests, impression, notes, result files) are empty for front-desk staff. */
  tests: z.array(z.string()),
  testCount: z.number(),
  fasting: z.boolean(),
  clinicalImpression: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(LAB_REQUEST_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  results: z.array(labResultSchema),
  resultCount: z.number(),
  createdAt: z.string(),
});
export type LabRequest = z.infer<typeof labRequestSchema>;

export const LAB_BOXES = ['awaiting', 'to_review'] as const;
export type LabBox = (typeof LAB_BOXES)[number];
export const labListQuery = z.object({ box: z.enum(LAB_BOXES) });

export const LAB_RESULT_MAX_BYTES = 5 * 1024 * 1024;
export const LAB_RESULT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/** A scanned or downloaded result, sent as base64 JSON; checked again by content on the server. */
export const labResultUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(LAB_RESULT_TYPES, 'Upload a PDF, PNG or JPEG file'),
  data: z
    .string()
    .max(Math.ceil((LAB_RESULT_MAX_BYTES * 4) / 3) + 4, 'The file must be 5 MB or smaller')
    .regex(/^[A-Za-z0-9+/]+=*$/, 'Invalid file data'),
});
export type LabResultUpload = z.infer<typeof labResultUploadSchema>;

export const labReviewSchema = z.object({ note: optionalText(1000) });
