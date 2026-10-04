import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn } from '@clinic/shared';
import type { App } from '../src/app';
import { appointments, schedules } from '../src/db/schema';
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
let clinic: ClinicFixture;
let admin: SignedIn;
const tomorrow = addDays(todayIn(CLINIC_TIMEZONE), 1);
let mobileSeq = 0;
const nextMobile = () => `0917${String(4000000 + ++mobileSeq).padStart(7, '0')}`;

const api = () => request(app.server);
const booking = (startAt: string, overrides: Record<string, unknown> = {}) => ({
  doctorId: clinic.userIds.doctor,
  startAt,
  firstName: 'Bea',
  lastName: 'Booker',
  birthdate: '1992-03-04',
  mobile: nextMobile(),
  smsOptIn: true,
  privacyConsent: true,
  website: '',
  ...overrides,
});
const slotsFor = async (date = tomorrow, doctorId = clinic.userIds.doctor) =>
  (await api().get(`/api/public/clinics/${clinic.slug}/slots?doctorId=${doctorId}&date=${date}`))
    .body as {
    startAt: string;
  }[];

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('booking', [
    {
      name: 'No Hours Doctor',
      email: uniqueEmail('nohours'),
      password: PASSWORD,
      roles: ['doctor'],
    },
  ]);
  // Open every day so the tests do not depend on the weekday they run on.
  await owner.db.insert(schedules).values(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      clinicId: clinic.clinicId,
      doctorId: clinic.userIds.doctor,
      dayOfWeek,
      startTime: '08:00',
      endTime: '17:00',
      slotMinutes: 15,
    })),
  );
  admin = await signIn(app, clinic.emails.doctor);
});
afterAll(() => app.close());

