import { z } from 'zod';
import { APPOINTMENT_STATUSES, SEXES } from '../constants';
import { isoDateSchema, optionalText } from './common';
import { vitalsSchema } from './queue';

export const SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type SoapField = (typeof SOAP_FIELDS)[number];

const soapText = z.string().max(10_000).nullable().optional();
export const soapSchema = z.object({
  subjective: soapText,
  objective: soapText,
  assessment: soapText,
  plan: soapText,
});
export type Soap = z.infer<typeof soapSchema>;

export const rxItemSchema = z.object({
  drugId: z.uuid().nullable().optional(),
  genericName: z.string().trim().min(1, 'Generic name is required').max(200),
  brandName: optionalText(200),
  strength: optionalText(100),
  form: optionalText(100),
  sig: z.string().trim().min(1, 'Add instructions (sig)').max(500),
  quantity: z.string().trim().min(1, 'Add a quantity').max(50),
});
export type RxItem = z.infer<typeof rxItemSchema>;
export type RxItemInput = z.input<typeof rxItemSchema>;

/** Response shape of an item: plain values, no input transforms (responses are encoded, not parsed). */
export const rxItemOutputSchema = z.object({
  drugId: z.uuid().nullable(),
  genericName: z.string(),
  brandName: z.string().nullable(),
  strength: z.string().nullable(),
  form: z.string().nullable(),
  sig: z.string(),
  quantity: z.string(),
});

/** Autosaved work in progress; nothing here is validated strictly until "Finish visit". */
export const consultDraftSchema = z.object({
  soap: soapSchema.optional(),
  vitals: vitalsSchema.optional(),
  followUpDate: isoDateSchema.nullable().optional(),
  rx: z
    .object({
      items: z.array(rxItemSchema.partial()).max(30),
      notes: z.string().max(2000).nullable().optional(),
    })
    .optional(),
});
export type ConsultDraft = z.infer<typeof consultDraftSchema>;

export const finishVisitSchema = z.object({
  soap: soapSchema,
  vitals: vitalsSchema.optional(),
  followUpDate: isoDateSchema.nullable().optional(),
  /** Books a follow-up appointment at this exact time (one of the doctor's open slots). */
  followUpStartAt: z.iso.datetime({ offset: true }).nullable().optional(),
  rx: z
    .object({
      items: z.array(rxItemSchema).min(1).max(30),
      notes: optionalText(2000),
    })
    .nullable()
    .optional(),
  /** The doctor saw the allergy warning for these items and is prescribing anyway. */
  allergyAcknowledged: z.boolean().default(false),
});
export type FinishVisitInput = z.input<typeof finishVisitSchema>;

export const prescriptionSchema = z.object({
  id: z.uuid(),
  issuedAt: z.string(),
  notes: z.string().nullable(),
  items: z.array(rxItemOutputSchema.extend({ id: z.uuid() })),
});
export type Prescription = z.infer<typeof prescriptionSchema>;

