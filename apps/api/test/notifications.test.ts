import { and, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc } from '@clinic/shared';
import type { App } from '../src/app';
import {
  appointments,
  clinics,
  notificationLogs,
  outbox,
  patients,
  schedules,
} from '../src/db/schema';
import { processOutbox, relayDueOutbox } from '../src/modules/notifications/dispatch';
import { reminderTimes } from '../src/modules/notifications/outbox';
import {
  memoryEmail,
  memorySms,
  type EmailMessage,
  type SmsMessage,
} from '../src/modules/notifications/providers';
import {
  createClinicFixture,
  owner,
  signIn,
  startApp,
  type ClinicFixture,
  type SignedIn,
} from './helpers';

const providers = { sms: memorySms, email: memoryEmail };
let app: App;
let clinic: ClinicFixture;
let admin: SignedIn;
let mobileSeq = 0;
const nextMobile = () => `0918${String(3000000 + ++mobileSeq).padStart(7, '0')}`;
const inThreeDays = addDays(todayIn(CLINIC_TIMEZONE), 3);
const SECRET_REASON = 'SECRET-REASON-hemorrhoids';

/** Runs every due outbox row through the dispatcher (what the worker does, minus pg-boss). */
async function drain(finalAttempt = false) {
  const errors: string[] = [];
  await relayDueOutbox((job) =>
    processOutbox(job.outboxId, job.clinicId, providers, { finalAttempt }).catch((e: Error) =>
      errors.push(e.message),
    ),
  );
  return errors;
}

const smsTo = (mobile: string) => (memorySms.sent as SmsMessage[]).filter((m) => m.to === mobile);
const emailTo = (to: string) => (memoryEmail.sent as EmailMessage[]).filter((m) => m.to === to);

async function book(date = inThreeDays, overrides: Record<string, unknown> = {}) {
  const slots = await request(app.server).get(
    `/api/public/clinics/${clinic.slug}/slots?doctorId=${clinic.userIds.doctor}&date=${date}`,
  );
  const mobile = nextMobile();
  const res = await request(app.server)
    .post(`/api/public/clinics/${clinic.slug}/bookings`)
    .send({
      doctorId: clinic.userIds.doctor,
      startAt: slots.body[mobileSeq % slots.body.length].startAt,
      firstName: 'Notif',
      lastName: 'Patient',
      birthdate: '1991-02-03',
      mobile,
      email: `notif${mobileSeq}@example.com`,
      reason: SECRET_REASON,
      smsOptIn: true,
      privacyConsent: true,
      ...overrides,
    });
  expect(res.status).toBe(201);
  const [appt] = await owner.db
    .select()
    .from(appointments)
    .where(eq(appointments.referenceCode, res.body.referenceCode));
  return {
    appointment: appt!,
    mobile: `+63${mobile.slice(1)}`,
    email: `notif${mobileSeq}@example.com`,
  };
}

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('notify');
  await owner.db
    .update(clinics)
    .set({ email: 'frontdesk@notify.test', contactNumber: '+639170001234' })
    .where(eq(clinics.id, clinic.clinicId));
  await owner.db.insert(schedules).values(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      clinicId: clinic.clinicId,
      doctorId: clinic.userIds.doctor,
      dayOfWeek,
      startTime: '09:00',
      endTime: '16:00',
      slotMinutes: 15,
    })),
  );
  admin = await signIn(app, clinic.emails.doctor);
  await drain(true);
});
beforeEach(() => {
  memorySms.sent.length = 0;
  memoryEmail.sent.length = 0;
  memorySms.failNext = 0;
});
afterAll(() => app.close());

describe('reminder times', () => {
  it('are 6 PM the day before and 7 AM the same day, Manila time, if still ahead', () => {
    const start = zonedToUtc('2026-11-10', '10:00', CLINIC_TIMEZONE);
    expect(
      reminderTimes(start, CLINIC_TIMEZONE, new Date('2026-11-01T00:00:00Z')).map((d) =>
        d.toISOString(),
      ),
    ).toEqual(['2026-11-09T10:00:00.000Z', '2026-11-09T23:00:00.000Z']);
    expect(reminderTimes(start, CLINIC_TIMEZONE, new Date('2026-11-09T12:00:00Z'))).toHaveLength(1);
    // An appointment at 6:30 AM gets no same-morning reminder.
    expect(
      reminderTimes(
        zonedToUtc('2026-11-10', '06:30', CLINIC_TIMEZONE),
        CLINIC_TIMEZONE,
        new Date('2026-11-01T00:00:00Z'),
      ),
    ).toHaveLength(1);
  });
});

