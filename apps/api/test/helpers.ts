import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Role } from '@clinic/shared';
import { buildApp, type App } from '../src/app';
import { createDb } from '../src/db/connect';
import { provisionClinic } from '../src/db/provision';
import { users } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

export const PASSWORD = 'CorrectHorse#2026';

export const owner = createDb(process.env.MIGRATION_DATABASE_URL as string, 2);

export async function startApp(): Promise<App> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export interface ClinicFixture {
  clinicId: string;
  emails: Record<'doctor' | 'secretary' | 'admin', string>;
  userIds: Record<'doctor' | 'secretary' | 'admin', string>;
}

/** A clinic with an admin-doctor, a secretary and an admin-only user. */
export async function createClinicFixture(label: string): Promise<ClinicFixture> {
  const suffix = randomUUID().slice(0, 8);
  const email = (who: string) => `${who}.${label}.${suffix}@test.local`;
  const { clinic, user } = await provisionClinic(owner.db, {
    clinic: { slug: `${label}-${suffix}`, name: `Clinic ${label}` },
    admin: {
      name: `Doctor ${label}`,
      email: email('doctor'),
      password: PASSWORD,
      roles: ['admin', 'doctor'],
      doctor: { prcNo: '1234567' },
    },
  });
  const passwordHash = await hashPassword(PASSWORD);
  const extra = async (who: string, roles: Role[]) => {
    const [row] = await owner.db
      .insert(users)
      .values({ clinicId: clinic.id, name: `${who} ${label}`, email: email(who), roles, passwordHash })
      .returning();
    return row!.id;
  };
  return {
    clinicId: clinic.id,
    emails: { doctor: email('doctor'), secretary: email('secretary'), admin: email('admin') },
    userIds: {
      doctor: user.id,
      secretary: await extra('secretary', ['secretary']),
      admin: await extra('admin', ['admin']),
    },
  };
}

export interface SignedIn {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

export async function signIn(app: App, email: string, password = PASSWORD): Promise<SignedIn> {
  const agent = request.agent(app.server);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return { agent, csrf: res.body.csrfToken as string };
}

export const samplePatient = {
  firstName: 'Test',
  lastName: 'Patient',
  mobile: '0917 555 1234',
  birthdate: '1990-05-01',
  sex: 'female',
};
