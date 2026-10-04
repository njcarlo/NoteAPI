import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, LogOut, X } from 'lucide-react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { applySession, useSelectClinic, useSession } from '@/auth/session';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';
import { useLiveUpdates } from '@/lib/live';
import { cn } from '@/lib/utils';
import { homePathFor, navFor } from './nav';

const CLINIC_FREE_PATHS = ['/select-clinic', '/platform'];

export function AppShell() {
  const { user, clinics, activeClinic, isLoading } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectClinic = useSelectClinic();
  const { state: live, alerts, dismiss } = useLiveUpdates(activeClinic?.id ?? null);
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => applySession(queryClient, null),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!activeClinic && !CLINIC_FREE_PATHS.some((p) => location.pathname.startsWith(p))) {
    return <Navigate to={homePathFor({ user, clinics, activeClinic })} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-card md:w-60 md:border-r md:border-b-0">
        <div className="space-y-2 px-5 py-4">
          {clinics.length > 1 ? (
            <Select
              aria-label={t.clinics.switch}
              className="h-9 font-semibold"
              value={activeClinic?.id ?? ''}
              disabled={selectClinic.isPending}
              onChange={(e) =>
                selectClinic.mutate(e.target.value, {
                  onSuccess: (session) => navigate(homePathFor(session)),
                })
              }
            >
              {!activeClinic && <option value="">{t.clinics.choose}</option>}
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm font-semibold">{activeClinic?.name ?? t.nav.platform}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {user.name}
            {activeClinic && ` · ${activeClinic.roles.map((r) => t.roles[r]).join(', ')}`}
          </p>
          {live !== 'off' && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn('size-2 rounded-full', live === 'live' ? 'bg-success' : 'bg-warning')}
              />
              {live === 'live' ? t.queue.live : t.queue.reconnecting}
            </p>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {navFor(user, activeClinic).map(({ to, label, icon: Icon }) => (
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
      {alerts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 w-80 space-y-2" role="status" aria-live="polite">
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-lg"
            >
              <BellRing className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="font-medium">{t.alerts.newBooking(manilaDateTime(a.startAt))}</p>
                <Link
                  className="text-primary hover:underline"
                  to="/calendar"
                  onClick={() => dismiss(a.id)}
                >
                  {t.alerts.view}
                </Link>
              </div>
              <button
                type="button"
                aria-label={t.alerts.dismiss}
                onClick={() => dismiss(a.id)}
                className="text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
