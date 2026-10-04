import { and, asc, eq, ilike, or } from 'drizzle-orm';
import type {
  DoctorProfile,
  DoctorProfileInput,
  Drug,
  RxFavorite,
  rxFavoriteInputSchema,
  SoapTemplate,
  SoapTemplateInput,
} from '@clinic/shared';
import type { z } from 'zod';
import { db } from '../../db/client';
import { doctorProfiles, drugs, rxFavorites, soapTemplates } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { notFound } from '../../lib/errors';
import { escapeLike } from '../../lib/sql';
import { getDoctor } from '../scheduling/service';

/** Typeahead over the shared drug list (generic or brand name). Reference data, not tenant data. */
export async function searchDrugs(q: string): Promise<Drug[]> {
  const term = `%${escapeLike(q)}%`;
  return db
    .select({
      id: drugs.id,
      genericName: drugs.genericName,
      brandName: drugs.brandName,
      form: drugs.form,
      strength: drugs.strength,
    })
    .from(drugs)
    .where(or(ilike(drugs.genericName, term), ilike(drugs.brandName, term)))
    .orderBy(asc(drugs.genericName), asc(drugs.strength))
    .limit(15);
}

export async function listFavorites(t: TenantScope, doctorId: string): Promise<RxFavorite[]> {
  const rows = await t.tx
    .select({ id: rxFavorites.id, name: rxFavorites.name, items: rxFavorites.items })
    .from(rxFavorites)
    .where(t.where(rxFavorites, eq(rxFavorites.doctorId, doctorId)))
    .orderBy(asc(rxFavorites.name));
  return rows;
}

export async function createFavorite(
  t: TenantScope,
  doctorId: string,
  input: z.output<typeof rxFavoriteInputSchema>,
) {
  const items = input.items.map((i) => ({
    drugId: i.drugId ?? null,
    genericName: i.genericName,
    brandName: i.brandName ?? null,
    strength: i.strength ?? null,
    form: i.form ?? null,
    sig: i.sig,
    quantity: i.quantity,
  }));
  const [row] = await t.tx
    .insert(rxFavorites)
    .values(t.values({ doctorId, name: input.name, items }))
    .returning({ id: rxFavorites.id, name: rxFavorites.name, items: rxFavorites.items });
  return row!;
}

export async function deleteFavorite(t: TenantScope, doctorId: string, id: string) {
  const [row] = await t.tx
    .delete(rxFavorites)
    .where(t.where(rxFavorites, eq(rxFavorites.id, id), eq(rxFavorites.doctorId, doctorId)))
    .returning({ id: rxFavorites.id });
  if (!row) throw notFound('Favorite');
}

const templateColumns = {
  id: soapTemplates.id,
  name: soapTemplates.name,
  subjective: soapTemplates.subjective,
  objective: soapTemplates.objective,
  assessment: soapTemplates.assessment,
  plan: soapTemplates.plan,
};

export function listTemplates(t: TenantScope, doctorId: string): Promise<SoapTemplate[]> {
  return t.tx
    .select(templateColumns)
    .from(soapTemplates)
    .where(t.where(soapTemplates, eq(soapTemplates.doctorId, doctorId)))
    .orderBy(asc(soapTemplates.name));
}

export async function createTemplate(t: TenantScope, doctorId: string, input: SoapTemplateInput) {
  const [row] = await t.tx
    .insert(soapTemplates)
    .values(
      t.values({
        doctorId,
        name: input.name,
        subjective: input.subjective ?? null,
        objective: input.objective ?? null,
        assessment: input.assessment ?? null,
        plan: input.plan ?? null,
      }),
    )
    .returning(templateColumns);
  return row!;
}

export async function deleteTemplate(t: TenantScope, doctorId: string, id: string) {
  const [row] = await t.tx
    .delete(soapTemplates)
    .where(t.where(soapTemplates, eq(soapTemplates.id, id), eq(soapTemplates.doctorId, doctorId)))
    .returning({ id: soapTemplates.id });
  if (!row) throw notFound('Template');
}

export async function getDoctorProfile(t: TenantScope, doctorId: string): Promise<DoctorProfile> {
  await getDoctor(t, doctorId);
  const [row] = await t.tx
    .select({
      specialty: doctorProfiles.specialty,
      prcNo: doctorProfiles.prcNo,
      ptrNo: doctorProfiles.ptrNo,
      s2No: doctorProfiles.s2No,
    })
    .from(doctorProfiles)
    .where(t.where(doctorProfiles, eq(doctorProfiles.userId, doctorId)));
  return row ?? { specialty: null, prcNo: '', ptrNo: null, s2No: null };
}

export async function saveDoctorProfile(
  t: TenantScope,
  doctorId: string,
  input: DoctorProfileInput & { prcNo: string },
) {
  await getDoctor(t, doctorId);
  const values = {
    specialty: input.specialty ?? null,
    prcNo: input.prcNo,
    ptrNo: input.ptrNo ?? null,
    s2No: input.s2No ?? null,
  };
  const [existing] = await t.tx
    .select({ id: doctorProfiles.id })
    .from(doctorProfiles)
    .where(t.where(doctorProfiles, eq(doctorProfiles.userId, doctorId)));
  if (existing) {
    await t.tx
      .update(doctorProfiles)
      .set(values)
      .where(t.where(doctorProfiles, and(eq(doctorProfiles.id, existing.id))));
  } else {
    await t.tx.insert(doctorProfiles).values(t.values({ userId: doctorId, ...values }));
  }
  await t.audit({ action: 'doctor.credentials.update', entityType: 'doctor', entityId: doctorId });
  return getDoctorProfile(t, doctorId);
}
