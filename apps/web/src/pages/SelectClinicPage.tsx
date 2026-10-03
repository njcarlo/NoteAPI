import { Building2, ChevronRight } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { useSelectClinic, useSession } from '@/auth/session';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { homePathFor } from '@/layouts/nav';

export function SelectClinicPage() {
  const { user, clinics, activeClinic } = useSession();
  const navigate = useNavigate();
  const select = useSelectClinic();

  if (user && activeClinic && clinics.length === 1) {
    return <Navigate to={homePathFor({ user, clinics, activeClinic })} replace />;
  }

  return (
    <>
      <PageHeader title={t.clinics.title} subtitle={t.clinics.subtitle} />
      {select.isError && (
        <Alert variant="destructive" className="mb-4">
          {errorMessage(select.error, t.common.genericError)}
        </Alert>
      )}
      {clinics.length === 0 ? (
        <EmptyState icon={Building2} title={t.clinics.none} />
      ) : (
        <Card className="max-w-lg divide-y divide-border">
          {clinics.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={select.isPending}
              className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-muted/50 disabled:opacity-50"
              onClick={() => select.mutate(c.id, { onSuccess: (s) => navigate(homePathFor(s)) })}
            >
              <span>
                <span className="block font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.roles.map((r) => t.roles[r]).join(', ')}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </Card>
      )}
    </>
  );
}
