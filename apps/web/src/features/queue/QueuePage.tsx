import { AlertTriangle, Megaphone, Stethoscope, Undo2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useState } from 'react';
import type { QueueItem } from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { ageFrom, minutesSince, vitalsSummary } from '@/lib/format';
import { useNow } from '@/lib/live';
import { useQueue, useQueueAction } from './api';
import { VitalsPanel } from './panels';

export function QueuePage() {
  const { user } = useSession();
  const now = useNow();
  const queue = useQueue(user?.id);
  const action = useQueueAction();
  const navigate = useNavigate();
  const callAndOpen = (a: { kind: 'next' } | { kind: 'call'; id: string }) =>
    action.mutate(a, { onSuccess: (item) => navigate(`/consult/${item.appointmentId}`) });
  const [vitalsFor, setVitalsFor] = useState<QueueItem | null>(null);
  const q = t.queue;

  const patientLine = (item: QueueItem) => {
    const age = ageFrom(item.patient.birthdate);
    return [
      age !== null && t.patients.years(age),
      item.patient.sex && t.patients.sex[item.patient.sex],
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <>
      <PageHeader
        title={q.title}
        subtitle={queue.data ? q.doneToday(queue.data.doneCount) : undefined}
        actions={
          <Button
            size="lg"
            disabled={action.isPending || !queue.data?.waiting.length}
            onClick={() => callAndOpen({ kind: 'next' })}
          >
            <Megaphone />
            {q.callNext}
          </Button>
        }
      />
      {action.isError && (
        <Alert variant="destructive" className="mb-4">
          {errorMessage(action.error, t.common.genericError)}
        </Alert>
      )}
      {queue.isLoading ? (
        <TableSkeleton />
      ) : queue.isError || !queue.data ? (
        <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
      ) : (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{q.nowServing}</h2>
              {queue.data.inConsult.length === 0 ? (
                <Card className="px-5 py-6 text-sm text-muted-foreground">{q.nobodyInConsult}</Card>
              ) : (
                queue.data.inConsult.map((item) => (
                  <Card
                    key={item.appointmentId}
                    className="mb-2 border-l-4 border-l-purple-500 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t.today.queueNumber(item.queueNumber ?? 0)}
                        </p>
                        <p className="text-xl font-semibold">
                          {item.patient.lastName}, {item.patient.firstName}
                        </p>
                        <p className="text-sm text-muted-foreground">{patientLine(item)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ kind: 'requeue', id: item.appointmentId })}
                      >
                        <Undo2 />
                        {q.returnToQueue}
                      </Button>
                    </div>
                    {item.patient.allergies && (
                      <Badge variant="destructive" className="mt-3 gap-1.5 px-3 py-1 text-sm">
                        <AlertTriangle className="size-4" />
                        {t.patients.fields.allergies}: {item.patient.allergies}
                      </Badge>
                    )}
                    <p className="mt-3 text-sm">{vitalsSummary(item.vitals) ?? t.vitals.none}</p>
                    <Button asChild className="mt-4">
                      <Link to={`/consult/${item.appointmentId}`}>
                        <Stethoscope />
                        {t.consult.openConsult}
                      </Link>
                    </Button>
                  </Card>
                ))
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                {q.waiting(queue.data.waiting.length)}
              </h2>
              {queue.data.waiting.length === 0 ? (
                <EmptyState title={q.empty} />
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">{q.columns.number}</th>
                        <th className="px-4 py-3 font-medium">{q.columns.patient}</th>
                        <th className="px-4 py-3 font-medium">{q.columns.vitals}</th>
                        <th className="px-4 py-3 font-medium">{q.columns.waited}</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {queue.data.waiting.map((item) => (
                        <tr
                          key={item.appointmentId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-3 text-lg font-semibold tabular-nums">
                            {item.queueNumber}
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2 font-medium">
                              {item.patient.lastName}, {item.patient.firstName}
                              {item.patient.allergies && (
                                <Badge variant="destructive" className="gap-1">
                                  <AlertTriangle className="size-3" />
                                  {item.patient.allergies}
                                </Badge>
                              )}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {patientLine(item)}
                              {item.type === 'walk_in' && ` · ${t.calendar.walkIn}`}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => setVitalsFor(item)}
                            >
                              {vitalsSummary(item.vitals) ?? (
                                <span className="text-muted-foreground">{t.vitals.none}</span>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {t.today.waitingFor(minutesSince(item.arrivedAt, now))}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={action.isPending}
                              onClick={() => callAndOpen({ kind: 'call', id: item.appointmentId })}
                            >
                              {q.call}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </section>
          </div>
          {vitalsFor && <VitalsPanel item={vitalsFor} onClose={() => setVitalsFor(null)} />}
        </div>
      )}
    </>
  );
}
