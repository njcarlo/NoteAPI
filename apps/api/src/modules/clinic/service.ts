import { eq } from 'drizzle-orm';
import {
  normalizePhMobile,
  type ClinicProfile,
  type clinicProfileInputSchema,
  type ImageUpload,
} from '@clinic/shared';
import type { z } from 'zod';
import { clinics } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { notFound } from '../../lib/errors';
import { decodeImage, IMAGE_EXT } from '../../lib/images';
import { storage } from '../../lib/storage';

export async function getClinicProfile(t: TenantScope): Promise<ClinicProfile> {
  const [clinic] = await t.tx.select().from(clinics).where(eq(clinics.id, t.clinicId));
  if (!clinic) throw notFound('Clinic');
  return {
    name: clinic.name,
    slug: clinic.slug,
    address: clinic.address,
    contactNumber: clinic.contactNumber,
    email: clinic.email,
    smsSenderName: clinic.smsSenderName,
    hasLogo: Boolean(clinic.logoUrl),
  };
}

export async function updateClinicProfile(
  t: TenantScope,
  input: z.output<typeof clinicProfileInputSchema>,
) {
  const contact = input.contactNumber ?? null;
  await t.tx
    .update(clinics)
    .set({
      name: input.name,
      address: input.address ?? null,
      // Mobile numbers are stored in E.164; landlines are kept as typed.
      contactNumber: contact ? (normalizePhMobile(contact) ?? contact) : null,
      email: input.email ?? null,
      smsSenderName: input.smsSenderName ?? null,
    })
    .where(eq(clinics.id, t.clinicId));
  await t.audit({ action: 'clinic.update', entityType: 'clinic', entityId: t.clinicId });
  return getClinicProfile(t);
}

export async function setClinicLogo(t: TenantScope, upload: ImageUpload | null) {
  let key: string | null = null;
  if (upload) {
    key = `clinics/${t.clinicId}/logo-${Date.now()}.${IMAGE_EXT[upload.contentType]}`;
    await storage.put(key, decodeImage(upload));
  }
  await t.tx.update(clinics).set({ logoUrl: key }).where(eq(clinics.id, t.clinicId));
  await t.audit({
    action: upload ? 'clinic.logo.update' : 'clinic.logo.remove',
    entityType: 'clinic',
    entityId: t.clinicId,
  });
  return getClinicProfile(t);
}
