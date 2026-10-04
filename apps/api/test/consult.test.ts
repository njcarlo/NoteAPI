import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, CLINIC_TIMEZONE, todayIn, zonedToUtc } from '@clinic/shared';
import type { App } from '../src/app';
import {
  appointments,
  auditLogs,
  drugs,
  patients,
  schedules,
  visitAmendments,
} from '../src/db/schema';
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
let doctor2: SignedIn;
let secretary: SignedIn;
let minute = 0;
const today = todayIn(CLINIC_TIMEZONE);

/** A patient (allergic to penicillin) checked in and called by the main doctor. */
async function patientInConsult(overrides: Partial<typeof patients.$inferInsert> = {}) {
  const [patient] = await owner.db
    .insert(patients)
    .values({
      clinicId: clinic.clinicId,
      firstName: 'Consuelo',
      lastName: 'Testcase',
      birthdate: '1985-04-12',
      sex: 'female',
      mobile: '+639170002222',
      address: '1 Sample St.',
      allergies: 'Penicillin',
      ...overrides,
    })
    .returning();
  minute += 7;
  const startAt = zonedToUtc(today, '00:01', CLINIC_TIMEZONE);
  startAt.setUTCMinutes(startAt.getUTCMinutes() + minute);
  const [appt] = await owner.db
    .insert(appointments)
    .values({
      clinicId: clinic.clinicId,
      doctorId: clinic.userIds.doctor,
      patientId: patient!.id,
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60_000),
      referenceCode: referenceCode(),
    })
    .returning();
  await secretary.agent
    .post(`/api/appointments/${appt!.id}/check-in`)
    .set('x-csrf-token', secretary.csrf)
    .send({ vitals: { bpSystolic: 118, bpDiastolic: 76, temperatureC: 36.6 } });
  const called = await doctor.agent
    .post(`/api/appointments/${appt!.id}/call`)
    .set('x-csrf-token', doctor.csrf);
  expect(called.status).toBe(200);
  return { patient: patient!, appointmentId: appt!.id };
}

const finishBody = (overrides: Record<string, unknown> = {}) => ({
  soap: {
    subjective: 'Cough x3 days',
    objective: 'Clear breath sounds',
    assessment: 'Acute bronchitis',
    plan: 'Rest, fluids',
  },
  rx: {
    items: [
      {
        genericName: 'Amoxicillin',
        brandName: 'Amoxil',
        strength: '500 mg',
        form: 'Capsule',
        sig: '1 cap 3x a day for 7 days',
        quantity: '21',
      },
      {
        genericName: 'Paracetamol',
        strength: '500 mg',
        form: 'Tablet',
        sig: '1 tab every 4 hours as needed for fever',
        quantity: '10',
      },
    ],
    notes: 'Return if fever persists beyond 3 days.',
  },
  ...overrides,
});

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

const finish = (appointmentId: string, body: object) =>
  doctor.agent
    .post(`/api/consult/${appointmentId}/finish`)
    .set('x-csrf-token', doctor.csrf)
    .send(body);

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('consult', [
    { name: 'Other Doctor', email: uniqueEmail('doc2'), password: PASSWORD, roles: ['doctor'] },
  ]);
  doctor = await signIn(app, clinic.emails.doctor);
  secretary = await signIn(app, clinic.emails.secretary);
  const staff = await doctor.agent.get('/api/staff');
  doctor2 = await signIn(
    app,
    staff.body.find((s: { name: string }) => s.name === 'Other Doctor').email,
  );
  await owner.db
    .insert(drugs)
    .values([
      { genericName: 'Amoxicillin', brandName: 'Amoxil', form: 'Capsule', strength: '500 mg' },
      { genericName: 'Amlodipine', form: 'Tablet', strength: '5 mg' },
    ])
    .onConflictDoNothing();
});
afterAll(() => app.close());

