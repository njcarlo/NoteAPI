import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { sessionQueryKey, useSession } from '@/auth/session';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { navFor } from './nav';

export function AppShell() {
  const { user, isLoading } = useSession();
  const location = useLocation();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQueryKey[0] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-card md:w-60 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          <p className="text-sm font-semibold">{user.clinicName}</p>
          <p className="text-xs text-muted-foreground">
            {user.name} · {user.roles.map((r) => t.roles[r]).join(', ')}
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {navFor(user).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-muted',
                  isActive && 'bg-primary/10 text-primary hover:bg-primary/10',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-border p-3 md:block">
          <Button variant="ghost" className="w-full justify-start" onClick={() => logout.mutate()}>
            <LogOut />
            {t.app.signOut}
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
