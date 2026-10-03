import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { db } from '../src/db/client';
import { auditLogs, patients, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { createClinicFixture, samplePatient, signIn, startApp, type ClinicFixture, type SignedIn } from './helpers';

let app: App;
let a: ClinicFixture;
let b: ClinicFixture;
let aDoctor: SignedIn;
let bDoctor: SignedIn;
let aPatientId: string;

beforeAll(async () => {
  app = await startApp();
  a = await createClinicFixture('tenant-a');
  b = await createClinicFixture('tenant-b');
  aDoctor = await signIn(app, a.emails.doctor);
  bDoctor = await signIn(app, b.emails.doctor);
  const res = await aDoctor.agent.post('/api/patients').set('x-csrf-token', aDoctor.csrf).send(samplePatient);
  aPatientId = res.body.id;
});
afterAll(() => app.close());

describe('tenant isolation through the API', () => {
  it('hides clinic A patients from clinic B lists and search', async () => {
    const list = await bDoctor.agent.get('/api/patients?q=Test');
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(aPatientId);
  });

  it('returns 404 when clinic B reads, edits or audits clinic A records', async () => {
    expect((await bDoctor.agent.get(`/api/patients/${aPatientId}`)).status).toBe(404);
    const patch = await bDoctor.agent
      .patch(`/api/patients/${aPatientId}`)
      .set('x-csrf-token', bDoctor.csrf)
      .send({ firstName: 'Hacked' });
    expect(patch.status).toBe(404);
    const staff = await bDoctor.agent
      .patch(`/api/staff/${a.userIds.secretary}`)
      .set('x-csrf-token', bDoctor.csrf)
      .send({ isActive: false });
    expect(staff.status).toBe(404);
    const audit = await bDoctor.agent.get(`/api/audit-logs?entityId=${aPatientId}`);
    expect(audit.body.items).toEqual([]);
  });

  it('only lists staff of the signed-in clinic', async () => {
    const res = await bDoctor.agent.get('/api/staff');
    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(b.userIds.secretary);
    expect(ids).not.toContain(a.userIds.secretary);
  });
});

describe('row-level security backstop', () => {
  const actor = { userId: null, ip: null };

  it('hides other tenants even when a query forgets the clinic filter', async () => {
    const rows = await withTenant(b.clinicId, actor, (t) => t.tx.select().from(patients));
    expect(rows.every((row) => row.clinicId === b.clinicId)).toBe(true);
    expect(rows.find((row) => row.id === aPatientId)).toBeUndefined();
  });

  it('refuses writes into another tenant', async () => {
    await expect(
      withTenant(b.clinicId, actor, (t) =>
        t.tx.insert(patients).values({ clinicId: a.clinicId, firstName: 'X', lastName: 'Y', mobile: '+639170000000' }),
      ),
    ).rejects.toThrow();
    const updated = await withTenant(b.clinicId, actor, (t) =>
      t.tx.update(patients).set({ firstName: 'Hacked' }).where(eq(patients.id, aPatientId)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it('sees nothing without a tenant context', async () => {
    expect(await db.select().from(patients)).toEqual([]);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('keeps audit logs append-only for the application role', async () => {
    await expect(
      withTenant(a.clinicId, actor, (t) => t.tx.update(auditLogs).set({ action: 'tampered' })),
    ).rejects.toThrow();
    await expect(withTenant(a.clinicId, actor, (t) => t.tx.delete(auditLogs))).rejects.toThrow();
  });

  it('connects as a role that cannot bypass row-level security', async () => {
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