describe('consultation screen', () => {
  it('shows the patient, today’s vitals and history to doctors only', async () => {
    const { appointmentId } = await patientInConsult();
    const res = await doctor.agent.get(`/api/consult/${appointmentId}`);
    expect(res.status).toBe(200);
    expect(res.body.patient).toMatchObject({ allergies: 'Penicillin', sex: 'female' });
    expect(res.body.visit).toMatchObject({
      status: 'in_consult',
      locked: false,
      vitals: { bpSystolic: 118, temperatureC: 36.6 },
    });
    expect((await secretary.agent.get(`/api/consult/${appointmentId}`)).status).toBe(403);
  });

  it('autosaves drafts for the consulting doctor only', async () => {
    const { appointmentId } = await patientInConsult();
    const draft = {
      soap: { subjective: 'Headache' },
      rx: { items: [{ genericName: 'Paracetamol' }] },
    };
    const saved = await doctor.agent
      .put(`/api/consult/${appointmentId}/draft`)
      .set('x-csrf-token', doctor.csrf)
      .send(draft);
    expect(saved.status).toBe(200);
    expect(
      (await doctor.agent.get(`/api/consult/${appointmentId}`)).body.visit.draft,
    ).toMatchObject(draft);
    const other = await doctor2.agent
      .put(`/api/consult/${appointmentId}/draft`)
      .set('x-csrf-token', doctor2.csrf)
      .send(draft);
    expect(other.status).toBe(403);
  });
});

describe('finishing a visit', () => {
  it('warns about allergies until the doctor acknowledges', async () => {
    const { appointmentId } = await patientInConsult();
    const warned = await finish(appointmentId, finishBody());
    expect(warned.status).toBe(409);
    expect(warned.body.error.code).toBe('ALLERGY_WARNING');
    expect(warned.body.error.details).toEqual([
      { drug: 'Amoxicillin', allergen: 'penicillin', reason: 'class' },
    ]);
    // Nothing was saved by the refused attempt.
    expect((await doctor.agent.get(`/api/consult/${appointmentId}`)).body.visit.locked).toBe(false);
  });

  it('saves notes, issues the prescription, locks the visit and empties the queue slot', async () => {
    const { appointmentId, patient } = await patientInConsult();
    const res = await finish(appointmentId, finishBody({ allergyAcknowledged: true }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'done',
      locked: true,
      draft: null,
      soap: { assessment: 'Acute bronchitis' },
    });
    expect(res.body.prescription.items.map((i: { genericName: string }) => i.genericName)).toEqual([
      'Amoxicillin',
      'Paracetamol',
    ]);

    expect((await finish(appointmentId, finishBody({ allergyAcknowledged: true }))).status).toBe(
      409,
    );
    const queue = await doctor.agent.get(`/api/queue?doctorId=${clinic.userIds.doctor}`);
    expect(
      queue.body.inConsult.map((i: { appointmentId: string }) => i.appointmentId),
    ).not.toContain(appointmentId);

    const audit = await owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, res.body.prescription.id));
    expect(audit.map((a) => a.action)).toContain('prescription.create');
    expect(audit[0]?.metadata).toMatchObject({ allergyWarningAcknowledged: true });

    // The next consult for this patient shows this visit in the history.
    const [appt] = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId));
    expect(appt?.patientId).toBe(patient.id);
  });

  it('books a follow-up at the chosen time', async () => {
    const tomorrow = addDays(today, 1);
    await owner.db.insert(schedules).values({
      clinicId: clinic.clinicId,
      doctorId: clinic.userIds.doctor,
      dayOfWeek: new Date(`${tomorrow}T00:00:00Z`).getUTCDay(),
      startTime: '08:00',
      endTime: '10:00',
      slotMinutes: 15,
    });
    const slots = await doctor.agent.get(
      `/api/doctors/${clinic.userIds.doctor}/slots?date=${tomorrow}`,
    );
    const { appointmentId, patient } = await patientInConsult({ allergies: null });
    const res = await finish(
      appointmentId,
      finishBody({ rx: null, followUpDate: tomorrow, followUpStartAt: slots.body[0].startAt }),
    );
    expect(res.status).toBe(200);
    expect(res.body.followUpDate).toBe(tomorrow);
    const followUps = await owner.db
      .select()
      .from(appointments)
      .where(eq(appointments.patientId, patient.id));
    expect(followUps.find((a) => a.reason === 'Follow-up')).toMatchObject({
      status: 'booked',
      doctorId: clinic.userIds.doctor,
    });
  });
});