export const amendmentSchema = z.object({
  id: z.uuid(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  reason: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type Amendment = z.infer<typeof amendmentSchema>;

export const AMENDABLE_FIELDS = [...SOAP_FIELDS, 'followUpDate'] as const;

export const amendmentInputSchema = z
  .object({
    field: z.enum(AMENDABLE_FIELDS),
    newValue: z.string().max(10_000).nullable(),
    reason: z.string().trim().min(3, 'Give a reason for the change').max(500),
  })
  .refine(
    (a) =>
      a.field !== 'followUpDate' ||
      a.newValue === null ||
      isoDateSchema.safeParse(a.newValue).success,
    {
      path: ['newValue'],
      message: 'Use a date (YYYY-MM-DD)',
    },
  );
export type AmendmentInput = z.infer<typeof amendmentInputSchema>;

const nullableNumber = z.number().nullable();
export const visitVitalsSchema = z.object({
  bpSystolic: nullableNumber,
  bpDiastolic: nullableNumber,
  temperatureC: nullableNumber,
  heartRate: nullableNumber,
  respiratoryRate: nullableNumber,
  weightKg: nullableNumber,
  heightCm: nullableNumber,
  o2Sat: nullableNumber,
});

export const visitSchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  date: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  reason: z.string().nullable(),
  vitals: visitVitalsSchema,
  soap: z.object({
    subjective: z.string().nullable(),
    objective: z.string().nullable(),
    assessment: z.string().nullable(),
    plan: z.string().nullable(),
  }),
  followUpDate: z.string().nullable(),
  locked: z.boolean(),
  finishedAt: z.string().nullable(),
  draft: z
    .object({
      soap: soapSchema.optional(),
      vitals: visitVitalsSchema.partial().optional(),
      followUpDate: z.string().nullable().optional(),
      rx: z
        .object({
          items: z.array(rxItemOutputSchema.partial()),
          notes: z.string().nullable().optional(),
        })
        .optional(),
    })
    .nullable(),
  prescription: prescriptionSchema.nullable(),
  amendments: z.array(amendmentSchema),
});
export type Visit = z.infer<typeof visitSchema>;

export const visitSummarySchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  date: z.string(),
  doctorName: z.string(),
  assessment: z.string().nullable(),
  medicines: z.array(z.string()),
});
export type VisitSummary = z.infer<typeof visitSummarySchema>;

export const consultSchema = z.object({
  patient: z.object({
    id: z.uuid(),
    firstName: z.string(),
    middleName: z.string().nullable(),
    lastName: z.string(),
    birthdate: z.string().nullable(),
    sex: z.enum(SEXES).nullable(),
    mobile: z.string(),
    address: z.string().nullable(),
    allergies: z.string().nullable(),
    conditions: z.string().nullable(),
  }),
  visit: visitSchema,
  history: z.array(visitSummarySchema),
});
export type Consult = z.infer<typeof consultSchema>;

export const drugSchema = z.object({
  id: z.uuid(),
  genericName: z.string(),
  brandName: z.string().nullable(),
  form: z.string(),
  strength: z.string(),
});
export type Drug = z.infer<typeof drugSchema>;

export const drugQuery = z.object({ q: z.string().trim().min(1).max(100) });

export const rxFavoriteSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  items: z.array(rxItemOutputSchema),
});
export type RxFavorite = z.infer<typeof rxFavoriteSchema>;

export const rxFavoriteInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the favorite').max(100),
  items: z.array(rxItemSchema).min(1).max(30),
});
export type RxFavoriteInput = z.input<typeof rxFavoriteInputSchema>;

export const soapTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subjective: z.string().nullable(),
  objective: z.string().nullable(),
  assessment: z.string().nullable(),
  plan: z.string().nullable(),
});
export type SoapTemplate = z.infer<typeof soapTemplateSchema>;

export const soapTemplateInputSchema = soapSchema.extend({
  name: z.string().trim().min(1, 'Name the template').max(100),
});
export type SoapTemplateInput = z.input<typeof soapTemplateInputSchema>;

export const doctorProfileSchema = z.object({
  specialty: z.string().nullable(),
  prcNo: z.string(),
  ptrNo: z.string().nullable(),
  s2No: z.string().nullable(),
});
export type DoctorProfile = z.infer<typeof doctorProfileSchema>;

export const doctorProfileInputSchema = z.object({
  specialty: optionalText(100),
  prcNo: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, 'PRC license numbers are 4–10 digits'),
  ptrNo: optionalText(50),
  s2No: optionalText(50),
});
export type DoctorProfileInput = z.input<typeof doctorProfileInputSchema>;

export const RX_SHARE_DAYS = 14;
export const RX_SHARE_MAX_ATTEMPTS = 5;

export const rxShareResponseSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type RxShareResponse = z.infer<typeof rxShareResponseSchema>;

export const rxShareOpenSchema = z.object({ birthdate: isoDateSchema });
export const rxShareInfoSchema = z.object({
  clinicName: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
});
export type RxShareInfo = z.infer<typeof rxShareInfoSchema>;
