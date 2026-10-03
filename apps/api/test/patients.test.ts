import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createClinicFixture, samplePatient, signIn, startApp, type SignedIn } from './helpers';

let app: App;
let secretary: SignedIn;
let admin: SignedIn;

beforeAll(async () => {
  app = await startApp();
  const clinic = await createClinicFixture('patients');
  secretary = await signIn(app, clinic.emails.secretary);
  admin = await signIn(app, clinic.emails.doctor);
});
afterAll(() => app.close());

describe('patients', () => {
  it('normalizes PH mobile numbers to E.164', async () => {
    const res = await secretary.agent
      .post('/api/patients')
      .set('x-csrf-token', secretary.csrf)
      .send(samplePatient);
    expect(res.status).toBe(201);
    expect(res.body.mobile).toBe('+639175551234');
    expect(res.body.smsOptIn).toBe(true);
  });

  it('returns validation errors in the standard shape without echoing input', async () => {
    const res = await secretary.agent
      .post('/api/patients')
      .set('x-csrf-token', secretary.csrf)
      .send({ ...samplePatient, mobile: '777888', firstName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string[] }) => d.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['mobile', 'firstName']));
    expect(JSON.stringify(res.body)).not.toContain('777888');
  });

  it('finds patients by name or mobile', async () => {
    const byName = await secretary.agent.get('/api/patients?q=test pat');
    expect(byName.body.total).toBeGreaterThan(0);
    const byMobile = await secretary.agent.get('/api/patients?q=09175551234');
    expect(byMobile.body.items[0].mobile).toBe('+639175551234');
  });

  it('does not reset unrelated fields on partial update', async () => {
    const created = await secretary.agent
      .post('/api/patients')
      .set('x-csrf-token', secretary.csrf)
      .send({ ...samplePatient, smsOptIn: false });
    const res = await secretary.agent
      .patch(`/api/patients/${created.body.id}`)
      .set('x-csrf-token', secretary.csrf)
      .send({ allergies: 'Penicillin' });
    expect(res.body.allergies).toBe('Penicillin');
    expect(res.body.smsOptIn).toBe(false);
  });

  it('audits views and edits by field name only', async () => {
    const created = await secretary.agent
      .post('/api/patients')
      .set('x-csrf-token', secretary.csrf)
      .send(samplePatient);
    await secretary.agent.get(`/api/patients/${created.body.id}`);
    await secretary.agent
      .patch(`/api/patients/${created.body.id}`)
      .set('x-csrf-token', secretary.csrf)
      .send({ conditions: 'Asthma' });
    const res = await admin.agent.get(
      `/api/audit-logs?entityType=patient&entityId=${created.body.id}`,
    );
    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining(['patient.create', 'patient.view', 'patient.update']),
    );
    expect(JSON.stringify(res.body)).not.toContain('Asthma');
  });
});
