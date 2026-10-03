import { Plus, Search, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { ageFrom, phone } from '@/lib/format';
import { PAGE_SIZE, usePatients } from './api';

export function PatientsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = useDeferredValue(search.trim());
  const query = usePatients(q, page);

  return (
    <>
      <PageHeader
        title={t.patients.title}
        actions={
          can('patients:write') && (
            <Button asChild>
              <Link to="/patients/new">
                <Plus />
                {t.patients.new}
              </Link>
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t.patients.searchPlaceholder}
          aria-label={t.common.search}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      {query.isLoading ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data || query.data.items.length === 0 ? (
        q ? (
          <EmptyState icon={Search} title={t.patients.noMatches} />
        ) : (
          <EmptyState icon={Users} title={t.patients.emptyTitle} body={t.patients.emptyBody} />
        )
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t.patients.columns.name}</th>
                <th className="px-4 py-3 font-medium">{t.patients.columns.age}</th>
                <th className="px-4 py-3 font-medium">{t.patients.columns.sex}</th>
                <th className="px-4 py-3 font-medium">{t.patients.columns.mobile}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((p) => {
                const age = ageFrom(p.birthdate);
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                    onClick={() => navigate(`/patients/${p.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/patients/${p.id}`} onClick={(e) => e.stopPropagation()}>
                        {p.lastName}, {p.firstName} {p.middleName ?? ''}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {age === null ? t.common.none : t.patients.years(age)}
                    </td>
                    <td className="px-4 py-3">{p.sex ? t.patients.sex[p.sex] : t.common.none}</td>
                    <td className="px-4 py-3 tabular-nums">{phone(p.mobile)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              {t.common.pageOf(
                page * PAGE_SIZE + 1,
                page * PAGE_SIZE + query.data.items.length,
                query.data.total,
              )}
            </span>
            <div className="flex gap-2">
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
          </div>
        </Card>
      )}
    </>
  );
}
