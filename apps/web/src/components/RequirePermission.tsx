import type { ReactNode } from 'react';
import type { Permission, Role } from '@clinic/shared';
import { useSession } from '@/auth/session';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function RequireAccess({
  permission,
  role,
  children,
}: {
  permission?: Permission;
  role?: Role;
  children: ReactNode;
}) {
  const { user, can } = useSession();
  const allowed =
    (!permission || can(permission)) && (!role || Boolean(user?.roles.includes(role)));
  return allowed ? <>{children}</> : <NotFoundPage />;
}
