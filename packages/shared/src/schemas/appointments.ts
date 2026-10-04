import { z } from 'zod';
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES, APPOINTMENT_TYPES } from '../constants';
import { isoDateSchema, optionalText } from './common';

export const appointmentListQuery = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    doctorId: z.uuid().optional(),
  })
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'End date is before start date' });

export const appointmentSchema = z.object({
  id: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  patient: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    mobile: z.string(),
  }),
  startAt: z.string(),
  endAt: z.string(),
  type: z.enum(APPOINTMENT_TYPES),
  status: z.enum(APPOINTMENT_STATUSES),
  source: z.enum(APPOINTMENT_SOURCES),
  reason: z.string().nullable(),
  referenceCode: z.string(),
  queueNumber: z.number().nullable(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentCreateSchema = z.object({
  doctorId: z.uuid(),
  patientId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(240).optional(),
  reason: optionalText(500),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

export const appointmentMoveSchema = z.object({
  startAt: z.iso.datetime({ offset: true }),
  doctorId: z.uuid().optional(),
});
export type AppointmentMoveInput = z.infer<typeof appointmentMoveSchema>;
