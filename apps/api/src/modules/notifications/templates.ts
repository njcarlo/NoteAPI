import { and, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_TEMPLATES,
  NOTIFICATION_CHANNELS,
  PATIENT_EVENTS,
  type NotificationChannel,
  type NotificationLog,
  type NotificationTemplate,
  type PatientEvent,
  type TemplateInput,
} from '@clinic/shared';
import { notificationLogs, notificationTemplates, patients } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { iso } from '../../lib/sql';
import { maskRecipient } from './providers';

/** One row per patient event and channel, used to seed a new clinic. */
export const defaultTemplateRows = (clinicId: string) =>
  PATIENT_EVENTS.flatMap((event) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      clinicId,
      event,
      channel,
      ...DEFAULT_TEMPLATES[event][channel],
    })),
  );

export async function listTemplates(t: TenantScope): Promise<NotificationTemplate[]> {
  const rows = await t.tx
    .select()
    .from(notificationTemplates)
    .where(t.where(notificationTemplates));
  return PATIENT_EVENTS.flatMap((event) =>
    NOTIFICATION_CHANNELS.map((channel) => {
      const custom = rows.find((r) => r.event === event && r.channel === channel);
      const fallback = DEFAULT_TEMPLATES[event][channel];
      const text = custom ?? fallback;
      return {
        event,
        channel,
        subject: text.subject,
        body: text.body,
        isCustom: Boolean(
          custom && (custom.body !== fallback.body || custom.subject !== fallback.subject),
        ),
      };
    }),
  );
}

export async function saveTemplate(
  t: TenantScope,
  event: PatientEvent,
  channel: NotificationChannel,
  input: TemplateInput & { body: string },
) {
  const where = t.where(
    notificationTemplates,
    and(eq(notificationTemplates.event, event), eq(notificationTemplates.channel, channel)),
  );
  const subject =
    channel === 'email' ? (input.subject ?? DEFAULT_TEMPLATES[event].email.subject) : null;
  const [existing] = await t.tx
    .select({ id: notificationTemplates.id })
    .from(notificationTemplates)
    .where(where);
  if (existing) {
    await t.tx.update(notificationTemplates).set({ subject, body: input.body }).where(where);
  } else {
    await t.tx
      .insert(notificationTemplates)
      .values(t.values({ event, channel, subject, body: input.body }));
  }
  await t.audit({
    action: 'notification_template.update',
    entityType: 'clinic',
    entityId: t.clinicId,
    metadata: { event, channel },
  });
  return (await listTemplates(t)).find((x) => x.event === event && x.channel === channel)!;
}

export async function resetTemplate(
  t: TenantScope,
  event: PatientEvent,
  channel: NotificationChannel,
) {
  return saveTemplate(t, event, channel, DEFAULT_TEMPLATES[event][channel]);
}

export async function listLogs(
  t: TenantScope,
  limit: number,
  offset: number,
): Promise<NotificationLog[]> {
  const rows = await t.tx
    .select({ log: notificationLogs, firstName: patients.firstName, lastName: patients.lastName })
    .from(notificationLogs)
    .leftJoin(patients, eq(patients.id, notificationLogs.patientId))
    .where(t.where(notificationLogs))
    .orderBy(desc(notificationLogs.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(({ log, firstName, lastName }) => ({
    id: log.id,
    event: log.event,
    channel: log.channel,
    recipient: maskRecipient(log.recipient),
    status: log.status,
    error: log.error,
    patientName: firstName ? `${lastName}, ${firstName}` : null,
    createdAt: iso(log.createdAt),
    sentAt: log.sentAt && iso(log.sentAt),
  }));
}
