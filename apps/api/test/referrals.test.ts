import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc } from '@clinic/shared';
import type { App } from '../src/app';
import { appointments, auditLogs, patients, referrals, schedules } from '../src/db/schema';
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
let clinic: ClinicFixture;
let doctor: SignedIn;
let cardio: SignedIn;
let pedia: SignedIn;
let secretary: SignedIn;
let cardioId: string;
let pediaId: string;
let minute = 0;
const today = todayIn(CLINIC_TIMEZONE);
const tomorrow = addDays(today, 1);

const post = (user: SignedIn, path: string, body: object = {}) =>
  user.agent.post(path).set('x-csrf-token', user.csrf).send(body);

/** Text drawn in an (uncompressed) pdfkit file: lines are hex-encoded glyph runs inside TJ arrays. */
function pdfText(raw: string): string {
  return [...raw.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map(([, runs]) =>
      [...runs!.matchAll(/<([0-9a-fA-F]+)>/g)]
        .map(([, hex]) => Buffer.from(hex!, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');
}

/** A patient in consultation with `by` (the main doctor unless given); returns the visit. */
async function visitInConsult(byId = clinic.userIds.doctor, by = doctor) {
  const [patient] = await owner.db
    .insert(patients)
    .values({
      clinicId: clinic.clinicId,
      firstName: 'Rosario',
      lastName: 'Referral',
      birthdate: '1970-02-03',
      sex: 'female',
      mobile: '+639170003333',
      allergies: 'Sulfa',
    })
    .returning();
  minute += 7;
  const startAt = zonedToUtc(today, '00:01', CLINIC_TIMEZONE);
  startAt.setUTCMinutes(startAt.getUTCMinutes() + minute);
  const [appt] = await owner.db
    .insert(appointments)
    .values({
      clinicId: clinic.clinicId,
      doctorId: byId,
      patientId: patient!.id,
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60_000),
      status: 'in_consult',
      referenceCode: referenceCode(),
    })
    .returning();
  const consult = await by.agent.get(`/api/consult/${appt!.id}`);
  expect(consult.status).toBe(200);
  return { patientId: patient!.id, appointmentId: appt!.id, visitId: consult.body.visit.id };
}

const cardiology = (overrides: Record<string, unknown> = {}) => ({
  specialty: 'Cardiology',
  toDoctorId: cardioId,
  urgency: 'urgent',
  reason: 'Evaluate chest pain on exertion',
  clinicalSummary: 'BP 150/95. ECG: ST depression in V4–V6.',
  ...overrides,
});

async function openSlot(doctorId: string): Promise<string> {
  const res = await secretary.agent.get(`/api/doctors/${doctorId}/slots?date=${tomorrow}`);
  expect(res.status).toBe(200);
  expect(res.body.length).toBeGreaterThan(0);
  return res.body[0].startAt as string;
}

beforeAll(async () => {
  app = await startApp();
  const cardioEmail = uniqueEmail('cardio');
  const pediaEmail = uniqueEmail('pedia');
  clinic = await createClinicFixture('referrals', [
    {
      name: 'Dr. Corazon Cardo',
      email: cardioEmail,
      password: PASSWORD,
      roles: ['doctor'],
      doctor: { specialty: 'Cardiology', prcNo: '7654321' },
    },
    {
      name: 'Dr. Pia Pedia',
      email: pediaEmail,
      password: PASSWORD,
      roles: ['doctor'],
      doctor: { specialty: 'Pediatrics', prcNo: '7654322' },
    },
  ]);
  doctor = await signIn(app, clinic.emails.doctor);
  secretary = await signIn(app, clinic.emails.secretary);
  cardio = await signIn(app, cardioEmail);
  pedia = await signIn(app, pediaEmail);
  cardioId = (cardio.body.user as { id: string }).id;
  pediaId = (pedia.body.user as { id: string }).id;
  await owner.db.insert(schedules).values({
    clinicId: clinic.clinicId,
    doctorId: cardioId,
    dayOfWeek: new Date(`${tomorrow}T00:00:00Z`).getUTCDay(),
    startTime: '08:00',
    endTime: '12:00',
    slotMinutes: 20,
  });
});
afterAll(() => app.close());

describe('writing referrals', () => {
  it('sends in-clinic referrals only to doctors listed under the chosen specialty', async () => {
    const { visitId } = await visitInConsult();
    const wrongSpecialty = await post(
      doctor,
      `/api/visits/${visitId}/referrals`,
      cardiology({ toDoctorId: pediaId }),
    );
    expect(wrongSpecialty.status).toBe(400);
    expect(wrongSpecialty.body.error.message).toContain('not listed under Cardiology');

    const self = await post(
      doctor,
      `/api/visits/${visitId}/referrals`,
      cardiology({ toDoctorId: clinic.userIds.doctor }),
    );
    expect(self.status).toBe(400);

    const unknownSpecialty = await post(
      doctor,
      `/api/visits/${visitId}/referrals`,
      cardiology({ specialty: 'Astrology' }),
    );
    expect(unknownSpecialty.status).toBe(400);

    const res = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      specialty: 'Cardiology',
      toDoctorId: cardioId,
      toDoctorName: 'Dr. Corazon Cardo',
      urgency: 'urgent',
      status: 'pending',
      reason: 'Evaluate chest pain on exertion',
    });

    const consult = await doctor.agent.get(`/api/consult/${res.body.appointmentId}`);
    expect(consult.body.visit.referrals.map((r: { id: string }) => r.id)).toEqual([res.body.id]);
    const [audit] = await owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, res.body.id));
    expect(audit).toMatchObject({ action: 'referral.create' });
  });

  it('lets only the visit’s doctor refer, and never the front desk', async () => {
    const { visitId } = await visitInConsult();
    expect((await post(cardio, `/api/visits/${visitId}/referrals`, cardiology())).status).toBe(403);
    expect((await post(secretary, `/api/visits/${visitId}/referrals`, cardiology())).status).toBe(
      403,
    );
  });

  it('refers outside the clinic and prints a letter with the specialty, facility and summary', async () => {
    const { visitId } = await visitInConsult();
    const res = await post(doctor, `/api/visits/${visitId}/referrals`, {
      specialty: 'Neurology',
      externalFacility: 'Philippine General Hospital',
      reason: 'Recurrent seizures despite medication',
      clinicalSummary: 'Two breakthrough seizures this month.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      toDoctorId: null,
      externalFacility: 'Philippine General Hospital',
      urgency: 'routine',
    });

    const pdf = await doctor.agent
      .get(`/api/referrals/${res.body.id}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const text = pdfText((pdf.body as Buffer).toString('latin1'));
    for (const expected of [
      'REFERRAL',
      'The attending Neurology specialist',
      'Philippine General Hospital',
      'Rosario Referral',
      'Sulfa',
      'Recurrent seizures despite medication',
      'Two breakthrough seizures this month.',
      'PRC Lic. No. 1234567',
    ])
      expect(text).toContain(expected);

    // The letter carries clinical details: front desk staff cannot open it.
    expect((await secretary.agent.get(`/api/referrals/${res.body.id}/pdf`)).status).toBe(403);
  });
});

describe('booking and following through', () => {
  it('lets the front desk book in-clinic referrals without seeing clinical details', async () => {
    const { visitId, patientId } = await visitInConsult();
    const created = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());

    const queue = await secretary.agent.get('/api/referrals?box=to_schedule');
    expect(queue.status).toBe(200);
    const item = queue.body.find((r: { id: string }) => r.id === created.body.id);
    expect(item).toMatchObject({ specialty: 'Cardiology', reason: null, clinicalSummary: null });
    expect((await secretary.agent.get('/api/referrals?box=incoming')).status).toBe(403);

    const startAt = await openSlot(cardioId);
    const booked = await post(secretary, `/api/referrals/${created.body.id}/schedule`, {
      startAt,
    });
    expect(booked.status).toBe(200);
    expect(booked.body).toMatchObject({ status: 'scheduled', scheduledStartAt: startAt });
    const [appt] = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, booked.body.scheduledAppointmentId));
    expect(appt).toMatchObject({
      doctorId: cardioId,
      patientId,
      reason: 'Referral: Cardiology',
      status: 'booked',
    });

    const again = await post(secretary, `/api/referrals/${created.body.id}/schedule`, {
      startAt: await openSlot(cardioId),
    });
    expect(again.status).toBe(409);

    const incoming = await cardio.agent.get('/api/referrals?box=incoming');
    expect(incoming.body.map((r: { id: string }) => r.id)).toContain(created.body.id);
    const outgoing = await doctor.agent.get('/api/referrals?box=outgoing');
    expect(outgoing.body.map((r: { id: string }) => r.id)).toContain(created.body.id);
  });

  it('shows the receiving doctor why the patient came, and completes the referral on finish', async () => {
    const { visitId } = await visitInConsult();
    const created = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());
    const booked = await post(secretary, `/api/referrals/${created.body.id}/schedule`, {
      startAt: await openSlot(cardioId),
    });
    const appointmentId = booked.body.scheduledAppointmentId as string;
    await owner.db
      .update(appointments)
      .set({ status: 'in_consult' })
      .where(eq(appointments.id, appointmentId));

    const consult = await cardio.agent.get(`/api/consult/${appointmentId}`);
    expect(consult.status).toBe(200);
    expect(consult.body.referredFrom).toMatchObject({
      id: created.body.id,
      fromDoctorName: 'Doctor referrals',
      specialty: 'Cardiology',
      urgency: 'urgent',
      reason: 'Evaluate chest pain on exertion',
    });

    const finished = await post(cardio, `/api/consult/${appointmentId}/finish`, {
      soap: { assessment: 'Stable angina' },
    });
    expect(finished.status).toBe(200);
    const [referral] = await owner.db
      .select()
      .from(referrals)
      .where(eq(referrals.id, created.body.id));
    expect(referral?.status).toBe('completed');
  });

  it('returns the referral to the front desk when its appointment is cancelled', async () => {
    const { visitId } = await visitInConsult();
    const created = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());
    const booked = await post(secretary, `/api/referrals/${created.body.id}/schedule`, {
      startAt: await openSlot(cardioId),
    });
    const cancelled = await post(
      secretary,
      `/api/appointments/${booked.body.scheduledAppointmentId}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    const queue = await secretary.agent.get('/api/referrals?box=to_schedule');
    expect(queue.body.find((r: { id: string }) => r.id === created.body.id)).toMatchObject({
      status: 'pending',
      scheduledAppointmentId: null,
    });
  });

  it('lets only the receiving doctor decline and only the sender cancel', async () => {
    const { visitId } = await visitInConsult();
    const first = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());
    const second = await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());

    expect(
      (await post(doctor, `/api/referrals/${first.body.id}/decline`, { note: 'Not mine' })).status,
    ).toBe(403);
    expect((await post(cardio, `/api/referrals/${first.body.id}/decline`, {})).status).toBe(400);
    const declined = await post(cardio, `/api/referrals/${first.body.id}/decline`, {
      note: 'Please refer to the hospital cath lab instead',
    });
    expect(declined.body).toMatchObject({
      status: 'declined',
      responseNote: 'Please refer to the hospital cath lab instead',
    });
    expect((await post(doctor, `/api/referrals/${first.body.id}/cancel`)).status).toBe(409);

    expect((await post(cardio, `/api/referrals/${second.body.id}/cancel`)).status).toBe(403);
    const cancelled = await post(doctor, `/api/referrals/${second.body.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
    expect(
      (
        await post(secretary, `/api/referrals/${second.body.id}/schedule`, {
          startAt: await openSlot(cardioId),
        })
      ).status,
    ).toBe(409);
  });

  it('lists a patient’s referrals for doctors only', async () => {
    const { visitId, patientId } = await visitInConsult();
    await post(doctor, `/api/visits/${visitId}/referrals`, cardiology());
    const list = await cardio.agent.get(`/api/patients/${patientId}/referrals`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect((await secretary.agent.get(`/api/patients/${patientId}/referrals`)).status).toBe(403);
  });
});

describe('specialties', () => {
  it('only accepts specialties from the shared list on doctor profiles', async () => {
    const bad = await doctor.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/profile`)
      .set('x-csrf-token', doctor.csrf)
      .send({ prcNo: '1234567', specialty: 'Astrology' });
    expect(bad.status).toBe(400);
    const good = await doctor.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/profile`)
      .set('x-csrf-token', doctor.csrf)
      .send({ prcNo: '1234567', specialty: 'Family Medicine' });
    expect(good.status).toBe(200);
    expect(good.body.specialty).toBe('Family Medicine');
  });
});
