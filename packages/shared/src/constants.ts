export const ROLES = ['admin', 'doctor', 'secretary'] as const;
export type Role = (typeof ROLES)[number];

export const CLINIC_STATUSES = ['active', 'suspended'] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

export const APPOINTMENT_STATUSES = [
  'booked',
  'arrived',
  'in_consult',
  'done',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TYPES = ['scheduled', 'walk_in'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_SOURCES = ['public', 'staff'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

export const NOTIFICATION_CHANNELS = ['sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_EVENTS = [
  'appointment.booked',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.reminder',
  'visit.finished',
  'followup.reminder',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const CLINIC_TIMEZONE = 'Asia/Manila';
export const CURRENCY = 'PHP';

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CSRF: 'CSRF_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ALLERGY_WARNING: 'ALLERGY_WARNING',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
