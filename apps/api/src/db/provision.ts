import type { Role } from '@clinic/shared';
import { hashPassword } from '../lib/password';
import type { Database } from './connect';
import { clinics, doctorProfiles, users } from './schema';

export interface ProvisionInput {
  clinic: { slug: string; name: string; address?: string; contactNumber?: string; email?: string };
  admin: {
    name: string;
    email: string;
    password: string;
    roles: Role[];
    doctor?: { specialty?: string; prcNo: string; ptrNo?: string };
  };
}

/** Creates a clinic and its first user. Requires the owner connection (runs before any tenant exists). */
export async function provisionClinic(ownerDb: Database, input: ProvisionInput) {
  return ownerDb.transaction(async (tx) => {
    const [clinic] = await tx.insert(clinics).values(input.clinic).returning();
    if (!clinic) throw new Error('Clinic insert returned no row');
    const [user] = await tx
      .insert(users)
      .values({
        clinicId: clinic.id,
        name: input.admin.name,
        email: input.admin.email.toLowerCase(),
        roles: input.admin.roles,
        passwordHash: await hashPassword(input.admin.password),
      })
      .returning();
    if (!user) throw new Error('User insert returned no row');
    if (input.admin.doctor) {
      await tx.insert(doctorProfiles).values({ clinicId: clinic.id, userId: user.id, ...input.admin.doctor });
    }
    return { clinic, user };
  });
}
