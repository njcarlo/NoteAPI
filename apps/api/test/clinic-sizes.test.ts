import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc, type Role } from '@clinic/shared';
import type { App } from '../src/app';
import { provisionClinic, type MemberInput } from '../src/db/provision';
import { appointments, patients, schedules } from '../src/db/schema';
import { referenceCode } from '../src/lib/reference';
import { owner, PASSWORD, signIn, startApp, type SignedIn } from './helpers';

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

const today = todayIn(CLINIC_TIMEZONE);
const tomorrow = addDays(today, 1);

/**
 * A clinic with `doctors` doctors. The first doctor is also the admin. With one doctor there is
 * no secretary at all (solo practice); otherwise there is one secretary for everyone.
 */
async function clinicWith(doctors: number) {
  const suffix = randomUUID().slice(0, 8);
  const email = (who: string) => `${who}.${suffix}@test.local`;
  const members: MemberInput[] = Array.from({ length: doctors }, (_, i) => ({
    name: `Doctor ${i + 1}`,
    email: email(`doctor${i + 1}`),
    password: PASSWORD,
    roles: (i === 0 ? ['admin', 'doctor'] : ['doctor']) as Role[],
    doctor: { prcNo: `100000${i}` },
  }));
  if (doctors > 1)
    members.push({
      name: 'Front Desk',
      email: email('desk'),
      password: PASSWORD,
      roles: ['secretary'],
    });

  const slug = `size-${doctors}-${suffix}`;
  const { clinic, userIds } = await provisionClinic(
    owner.db,
    { slug, name: `Clinic of ${doctors}` },
    members,
  );
  const doctorIds = userIds.slice(0, doctors);
  await owner.db.insert(schedules).values(
    doctorIds.flatMap((doctorId) =>
      [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        clinicId: clinic.id,
        doctorId,
        dayOfWeek,
        startTime: '08:00',
        endTime: '12:00',
        slotMinutes: 15,
      })),
    ),
  );
  return {
    clinicId: clinic.id,
    slug,
    doctorIds,
    doctorEmails: members.slice(0, doctors).map((m) => m.email),
    deskEmail: doctors > 1 ? email('desk') : members[0]!.email,
  };
}

describe.each([1, 2, 5])('a clinic with %i doctor(s)', (count) => {
  let c: Awaited<ReturnType<typeof clinicWith>>;
  let desk: SignedIn;

  beforeAll(async () => {
    c = await clinicWith(count);
    desk = await signIn(app, c.deskEmail);
  });

  it('lists every doctor for booking and for staff', async () => {
    const pub = await request(app.server).get(`/api/public/clinics/${c.slug}`);
    expect(pub.body.doctors).toHaveLength(count);
    const staff = await desk.agent.get('/api/doctors');
    expect(staff.body.map((d: { id: string }) => d.id).sort()).toEqual([...c.doctorIds].sort());
  });

  it('books each doctor online independently', async () => {
    for (const [i, doctorId] of c.doctorIds.entries()) {
      const slots = await request(app.server).get(
        `/api/public/clinics/${c.slug}/slots?doctorId=${doctorId}&date=${tomorrow}`,
      );
      expect(slots.body).toHaveLength(16);
      // Same time for every doctor: doctors do not block each other.
      const res = await request(app.server)
        .post(`/api/public/clinics/${c.slug}/bookings`)
        .send({
          doctorId,
          startAt: slots.body[0].startAt,
          firstName: `Patient${i}`,
          lastName: 'Size',
          birthdate: '1990-01-01',
          mobile: `0917${String(5000000 + count * 100 + i).padStart(7, '0')}`,
          smsOptIn: true,
          privacyConsent: true,
        });
      expect(res.status).toBe(201);
    }
    const calendar = await desk.agent.get(`/api/appointments?from=${tomorrow}&to=${tomorrow}`);
    expect(calendar.body).toHaveLength(count);
  });

  it('runs a separate queue per doctor, numbered from 1', async () => {
    const [patient] = await owner.db
      .insert(patients)
      .values({
        clinicId: c.clinicId,
        firstName: 'Queue',
        lastName: 'Size',
        mobile: '+639170009999',
      })
      .returning();
    for (const doctorId of c.doctorIds) {
      const startAt = zonedToUtc(today, '00:05', CLINIC_TIMEZONE);
      const [appt] = await owner.db
        .insert(appointments)
        .values({
          clinicId: c.clinicId,
          doctorId,
          patientId: patient!.id,
          startAt,
          endAt: new Date(startAt.getTime() + 15 * 60_000),
          referenceCode: referenceCode(),
        })
        .returning();
      const res = await desk.agent
        .post(`/api/appointments/${appt!.id}/check-in`)
        .set('x-csrf-token', desk.csrf)
        .send({});
      expect(res.body.queueNumber).toBe(1);
    }

    const walkIn = await desk.agent
      .post('/api/walk-ins')
      .set('x-csrf-token', desk.csrf)
      .send({ doctorId: c.doctorIds[0], patientId: patient!.id });
    expect(walkIn.body.queueNumber).toBe(2);

    const all = await desk.agent.get('/api/queue');
    expect(all.body.waiting).toHaveLength(count + 1);

    for (const [i, doctorId] of c.doctorIds.entries()) {
      const doctor = await signIn(app, c.doctorEmails[i]!);
      const called = await doctor.agent
        .post('/api/queue/call-next')
        .set('x-csrf-token', doctor.csrf);
      expect(called.body).toMatchObject({ doctorId, queueNumber: 1, status: 'in_consult' });
    }
  });
});
