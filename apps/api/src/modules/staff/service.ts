import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  Role,
  Staff,
  StaffCreateInput,
  StaffCreateResponse,
  StaffUpdateInput,
} from '@clinic/shared';
import { memberships, secretaryAssignments, users } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { iso } from '../../lib/sql';

async function loadStaff(t: TenantScope, userId?: string): Promise<Staff[]> {
  const rows = await t.tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      roles: memberships.roles,
      isActive: memberships.isActive,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(t.where(memberships, userId ? eq(memberships.userId, userId) : undefined))
    .orderBy(asc(users.name));
  const assignments = await t.tx
    .select({
      secretaryId: secretaryAssignments.secretaryId,
      doctorId: secretaryAssignments.doctorId,
    })
    .from(secretaryAssignments)
    .where(t.where(secretaryAssignments));
  return rows.map((row) => ({
    ...row,
    roles: row.roles as Role[],
    doctorIds: assignments.filter((a) => a.secretaryId === row.id).map((a) => a.doctorId),
    createdAt: iso(row.createdAt),
  }));
}

async function loadOne(t: TenantScope, userId: string): Promise<Staff> {
  const [staff] = await loadStaff(t, userId);
  if (!staff) throw notFound('Staff member');
  return staff;
}

export const listStaff = (t: TenantScope) => loadStaff(t);

export async function createStaff(
  t: TenantScope,
  input: StaffCreateInput,
): Promise<StaffCreateResponse> {
  const [existing] = await t.tx.execute<{ id: string | null }>(
    sql`select user_id_by_email(${input.email}) as id`,
  );
  let userId = existing?.id ?? null;
  const linkedExistingAccount = Boolean(userId);

  if (userId) {
    const [member] = await t.tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(t.where(memberships, eq(memberships.userId, userId)));
    if (member) throw conflict('This person is already on your staff');
  } else {
    if (!input.password)
      throw badRequest('Set a temporary password for the new account', [
        { path: ['password'], message: 'Required for a new account' },
      ]);
    userId = randomUUID();
    // No RETURNING: the new login is not visible to this clinic until its membership exists.
    await t.tx.insert(users).values({
      id: userId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
  }

  await t.tx.insert(memberships).values(t.values({ userId, roles: input.roles }));
  await t.audit({
    action: 'staff.create',
    entityType: 'user',
    entityId: userId,
    metadata: { roles: input.roles, linkedExistingAccount },
  });
  return { ...(await loadOne(t, userId)), linkedExistingAccount };
}

export async function updateStaff(
  t: TenantScope,
  actorId: string,
  userId: string,
  input: StaffUpdateInput,
): Promise<Staff> {
  if (
    userId === actorId &&
    (input.isActive === false || (input.roles && !input.roles.includes('admin')))
  ) {
    throw badRequest('You cannot deactivate yourself or remove your own admin role');
  }
  const current = await loadOne(t, userId);
  const roles = input.roles ?? current.roles;

  const { doctorIds, ...membershipChanges } = input;
  if (Object.keys(membershipChanges).length) {
    await t.tx
      .update(memberships)
      .set(membershipChanges)
      .where(t.where(memberships, eq(memberships.userId, userId)));
  }

  // Assignments only apply to secretaries; they are cleared when the role is removed.
  const keepAssignments = roles.includes('secretary') && !roles.includes('doctor');
  if (doctorIds !== undefined || !keepAssignments) {
    const wanted = keepAssignments ? [...new Set(doctorIds ?? current.doctorIds)] : [];
    if (doctorIds?.length && !keepAssignments) {
      throw badRequest('Only secretaries can be assigned to doctors');
    }
    if (wanted.length) {
      const doctors = await t.tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          t.where(
            memberships,
            inArray(memberships.userId, wanted),
            sql`'doctor' = any(${memberships.roles})`,
          ),
        );
      if (doctors.length !== wanted.length) throw badRequest('Pick doctors from this clinic');
    }
    await t.tx
      .delete(secretaryAssignments)
      .where(t.where(secretaryAssignments, eq(secretaryAssignments.secretaryId, userId)));
    if (wanted.length) {
      await t.tx
        .insert(secretaryAssignments)
        .values(wanted.map((doctorId) => t.values({ secretaryId: userId, doctorId })));
    }
  }

  await t.audit({
    action: 'staff.update',
    entityType: 'user',
    entityId: userId,
    metadata: { fields: Object.keys(input), roles: input.roles },
  });
  return loadOne(t, userId);
}