describe('public booking page', () => {
  it('lists the clinic and only doctors with published hours', async () => {
    const res = await api().get(`/api/public/clinics/${clinic.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.doctors.map((d: { id: string }) => d.id)).toEqual([clinic.userIds.doctor]);
    expect((await api().get('/api/public/clinics/does-not-exist')).status).toBe(404);
  });

  it('offers slots from the schedule and day counts for the date picker', async () => {
    expect(await slotsFor()).toHaveLength(36);
    const days = await api().get(
      `/api/public/clinics/${clinic.slug}/days?doctorId=${clinic.userIds.doctor}&from=${tomorrow}`,
    );
    expect(days.body).toHaveLength(14);
    expect(days.body[0]).toEqual({ date: tomorrow, available: 36 });
  });

  it('books a slot, then that slot is gone and cannot be booked twice', async () => {
    const [slot] = await slotsFor();
    const res = await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(slot!.startAt));
    expect(res.status).toBe(201);
    expect(res.body.referenceCode).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{4}$/);
    expect(res.body.cancelToken).toEqual(expect.any(String));
    expect((await slotsFor()).map((s) => s.startAt)).not.toContain(slot!.startAt);

    const again = await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(slot!.startAt));
    expect(again.status).toBe(409);
  });

  it('lets only one of two simultaneous bookings for a slot through', async () => {
    const [slot] = await slotsFor();
    const results = await Promise.all([
      api().post(`/api/public/clinics/${clinic.slug}/bookings`).send(booking(slot!.startAt)),
      api().post(`/api/public/clinics/${clinic.slug}/bookings`).send(booking(slot!.startAt)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('matches returning patients by mobile and birthdate', async () => {
    const mobile = nextMobile();
    const [a, b] = await slotsFor();
    await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(a!.startAt, { mobile }));
    await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(b!.startAt, { mobile, firstName: 'Beatriz' }));
    const found = await admin.agent.get(`/api/patients?q=${mobile}`);
    expect(found.body.total).toBe(1);
    expect(found.body.items[0].firstName).toBe('Bea');
  });

  it('rejects bots, missing consent and times that are not offered', async () => {
    const [slot] = await slotsFor();
    const url = `/api/public/clinics/${clinic.slug}/bookings`;
    expect(
      (
        await api()
          .post(url)
          .send(booking(slot!.startAt, { website: 'http://spam' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(url)
          .send(booking(slot!.startAt, { privacyConsent: false }))
      ).status,
    ).toBe(400);
    const offGrid = new Date(new Date(slot!.startAt).getTime() + 7 * 60_000).toISOString();
    expect((await api().post(url).send(booking(offGrid))).status).toBe(409);
  });

  it('does not book doctors without published hours', async () => {
    const staff = await admin.agent.get('/api/staff');
    const noHours = staff.body.find((s: { name: string }) => s.name === 'No Hours Doctor');
    const [slot] = await slotsFor();
    const res = await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(slot!.startAt, { doctorId: noHours.id }));
    expect(res.status).toBe(404);
  });
});

describe('cancel links', () => {
  it('shows and cancels the appointment, freeing the slot', async () => {
    const [slot] = await slotsFor();
    const booked = await api()
      .post(`/api/public/clinics/${clinic.slug}/bookings`)
      .send(booking(slot!.startAt));
    const token = booked.body.cancelToken as string;

    const lookup = await api().get(`/api/public/cancel/${token}`);
    expect(lookup.body).toMatchObject({
      referenceCode: booked.body.referenceCode,
      cancellable: true,
    });
    expect(JSON.stringify(lookup.body)).not.toContain('Booker');

    const cancelled = await api().post(`/api/public/cancel/${token}`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancellable: false });
    expect((await slotsFor()).map((s) => s.startAt)).toContain(slot!.startAt);
    expect((await api().post(`/api/public/cancel/${token}`)).status).toBe(409);
  });

  it('rejects unknown tokens', async () => {
    expect((await api().get(`/api/public/cancel/${'x'.repeat(43)}`)).status).toBe(404);
  });
});

describe('schedule settings', () => {
  it('validates overlapping blocks', async () => {
    const res = await admin.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/schedule`)
      .set('x-csrf-token', admin.csrf)
      .send({
        blocks: [
          {
            dayOfWeek: 1,
            startTime: '08:00',
            endTime: '12:00',
            slotMinutes: 15,
            maxPatients: null,
          },
          {
            dayOfWeek: 1,
            startTime: '11:00',
            endTime: '13:00',
            slotMinutes: 15,
            maxPatients: null,
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('applies closed days, custom hours and patient caps', async () => {
    const other = await createClinicFixture('sched');
    const doctorId = other.userIds.doctor;
    const doc = await signIn(app, other.emails.doctor);
    const put = await doc.agent
      .put(`/api/doctors/${doctorId}/schedule`)
      .set('x-csrf-token', doc.csrf)
      .send({
        blocks: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '10:00',
          slotMinutes: 20,
          maxPatients: 1,
        })),
      });
    expect(put.status).toBe(200);
    const slots = (date: string) =>
      api().get(`/api/public/clinics/${other.slug}/slots?doctorId=${doctorId}&date=${date}`);
    expect((await slots(tomorrow)).body).toHaveLength(3);

    const [first] = (await slots(tomorrow)).body;
    await api()
      .post(`/api/public/clinics/${other.slug}/bookings`)
      .send(booking(first.startAt, { doctorId }));
    expect((await slots(tomorrow)).body).toHaveLength(0);

    const dayAfter = addDays(tomorrow, 1);
    const closed = await doc.agent
      .post(`/api/doctors/${doctorId}/exceptions`)
      .set('x-csrf-token', doc.csrf)
      .send({ date: dayAfter, isClosed: true, note: 'Holiday' });
    expect(closed.status).toBe(201);
    expect((await slots(dayAfter)).body).toHaveLength(0);

    const later = addDays(tomorrow, 2);
    await doc.agent
      .post(`/api/doctors/${doctorId}/exceptions`)
      .set('x-csrf-token', doc.csrf)
      .send({ date: later, isClosed: false, startTime: '14:00', endTime: '15:00' });
    expect((await slots(later)).body).toHaveLength(3);

    const exceptionId = closed.body.exceptions.find(
      (e: { date: string }) => e.date === dayAfter,
    ).id;
    await doc.agent
      .delete(`/api/doctors/${doctorId}/exceptions/${exceptionId}`)
      .set('x-csrf-token', doc.csrf);
    expect((await slots(dayAfter)).body).toHaveLength(3);
  });

  it('keeps schedule editing to admins', async () => {
    const secretary = await signIn(app, clinic.emails.secretary);
    const res = await secretary.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/schedule`)
      .set('x-csrf-token', secretary.csrf)
      .send({ blocks: [] });
    expect(res.status).toBe(403);
    expect(
      (await secretary.agent.get(`/api/doctors/${clinic.userIds.doctor}/schedule`)).status,
    ).toBe(200);
  });
});

describe('staff calendar', () => {
  let patientId: string;
  beforeAll(async () => {
    const res = await admin.agent
      .post('/api/patients')
      .set('x-csrf-token', admin.csrf)
      .send({ firstName: 'Cal', lastName: 'Endar', mobile: nextMobile() });
    patientId = res.body.id;
  });

  it('creates, lists, moves and cancels appointments', async () => {
    const secretary = await signIn(app, clinic.emails.secretary);
    const [s1, s2] = await slotsFor();
    const created = await secretary.agent
      .post('/api/appointments')
      .set('x-csrf-token', secretary.csrf)
      .send({
        doctorId: clinic.userIds.doctor,
        patientId,
        startAt: s1!.startAt,
        reason: 'Check-up',
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      source: 'staff',
      status: 'booked',
      patient: { firstName: 'Cal' },
    });
    expect(new Date(created.body.endAt).getTime() - new Date(created.body.startAt).getTime()).toBe(
      15 * 60_000,
    );

    const list = await secretary.agent.get(`/api/appointments?from=${tomorrow}&to=${tomorrow}`);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const moved = await secretary.agent
      .patch(`/api/appointments/${created.body.id}`)
      .set('x-csrf-token', secretary.csrf)
      .send({ startAt: s2!.startAt });
    expect(moved.body.startAt).toBe(s2!.startAt);

    const taken = list.body.find(
      (a: { id: string; status: string }) => a.id !== created.body.id && a.status === 'booked',
    );
    const clash = await secretary.agent
      .patch(`/api/appointments/${created.body.id}`)
      .set('x-csrf-token', secretary.csrf)
      .send({ startAt: taken.startAt });
    expect(clash.status).toBe(409);

    const cancelled = await secretary.agent
      .post(`/api/appointments/${created.body.id}/cancel`)
      .set('x-csrf-token', secretary.csrf);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('marks no-shows only after the start time', async () => {
    const [slot] = await slotsFor();
    const future = await admin.agent
      .post('/api/appointments')
      .set('x-csrf-token', admin.csrf)
      .send({ doctorId: clinic.userIds.doctor, patientId, startAt: slot!.startAt });
    expect(
      (
        await admin.agent
          .post(`/api/appointments/${future.body.id}/no-show`)
          .set('x-csrf-token', admin.csrf)
      ).status,
    ).toBe(409);

    const past = new Date(Date.now() - 2 * 3_600_000);
    await owner.db
      .update(appointments)
      .set({ startAt: past, endAt: new Date(past.getTime() + 15 * 60_000) })
      .where(eq(appointments.id, future.body.id));
    const res = await admin.agent
      .post(`/api/appointments/${future.body.id}/no-show`)
      .set('x-csrf-token', admin.csrf);
    expect(res.body.status).toBe('no_show');
  });

  it('limits assigned secretaries to their doctors', async () => {
    const scoped = await createClinicFixture('scope', [
      { name: 'Other Doctor', email: uniqueEmail('other'), password: PASSWORD, roles: ['doctor'] },
    ]);
    const owner2 = await signIn(app, scoped.emails.doctor);
    const staff = await owner2.agent.get('/api/staff');
    const otherId = staff.body.find((s: { name: string }) => s.name === 'Other Doctor').id;
    await owner2.agent
      .patch(`/api/staff/${scoped.userIds.secretary}`)
      .set('x-csrf-token', owner2.csrf)
      .send({ doctorIds: [otherId] });

    const secretary = await signIn(app, scoped.emails.secretary);
    const doctors = await secretary.agent.get('/api/doctors');
    expect(doctors.body.map((d: { id: string }) => d.id)).toEqual([otherId]);
    const blocked = await secretary.agent.get(
      `/api/appointments?from=${tomorrow}&to=${tomorrow}&doctorId=${scoped.userIds.doctor}`,
    );
    expect(blocked.status).toBe(403);
  });

  it('hides appointments from other clinics', async () => {
    const list = await admin.agent.get(`/api/appointments?from=${tomorrow}&to=${tomorrow}`);
    const id = list.body[0].id as string;
    const outsider = await createClinicFixture('cal-out');
    const other = await signIn(app, outsider.emails.doctor);
    expect((await other.agent.get(`/api/appointments/${id}`)).status).toBe(404);
    expect(
      (await other.agent.post(`/api/appointments/${id}/cancel`).set('x-csrf-token', other.csrf))
        .status,
    ).toBe(404);
  });
});
