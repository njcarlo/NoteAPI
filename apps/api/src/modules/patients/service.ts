import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { normalizePhMobile, type Paginated, type Patient, type PatientData } from '@clinic/shared';
import { patients } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { notFound } from '../../lib/errors';
import { escapeLike, iso } from '../../lib/sql';

type PatientRow = typeof patients.$inferSelect;

export function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    birthdate: row.birthdate,
    sex: row.sex,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    allergies: row.allergies,
    conditions: row.conditions,
    smsOptIn: row.smsOptIn,
    emailOptIn: row.emailOptIn,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listPatients(
  t: TenantScope,
  query: { q?: string | undefined; limit: number; offset: number },
): Promise<Paginated<Patient>> {
  let search;
  if (query.q) {
    const term = `%${escapeLike(query.q)}%`;
    const mobile = normalizePhMobile(query.q);
    search = or(
      ilike(sql`${patients.firstName} || ' ' || ${patients.lastName}`, term),
      ilike(sql`${patients.lastName} || ', ' || ${patients.firstName}`, term),
      mobile ? eq(patients.mobile, mobile) : undefined,
    );
  }
  const where = t.where(patients, search);

  const [rows, [total]] = await Promise.all([
    t.tx
      .select()
      .from(patients)
      .where(where)
      .orderBy(patients.lastName, patients.firstName, desc(patients.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    t.tx.select({ value: count() }).from(patients).where(where),
  ]);

  await t.audit({
    action: 'patient.list',
    entityType: 'patient',
    metadata: { count: rows.length, searched: Boolean(query.q) },
  });
  return { items: rows.map(toPatient), total: total?.value ?? 0 };
}

export async function getPatient(t: TenantScope, id: string): Promise<Patient> {
  const [row] = await t.tx
    .select()
    .from(patients)
    .where(t.where(patients, eq(patients.id, id)));
  if (!row) throw notFound('Patient');
  await t.audit({ action: 'patient.view', entityType: 'patient', entityId: id });
  return toPatient(row);
}

export async function createPatient(t: TenantScope, data: PatientData): Promise<Patient> {
  const [row] = await t.tx.insert(patients).values(t.values(data)).returning();
  if (!row) throw new Error('Insert returned no row');
  await t.audit({ action: 'patient.create', entityType: 'patient', entityId: row.id });
  return toPatient(row);
}

export async function updatePatient(
  t: TenantScope,
  id: string,
  data: Partial<PatientData>,
): Promise<Patient> {
  const [row] = await t.tx
    .update(patients)
    .set(data)
    .where(t.where(patients, eq(patients.id, id)))
    .returning();
  if (!row) throw notFound('Patient');
  // Field names only: audit metadata never stores the values themselves.
  await t.audit({
    action: 'patient.update',
    entityType: 'patient',
    entityId: id,
    metadata: { fields: Object.keys(data) },
  });
  return toPatient(row);
}