describe('prescription PDF and share links', () => {
  let prescriptionId: string;
  let patientBirthdate: string;

  beforeAll(async () => {
    await doctor.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/profile`)
      .set('x-csrf-token', doctor.csrf)
      .send({ specialty: 'Family Medicine', prcNo: '0123456', ptrNo: 'PTR-777', s2No: '' });
    const { appointmentId, patient } = await patientInConsult();
    patientBirthdate = patient.birthdate!;
    const res = await finish(appointmentId, finishBody({ allergyAcknowledged: true }));
    prescriptionId = res.body.prescription.id;
  });

  it('renders an A5 PDF with generic names first and the doctor’s credentials', async () => {
    const res = await doctor.agent
      .get(`/api/prescriptions/${prescriptionId}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const raw = (res.body as Buffer).toString('latin1');
    expect(raw.startsWith('%PDF')).toBe(true);
    const text = pdfText(raw);
    expect(text).toContain('Amoxicillin (Amoxil) 500 mg Capsule');
    expect(text).toContain('PRC Lic. No. 0123456');
    expect(text).toContain('PTR No. PTR-777');
    expect(text).not.toContain('S2 No.');
    expect((await secretary.agent.get(`/api/prescriptions/${prescriptionId}/pdf`)).status).toBe(
      403,
    );
  });

  it('opens a share link only with the right birthdate, and locks after repeated misses', async () => {
    const share = await doctor.agent
      .post(`/api/prescriptions/${prescriptionId}/share`)
      .set('x-csrf-token', doctor.csrf);
    expect(share.status).toBe(201);
    const token = share.body.token as string;

    const info = await request(app.server).get(`/api/public/rx/${token}`);
    expect(info.body).toMatchObject({ clinicName: 'Clinic consult' });
    expect(JSON.stringify(info.body)).not.toContain('Consuelo');

    const wrong = await request(app.server)
      .post(`/api/public/rx/${token}`)
      .send({ birthdate: '2000-01-01' });
    expect(wrong.status).toBe(403);
    const right = await request(app.server)
      .post(`/api/public/rx/${token}`)
      .send({ birthdate: patientBirthdate });
    expect(right.status).toBe(200);
    expect(right.headers['content-type']).toBe('application/pdf');

    for (let i = 0; i < 4; i++)
      await request(app.server).post(`/api/public/rx/${token}`).send({ birthdate: '2000-01-01' });
    expect(
      (
        await request(app.server)
          .post(`/api/public/rx/${token}`)
          .send({ birthdate: patientBirthdate })
      ).status,
    ).toBe(404);

    const audit = await owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, prescriptionId));
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'prescription.share',
        'prescription.share_open',
        'prescription.share_denied',
      ]),
    );
  });

  it('keeps prescriptions inside their clinic', async () => {
    const outsider = await createClinicFixture('consult-out');
    const other = await signIn(app, outsider.emails.doctor);
    expect((await other.agent.get(`/api/prescriptions/${prescriptionId}/pdf`)).status).toBe(404);
  });
});

describe('amendments', () => {
  it('records the old value, new value, reason and author of changes to finished visits', async () => {
    const { appointmentId } = await patientInConsult({ allergies: null });
    const open = await doctor.agent.get(`/api/consult/${appointmentId}`);
    const visitId = open.body.visit.id as string;
    const early = await doctor.agent
      .post(`/api/visits/${visitId}/amendments`)
      .set('x-csrf-token', doctor.csrf)
      .send({ field: 'assessment', newValue: 'x', reason: 'Too early' });
    expect(early.status).toBe(409);

    await finish(appointmentId, finishBody({ rx: null }));
    const res = await doctor.agent
      .post(`/api/visits/${visitId}/amendments`)
      .set('x-csrf-token', doctor.csrf)
      .send({
        field: 'assessment',
        newValue: 'Community-acquired pneumonia, low risk',
        reason: 'X-ray result received',
      });
    expect(res.status).toBe(200);
    expect(res.body.soap.assessment).toBe('Community-acquired pneumonia, low risk');
    expect(res.body.amendments[0]).toMatchObject({
      field: 'assessment',
      oldValue: 'Acute bronchitis',
      reason: 'X-ray result received',
    });
    const rows = await owner.db
      .select()
      .from(visitAmendments)
      .where(eq(visitAmendments.visitId, visitId));
    expect(rows).toHaveLength(1);

    const bySecretary = await secretary.agent
      .post(`/api/visits/${visitId}/amendments`)
      .set('x-csrf-token', secretary.csrf)
      .send({ field: 'plan', newValue: 'x', reason: 'nope' });
    expect(bySecretary.status).toBe(403);
    const byColleague = await doctor2.agent
      .post(`/api/visits/${visitId}/amendments`)
      .set('x-csrf-token', doctor2.csrf)
      .send({ field: 'plan', newValue: 'x', reason: 'Not my patient' });
    expect(byColleague.status).toBe(403);
  });
});

