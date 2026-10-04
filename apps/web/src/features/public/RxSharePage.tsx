import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { RxShareInfo } from '@clinic/shared';
import { EmptyState, ErrorState } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';
import { PublicLayout } from './PublicLayout';

const r = t.rxShare;

/** Fetches the PDF as a file; the JSON api() helper is not used for binary responses. */
async function openPdf(token: string, birthdate: string): Promise<string> {
  const res = await fetch(`/api/public/rx/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ birthdate }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    throw new ApiError(
      res.status,
      (body?.error?.code ?? 'INTERNAL_ERROR') as never,
      body?.error?.message ?? t.common.genericError,
    );
  }
  return URL.createObjectURL(await res.blob());
}

export function RxSharePage() {
  const { token = '' } = useParams();
  const [birthdate, setBirthdate] = useState('');
  const info = useQuery({
    queryKey: ['public', 'rx', token],
    queryFn: () => api<RxShareInfo>(`/public/rx/${token}`),
    retry: false,
  });
  const open = useMutation({ mutationFn: () => openPdf(token, birthdate) });
  useEffect(() => () => void (open.data && URL.revokeObjectURL(open.data)), [open.data]);

  let body;
  if (info.isLoading) body = <Skeleton className="h-40 w-full" />;
  else if (info.error instanceof ApiError && info.error.status === 404)
    body = <EmptyState title={t.cancel.invalid} />;
  else if (info.isError || !info.data)
    body = <ErrorState error={info.error} onRetry={() => info.refetch()} />;
  else
    body = (
      <Card>
        <CardHeader>
          <CardTitle>{info.data.clinicName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {r.issued(manilaDateTime(info.data.issuedAt))} ·{' '}
            {r.expires(manilaDateTime(info.data.expiresAt))}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {open.data ? (
            <Button asChild size="lg" className="w-full">
              <a href={open.data} download="prescription.pdf">
                <FileText />
                {r.download}
              </a>
            </Button>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                open.mutate(undefined, { onSuccess: (url) => window.open(url, '_blank') });
              }}
            >
              <label className="block text-sm">
                {r.prompt}
                <Input
                  type="date"
                  required
                  className="mt-2"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                />
              </label>
              {open.isError && (
                <Alert variant="destructive">
                  {open.error instanceof ApiError && open.error.status === 403
                    ? r.wrong
                    : open.error.message}
                </Alert>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!birthdate || open.isPending}
              >
                {open.isPending ? r.opening : r.open}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    );

  return (
    <PublicLayout>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{r.title}</h1>
      {body}
    </PublicLayout>
  );
}
