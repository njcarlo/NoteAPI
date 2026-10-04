import { z } from 'zod';
import { APPOINTMENT_STATUSES, SEXES } from '../constants';
import { isoDateSchema, optionalText } from './common';

const range = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label} must be a number` })
    .min(min, `${label} looks too low`)
    .max(max, `${label} looks too high`)
    .nullable()
    .optional();

const int = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} looks too low`)
    .max(max, `${label} looks too high`)
    .nullable()
    .optional();

export const vitalsSchema = z
  .object({
    bpSystolic: int(50, 260, 'Systolic BP'),
    bpDiastolic: int(30, 160, 'Diastolic BP'),
    temperatureC: range(30, 45, 'Temperature'),
    heartRate: int(20, 250, 'Heart rate'),
    respiratoryRate: int(5, 80, 'Respiratory rate'),
    weightKg: range(0.5, 400, 'Weight'),
    heightCm: range(30, 250, 'Height'),
    o2Sat: int(50, 100, 'O₂ saturation'),
  })
  .refine((v) => (v.bpSystolic == null) === (v.bpDiastolic == null), {
    path: ['bpDiastolic'],
    message: 'Enter both systolic and diastolic BP',
  })
  .refine((v) => v.bpSystolic == null || v.bpDiastolic == null || v.bpSystolic > v.bpDiastolic, {
    path: ['bpDiastolic'],
    message: 'Diastolic must be lower than systolic',
  });
export type Vitals = z.infer<typeof vitalsSchema>;

/** Demographics a secretary can complete at check-in (e.g. for patients who booked online). */
export const profileCompletionSchema = z.object({
  birthdate: isoDateSchema.nullable().optional(),
  sex: z.enum(SEXES).nullable().optional(),
  allergies: optionalText(2000),
  conditions: optionalText(2000),
});
export type ProfileCompletion = z.infer<typeof profileCompletionSchema>;

export const checkInSchema = z.object({
  vitals: vitalsSchema.optional(),
  patient: profileCompletionSchema.optional(),
});
export type CheckInInput = z.input<typeof checkInSchema>;

export const walkInSchema = checkInSchema.extend({
  doctorId: z.uuid(),
  patientId: z.uuid(),
  reason: optionalText(500),
});
export type WalkInInput = z.input<typeof walkInSchema>;

export const queueQuery = z.object({ doctorId: z.uuid().optional() });

export const queueItemSchema = z.object({
  appointmentId: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  queueNumber: z.number().nullable(),
  arrivedAt: z.string().nullable(),
  type: z.enum(['scheduled', 'walk_in']),
  startAt: z.string(),
  patient: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    birthdate: z.string().nullable(),
    sex: z.enum(SEXES).nullable(),
    allergies: z.string().nullable(),
  }),
  vitals: z.object({
    bpSystolic: z.number().nullable(),
    bpDiastolic: z.number().nullable(),
    temperatureC: z.number().nullable(),
    heartRate: z.number().nullable(),
    respiratoryRate: z.number().nullable(),
    weightKg: z.number().nullable(),
    heightCm: z.number().nullable(),
    o2Sat: z.number().nullable(),
  }),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueSchema = z.object({
  date: z.string(),
  inConsult: z.array(queueItemSchema),
  waiting: z.array(queueItemSchema),
  doneCount: z.number(),
});
export type Queue = z.infer<typeof queueSchema>;

/** Server-sent event: tells screens what to refetch. Never carries patient data. */
export type ClinicEvent =
  | { type: 'appointments.changed'; doctorId: string }
  /** A patient booked on the public page; staff get an in-app alert. */
  | { type: 'booking.created'; doctorId: string; startAt: string };
