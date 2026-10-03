import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { ERROR_CODES, type Role, type SessionUser } from '@clinic/shared';
import { env } from '../../config/env';
import { db, type Transaction } from '../../db/client';
import { clinics, sessions, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { verifyDummy, verifyPassword } from '../../lib/password';

export interface ActiveSession {
  id: string;
  csrfToken: string;
  user: SessionUser;
}

const invalidCredentials = () =>
  new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password');

const idleExpiry = () => new Date(Date.now() + env.SESSION_IDLE_MINUTES * 60_000);

interface LookupRow extends Record<string, unknown> {
  id: string;
  clinic_id: string;
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

  const actor = { userId: found.id, ip: input.ip };
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
      await withTenant(found.clinic_id, actor, async (t) => {
        const [row] = await t.tx
          .update(users)
          .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
          .where(t.where(users, eq(users.id, found.id)))
          .returning({ failed: users.failedLoginCount });
        if (row && row.failed >= env.LOGIN_MAX_FAILURES) {
          await t.tx
            .update(users)
            .set({
              failedLoginCount: 0,
              lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000),
            })
            .where(t.where(users, eq(users.id, found.id)));
          await t.audit({ action: 'auth.locked', entityType: 'user', entityId: found.id });
        }
        await t.audit({ action: 'auth.login_failed', entityType: 'user', entityId: found.id });
      });
    }
    throw invalidCredentials();
  }

  // Session rotation: any session presented with this request is discarded.
  if (input.previousToken) {
    await db.delete(sessions).where(eq(sessions.id, sha256(input.previousToken)));
  }
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, found.id), lt(sessions.expiresAt, new Date())));

  const token = randomToken();
  const csrfToken = randomToken();
  const sessionId = sha256(token);

  const user = await withTenant(found.clinic_id, actor, async (t) => {
    await t.tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(t.where(users, eq(users.id, found.id)));
    await t.audit({ action: 'auth.login', entityType: 'user', entityId: found.id });
    return loadSessionUser(t.tx, found.clinic_id, found.id);
  });
  if (!user) throw invalidCredentials();

  await db.insert(sessions).values({
    id: sessionId,
    userId: found.id,
    clinicId: found.clinic_id,
    csrfToken,
    expiresAt: idleExpiry(),
    ip: input.ip,
  });

  return { token, session: { id: sessionId, csrfToken, user } };
}

async function loadSessionUser(
  tx: Transaction,
  clinicId: string,
  userId: string,
): Promise<SessionUser | null> {
  const [row] = await tx
    .select({
      id: users.id,
      clinicId: users.clinicId,
      name: users.name,
      email: users.email,
      roles: users.roles,
      isActive: users.isActive,
      clinicName: clinics.name,
    })
    .from(users)
    .innerJoin(clinics, eq(clinics.id, users.clinicId))
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)));
  if (!row || !row.isActive) return null;
  const { isActive: _isActive, ...user } = row;
  return { ...user, roles: user.roles as Role[] };
}

/** Resolves a session cookie; slides the idle expiry at most once a minute. */
export async function resolveSession(
  token: string,
  ip: string | null,
): Promise<ActiveSession | null> {
  const sessionId = sha256(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!row || row.expiresAt <= new Date()) return null;

  const user = await withTenant(row.clinicId, { userId: row.userId, ip }, (t) =>
    loadSessionUser(t.tx, row.clinicId, row.userId),
  );
  if (!user) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  const next = idleExpiry();
  if (next.getTime() - row.expiresAt.getTime() > 60_000) {
    await db.update(sessions).set({ expiresAt: next }).where(eq(sessions.id, sessionId));
  }
  return { id: sessionId, csrfToken: row.csrfToken, user };
}

export async function logout(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Ends every session of a user, e.g. after deactivation or a role change. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}
