import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc } from '@clinic/shared';
import type { App } from '../src/app';
import { appointments, patients, visits } from '../src/db/schema';
import { referenceCode } from '../src/lib/reference';
import {
  createClinicFixture,
  owner,
  PASSWORD,
  signIn,
  startApp,
  uniqueEmail,
  type ClinicFixture,
  type SignedIn,
} from './helpers';

let app: App;
let baseUrl: string;
const today = todayIn(CLINIC_TIMEZONE);
let minute = 0;

async function seedPatient(
  clinicId: string,
  overrides: Partial<typeof patients.$inferInsert> = {},
) {
  const [row] = await owner.db
    .insert(patients)
    .values({
      clinicId,
      firstName: 'Queue',
      lastName: 'Patient',
      mobile: '+639170001111',
      ...overrides,
    })
    .returning();
  return row!;
}

/** A booked appointment today (or another day), at a unique time. */
async function seedAppointment(
  clinicId: string,
  doctorId: string,
  patientId: string,
  date = today,
) {
  minute += 5;
  const startAt = zonedToUtc(date, `06:${String(minute % 60).padStart(2, '0')}`, CLINIC_TIMEZONE);
  startAt.setUTCHours(startAt.getUTCHours() + Math.floor(minute / 60));
  const [row] = await owner.db
    .insert(appointments)
    .values({
      clinicId,
      doctorId,
      patientId,
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60_000),
      referenceCode: referenceCode(),
    })
    .returning();
  return row!;
}

let clinic: ClinicFixture;
let doctor2Id: string;
let secretary: SignedIn;
let doctor: SignedIn;

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  const doc2Email = uniqueEmail('doc2');
  clinic = await createClinicFixture('queue', [
    { name: 'Second Doctor', email: doc2Email, password: PASSWORD, roles: ['doctor'] },
  ]);
  secretary = await signIn(app, clinic.emails.secretary);
  doctor = await signIn(app, clinic.emails.doctor);
  const staff = await doctor.agent.get('/api/staff');
  doctor2Id = staff.body.find((s: { name: string }) => s.name === 'Second Doctor').id;
});
afterAll(() => app.close());

const checkIn = (id: string, body: object = {}) =>
  secretary.agent
    .post(`/api/appointments/${id}/check-in`)
    .set('x-csrf-token', secretary.csrf)
    .send(body);

describe('check-in', () => {
  it('assigns queue numbers per doctor per day, saves vitals and completes the profile', async () => {
    const p1 = await seedPatient(clinic.clinicId, { birthdate: null, sex: null });
    const a1 = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p1.id);
    const res = await checkIn(a1.id, {
      vitals: { bpSystolic: 120, bpDiastolic: 80, temperatureC: 36.8, weightKg: 62.5, o2Sat: 98 },
      patient: { birthdate: '1980-01-15', sex: 'female', allergies: 'Penicillin' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'arrived', queueNumber: 1 });
    expect(res.body.arrivedAt).toEqual(expect.any(String));

    const [visit] = await owner.db.select().from(visits).where(eq(visits.appointmentId, a1.id));
    expect(visit).toMatchObject({ bpSystolic: 120, temperatureC: '36.8', weightKg: '62.50' });
    const [patient] = await owner.db.select().from(patients).where(eq(patients.id, p1.id));
    expect(patient).toMatchObject({
      birthdate: '1980-01-15',
      sex: 'female',
      allergies: 'Penicillin',
    });

    const a2 = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p1.id);
    expect((await checkIn(a2.id)).body.queueNumber).toBe(2);
    const a3 = await seedAppointment(clinic.clinicId, doctor2Id, p1.id);
    expect((await checkIn(a3.id)).body.queueNumber).toBe(1);
  });

  it('never hands out the same number twice under concurrency', async () => {
    const other = await createClinicFixture('queue-race');
    const sec = await signIn(app, other.emails.secretary);
    const p = await seedPatient(other.clinicId);
    const appts = await Promise.all(
      [1, 2, 3, 4].map(() => seedAppointment(other.clinicId, other.userIds.doctor, p.id)),
    );
    const results = await Promise.all(
      appts.map((a) =>
        sec.agent.post(`/api/appointments/${a.id}/check-in`).set('x-csrf-token', sec.csrf).send({}),
      ),
    );
    expect(results.map((r) => r.body.queueNumber).sort()).toEqual([1, 2, 3, 4]);
  });

  it('refuses other days and repeated check-ins', async () => {
    const p = await seedPatient(clinic.clinicId);
    const tomorrow = await seedAppointment(
      clinic.clinicId,
      clinic.userIds.doctor,
      p.id,
      addDays(today, 1),
    );
    expect((await checkIn(tomorrow.id)).status).toBe(409);
    const a = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p.id);
    expect((await checkIn(a.id)).status).toBe(200);
    expect((await checkIn(a.id)).status).toBe(409);
  });

  it('validates vitals', async () => {
    const p = await seedPatient(clinic.clinicId);
    const a = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p.id);
    const bad = await checkIn(a.id, {
      vitals: { bpSystolic: 80, bpDiastolic: 120, temperatureC: 52 },
    });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: { path: string[] }) => d.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['vitals.bpDiastolic', 'vitals.temperatureC']));
  });
});

