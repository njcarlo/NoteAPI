import type { Role } from './constants';

export const PERMISSIONS = [
  'patients:read',
  'patients:write',
  'appointments:manage',
  'queue:manage',
  'vitals:write',
  'clinical:read',
  'clinical:write',
  'prescriptions:read',
  'prescriptions:write',
  'settings:manage',
  'staff:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  secretary: ['patients:read', 'patients:write', 'appointments:manage', 'queue:manage', 'vitals:write'],
  doctor: [
    'patients:read',
    'patients:write',
    'appointments:manage',
    'queue:manage',
    'vitals:write',
    'clinical:read',
    'clinical:write',
    'prescriptions:read',
    'prescriptions:write',
  ],
  admin: ['patients:read', 'appointments:manage', 'settings:manage', 'staff:manage', 'audit:read'],
};

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}
