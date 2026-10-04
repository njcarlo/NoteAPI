import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { OptOutInfo } from '@clinic/shared';
import { EmptyState, ErrorState } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { PublicLayout } from './PublicLayout';

const o = t.optOut;

export function OptOutPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['public', 'opt-out', token];
  const info = useQuery({
    queryKey: key,
    queryFn: () => api<OptOutInfo>(`/public/opt-out/${token}`),
    retry: false,
  });
  const stop = useMutation({
    mutationFn: () => api<OptOutInfo>(`/public/opt-out/${token}`, { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  let body;
  if (info.isLoading) body = <Skeleton className="h-32 w-full" />;
  else if (info.error instanceof ApiError && info.error.status === 404)
    body = <EmptyState title={o.invalid} />;
  else if (info.isError || !info.data)
    body = <ErrorState error={info.error} onRetry={() => info.refetch()} />;
  else
    body = (
      <Card>
        <CardContent className="space-y-4 pt-6">
          {info.data.smsOptIn ? (
            <>
              <p>{o.question(info.data.clinicName)}</p>
              {stop.isError && (
                <Alert variant="destructive">
                  {errorMessage(stop.error, t.common.genericError)}
                </Alert>
              )}
              <Button className="w-full" disabled={stop.isPending} onClick={() => stop.mutate()}>
                {o.confirm}
              </Button>
            </>
          ) : (
            <Alert variant="success">{o.done(info.data.clinicName)}</Alert>
          )}
        </CardContent>
      </Card>
    );

  return (
    <PublicLayout>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{o.title}</h1>
      {body}
    </PublicLayout>
  );
}