describe('visit history', () => {
  it('lists a patient’s finished visits with medicines, for doctors only', async () => {
    const { appointmentId, patient } = await patientInConsult();
    await finish(appointmentId, finishBody({ allergyAcknowledged: true }));
    const res = await doctor.agent.get(`/api/patients/${patient.id}/visits`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      appointmentId,
      assessment: 'Acute bronchitis',
      medicines: ['Amoxicillin 500 mg', 'Paracetamol 500 mg'],
    });
    expect((await secretary.agent.get(`/api/patients/${patient.id}/visits`)).status).toBe(403);
  });
});

describe('prescribing helpers', () => {
  it('searches drugs by generic or brand name', async () => {
    const res = await doctor.agent.get('/api/drugs?q=amox');
    expect(res.body.map((d: { genericName: string }) => d.genericName)).toContain('Amoxicillin');
    expect((await secretary.agent.get('/api/drugs?q=amox')).status).toBe(403);
  });

  it('keeps favorites and templates per doctor', async () => {
    const fav = await doctor.agent
      .post('/api/rx-favorites')
      .set('x-csrf-token', doctor.csrf)
      .send({
        name: 'Fever',
        items: [
          { genericName: 'Paracetamol', strength: '500 mg', sig: '1 tab q4h PRN', quantity: '10' },
        ],
      });
    expect(fav.status).toBe(201);
    expect(
      (await doctor.agent.get('/api/rx-favorites')).body.map((f: { id: string }) => f.id),
    ).toContain(fav.body.id);
    expect((await doctor2.agent.get('/api/rx-favorites')).body).toEqual([]);
    expect(
      (
        await doctor2.agent
          .delete(`/api/rx-favorites/${fav.body.id}`)
          .set('x-csrf-token', doctor2.csrf)
      ).status,
    ).toBe(404);

    const tpl = await doctor.agent
      .post('/api/soap-templates')
      .set('x-csrf-token', doctor.csrf)
      .send({ name: 'URI', subjective: 'Cough, colds', plan: 'Supportive care' });
    expect(tpl.status).toBe(201);
    expect((await doctor.agent.get('/api/soap-templates')).body[0]).toMatchObject({
      name: 'URI',
      plan: 'Supportive care',
    });
    expect(
      (
        await doctor.agent
          .delete(`/api/soap-templates/${tpl.body.id}`)
          .set('x-csrf-token', doctor.csrf)
      ).status,
    ).toBe(204);
  });

  it('lets doctors edit their own credentials and admins edit anyone’s', async () => {
    const staff = await doctor.agent.get('/api/staff');
    const doc2Id = staff.body.find((s: { name: string }) => s.name === 'Other Doctor').id;
    const own = await doctor2.agent
      .put(`/api/doctors/${doc2Id}/profile`)
      .set('x-csrf-token', doctor2.csrf)
      .send({ prcNo: '7654321', specialty: 'Pediatrics' });
    expect(own.body).toMatchObject({ prcNo: '7654321', specialty: 'Pediatrics', ptrNo: null });
    const notOwn = await doctor2.agent
      .put(`/api/doctors/${clinic.userIds.doctor}/profile`)
      .set('x-csrf-token', doctor2.csrf)
      .send({ prcNo: '1111111' });
    expect(notOwn.status).toBe(403);
    const byAdmin = await doctor.agent.get(`/api/doctors/${doc2Id}/profile`);
    expect(byAdmin.body.prcNo).toBe('7654321');
    const badPrc = await doctor2.agent
      .put(`/api/doctors/${doc2Id}/profile`)
      .set('x-csrf-token', doctor2.csrf)
      .send({ prcNo: 'abc' });
    expect(badPrc.status).toBe(400);
  });
});
