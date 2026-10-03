import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memberships } from '../src/db/schema';
import type { App } from '../src/app';
import {
  createClinicFixture,
  owner,
  PASSWORD,
  signIn,
  startApp,
  type ClinicFixture,
} from './helpers';

let app: App;
let clinic: ClinicFixture;

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('auth');
});
afterAll(() => app.close());

describe('auth', () => {
  it('signs in and returns the session user with a CSRF token', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: clinic.emails.doctor.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: clinic.emails.doctor, isPlatformAdmin: false });
    expect(res.body.activeClinic).toMatchObject({
      id: clinic.clinicId,
      roles: ['admin', 'doctor'],
    });
    expect(res.body.csrfToken).toEqual(expect.any(String));
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrong = await request(app.server)
      .post('/api/auth/login')
      .send({ email: clinic.emails.secretary, password: 'nope-nope-nope' });
    const unknown = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const target = await createClinicFixture('lockout');
    for (let i = 0; i < 5; i++) {
      await request(app.server)
        .post('/api/auth/login')
        .send({ email: target.emails.secretary, password: 'wrong-password' });
    }
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: target.emails.secretary, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates the session on sign-in', async () => {
    const { agent } = await signIn(app, clinic.emails.secretary);
    const first = (await agent.get('/api/auth/me')).body.csrfToken;
    await agent
      .post('/api/auth/login')
      .send({ email: clinic.emails.secretary, password: PASSWORD });
    const second = await agent.get('/api/auth/me');
    expect(second.status).toBe(200);
    expect(second.body.csrfToken).not.toBe(first);
  });

  it('requires the CSRF token on state-changing requests', async () => {
    const { agent, csrf } = await signIn(app, clinic.emails.doctor);
    const body = { firstName: 'A', lastName: 'B', mobile: '09170000001' };
    const missing = await agent.post('/api/patients').send(body);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');
    const ok = await agent.post('/api/patients').set('x-csrf-token', csrf).send(body);
    expect(ok.status).toBe(201);
  });

  it('blocks unsafe requests from foreign origins', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .set('origin', 'https://evil.example')
      .send({ email: clinic.emails.doctor, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('signs out and invalidates the session', async () => {
    const { agent, csrf } = await signIn(app, clinic.emails.secretary);
    expect((await agent.post('/api/auth/logout').set('x-csrf-token', csrf)).status).toBe(204);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('removes access immediately when a membership is deactivated', async () => {
    const target = await createClinicFixture('inactive');
    const { agent } = await signIn(app, target.emails.secretary);
    const admin = await signIn(app, target.emails.doctor);
    const res = await admin.agent
      .patch(`/api/staff/${target.userIds.secretary}`)
      .set('x-csrf-token', admin.csrf)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app.server)
      .post('/api/auth/login')
      .send({ email: target.emails.secretary, password: PASSWORD });
    expect(login.status).toBe(403);
    const [row] = await owner.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, target.userIds.secretary));
    expect(row?.isActive).toBe(false);
  });
});
