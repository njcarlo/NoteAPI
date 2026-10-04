import { eq, sql } from 'drizzle-orm';
import { ERROR_CODES, RX_SHARE_MAX_ATTEMPTS, type RxShareInfo } from '@clinic/shared';
import { db } from '../../db/client';
import { clinics, patients, prescriptions, rxShareTokens } from '../../db/schema';
import { withTenant, type TenantScope } from '../../db/tenant';
import { sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { iso } from '../../lib/sql';
import { prescriptionPdf } from './service';

const invalidLink = () =>
  new AppError(404, ERROR_CODES.NOT_FOUND, 'This link is invalid or has expired');

interface TokenRow extends Record<string, unknown> {
  id: string;
  clinic_id: string;
}

/** Resolves a share link (by token hash) and runs `fn` inside that clinic's scope. */
async function withShare<T>(
  token: string,
  ip: string | null,
  fn: (t: TenantScope, shareId: string) => Promise<T>,
) {
  const [row] = await db.execute<TokenRow>(sql`select * from rx_share_by_token(${sha256(token)})`);
  if (!row) throw invalidLink();
  return withTenant(row.clinic_id, { userId: null, ip }, (t) => fn(t, row.id));
}

async function loadShare(t: TenantScope, shareId: string) {
  const [row] = await t.tx
    .select({
      share: rxShareTokens,
      issuedAt: prescriptions.issuedAt,
      patientId: prescriptions.patientId,
      clinicName: clinics.name,
    })
    .from(rxShareTokens)
    .innerJoin(prescriptions, eq(prescriptions.id, rxShareTokens.prescriptionId))
    .innerJoin(clinics, eq(clinics.id, rxShareTokens.clinicId))
    .where(t.where(rxShareTokens, eq(rxShareTokens.id, shareId)));
  if (
    !row ||
    row.share.expiresAt <= new Date() ||
    row.share.failedAttempts >= RX_SHARE_MAX_ATTEMPTS
  )
    throw invalidLink();
  return row;
}

/** What the landing page may show before the birthdate check: no patient details. */
export const shareInfo = (token: string, ip: string | null): Promise<RxShareInfo> =>
  withShare(token, ip, async (t, shareId) => {
    const row = await loadShare(t, shareId);
    return {
      clinicName: row.clinicName,
      issuedAt: iso(row.issuedAt),
      expiresAt: iso(row.share.expiresAt),
    };
  });

/**
 * Returns the PDF when the birthdate matches. Wrong answers are counted and the link dies after
 * a few. Every attempt is written to the audit log.
 */
export const openShare = (token: string, birthdate: string, ip: string | null) =>
  withShare(token, ip, async (t, shareId) => {
    const row = await loadShare(t, shareId);
    const [patient] = await t.tx
      .select({ birthdate: patients.birthdate })
      .from(patients)
      .where(t.where(patients, eq(patients.id, row.patientId)));
    if (!patient?.birthdate || patient.birthdate !== birthdate) {
      await t.tx
        .update(rxShareTokens)
        .set({ failedAttempts: sql`${rxShareTokens.failedAttempts} + 1` })
        .where(t.where(rxShareTokens, eq(rxShareTokens.id, shareId)));
      await t.audit({
        action: 'prescription.share_denied',
        entityType: 'prescription',
        entityId: row.share.prescriptionId,
      });
      return null;
    }
    await t.tx
      .update(rxShareTokens)
      .set({ accessedAt: new Date() })
      .where(t.where(rxShareTokens, eq(rxShareTokens.id, shareId)));
    await t.audit({
      action: 'prescription.share_open',
      entityType: 'prescription',
      entityId: row.share.prescriptionId,
    });
    return prescriptionPdf(t, row.share.prescriptionId);
  });
