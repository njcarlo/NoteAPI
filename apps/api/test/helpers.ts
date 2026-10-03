import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, type App } from '../src/app';
import { createDb } from '../src/db/connect';
import { provisionClinic, upsertPerson, type MemberInput } from '../src/db/provision';

export const PASSWORD = 'CorrectHorse#2026';

export const owner = createDb(process.env.MIGRATION_DATABASE_URL as string, 2);

export async function startApp(): Promise<App> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export const uniqueEmail = (who: string) => `${who}.${randomUUID().slice(0, 8)}@test.local`;

type Who = 'doctor' | 'secretary' | 'admin';

export interface ClinicFixture {
  clinicId: string;
  slug: string;
  emails: Record<Who, string>;
  userIds: Record<Who, string>;
}

/** A clinic with an admin-doctor, a secretary and an admin-only user. */
export async function createClinicFixture(
  label: string,
  extra: MemberInput[] = [],
): Promise<ClinicFixture> {
  const suffix = randomUUID().slice(0, 8);
  const emails = {
    doctor: `doctor.${label}.${suffix}@test.local`,
    secretary: `secretary.${label}.${suffix}@test.local`,
    admin: `admin.${label}.${suffix}@test.local`,
  };
  const slug = `${label}-${suffix}`;
  const { clinic, userIds } = await provisionClinic(owner.db, { slug, name: `Clinic ${label}` }, [
    {
      name: `Doctor ${label}`,
      email: emails.doctor,
      password: PASSWORD,
      roles: ['admin', 'doctor'],
      doctor: { prcNo: '1234567' },
    },
    {
      name: `Secretary ${label}`,
      email: emails.secretary,
      password: PASSWORD,
      roles: ['secretary'],
    },
    { name: `Admin ${label}`, email: emails.admin, password: PASSWORD, roles: ['admin'] },
    ...extra,
  ]);
  const [doctor, secretary, admin] = userIds as [string, string, string];
  return { clinicId: clinic.id, slug, emails, userIds: { doctor, secretary, admin } };
}

export async function createPlatformAdmin(): Promise<string> {
  const email = uniqueEmail('platform');
  await upsertPerson(owner.db, {
    name: 'Platform Admin',
    email,
    password: PASSWORD,
    isPlatformAdmin: true,
  });
  return email;
}

export interface SignedIn {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  body: Record<string, unknown> & {
    activeClinic: { roles: string[]; assignedDoctorIds: string[] | null } | null;
  };
}

export async function signIn(app: App, email: string, password = PASSWORD): Promise<SignedIn> {
  const agent = request.agent(app.server);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return { agent, csrf: res.body.csrfToken as string, body: res.body };
}

export async function selectClinic(user: SignedIn, clinicId: string) {
  return user.agent
    .post('/api/auth/active-clinic')
    .set('x-csrf-token', user.csrf)
    .send({ clinicId });
}

export const samplePatient = {
  firstName: 'Test',
  lastName: 'Patient',
  mobile: '0917 555 1234',
  birthdate: '1990-05-01',
  sex: 'female',
};
