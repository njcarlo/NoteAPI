import { and, eq, lt, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ActiveClinic,
  type ClinicMembership,
  type Role,
  type SessionUser,
} from '@clinic/shared';
import { env } from '../../config/env';
import { db, type Transaction } from '../../db/client';
import { clinics, memberships, secretaryAssignments, sessions, users } from '../../db/schema';
import { enterClinic, withTenant, withUser } from '../../db/tenant';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError, forbidden } from '../../lib/errors';
import { verifyDummy, verifyPassword } from '../../lib/password';

export interface SessionState {
  user: SessionUser;
  clinics: ClinicMembership[];
  activeClinic: ActiveClinic | null;
}

export interface ActiveSession extends SessionState {
  id: string;
  csrfToken: string;
}

const invalidCredentials = () =>
  new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password');

const idleExpiry = () => new Date(Date.now() + env.SESSION_IDLE_MINUTES * 60_000);

/** Loads the user, their active clinics, and their roles in the requested clinic (if still valid). */
async function loadState(
  tx: Transaction,
  userId: string,
  activeClinicId: string | null,
): Promise<SessionState | null> {
  const [user] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isPlatformAdmin: users.isPlatformAdmin,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.isActive) return null;

  const rows = await tx
    .select({ id: clinics.id, name: clinics.name, slug: clinics.slug, roles: memberships.roles })
    .from(memberships)
    .innerJoin(clinics, eq(clinics.id, memberships.clinicId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.isActive, true),
        eq(clinics.status, 'active'),
      ),
    )
    .orderBy(clinics.name);
  const clinicList = rows.map((row) => ({ ...row, roles: row.roles as Role[] }));

  let activeClinic: ActiveClinic | null = null;
  const current = clinicList.find((c) => c.id === activeClinicId);
  if (current) {
    await enterClinic(tx, current.id);
    let assignedDoctorIds: string[] | null = null;
    if (current.roles.includes('secretary') && !current.roles.includes('doctor')) {
      const assigned = await tx
        .select({ doctorId: secretaryAssignments.doctorId })
        .from(secretaryAssignments)
        .where(
          and(
            eq(secretaryAssignments.clinicId, current.id),
            eq(secretaryAssignments.secretaryId, userId),
          ),
        );
      assignedDoctorIds = assigned.length ? assigned.map((a) => a.doctorId) : null;
    }
    activeClinic = { ...current, assignedDoctorIds };
  }

  const { isActive: _isActive, ...sessionUser } = user;
  return { user: sessionUser, clinics: clinicList, activeClinic };
}

interface LookupRow extends Record<string, unknown> {
  id: string;
  password_hash: string;
  is_active: boolean;
  locked_until: Date | string | null;
}

export async function login(input: {
  email: string;
  password: string;
  ip: string | null;
  previousToken: string | undefined;
}): Promise<{ token: string; session: ActiveSession }> {
  const [found] = await db.execute<LookupRow>(sql`select * from auth_lookup_user(${input.email})`);
  if (!found) {
    await verifyDummy(input.password);
    throw invalidCredentials();
  }

  const lockedUntil = found.locked_until ? new Date(found.locked_until) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    throw new AppError(
      423,
      ERROR_CODES.ACCOUNT_LOCKED,
      'Too many failed sign-in attempts. Please try again later.',
    );
  }

  const passwordOk = await verifyPassword(found.password_hash, input.password);
  if (!passwordOk || !found.is_active) {
    if (!passwordOk) {
      await withUser(found.id, async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
          .where(eq(users.id, found.id))
          .returning({ failed: users.failedLoginCount });
        if (row && row.failed >= env.LOGIN_MAX_FAILURES) {
          await tx
            .update(users)
            .set({
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000),
            })
            .where(eq(users.id, found.id));
        }
      });
    }
    throw invalidCredentials();
  }

  const state = await withUser(found.id, async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, found.id));
    const loaded = await loadState(tx, found.id, null);
    // A single clinic is selected automatically; with several, the user picks one.
    const only = loaded?.clinics.length === 1 ? loaded.clinics[0] : undefined;
    return only ? loadState(tx, found.id, only.id) : loaded;
  });
  if (!state) throw invalidCredentials();
  if (!state.clinics.length && !state.user.isPlatformAdmin) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, 'Your account is not active in any clinic.');
  }

  // Session rotation: any session presented with this request is discarded.
  if (input.previousToken)
    await db.delete(sessions).where(eq(sessions.id, sha256(input.previousToken)));
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, found.id), lt(sessions.expiresAt, new Date())));

  const token = randomToken();
  const csrfToken = randomToken();
  const sessionId = sha256(token);
  await db.insert(sessions).values({
    id: sessionId,
    userId: found.id,
    activeClinicId: state.activeClinic?.id ?? null,
    csrfToken,
    expiresAt: idleExpiry(),
    ip: input.ip,
  });

  if (state.activeClinic) {
    await withTenant(state.activeClinic.id, { userId: found.id, ip: input.ip }, (t) =>
      t.audit({ action: 'auth.login', entityType: 'user', entityId: found.id }),
    );
  }
  return { token, session: { id: sessionId, csrfToken, ...state } };
}

/** Resolves a session cookie; slides the idle expiry at most once a minute. */
export async function resolveSession(token: string): Promise<ActiveSession | null> {
  const sessionId = sha256(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!row || row.expiresAt <= new Date()) return null;

  const state = await withUser(row.userId, (tx) => loadState(tx, row.userId, row.activeClinicId));
  if (!state || (!state.clinics.length && !state.user.isPlatformAdmin)) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  const next = idleExpiry();
  const clinicGone = row.activeClinicId !== null && !state.activeClinic;
  if (clinicGone || next.getTime() - row.expiresAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ expiresAt: next, ...(clinicGone ? { activeClinicId: null } : {}) })
      .where(eq(sessions.id, sessionId));
  }
  return { id: sessionId, csrfToken: row.csrfToken, ...state };
}

export async function selectClinic(
  session: ActiveSession,
  clinicId: string,
  ip: string | null,
): Promise<ActiveSession> {
  if (!session.clinics.some((c) => c.id === clinicId)) throw forbidden();
  const state = await withUser(session.user.id, (tx) => loadState(tx, session.user.id, clinicId));
  if (!state?.activeClinic) throw forbidden();
  await db.update(sessions).set({ activeClinicId: clinicId }).where(eq(sessions.id, session.id));
  await withTenant(clinicId, { userId: session.user.id, ip }, (t) =>
    t.audit({ action: 'auth.select_clinic', entityType: 'user', entityId: session.user.id }),
  );
  return { ...session, ...state };
}

export async function logout(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
