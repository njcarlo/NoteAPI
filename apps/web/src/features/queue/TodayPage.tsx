import { AlertTriangle, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Appointment, QueueItem } from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { STATUS_BORDER, StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useAppointmentAction, useAppointments, useDoctors } from '@/features/calendar/api';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { dateLabel, manilaTime, minutesSince, todayManila, vitalsSummary } from '@/lib/format';
import { useNow } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useQueue } from './api';
import { CheckInPanel, VitalsPanel, WalkInPanel } from './panels';

type PanelState =
  | { kind: 'checkIn'; appointment: Appointment }
  | { kind: 'walkIn' }
  | { kind: 'vitals'; item: QueueItem }
  | null;

export function TodayPage() {
  const today = todayManila();
  const now = useNow();
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [panel, setPanel] = useState<PanelState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const doctors = useDoctors();
  const appointments = useAppointments(today, today);
  const queue = useQueue(doctorFilter === 'all' ? undefined : doctorFilter);
  const action = useAppointmentAction();

  const mine = (appointments.data ?? []).filter(
    (a) => doctorFilter === 'all' || a.doctorId === doctorFilter,
  );
  const upcoming = mine.filter((a) => a.status === 'booked');
  const done = mine.filter((a) => a.status === 'done');
  const closed = mine.filter((a) => a.status === 'cancelled' || a.status === 'no_show');
  const waiting = queue.data?.waiting ?? [];
  const inConsult = queue.data?.inConsult ?? [];
  const showDoctor = doctorFilter === 'all' && (doctors.data?.length ?? 0) > 1;

  const onCheckedIn = (a: Appointment) => {
    setPanel(null);
    setNotice(t.today.checkedIn(a.queueNumber ?? 0));
  };

  return (
    <>
      <PageHeader
        title={t.today.title}
        subtitle={dateLabel(today, 'long')}
        actions={
          <div className="flex flex-wrap gap-2">
            {(doctors.data?.length ?? 0) > 1 && (
              <Select
                className="w-auto"
                value={doctorFilter}
                onChange={(e) => setDoctorFilter(e.target.value)}
              >
                <option value="all">{t.calendar.allDoctors}</option>
                {doctors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            <Button onClick={() => (setNotice(null), setPanel({ kind: 'walkIn' }))}>
              <Plus />
              {t.today.addWalkIn}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t.today.counts.booked, upcoming.length],
          [t.today.counts.waiting, waiting.length],
          [t.today.counts.inConsult, inConsult.length],
          [t.today.counts.done, done.length],
        ].map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {action.isError && (
        <Alert variant="destructive" className="mb-4">
          {errorMessage(action.error, t.common.genericError)}
        </Alert>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          {appointments.isLoading || queue.isLoading ? (
            <TableSkeleton />
          ) : appointments.isError || queue.isError ? (
            <ErrorState
              error={appointments.error ?? queue.error}
              onRetry={() => (appointments.refetch(), queue.refetch())}
            />
          ) : mine.length === 0 ? (
            <EmptyState title={t.today.emptyDay} />
          ) : (
            <>
              <Section title={t.today.sections.waiting} count={waiting.length}>
                {waiting.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.today.emptyWaiting}</p>
                ) : (
                  waiting.map((item) => (
                    <QueueRow
                      key={item.appointmentId}
                      item={item}
                      now={now}
                      showDoctor={showDoctor}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPanel({ kind: 'vitals', item })}
                      >
                        {t.vitals.edit}
                      </Button>
                    </QueueRow>
                  ))
                )}
              </Section>

              {inConsult.length > 0 && (
                <Section title={t.today.sections.inConsult} count={inConsult.length}>
                  {inConsult.map((item) => (
                    <QueueRow
                      key={item.appointmentId}
                      item={item}
                      now={now}
                      showDoctor={showDoctor}
                    />
                  ))}
                </Section>
              )}

              <Section title={t.today.sections.upcoming} count={upcoming.length}>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.today.emptyUpcoming}</p>
                ) : (
                  upcoming.map((a) => {
                    const late = new Date(a.startAt) < now;
                    return (
                      <Row
                        key={a.id}
                        appointment={a}
                        showDoctor={showDoctor}
                        active={panel?.kind === 'checkIn' && panel.appointment.id === a.id}
                      >
                        {late && <Badge variant="warning">{t.today.late}</Badge>}
                        {late && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={action.isPending}
                            onClick={() => action.mutate({ kind: 'no-show', id: a.id })}
                          >
                            {t.today.noShow}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => (
                            setNotice(null),
                            setPanel({ kind: 'checkIn', appointment: a })
                          )}
                        >
                          {t.today.checkIn}
                        </Button>
                      </Row>
                    );
                  })
                )}
              </Section>

              {done.length > 0 && (
                <Section title={t.today.sections.done} count={done.length}>
                  {done.map((a) => (
                    <Row key={a.id} appointment={a} showDoctor={showDoctor} />
                  ))}
                </Section>
              )}

              {closed.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    {t.today.sections.closed} ({closed.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {closed.map((a) => (
                      <Row key={a.id} appointment={a} showDoctor={showDoctor} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        {panel?.kind === 'checkIn' && (
          <CheckInPanel
            appointment={panel.appointment}
            onClose={() => setPanel(null)}
            onDone={onCheckedIn}
          />
        )}
        {panel?.kind === 'walkIn' && (
          <WalkInPanel onClose={() => setPanel(null)} onDone={onCheckedIn} />
        )}
        {panel?.kind === 'vitals' && (
          <VitalsPanel item={panel.item} onClose={() => setPanel(null)} />
        )}
      </div>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {title} <span className="tabular-nums">({count})</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  appointment: a,
  showDoctor,
  active,
  children,
}: {
  appointment: Appointment;
  showDoctor: boolean;
  active?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        'flex flex-wrap items-center gap-3 border-l-4 px-4 py-3',
        STATUS_BORDER[a.status],
        active && 'ring-2 ring-ring',
      )}
    >
      <span className="w-20 font-medium tabular-nums">
        {a.type === 'walk_in' ? t.calendar.walkIn : manilaTime(a.startAt)}
      </span>
      <span className="min-w-40 flex-1">
        <span className="block font-medium">
          {a.patient.lastName}, {a.patient.firstName}
        </span>
        <span className="text-xs text-muted-foreground">
          {a.referenceCode}
          {showDoctor && ` · ${a.doctorName}`}
        </span>
      </span>
      <StatusBadge status={a.status} />
      {children && <span className="flex items-center gap-2">{children}</span>}
    </Card>
  );
}

function QueueRow({
  item,
  now,
  showDoctor,
  children,
}: {
  item: QueueItem;
  now: Date;
  showDoctor: boolean;
  children?: ReactNode;
}) {
  const vitals = vitalsSummary(item.vitals);
  return (
    <Card
      className={cn(
        'flex flex-wrap items-center gap-3 border-l-4 px-4 py-3',
        STATUS_BORDER[item.status],
      )}
    >
      <span className="w-12 text-xl font-semibold tabular-nums">
        {t.today.queueNumber(item.queueNumber ?? 0)}
      </span>
      <span className="min-w-40 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {item.patient.lastName}, {item.patient.firstName}
          {item.patient.allergies && (
            <AlertTriangle
              className="size-4 text-destructive"
              aria-label={t.patients.fields.allergies}
            />
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {vitals ?? t.vitals.none}
          {showDoctor && ` · ${item.doctorName}`}
        </span>
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {t.today.waitingFor(minutesSince(item.arrivedAt, now))}
      </span>
      {children}
    </Card>
  );
}
