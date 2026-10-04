import { eq } from 'drizzle-orm';
import type { Role } from '@clinic/shared';
import { hashPassword } from '../lib/password';
import type { Database } from './connect';
import { defaultTemplateRows } from '../modules/notifications/templates';
import { clinics, doctorProfiles, memberships, notificationTemplates, users } from './schema';

export interface PersonInput {
  name: string;
  email: string;
  password: string;
  isPlatformAdmin?: boolean;
}

export interface MemberInput extends PersonInput {
  roles: Role[];
  doctor?: { specialty?: string; prcNo: string; ptrNo?: string };
}

/** Finds a login by email or creates it. Owner connection only (seed, tests, CLI). */
export async function upsertPerson(
  ownerDb: Database,
  person: PersonInput,
): Promise<{ id: string; created: boolean }> {
  const email = person.email.toLowerCase();
  const [found] = await ownerDb.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (found) return { id: found.id, created: false };
  const [created] = await ownerDb
    .insert(users)
    .values({
      name: person.name,
      email,
      passwordHash: await hashPassword(person.password),
      isPlatformAdmin: person.isPlatformAdmin ?? false,
    })
    .returning({ id: users.id });
  if (!created) throw new Error('User insert returned no row');
  return { id: created.id, created: true };
}

/** Creates a clinic with its staff. Existing logins (matched by email) are reused. */
export async function provisionClinic(
  ownerDb: Database,
  clinic: { slug: string; name: string; address?: string; contactNumber?: string; email?: string },
  members: MemberInput[],
) {
  const [row] = await ownerDb.insert(clinics).values(clinic).returning();
  if (!row) throw new Error('Clinic insert returned no row');
  await ownerDb.insert(notificationTemplates).values(defaultTemplateRows(row.id));
  const userIds: string[] = [];
  for (const member of members) {
    const { id: userId } = await upsertPerson(ownerDb, member);
    await ownerDb.insert(memberships).values({ clinicId: row.id, userId, roles: member.roles });
    if (member.doctor) {
      await ownerDb.insert(doctorProfiles).values({ clinicId: row.id, userId, ...member.doctor });
    }
    userIds.push(userId);
  }
  return { clinic: row, userIds };
}
