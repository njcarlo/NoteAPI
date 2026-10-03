import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import {
  createClinicFixture,
  samplePatient,
  signIn,
  startApp,
  type ClinicFixture,
} from './helpers';

let app: App;
let clinic: ClinicFixture;

beforeAll(async () => {
  app = await startApp();
  clinic = await createClinicFixture('rbac');
});
afterAll(() => app.close());

describe('role-based access', () => {
  it('rejects anonymous requests', async () => {
    const { agent } = await signIn(app, clinic.emails.secretary);
    await agent.post('/api/auth/logout');
    const res = await (await import('supertest')).default(app.server).get('/api/patients');
    expect(res.status).toBe(401);
  });

  it('lets secretaries manage patients but not staff or audit logs', async () => {
    const { agent, csrf } = await signIn(app, clinic.emails.secretary);
    expect((await agent.get('/api/patients')).status).toBe(200);
    expect(
      (await agent.post('/api/patients').set('x-csrf-token', csrf).send(samplePatient)).status,
    ).toBe(201);
    expect((await agent.get('/api/staff')).status).toBe(403);
    expect((await agent.get('/api/audit-logs')).status).toBe(403);
  });

  it('lets an admin-only user read patients but not edit them', async () => {
    const { agent, csrf } = await signIn(app, clinic.emails.admin);
    expect((await agent.get('/api/patients')).status).toBe(200);
    const res = await agent.post('/api/patients').set('x-csrf-token', csrf).send(samplePatient);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await agent.get('/api/staff')).status).toBe(200);
  });

  it('stops admins from removing their own admin role', async () => {
    const { agent, csrf } = await signIn(app, clinic.emails.doctor);
    const res = await agent
      .patch(`/api/staff/${clinic.userIds.doctor}`)
      .set('x-csrf-token', csrf)
      .send({ roles: ['doctor'] });
    expect(res.status).toBe(400);
  });
});