describe('walk-ins', () => {
  it('creates an arrived walk-in with the next queue number', async () => {
    const p = await seedPatient(clinic.clinicId);
    const res = await secretary.agent
      .post('/api/walk-ins')
      .set('x-csrf-token', secretary.csrf)
      .send({
        doctorId: doctor2Id,
        patientId: p.id,
        reason: 'Fever',
        vitals: { temperatureC: 38.2 },
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'walk_in', status: 'arrived', queueNumber: 2 });

    const queue = await secretary.agent.get(`/api/queue?doctorId=${doctor2Id}`);
    const item = queue.body.waiting.find(
      (w: { appointmentId: string }) => w.appointmentId === res.body.id,
    );
    expect(item.vitals).toMatchObject({ temperatureC: 38.2, bpSystolic: null });
  });
});

describe('doctor queue', () => {
  it('lists waiting patients with vitals but never clinical notes', async () => {
    const [anyVisit] = await owner.db
      .select()
      .from(visits)
      .where(eq(visits.clinicId, clinic.clinicId));
    await owner.db
      .update(visits)
      .set({ subjective: 'SECRET-NOTE' })
      .where(eq(visits.id, anyVisit!.id));

    const res = await secretary.agent.get(`/api/queue?doctorId=${clinic.userIds.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.waiting.map((w: { queueNumber: number }) => w.queueNumber)).toEqual(
      [...res.body.waiting.map((w: { queueNumber: number }) => w.queueNumber)].sort(
        (a, b) => a - b,
      ),
    );
    expect(res.body.waiting[0].vitals.bpSystolic).toBe(120);
    expect(res.body.waiting[0].patient.allergies).toBe('Penicillin');
    expect(JSON.stringify(res.body)).not.toContain('SECRET-NOTE');
  });

  it('lets only doctors call patients, in queue order, and send them back', async () => {
    expect(
      (await secretary.agent.post('/api/queue/call-next').set('x-csrf-token', secretary.csrf))
        .status,
    ).toBe(403);

    const called = await doctor.agent.post('/api/queue/call-next').set('x-csrf-token', doctor.csrf);
    expect(called.status).toBe(200);
    expect(called.body).toMatchObject({ status: 'in_consult', queueNumber: 1 });

    const queue = await doctor.agent.get(`/api/queue?doctorId=${clinic.userIds.doctor}`);
    expect(queue.body.inConsult.map((i: { appointmentId: string }) => i.appointmentId)).toEqual([
      called.body.appointmentId,
    ]);
    expect(queue.body.waiting.some((i: { queueNumber: number }) => i.queueNumber === 1)).toBe(
      false,
    );

    const back = await doctor.agent
      .post(`/api/appointments/${called.body.appointmentId}/requeue`)
      .set('x-csrf-token', doctor.csrf);
    expect(back.body.status).toBe('arrived');

    const doc2Waiting = (await secretary.agent.get(`/api/queue?doctorId=${doctor2Id}`)).body
      .waiting[0];
    const wrongDoctor = await doctor.agent
      .post(`/api/appointments/${doc2Waiting.appointmentId}/call`)
      .set('x-csrf-token', doctor.csrf);
    expect(wrongDoctor.status).toBe(404);
  });

  it('blocks vitals changes after the visit is finished', async () => {
    const p = await seedPatient(clinic.clinicId);
    const a = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p.id);
    await checkIn(a.id, { vitals: { heartRate: 80 } });
    await owner.db.update(visits).set({ locked: true }).where(eq(visits.appointmentId, a.id));
    const res = await secretary.agent
      .put(`/api/appointments/${a.id}/vitals`)
      .set('x-csrf-token', secretary.csrf)
      .send({ heartRate: 90 });
    expect(res.status).toBe(409);
  });
});

describe('live updates', () => {
  async function openStream(email: string) {
    const login = await request(app.server)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, {
      headers: { cookie },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      async next(timeoutMs = 3000): Promise<string | null> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const match = buffer.match(/event: [^\n]+\ndata: [^\n]+\n\n/);
          if (match) {
            buffer = buffer.slice(match.index! + match[0].length);
            return match[0];
          }
          const chunk = await Promise.race([
            reader.read(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
          ]);
          if (!chunk || chunk.done) return null;
          buffer += decoder.decode(chunk.value);
        }
        return null;
      },
      close: () => controller.abort(),
    };
  }

  it('pushes a change event (ids only) to the same clinic and nobody else', async () => {
    const outsider = await createClinicFixture('queue-outsider');
    const mine = await openStream(clinic.emails.doctor);
    const theirs = await openStream(outsider.emails.secretary);
    expect(mine.status).toBe(200);
    expect(mine.contentType).toContain('text/event-stream');

    const p = await seedPatient(clinic.clinicId, { firstName: 'Streamy' });
    const a = await seedAppointment(clinic.clinicId, clinic.userIds.doctor, p.id);
    await checkIn(a.id);

    const event = await mine.next();
    expect(event).toContain('event: appointments.changed');
    expect(event).toContain(clinic.userIds.doctor);
    expect(event).not.toContain('Streamy');
    expect(await theirs.next(800)).toBeNull();
    mine.close();
    theirs.close();
  });
});
