import { asc, eq } from 'drizzle-orm';
import type { Role, Staff, StaffCreateInput, StaffUpdateInput } from '@clinic/shared';
import { users } from '../../db/schema';
import type { TenantScope } from '../../db/tenant';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { iso } from '../../lib/sql';
import { revokeUserSessions } from '../auth/service';

const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  roles: users.roles,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

type StaffRow = { [K in keyof typeof columns]: (typeof columns)[K]['_']['data'] };

const toStaff = (row: StaffRow): Staff => ({
  ...row,
  roles: row.roles as Role[],
  createdAt: iso(row.createdAt),
});

export async function listStaff(t: TenantScope): Promise<Staff[]> {
  const rows = await t.tx.select(columns).from(users).where(t.where(users)).orderBy(asc(users.name));
  return rows.map(toStaff);
}

export async function createStaff(t: TenantScope, input: StaffCreateInput): Promise<Staff> {
  try {
    const [row] = await t.tx
      .insert(users)
      .values(
        t.values({
          name: input.name,
          email: input.email,
          roles: input.roles,
          passwordHash: await hashPassword(input.password),
        }),
      )
      .returning(columns);
    if (!row) throw new Error('Insert returned no row');
    await t.audit({
      action: 'staff.create',
      entityType: 'user',
      entityId: row.id,
      metadata: { roles: input.roles },
    });
    return toStaff(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('That email is already in use');
    throw error;
  }
}

export async function updateStaff(
  t: TenantScope,
  actorId: string,
  id: string,
  input: StaffUpdateInput,
): Promise<Staff> {
  if (id === actorId && (input.isActive === false || (input.roles && !input.roles.includes('admin')))) {
    throw badRequest('You cannot deactivate yourself or remove your own admin role');
  }
  const [row] = await t.tx
    .update(users)
    .set(input)
    .where(t.where(users, eq(users.id, id)))
    .returning(columns);
  if (!row) throw notFound('Staff member');
  if (input.isActive === false || input.roles) await revokeUserSessions(id);
  await t.audit({
    action: 'staff.update',
    entityType: 'user',
    entityId: id,
    metadata: { fields: Object.keys(input), roles: input.roles },
  });
  return toStaff(row);
}
