import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { appointments, auditLogs, labResults, patients } from '../src/db/schema';
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
let adminOnly: SignedIn;
let labId: string;
let minute = 0;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('result-image-bytes'),
]);
const PDF = Buffer.from('%PDF-1.4\nCBC result: Hgb 135 g/L\n%%EOF');

const post = (user: SignedIn, path: string, body: object = {}) =>
  user.agent.post(path).set('x-csrf-token', user.csrf).send(body);

const binary = (req: ReturnType<SignedIn['agent']['get']>) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
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

async function visitInConsult() {
  const [patient] = await owner.db
    .insert(patients)
    .values({
      clinicId: clinic.clinicId,
      firstName: 'Lourdes',
      lastName: 'Labtest',
      birthdate: '1966-09-09',
      sex: 'female',
      mobile: '+639170004444',
    })
    .returning();
  minute += 5;
  const startAt = new Date(Date.now() - 60 * 60_000 + minute * 60_000);
  const [appt] = await owner.db
    .insert(appointments)
    .values({
      clinicId: clinic.clinicId,
      doctorId: clinic.userIds.doctor,
      patientId: patient!.id,
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60_000),
      status: 'in_consult',
      referenceCode: referenceCode(),
    })
    .returning();
  const consult = await doctor.agent.get(`/api/consult/${appt!.id}`);
  expect(consult.status).toBe(200);
  return { patientId: patient!.id, appointmentId: appt!.id, visitId: consult.body.visit.id };
}

const request = (visitId: string, overrides: Record<string, unknown> = {}) =>
  post(doctor, `/api/visits/${visitId}/lab-requests`, {
    facilityId: labId,
    tests: ['CBC with platelet count', 'FBS', 'Lipid profile'],
    fasting: true,
    clinicalImpression: 'Hypertension, rule out dyslipidemia',
    ...overrides,
  });

const upload = (user: SignedIn, id: string, file: Buffer, contentType = 'image/png') =>
  post(user, `/api/lab-requests/${id}/results`, {
    fileName: 'scan.png',
    contentType,
    data: file.toString('base64'),
  });

beforeAll(async () => {
  app = await startApp();
  const doctor2Email = uniqueEmail('labdoc2');
  clinic = await createClinicFixture('labs', [
    { name: 'Second Doctor', email: doctor2Email, password: PASSWORD, roles: ['doctor'] },
  ]);
  doctor = await signIn(app, clinic.emails.doctor);
  doctor2 = await signIn(app, doctor2Email);
  secretary = await signIn(app, clinic.emails.secretary);
  adminOnly = await signIn(app, clinic.emails.admin);
  const lab = await post(doctor, '/api/facilities', {
    name: 'Sample Diagnostic Laboratory',
    kind: 'laboratory',
    address: '1 Lab St., Dasmariñas',
  });
  expect(lab.status).toBe(201);
  labId = lab.body.id;
});
afterAll(() => app.close());

describe('partner facilities', () => {
  it('are managed by admins, listed for everyone, and deactivated rather than deleted', async () => {
    expect(
      (await post(secretary, '/api/facilities', { name: 'Nope Lab', kind: 'laboratory' })).status,
    ).toBe(403);
    const imaging = await post(adminOnly, '/api/facilities', {
      name: 'Old Imaging',
      kind: 'imaging',
    });
    expect(imaging.status).toBe(201);
    const listed = await secretary.agent.get('/api/facilities');
    expect(listed.body.map((f: { name: string }) => f.name)).toEqual(
      expect.arrayContaining(['Sample Diagnostic Laboratory', 'Old Imaging']),
    );
    const off = await adminOnly.agent
      .patch(`/api/facilities/${imaging.body.id}`)
      .set('x-csrf-token', adminOnly.csrf)
      .send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const empty = await adminOnly.agent
      .patch(`/api/facilities/${imaging.body.id}`)
      .set('x-csrf-token', adminOnly.csrf)
      .send({});
    expect(empty.status).toBe(400);
    const active = await doctor.agent.get('/api/facilities');
    expect(active.body.map((f: { id: string }) => f.id)).not.toContain(imaging.body.id);
    const all = await adminOnly.agent.get('/api/facilities?all=true');
    expect(all.body.map((f: { id: string }) => f.id)).toContain(imaging.body.id);

    const { visitId } = await visitInConsult();
    expect((await request(visitId, { facilityId: imaging.body.id })).status).toBe(404);
  });
});

