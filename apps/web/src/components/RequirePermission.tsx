import type { ReactNode } from 'react';
import type { Permission, Role } from '@clinic/shared';
import { useSession } from '@/auth/session';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function RequireAccess({
  permission,
  role,
  platform,
  children,
}: {
  permission?: Permission;
  role?: Role;
  platform?: boolean;
  children: ReactNode;
}) {
  const { user, activeClinic, can } = useSession();
  const allowed =
    (!permission || can(permission)) &&
    (!role || Boolean(activeClinic?.roles.includes(role))) &&
    (!platform || Boolean(user?.isPlatformAdmin));
  return allowed ? <>{children}</> : <NotFoundPage />;
}