describe('booking notifications', () => {
  it('queues the confirmation, a staff alert and two reminders in the booking transaction', async () => {
    const { appointment } = await book();
    const rows = await owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.appointmentId, appointment.id));
    expect(rows.map((r) => r.event).sort()).toEqual([
      'appointment.booked',
      'appointment.reminder',
      'appointment.reminder',
      'booking.staff_alert',
    ]);
    const reminders = rows
      .filter((r) => r.event === 'appointment.reminder')
      .map((r) => r.runAt.toISOString())
      .sort();
    expect(reminders).toEqual(
      reminderTimes(appointment.startAt, CLINIC_TIMEZONE).map((d) => d.toISOString()),
    );
  });

  it('sends SMS and email without clinical details, plus a staff email without patient details', async () => {
    const { appointment, mobile, email } = await book();
    expect(await drain()).toEqual([]);

    const [sms] = smsTo(mobile);
    expect(sms?.body).toContain(appointment.referenceCode);
    expect(sms?.body).toMatch(/\/cancel\/[\w-]{20,}/);
    expect(sms?.body).toMatch(/Stop SMS: http\S+\/u\/[\w-]{32}/);
    const [mail] = emailTo(email);
    expect(mail?.subject).toContain(appointment.referenceCode);

    const staff = emailTo('frontdesk@notify.test').find((m) =>
      m.subject.includes(appointment.referenceCode),
    );
    expect(staff).toBeDefined();
    for (const text of [sms!.body, mail!.subject, mail!.text, staff!.text])
      expect(text).not.toContain(SECRET_REASON);
    expect(staff!.text).not.toContain('Notif');

    const logs = await owner.db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.clinicId, clinic.clinicId));
    expect(logs.filter((l) => l.status === 'sent').length).toBeGreaterThanOrEqual(3);

    // The cancel link in the message works.
    const token = sms!.body.match(/\/cancel\/([\w-]+)/)![1];
    expect((await request(app.server).get(`/api/public/cancel/${token}`)).body.referenceCode).toBe(
      appointment.referenceCode,
    );
  });

  it('replaces reminders on reschedule and removes them on cancel', async () => {
    const { appointment, mobile } = await book();
    await drain();
    const later = addDays(inThreeDays, 1);
    const slots = await admin.agent.get(
      `/api/doctors/${clinic.userIds.doctor}/slots?date=${later}`,
    );
    const moved = await admin.agent
      .patch(`/api/appointments/${appointment.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ startAt: slots.body[0].startAt });
    expect(moved.status).toBe(200);

    const pending = await owner.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.appointmentId, appointment.id),
          eq(outbox.event, 'appointment.reminder'),
          eq(outbox.status, 'pending'),
        ),
      );
    expect(pending.map((r) => r.payload.startAt)).toEqual(
      [slots.body[0].startAt, slots.body[0].startAt].map((s) => new Date(s).toISOString()),
    );

    await drain();
    expect(smsTo(mobile).at(-1)?.body).toContain('is now on');

    await admin.agent
      .post(`/api/appointments/${appointment.id}/cancel`)
      .set('x-csrf-token', admin.csrf);
    const left = await owner.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.appointmentId, appointment.id),
          eq(outbox.event, 'appointment.reminder'),
          eq(outbox.status, 'pending'),
        ),
      );
    expect(left).toEqual([]);
    await drain();
    expect(smsTo(mobile).at(-1)?.body).toContain('is cancelled');
  });

  it('skips a due reminder whose appointment changed behind its back', async () => {
    const { appointment, mobile } = await book();
    await drain();
    memorySms.sent.length = 0;
    await owner.db
      .update(outbox)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(
        and(eq(outbox.appointmentId, appointment.id), eq(outbox.event, 'appointment.reminder')),
      );
    await owner.db
      .update(appointments)
      .set({ status: 'cancelled' })
      .where(eq(appointments.id, appointment.id));
    await drain();
    expect(smsTo(mobile)).toEqual([]);
    const logs = await owner.db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.event, 'appointment.reminder'));
    expect(
      logs.some((l) => l.status === 'skipped' && l.error === 'Appointment changed or cancelled'),
    ).toBe(true);
  });
});

describe('after the visit', () => {
  it('sends a prescription link that works, without naming the medicines', async () => {
    const mobile = `+63${nextMobile().slice(1)}`;
    const [patient] = await owner.db
      .insert(patients)
      .values({
        clinicId: clinic.clinicId,
        firstName: 'Rx',
        lastName: 'Receiver',
        birthdate: '1980-08-08',
        mobile,
      })
      .returning();
    const startAt = new Date(Date.now() - 10 * 60_000);
    const [appt] = await owner.db
      .insert(appointments)
      .values({
        clinicId: clinic.clinicId,
        doctorId: clinic.userIds.doctor,
        patientId: patient!.id,
        startAt,
        endAt: new Date(startAt.getTime() + 15 * 60_000),
        type: 'walk_in',
        status: 'in_consult',
        referenceCode: `RX${Date.now().toString(36).slice(-5).toUpperCase()}`,
      })
      .returning();
    const finish = await admin.agent
      .post(`/api/consult/${appt!.id}/finish`)
      .set('x-csrf-token', admin.csrf)
      .send({
        soap: { assessment: 'Acute pharyngitis' },
        rx: {
          items: [
            {
              genericName: 'Amoxicillin',
              strength: '500 mg',
              sig: '1 cap 3x a day',
              quantity: '21',
            },
          ],
        },
      });
    expect(finish.status).toBe(200);
    await drain();
    const [sms] = smsTo(mobile);
    expect(sms?.body).toMatch(/\/rx\/[\w-]{40,}/);
    expect(sms?.body).not.toMatch(/amoxicillin|pharyngitis/i);
    const token = sms!.body.match(/\/rx\/([\w-]+)/)![1];
    const pdf = await request(app.server)
      .post(`/api/public/rx/${token}`)
      .send({ birthdate: '1980-08-08' });
    expect(pdf.status).toBe(200);
  });
});

describe('retries', () => {
  it('retries failed channels without resending the ones that worked', async () => {
    const { mobile, email } = await book();
    memorySms.failNext = 1;
    const errors = await drain();
    expect(errors.some((e) => e.includes('Simulated provider failure'))).toBe(true);
    expect(smsTo(mobile)).toHaveLength(0);
    expect(emailTo(email)).toHaveLength(1);

    // The queue retries the job: the same outbox row is processed again.
    const [row] = await owner.db
      .select()
      .from(outbox)
      .where(and(eq(outbox.event, 'appointment.booked'), eq(outbox.status, 'queued')));
    await processOutbox(row!.id, clinic.clinicId, providers, { finalAttempt: false });
    expect(smsTo(mobile)).toHaveLength(1);
    expect(emailTo(email)).toHaveLength(1);
  });

  it('closes the row after the final attempt and keeps the failure in the log', async () => {
    const { appointment } = await book();
    memorySms.failNext = 1;
    expect(await drain(true)).toEqual([]);
    const [row] = await owner.db
      .select()
      .from(outbox)
      .where(and(eq(outbox.appointmentId, appointment.id), eq(outbox.event, 'appointment.booked')));
    expect(row?.status).toBe('done');
    const [log] = await owner.db
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.outboxId, row!.id), eq(notificationLogs.channel, 'sms')));
    expect(log).toMatchObject({ status: 'failed', error: 'Simulated provider failure' });
  });
});

describe('opt-out', () => {
  it('stops SMS through the link in the message', async () => {
    const { appointment, mobile } = await book();
    await drain();
    const token = smsTo(mobile)[0]!.body.match(/\/u\/([\w-]+)/)![1]!;
    const info = await request(app.server).get(`/api/public/opt-out/${token}`);
    expect(info.body).toEqual({ clinicName: 'Clinic notify', smsOptIn: true });
    const res = await request(app.server).post(`/api/public/opt-out/${token}`);
    expect(res.body.smsOptIn).toBe(false);
    expect(
      (await request(app.server).get(`/api/public/opt-out/${token.slice(0, -2)}xx`)).status,
    ).toBe(404);

    await admin.agent
      .post(`/api/appointments/${appointment.id}/cancel`)
      .set('x-csrf-token', admin.csrf);
    memorySms.sent.length = 0;
    await drain();
    expect(smsTo(mobile)).toEqual([]);
    const logs = await owner.db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.event, 'appointment.cancelled'));
    expect(
      logs.some(
        (l) =>
          l.channel === 'sms' && l.status === 'skipped' && l.error === 'Patient opted out of SMS',
      ),
    ).toBe(true);
  });

  it('stops SMS when the patient replies STOP', async () => {
    const { mobile } = await book();
    const hook = (secret: string, message: string) =>
      request(app.server)
        .post('/api/webhooks/sms/inbound')
        .set('x-webhook-secret', secret)
        .send({ from: mobile, message });
    expect((await hook('wrong-secret-value-123', 'STOP')).status).toBe(404);
    expect((await hook('test-webhook-secret-123', 'hello')).body).toEqual({ optedOut: 0 });
    expect((await hook('test-webhook-secret-123', ' stop please')).body).toEqual({ optedOut: 1 });
    const [patient] = await owner.db.select().from(patients).where(eq(patients.mobile, mobile));
    expect(patient?.smsOptIn).toBe(false);
  });
});

describe('templates', () => {
  it('lists every event and channel, validates variables and supports reset', async () => {
    const list = await admin.agent.get('/api/notification-templates');
    expect(list.body).toHaveLength(12);

    const leaky = await admin.agent
      .put('/api/notification-templates/appointment.booked/sms')
      .set('x-csrf-token', admin.csrf)
      .send({ body: 'Hi {{firstName}}, about your {{reason}}' });
    expect(leaky.status).toBe(400);

    const custom = await admin.agent
      .put('/api/notification-templates/appointment.booked/sms')
      .set('x-csrf-token', admin.csrf)
      .send({ body: 'Kumusta {{firstName}}! Ref {{referenceCode}}.' });
    expect(custom.body).toMatchObject({ isCustom: true });
    const { mobile } = await book();
    await drain();
    expect(smsTo(mobile)[0]?.body).toMatch(/^Kumusta Notif! Ref/);

    const reset = await admin.agent
      .post('/api/notification-templates/appointment.booked/sms/reset')
      .set('x-csrf-token', admin.csrf);
    expect(reset.body.isCustom).toBe(false);

    const secretary = await signIn(app, clinic.emails.secretary);
    expect((await secretary.agent.get('/api/notification-templates')).status).toBe(403);
    expect((await secretary.agent.get('/api/notification-logs')).status).toBe(403);
  });

  it('shows logs with masked recipients', async () => {
    const logs = await admin.agent.get('/api/notification-logs?limit=5');
    expect(logs.status).toBe(200);
    expect(logs.body[0].recipient).toMatch(/•••/);
  });
});

describe('through pg-boss', () => {
  it('delivers a queued notification end to end', async () => {
    const boss = new PgBoss({ connectionString: process.env.JOBS_DATABASE_URL as string });
    await boss.start();
    if (!(await boss.getQueue('notify-test')))
      await boss.createQueue('notify-test', { retryLimit: 3, retryBackoff: true });
    await boss.work<{ outboxId: string; clinicId: string }>(
      'notify-test',
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (job)
          await processOutbox(job.data.outboxId, job.data.clinicId, providers, {
            finalAttempt: job.retryCount >= 3,
          });
      },
    );
    try {
      const { mobile } = await book();
      await relayDueOutbox((data) =>
        boss.send('notify-test', data, { singletonKey: data.outboxId }),
      );
      const deadline = Date.now() + 15_000;
      while (smsTo(mobile).length === 0 && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 200));
      expect(smsTo(mobile)).toHaveLength(1);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 30_000);
});
