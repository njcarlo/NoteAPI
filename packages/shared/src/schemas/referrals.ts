import { z } from 'zod';
import { REFERRAL_STATUSES, REFERRAL_URGENCIES, SPECIALTIES } from '../constants';
import { optionalText } from './common';

export const referralInputSchema = z.object({
  specialty: z.enum(SPECIALTIES, 'Choose a specialty'),
  /** A doctor in this clinic with that specialty; leave empty to refer outside the clinic. */
  toDoctorId: z.uuid().nullable().optional(),
  externalDoctor: optionalText(200),
  externalFacility: optionalText(200),
  urgency: z.enum(REFERRAL_URGENCIES).default('routine'),
  reason: z.string().trim().min(3, 'Give the reason for referral').max(1000),
  clinicalSummary: optionalText(5000),
});
export type ReferralInput = z.input<typeof referralInputSchema>;

export const referralSchema = z.object({
  id: z.uuid(),
  visitId: z.uuid(),
  /** The referring consultation, for linking back to it. */
  appointmentId: z.uuid(),
  patient: z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() }),
  fromDoctorId: z.uuid(),
  fromDoctorName: z.string(),
  specialty: z.string(),
  toDoctorId: z.uuid().nullable(),
  toDoctorName: z.string().nullable(),
  externalDoctor: z.string().nullable(),
  externalFacility: z.string().nullable(),
  urgency: z.enum(REFERRAL_URGENCIES),
  status: z.enum(REFERRAL_STATUSES),
  /** Clinical fields are null for staff without access to clinical records. */
  reason: z.string().nullable(),
  clinicalSummary: z.string().nullable(),
  responseNote: z.string().nullable(),
  scheduledAppointmentId: z.uuid().nullable(),
  scheduledStartAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Referral = z.infer<typeof referralSchema>;

export const REFERRAL_BOXES = ['incoming', 'outgoing', 'to_schedule'] as const;
export type ReferralBox = (typeof REFERRAL_BOXES)[number];

export const referralListQuery = z.object({
  box: z.enum(REFERRAL_BOXES),
  status: z.enum(REFERRAL_STATUSES).optional(),
});

export const referralScheduleSchema = z.object({ startAt: z.iso.datetime({ offset: true }) });
export const referralDeclineSchema = z.object({
  note: z.string().trim().min(3, 'Tell the referring doctor why').max(1000),
});

/** Shown to the receiving doctor during the referred consultation. */
export const referredFromSchema = z.object({
  id: z.uuid(),
  fromDoctorName: z.string(),
  specialty: z.string(),
  urgency: z.enum(REFERRAL_URGENCIES),
  reason: z.string(),
  clinicalSummary: z.string().nullable(),
  createdAt: z.string(),
});
export type ReferredFrom = z.infer<typeof referredFromSchema>;
