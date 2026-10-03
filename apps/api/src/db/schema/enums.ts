import { pgEnum } from 'drizzle-orm/pg-core';
import {
  APPOINTMENT_SOURCES,
  CLINIC_STATUSES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  ROLES,
  SEXES,
} from '@clinic/shared';

export const roleEnum = pgEnum('role', ROLES);
export const sexEnum = pgEnum('sex', SEXES);
export const appointmentStatusEnum = pgEnum('appointment_status', APPOINTMENT_STATUSES);
export const appointmentTypeEnum = pgEnum('appointment_type', APPOINTMENT_TYPES);
export const appointmentSourceEnum = pgEnum('appointment_source', APPOINTMENT_SOURCES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum('notification_status', NOTIFICATION_STATUSES);
export const clinicStatusEnum = pgEnum('clinic_status', CLINIC_STATUSES);
