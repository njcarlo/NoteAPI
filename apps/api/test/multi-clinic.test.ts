import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import {
  createClinicFixture,
  PASSWORD,
  samplePatient,
  selectClinic,
  signIn,
  startApp,
  uniqueEmail,
  type ClinicFixture,
} from './helpers';

let app: App;
let a: ClinicFixture;
let b: ClinicFixture;
const roamingEmail = uniqueEmail('roaming');

beforeAll(async () => {
  app = await startApp();
  const roaming = { name: 'Roaming Doctor', email: roamingEmail, password: PASSWORD };
  a = await createClinicFixture('multi-a', [{ ...roaming, roles: ['admin', 'doctor'] }]);
  b = await createClinicFixture('multi-b', [{ ...roaming, roles: ['doctor'] }]);
});
afterAll(() => app.close());

describe('one login across several clinics', () => {
  it('asks the user to choose a clinic before any clinic data is available', async () => {
    const user = await signIn(app, roamingEmail);
    expect(user.body.activeClinic).toBeNull();
    expect((user.body.clinics as unknown[]).length).toBe(2);
    const res = await user.agent.get('/api/patients');
    expect(res.status).toBe(403);
  });

  it('applies the roles of the selected clinic only', async () => {
    const user = await signIn(app, roamingEmail);
    const inB = await selectClinic(user, b.clinicId);
    expect(inB.body.activeClinic.roles).toEqual(['doctor']);
    expect((await user.agent.get('/api/staff')).status).toBe(403);

    const inA = await selectClinic(user, a.clinicId);
    expect(inA.body.activeClinic.roles).toEqual(['admin', 'doctor']);
    expect((await user.agent.get('/api/staff')).status).toBe(200);
  });

  it('keeps each clinic’s patients separate when switching', async () => {
    const user = await signIn(app, roamingEmail);
    await selectClinic(user, a.clinicId);
    const created = await user.agent
      .post('/api/patients')
      .set('x-csrf-token', user.csrf)
      .send(samplePatient);
    expect(created.status).toBe(201);

    await selectClinic(user, b.clinicId);
    expect((await user.agent.get(`/api/patients/${created.body.id}`)).status).toBe(404);
    const list = await user.agent.get('/api/patients');
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(created.body.id);
  });

  it('refuses to switch into a clinic the user does not belong to', async () => {
    const outsider = await createClinicFixture('multi-c');
    const user = await signIn(app, roamingEmail);
    expect((await selectClinic(user, outsider.clinicId)).status).toBe(403);
  });

  it('only exposes logins of the current clinic’s staff', async () => {
    const actor = { userId: null, ip: null };
    const visible = await withTenant(b.clinicId, actor, (t) =>
      t.tx.select({ id: users.id }).from(users),
    );
    const ids = visible.map((u) => u.id);
    expect(ids).toContain(b.userIds.secretary);
    expect(ids).not.toContain(a.userIds.secretary);
  });
});

describe('staff accounts', () => {
  it('links an existing account instead of creating a duplicate', async () => {
    const admin = await signIn(app, b.emails.doctor);
    const res = await admin.agent
      .post('/api/staff')
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'ignored', email: a.emails.secretary, roles: ['secretary'] });
    expect(res.status).toBe(201);
    expect(res.body.linkedExistingAccount).toBe(true);
    expect(res.body.name).toBe('Secretary multi-a');

    const again = await admin.agent
      .post('/api/staff')
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'x', email: a.emails.secretary, roles: ['secretary'] });
    expect(again.status).toBe(409);
  });

  it('requires a password for a brand-new account', async () => {
    const admin = await signIn(app, a.emails.doctor);
    const res = await admin.agent
      .post('/api/staff')
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'New Person', email: uniqueEmail('new'), roles: ['secretary'] });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toEqual(['password']);
  });
});

describe('secretary assignments', () => {
  it('limits a secretary to chosen doctors and validates the choice', async () => {
    const clinic = await createClinicFixture('assign', [
      { name: 'Second Doctor', email: uniqueEmail('doc2'), password: PASSWORD, roles: ['doctor'] },
    ]);
    const admin = await signIn(app, clinic.emails.doctor);
    const staff = await admin.agent.get('/api/staff');
    const doc2 = staff.body.find((s: { name: string }) => s.name === 'Second Doctor');

    const bad = await admin.agent
      .patch(`/api/staff/${clinic.userIds.secretary}`)
      .set('x-csrf-token', admin.csrf)
      .send({ doctorIds: [clinic.userIds.admin] });
    expect(bad.status).toBe(400);

    const ok = await admin.agent
      .patch(`/api/staff/${clinic.userIds.secretary}`)
      .set('x-csrf-token', admin.csrf)
      .send({ doctorIds: [doc2.id] });
    expect(ok.body.doctorIds).toEqual([doc2.id]);

    const secretary = await signIn(app, clinic.emails.secretary);
    expect(secretary.body.activeClinic?.assignedDoctorIds).toEqual([doc2.id]);

    await admin.agent
      .patch(`/api/staff/${clinic.userIds.secretary}`)
      .set('x-csrf-token', admin.csrf)
      .send({ doctorIds: [] });
    const me = await secretary.agent.get('/api/auth/me');
    expect(me.body.activeClinic.assignedDoctorIds).toBeNull();
  });
});
