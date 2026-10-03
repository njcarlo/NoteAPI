import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditLog, Paginated } from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';

const PAGE_SIZE = 50;

export function AuditPage() {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['audit', page],
    queryFn: () =>
      api<Paginated<AuditLog>>(`/audit-logs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />
      {query.isLoading ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <EmptyState title={t.audit.empty} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t.audit.columns.when}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.who}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.action}</th>
                <th className="px-4 py-3 font-medium">{t.audit.columns.record}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {manilaDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2">{log.userName ?? t.audit.system}</td>
                  <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {log.entityType}
                    {log.entityId && ` · ${log.entityId.slice(0, 8)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t.common.previous}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= query.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t.common.next}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
