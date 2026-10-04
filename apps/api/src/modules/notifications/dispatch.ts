import { and, eq, gt, sql } from 'drizzle-orm';
import {
  DEFAULT_TEMPLATES,
  formatPhMobile,
  PATIENT_EVENTS,
  renderTemplate,
  usedVariables,
  type NotificationChannel,
  type PatientEvent,
  type TemplateValues,
} from '@clinic/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import {
  appointments,
  clinics,
  notificationLogs,
  notificationTemplates,
  outbox,
  patients,
  users,
} from '../../db/schema';
import { withTenant, type TenantScope } from '../../db/tenant';
import { cancelTokenFor, optOutTokenFor } from '../../lib/tokens';
import { createShareLink } from '../consult/service';
import type { Providers } from './providers';

const appUrl = (path: string) => new URL(path, env.PUBLIC_APP_URL).toString();
const isPatientEvent = (event: string): event is PatientEvent =>
  (PATIENT_EVENTS as readonly string[]).includes(event);

const dateFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-PH', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit' });

type Outcome = { status: 'sent' | 'skipped' | 'failed'; error?: string };

/** Sends one channel once: an earlier sent/skipped log for this outbox row and channel wins. */
async function deliver(
  t: TenantScope,
  row: typeof outbox.$inferSelect,
  channel: NotificationChannel,
  recipient: string | null,
  skipReason: string | null,
  send: () => Promise<{ providerMessageId: string | null }>,
): Promise<Outcome> {
  const [existing] = await t.tx
    .select()
    .from(notificationLogs)
    .where(
      t.where(
        notificationLogs,
        eq(notificationLogs.outboxId, row.id),
        eq(notificationLogs.channel, channel),
      ),
    );
  if (existing && existing.status !== 'failed' && existing.status !== 'queued')
    return { status: existing.status };

  const base = {
    event: row.event,
    channel,
    patientId: row.patientId,
    outboxId: row.id,
    recipient: recipient ?? '—',
  };
  const upsert = async (values: Partial<typeof notificationLogs.$inferInsert>) => {
    if (existing) {
      await t.tx
        .update(notificationLogs)
        .set(values)
        .where(t.where(notificationLogs, eq(notificationLogs.id, existing.id)));
    } else {
      await t.tx.insert(notificationLogs).values(t.values({ ...base, ...values }));
    }
  };

  if (skipReason || !recipient) {
    await upsert({ status: 'skipped', error: skipReason ?? 'No recipient' });
    return { status: 'skipped' };
  }
  try {
    const { providerMessageId } = await send();
    await upsert({ status: 'sent', providerMessageId, sentAt: new Date(), error: null });
    return { status: 'sent' };
  } catch (error) {
    // Provider errors describe the transport (status codes, timeouts), never message content.
    const message = (error as Error).message.slice(0, 300);
    await upsert({ status: 'failed', error: message });
    return { status: 'failed', error: message };
  }
}

async function templateFor(t: TenantScope, event: PatientEvent, channel: NotificationChannel) {
  const [custom] = await t.tx
    .select({ subject: notificationTemplates.subject, body: notificationTemplates.body })
    .from(notificationTemplates)
    .where(
      t.where(
        notificationTemplates,
        eq(notificationTemplates.event, event),
        eq(notificationTemplates.channel, channel),
      ),
    );
  return custom ?? DEFAULT_TEMPLATES[event][channel];
}

