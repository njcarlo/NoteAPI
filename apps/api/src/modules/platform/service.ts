import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  ClinicStatus,
  PlatformClinic,
  PlatformClinicCreateResponse,
  platformClinicCreateSchema,
} from '@clinic/shared';
import { clinics, doctorProfiles, memberships, users } from '../../db/schema';
import type { PlatformScope } from '../../db/tenant';
import { randomToken } from '../../lib/crypto';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { iso } from '../../lib/sql';

type CreateInput = z.output<typeof platformClinicCreateSchema>;

async function loadClinics(p: PlatformScope, clinicId?: string): Promise<PlatformClinic[]> {
  const staff = p.tx
    .select({
      clinicId: memberships.clinicId,
      staffCount: sql<number>`count(*)::int`.as('staff_count'),
      doctorCount:
        sql<number>`count(*) filter (where 'doctor' = any(${memberships.roles}))::int`.as(
          'doctor_count',
        ),
    })
    .from(memberships)
    .where(eq(memberships.isActive, true))
    .groupBy(memberships.clinicId)
    .as('staff');
  const patients = sql`platform_patient_counts()`;

  const rows = await p.tx
    .select({
      id: clinics.id,
      name: clinics.name,
      slug: clinics.slug,
      status: clinics.status,
      createdAt: clinics.createdAt,
      staffCount: sql<number>`coalesce(${staff.staffCount}, 0)`,
      doctorCount: sql<number>`coalesce(${staff.doctorCount}, 0)`,
      patientCount: sql<number>`coalesce((select pc.patients from ${patients} pc where pc.clinic_id = ${clinics.id}), 0)::int`,
    })
    .from(clinics)
    .leftJoin(staff, eq(staff.clinicId, clinics.id))
    .where(clinicId ? eq(clinics.id, clinicId) : undefined)
    .orderBy(desc(clinics.createdAt));
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

export const listClinics = (p: PlatformScope) => loadClinics(p);

export async function createClinic(
  p: PlatformScope,
  input: CreateInput,
): Promise<PlatformClinicCreateResponse> {
  let clinicId: string;
  try {
    const [clinic] = await p.tx
      .insert(clinics)
      .values({
        slug: input.slug,
        name: input.name,
        address: input.address ?? null,
        contactNumber: input.contactNumber ?? null,
      })
      .returning({ id: clinics.id });
    if (!clinic) throw new Error('Clinic insert returned no row');
    clinicId = clinic.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('That clinic address (slug) is taken');
    throw error;
  }

  const [existing] = await p.tx.execute<{ id: string | null }>(
    sql`select user_id_by_email(${input.adminEmail}) as id`,
  );
  let userId = existing?.id ?? null;
  let temporaryPassword: string | null = null;
  if (!userId) {
    userId = randomUUID();
    temporaryPassword = randomToken(12);
    await p.tx.insert(users).values({
      id: userId,
      name: input.adminName,
      email: input.adminEmail,
      passwordHash: await hashPassword(temporaryPassword),
    });
  }

  await p.tx.insert(memberships).values({
    clinicId,
    userId,
    roles: input.adminIsDoctor ? ['admin', 'doctor'] : ['admin'],
  });
  if (input.adminIsDoctor && input.prcNo) {
    await p.tx.insert(doctorProfiles).values({ clinicId, userId, prcNo: input.prcNo });
  }
  await p.audit(clinicId, {
    action: 'platform.clinic.create',
    entityType: 'clinic',
    entityId: clinicId,
    metadata: { adminUserId: userId, linkedExistingAccount: temporaryPassword === null },
  });

  const [clinic] = await loadClinics(p, clinicId);
  return { clinic: clinic as PlatformClinic, adminEmail: input.adminEmail, temporaryPassword };
}

export async function setClinicStatus(p: PlatformScope, clinicId: string, status: ClinicStatus) {
  const [row] = await p.tx
    .update(clinics)
    .set({ status })
    .where(eq(clinics.id, clinicId))
    .returning({ id: clinics.id });
  if (!row) throw notFound('Clinic');
  await p.audit(clinicId, {
    action: `platform.clinic.${status}`,
    entityType: 'clinic',
    entityId: clinicId,
  });
  const [clinic] = await loadClinics(p, clinicId);
  return clinic as PlatformClinic;
}
