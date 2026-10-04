import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { CancelLookup } from '@clinic/shared';
import { EmptyState, ErrorState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';
import { PublicLayout } from './PublicLayout';

export function CancelPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['public', 'cancel', token];
  const lookup = useQuery({
    queryKey: key,
    queryFn: () => api<CancelLookup>(`/public/cancel/${token}`),
  });
  const cancel = useMutation({
    mutationFn: () => api<CancelLookup>(`/public/cancel/${token}`, { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  let body;
  if (lookup.isLoading) body = <Skeleton className="h-48 w-full" />;
  else if (lookup.error instanceof ApiError && lookup.error.status === 404)
    body = <EmptyState title={t.cancel.invalid} />;
  else if (lookup.isError || !lookup.data)
    body = <ErrorState error={lookup.error} onRetry={() => lookup.refetch()} />;
  else {
    const a = lookup.data;
    body = (
      <Card>
        <CardHeader>
          <CardTitle>{a.clinicName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t.booking.reference}</dt>
            <dd className="font-mono">{a.referenceCode}</dd>
            <dt className="text-muted-foreground">{t.booking.when}</dt>
            <dd>{manilaDateTime(a.startAt)}</dd>
            <dt className="text-muted-foreground">{t.booking.doctor}</dt>
            <dd>{a.doctorName}</dd>
            <dt className="text-muted-foreground">{t.staff.columns.status}</dt>
            <dd>
              <StatusBadge status={a.status as Parameters<typeof StatusBadge>[0]['status']} />
            </dd>
          </dl>
          {cancel.isError && (
            <Alert variant="destructive">{errorMessage(cancel.error, t.common.genericError)}</Alert>
          )}
          {a.status === 'cancelled' ? (
            <Alert variant="success">{t.cancel.cancelled}</Alert>
          ) : a.cancellable ? (
            <Button
              variant="destructive"
              className="w-full"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? t.cancel.cancelling : t.cancel.confirm}
            </Button>
          ) : (
            <Alert>{t.cancel.notCancellable}</Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <PublicLayout>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t.cancel.title}</h1>
      {body}
    </PublicLayout>
  );
}
