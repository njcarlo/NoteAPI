import { AlertTriangle, ArrowLeft, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { ageFrom, fullName, phone } from '@/lib/format';
import { usePatientVisits } from '@/features/consult/api';
import { dateLabel } from '@/lib/format';
import { usePatient } from './api';

export function PatientDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const query = usePatient(id);
  const visits = usePatientVisits(id ?? '', Boolean(id) && can('clinical:read'));

  if (query.isLoading) return <TableSkeleton rows={5} />;
  if (query.isError || !query.data)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const p = query.data;
  const age = ageFrom(p.birthdate);
  const f = t.patients.fields;
  const rows: [string, string][] = [
    [f.birthdate, p.birthdate ?? t.common.none],
    [f.sex, p.sex ? t.patients.sex[p.sex] : t.common.none],
    [f.mobile, phone(p.mobile)],
    [f.email, p.email ?? t.common.none],
    [f.address, p.address ?? t.common.none],
    [f.conditions, p.conditions ?? t.common.none],
    [f.smsOptIn, p.smsOptIn ? t.common.yes : t.common.no],
    [f.emailOptIn, p.emailOptIn ? t.common.yes : t.common.no],
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
        <Link to="/patients">
          <ArrowLeft />
          {t.common.back}
        </Link>
      </Button>
      <PageHeader
        title={fullName(p)}
        subtitle={[age !== null && t.patients.years(age), p.sex && t.patients.sex[p.sex]]
          .filter(Boolean)
          .join(' · ')}
        actions={
          can('patients:write') && (
            <Button asChild variant="outline">
              <Link to={`/patients/${p.id}/edit`}>
                <Pencil />
                {t.common.edit}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4">
        {p.allergies ? (
          <Badge variant="destructive" className="gap-1.5 px-3 py-1 text-sm">
            <AlertTriangle className="size-4" />
            {f.allergies}: {p.allergies}
          </Badge>
        ) : (
          <Badge variant="muted">{t.patients.allergiesNone}</Badge>
        )}
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">{t.patients.profile}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {can('clinical:read') && (
        <Card className="mt-6 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">{t.consult.history}</CardTitle>
          </CardHeader>
          <CardContent>
            {!visits.data?.length ? (
              <p className="text-sm text-muted-foreground">{t.consult.noHistory}</p>
            ) : (
              <ul className="divide-y divide-border">
                {visits.data.map((v) => (
                  <li key={v.id}>
                    <Link
                      to={`/consult/${v.appointmentId}`}
                      className="block py-3 text-sm hover:text-primary"
                    >
                      <span className="flex justify-between text-xs text-muted-foreground">
                        <span>{dateLabel(v.date, 'long')}</span>
                        <span>{v.doctorName}</span>
                      </span>
                      <span className="block font-medium">{v.assessment ?? '—'}</span>
                      {v.medicines.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {v.medicines.join(', ')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
