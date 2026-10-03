import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { App } from '../src/app';
import { patients, users } from '../src/db/schema';
import { withPlatform } from '../src/db/tenant';
import {
  createClinicFixture,
  createPlatformAdmin,
  samplePatient,
  signIn,
  startApp,
  uniqueEmail,
  type SignedIn,
} from './helpers';

let app: App;
let platform: SignedIn;

beforeAll(async () => {
  app = await startApp();
  platform = await signIn(app, await createPlatformAdmin());
});
afterAll(() => app.close());

describe('platform console', () => {
  it('is closed to clinic staff', async () => {
    const clinic = await createClinicFixture('plat-staff');
    const admin = await signIn(app, clinic.emails.doctor);
    expect((await admin.agent.get('/api/platform/clinics')).status).toBe(403);
  });

  it('gives platform admins no access to clinic data', async () => {
    expect(platform.body.activeClinic).toBeNull();
    expect((await platform.agent.get('/api/patients')).status).toBe(403);
  });

  it('creates a clinic whose new admin can sign in with the temporary password', async () => {
    const email = uniqueEmail('owner');
    const slug = `new-clinic-${Date.now()}`;
    const res = await platform.agent
      .post('/api/platform/clinics')
      .set('x-csrf-token', platform.csrf)
      .send({
        name: 'New Clinic',
        slug,
        adminName: 'Owner',
        adminEmail: email,
        adminIsDoctor: true,
        prcNo: '7654321',
      });
    expect(res.status).toBe(201);
    expect(res.body.clinic).toMatchObject({
      slug,
      status: 'active',
      staffCount: 1,
      doctorCount: 1,
      patientCount: 0,
    });
    expect(res.body.temporaryPassword).toEqual(expect.any(String));

    const owner = await signIn(app, email, res.body.temporaryPassword);
    expect(owner.body.activeClinic).toMatchObject({ slug, roles: ['admin', 'doctor'] });

    const dup = await platform.agent
      .post('/api/platform/clinics')
      .set('x-csrf-token', platform.csrf)
      .send({ name: 'Dup', slug, adminName: 'X', adminEmail: uniqueEmail('x') });
    expect(dup.status).toBe(409);
  });

  it('reports patient counts without exposing patients', async () => {
    const clinic = await createClinicFixture('plat-count');
    const doctor = await signIn(app, clinic.emails.doctor);
    await doctor.agent.post('/api/patients').set('x-csrf-token', doctor.csrf).send(samplePatient);
    const res = await platform.agent.get('/api/platform/clinics');
    const row = res.body.find((c: { id: string }) => c.id === clinic.clinicId);
    expect(row).toMatchObject({ patientCount: 1, staffCount: 3, doctorCount: 1 });
  });

  it('suspending a clinic cuts off its staff', async () => {
    const clinic = await createClinicFixture('plat-suspend');
    const secretary = await signIn(app, clinic.emails.secretary);
    const res = await platform.agent
      .patch(`/api/platform/clinics/${clinic.clinicId}`)
      .set('x-csrf-token', platform.csrf)
      .send({ status: 'suspended' });
    expect(res.body.status).toBe('suspended');
    expect((await secretary.agent.get('/api/patients')).status).toBe(401);
    const login = await request(app.server)
      .post('/api/auth/login')
      .send({ email: clinic.emails.secretary, password: 'CorrectHorse#2026' });
    expect(login.status).toBe(403);
  });
});

describe('platform database role', () => {
  const actor = { userId: null, ip: null };

  it('cannot read patient data even if platform code tries', async () => {
    await expect(withPlatform(actor, (p) => p.tx.select().from(patients))).rejects.toThrow();
  });

  it('cannot read password hashes', async () => {
    await expect(withPlatform(actor, (p) => p.tx.select().from(users))).rejects.toThrow();
    const safe = await withPlatform(actor, (p) =>
      p.tx.select({ id: users.id, email: users.email }).from(users),
    );
    expect(safe.length).toBeGreaterThan(0);
  });
});