async function patientMessages(
  t: TenantScope,
  row: typeof outbox.$inferSelect,
  event: PatientEvent,
  clinic: typeof clinics.$inferSelect,
  providers: Providers,
): Promise<Outcome[]> {
  const [patient] = row.patientId
    ? await t.tx
        .select()
        .from(patients)
        .where(t.where(patients, eq(patients.id, row.patientId)))
    : [];
  if (!patient) return [];
  const [appointment] = row.appointmentId
    ? await t.tx
        .select()
        .from(appointments)
        .where(t.where(appointments, eq(appointments.id, row.appointmentId)))
    : [];

  // A reminder is only valid for the time it was scheduled for, while still booked.
  let stale: string | null = null;
  if (
    event === 'appointment.reminder' &&
    (appointment?.status !== 'booked' || appointment.startAt.toISOString() !== row.payload.startAt)
  ) {
    stale = 'Appointment changed or cancelled';
  }
  if (event === 'followup.reminder') {
    const [booked] = await t.tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        t.where(
          appointments,
          eq(appointments.patientId, patient.id),
          eq(appointments.status, 'booked'),
          gt(appointments.startAt, new Date()),
        ),
      )
      .limit(1);
    if (booked) stale = 'Follow-up already booked';
  }

  const tz = clinic.timezone;
  const when = appointment?.startAt ?? null;
  const values: TemplateValues = {
    firstName: patient.firstName,
    clinicName: clinic.name,
    clinicPhone: clinic.contactNumber ? formatPhMobile(clinic.contactNumber) : '',
    date: when ? dateFormat(tz).format(when) : '',
    time: appointment ? timeFormat(tz).format(appointment.startAt) : '',
    referenceCode: appointment?.referenceCode ?? '',
    cancelLink:
      appointment?.status === 'booked' ? appUrl(`/cancel/${cancelTokenFor(appointment.id)}`) : '',
    bookingLink: appUrl(`/c/${clinic.slug}`),
  };
  if (event === 'followup.reminder' && row.payload.followUpDate) {
    values.date = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${row.payload.followUpDate}T00:00:00Z`));
  }

  const outcomes: Outcome[] = [];
  for (const channel of ['sms', 'email'] as const) {
    const template = await templateFor(t, event, channel);
    const needsRx = usedVariables(`${template.subject ?? ''} ${template.body}`).includes('rxLink');
    let skip = stale;
    if (!skip && needsRx && !row.payload.prescriptionId) skip = 'No prescription to share';
    const recipient = channel === 'sms' ? patient.mobile : patient.email;
    if (!skip && channel === 'sms' && !patient.smsOptIn) skip = 'Patient opted out of SMS';
    if (!skip && channel === 'email' && (!patient.email || !patient.emailOptIn))
      skip = patient.email ? 'Patient opted out of email' : 'No email address';

    outcomes.push(
      await deliver(t, row, channel, recipient, skip, async () => {
        if (needsRx && row.payload.prescriptionId && !values.rxLink) {
          const share = await createShareLink(t, row.payload.prescriptionId);
          values.rxLink = appUrl(`/rx/${share.token}`);
        }
        if (channel === 'sms') {
          const body = `${renderTemplate(template.body, values)}\nStop SMS: ${appUrl(`/u/${optOutTokenFor(patient.id)}`)}`;
          return providers.sms.send({
            to: recipient as string,
            body,
            senderName: clinic.smsSenderName ?? env.SMS_SENDER_NAME,
          });
        }
        return providers.email.send({
          to: recipient as string,
          subject: renderTemplate(template.subject ?? clinic.name, values),
          text: renderTemplate(template.body, values),
        });
      }),
    );
  }
  return outcomes;
}

/** Tells the clinic a patient booked online. Date, time and doctor only. */
async function staffAlert(
  t: TenantScope,
  row: typeof outbox.$inferSelect,
  clinic: typeof clinics.$inferSelect,
  providers: Providers,
) {
  const [appointment] = row.appointmentId
    ? await t.tx
        .select({
          startAt: appointments.startAt,
          referenceCode: appointments.referenceCode,
          doctorName: users.name,
        })
        .from(appointments)
        .innerJoin(users, eq(users.id, appointments.doctorId))
        .where(t.where(appointments, eq(appointments.id, row.appointmentId)))
    : [];
  const tz = clinic.timezone;
  return [
    await deliver(
      t,
      row,
      'email',
      clinic.email,
      clinic.email ? (appointment ? null : 'Appointment not found') : 'Clinic has no email address',
      () =>
        providers.email.send({
          to: clinic.email as string,
          subject: `New online booking ${appointment!.referenceCode}`,
          text: `A patient booked online: ${dateFormat(tz).format(appointment!.startAt)}, ${timeFormat(tz).format(appointment!.startAt)} with ${appointment!.doctorName} (ref ${appointment!.referenceCode}).\n\nOpen the calendar: ${appUrl('/calendar')}`,
        }),
    ),
  ];
}

/**
 * Processes one outbox row. Returns true when finished. Throws when a channel failed and a retry
 * may help; on the final attempt failures are left in the log and the row is closed.
 */
export async function processOutbox(
  outboxId: string,
  clinicId: string,
  providers: Providers,
  options: { finalAttempt: boolean },
): Promise<void> {
  const failed = await withTenant(clinicId, { userId: null, ip: null }, async (t) => {
    const [row] = await t.tx
      .select()
      .from(outbox)
      .where(t.where(outbox, eq(outbox.id, outboxId)));
    if (!row || row.status === 'done') return [];
    const [clinic] = await t.tx.select().from(clinics).where(eq(clinics.id, clinicId));
    if (!clinic) return [];

    const outcomes = isPatientEvent(row.event)
      ? await patientMessages(t, row, row.event, clinic, providers)
      : row.event === 'booking.staff_alert'
        ? await staffAlert(t, row, clinic, providers)
        : [];
    const failures = outcomes.filter((o) => o.status === 'failed');
    if (!failures.length || options.finalAttempt) {
      await t.tx
        .update(outbox)
        .set({ status: 'done' })
        .where(t.where(outbox, eq(outbox.id, row.id)));
    }
    return failures;
  });
  if (failed.length && !options.finalAttempt) {
    throw new Error(`Notification delivery failed: ${failed.map((f) => f.error).join('; ')}`);
  }
}

interface ClaimRow extends Record<string, unknown> {
  id: string;
  clinic_id: string;
}

/** Hands due outbox rows to the job queue. Returns how many were handed off. */
export async function relayDueOutbox(
  send: (job: { outboxId: string; clinicId: string }) => Promise<unknown>,
  limit = 50,
): Promise<number> {
  const rows = await db.execute<ClaimRow>(sql`select * from claim_due_outbox(${limit})`);
  for (const row of rows) {
    await send({ outboxId: row.id, clinicId: row.clinic_id });
    await withTenant(row.clinic_id, { userId: null, ip: null }, (t) =>
      t.tx
        .update(outbox)
        .set({ status: 'queued' })
        .where(t.where(outbox, and(eq(outbox.id, row.id), eq(outbox.status, 'dispatching')))),
    );
  }
  return rows.length;
}
