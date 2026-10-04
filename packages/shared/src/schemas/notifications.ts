import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '../constants';
import { PATIENT_EVENTS, unknownVariables } from '../notifications';
import { paginationQuery } from './common';

export const templateSchema = z.object({
  event: z.enum(PATIENT_EVENTS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  subject: z.string().nullable(),
  body: z.string(),
  isCustom: z.boolean(),
});
export type NotificationTemplate = z.infer<typeof templateSchema>;

export const templateParams = z.object({
  event: z.enum(PATIENT_EVENTS),
  channel: z.enum(NOTIFICATION_CHANNELS),
});

const checked = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Required')
    .max(max)
    .superRefine((text, ctx) => {
      const unknown = unknownVariables(text);
      if (unknown.length) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown variables: ${unknown.map((v) => `{{${v}}}`).join(', ')}`,
        });
      }
    });

export const templateInputSchema = z.object({
  subject: checked(200).nullable().optional(),
  body: checked(2000),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

export const notificationLogQuery = paginationQuery;

export const notificationLogSchema = z.object({
  id: z.uuid(),
  event: z.string(),
  channel: z.enum(NOTIFICATION_CHANNELS),
  /** Partially masked, e.g. "+63917•••4567". */
  recipient: z.string(),
  status: z.enum(NOTIFICATION_STATUSES),
  error: z.string().nullable(),
  patientName: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type NotificationLog = z.infer<typeof notificationLogSchema>;

export const optOutParams = z.object({ token: z.string().min(20).max(80) });
export const optOutInfoSchema = z.object({ clinicName: z.string(), smsOptIn: z.boolean() });
export type OptOutInfo = z.infer<typeof optOutInfoSchema>;

export const smsInboundSchema = z.object({
  from: z.string().max(30),
  message: z.string().max(1000),
});