describe('lab requests', () => {
  it('are written by the visit’s doctor with at least one test', async () => {
    const { visitId, appointmentId } = await visitInConsult();
    expect((await request(visitId, { tests: [] })).status).toBe(400);
    expect((await request(visitId, { tests: ['FBS', 'FBS'] })).status).toBe(400);
    expect(
      (await post(doctor2, `/api/visits/${visitId}/lab-requests`, { tests: ['FBS'] })).status,
    ).toBe(403);
    expect(
      (await post(secretary, `/api/visits/${visitId}/lab-requests`, { tests: ['FBS'] })).status,
    ).toBe(403);

    const res = await request(visitId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      facilityId: labId,
      facilityName: 'Sample Diagnostic Laboratory',
      tests: ['CBC with platelet count', 'FBS', 'Lipid profile'],
      status: 'requested',
      fasting: true,
    });
    const consult = await doctor.agent.get(`/api/consult/${appointmentId}`);
    expect(consult.body.labRequests.map((l: { id: string }) => l.id)).toEqual([res.body.id]);

    // A one-off place can be typed in.
    const typed = await request(visitId, {
      facilityId: null,
      facilityName: 'Barangay Health Center',
      tests: ['Sputum AFB / GeneXpert'],
      fasting: false,
    });
    expect(typed.body).toMatchObject({ facilityId: null, facilityName: 'Barangay Health Center' });
  });

  it('prints a request slip with the tests, laboratory and fasting instructions', async () => {
    const { visitId } = await visitInConsult();
    const created = await request(visitId);
    const pdf = await binary(doctor.agent.get(`/api/lab-requests/${created.body.id}/pdf`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const text = pdfText((pdf.body as Buffer).toString('latin1'));
    for (const expected of [
      'LABORATORY REQUEST',
      'Sample Diagnostic Laboratory, 1 Lab St., Dasmari',
      'CBC with platelet count',
      'Lipid profile',
      'Hypertension, rule out dyslipidemia',
      'Fast for 8',
      'Lourdes Labtest',
      'PRC Lic. No. 1234567',
    ])
      expect(text).toContain(expected);
    expect((await secretary.agent.get(`/api/lab-requests/${created.body.id}/pdf`)).status).toBe(
      403,
    );
  });

  it('lets the front desk attach results without seeing tests or opening files', async () => {
    const { visitId } = await visitInConsult();
    const created = await request(visitId);

    const awaiting = await secretary.agent.get('/api/lab-requests?box=awaiting');
    expect(awaiting.status).toBe(200);
    expect(awaiting.body.find((l: { id: string }) => l.id === created.body.id)).toMatchObject({
      tests: [],
      testCount: 3,
      clinicalImpression: null,
      fasting: true,
    });
    expect((await secretary.agent.get('/api/lab-requests?box=to_review')).status).toBe(403);

    const fake = await upload(secretary, created.body.id, Buffer.from('not really a png'));
    expect(fake.status).toBe(400);
    const res = await upload(secretary, created.body.id, PNG);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'results_in', results: [], resultCount: 1 });

    const [stored] = await owner.db
      .select()
      .from(labResults)
      .where(eq(labResults.labRequestId, created.body.id));
    expect(stored).toMatchObject({ contentType: 'image/png', sizeBytes: PNG.length });
    expect((await secretary.agent.get(`/api/lab-results/${stored!.id}`)).status).toBe(403);
  });

  it('puts results in the doctor’s review list, serves the file, and records the review', async () => {
    const { visitId } = await visitInConsult();
    const created = await request(visitId);
    await upload(secretary, created.body.id, PDF, 'application/pdf');

    const toReview = await doctor.agent.get('/api/lab-requests?box=to_review');
    const item = toReview.body.find((l: { id: string }) => l.id === created.body.id);
    expect(item.results).toHaveLength(1);
    expect(item.results[0]).toMatchObject({
      fileName: 'scan.png',
      contentType: 'application/pdf',
      uploadedByName: 'Secretary labs',
    });

    const file = await binary(doctor.agent.get(`/api/lab-results/${item.results[0].id}`));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((file.body as Buffer).equals(PDF)).toBe(true);
    const views = await owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.body.id));
    expect(views.map((v) => v.action)).toContain('lab_result.view');

    expect((await post(doctor2, `/api/lab-requests/${created.body.id}/review`)).status).toBe(403);
    const reviewed = await post(doctor, `/api/lab-requests/${created.body.id}/review`, {
      note: 'LDL high; start statin',
    });
    expect(reviewed.body).toMatchObject({
      status: 'reviewed',
      reviewNote: 'LDL high; start statin',
    });
    expect((await post(doctor, `/api/lab-requests/${created.body.id}/review`)).status).toBe(409);

    // A later result (e.g. the lipid profile comes back a day after the CBC) needs review again.
    const more = await upload(secretary, created.body.id, PNG);
    expect(more.body.status).toBe('results_in');
  });

  it('lets only the requesting doctor cancel, and only before results arrive', async () => {
    const { visitId } = await visitInConsult();
    const first = await request(visitId);
    expect((await post(doctor2, `/api/lab-requests/${first.body.id}/cancel`)).status).toBe(403);
    const cancelled = await post(doctor, `/api/lab-requests/${first.body.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await upload(secretary, first.body.id, PNG)).status).toBe(409);

    const second = await request(visitId);
    await upload(secretary, second.body.id, PNG);
    expect((await post(doctor, `/api/lab-requests/${second.body.id}/cancel`)).status).toBe(409);
  });

  it('lists a patient’s lab requests for doctors only', async () => {
    const { visitId, patientId } = await visitInConsult();
    await request(visitId);
    const list = await doctor2.agent.get(`/api/patients/${patientId}/lab-requests`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect((await secretary.agent.get(`/api/patients/${patientId}/lab-requests`)).status).toBe(403);
  });
});
