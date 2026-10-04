import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  addDays,
  startOfWeek,
  utcToZoned,
  CLINIC_TIMEZONE,
  type Appointment,
  type Doctor,
  type SlotDto,
} from '@clinic/shared';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { STATUS_BORDER, StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { t } from '@/i18n';
import { dateLabel, manilaTime, todayManila } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppointments, useDoctors, useSlotsFor } from './api';
import { AppointmentPanel, BookPanel } from './panels';

type View = 'day' | 'week';
export type PanelState =
  { kind: 'book'; doctorId: string; slot: SlotDto } | { kind: 'details'; id: string } | null;

const localDate = (iso: string) => utcToZoned(iso, CLINIC_TIMEZONE).date;

export function CalendarPage() {
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(todayManila());
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [panel, setPanel] = useState<PanelState>(null);

  const from = view === 'day' ? date : startOfWeek(date);
  const to = view === 'day' ? date : addDays(from, 6);
  const doctors = useDoctors();
  const appointments = useAppointments(from, to);
  const shownDoctors = (doctors.data ?? []).filter(
    (d) => doctorFilter === 'all' || d.id === doctorFilter,
  );
  const visible = (appointments.data ?? []).filter(
    (a) => doctorFilter === 'all' || a.doctorId === doctorFilter,
  );
  const selected =
    panel?.kind === 'details' ? appointments.data?.find((a) => a.id === panel.id) : undefined;

  const step = (dir: -1 | 1) => setDate(addDays(date, dir * (view === 'day' ? 1 : 7)));
  const title = view === 'day' ? dateLabel(date, 'long') : `${dateLabel(from)} – ${dateLabel(to)}`;

  return (
    <>
      <PageHeader title={t.calendar.title} subtitle={title} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium',
                view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {t.calendar[v]}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t.common.previous}
          onClick={() => step(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" onClick={() => setDate(todayManila())}>
          {t.calendar.today}
        </Button>
        <Button variant="outline" size="icon" aria-label={t.common.next} onClick={() => step(1)}>
          <ChevronRight />
        </Button>
        <Input
          type="date"
          className="w-auto"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
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
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {doctors.isLoading || appointments.isLoading ? (
            <TableSkeleton />
          ) : doctors.isError || appointments.isError ? (
            <ErrorState
              error={doctors.error ?? appointments.error}
              onRetry={() => (doctors.refetch(), appointments.refetch())}
            />
          ) : !doctors.data?.length ? (
            <EmptyState title={t.calendar.noDoctors} />
          ) : view === 'day' ? (
            <DayView
              date={date}
              doctors={shownDoctors}
              appointments={visible}
              panel={panel}
              onSelect={setPanel}
            />
          ) : (
            <WeekView
              from={from}
              appointments={visible}
              showDoctor={doctorFilter === 'all' && doctors.data.length > 1}
              panel={panel}
              onSelect={setPanel}
              onOpenDay={(d) => (setDate(d), setView('day'))}
            />
          )}
        </div>
        {panel?.kind === 'book' && (
          <BookPanel
            doctor={doctors.data?.find((d) => d.id === panel.doctorId)}
            slot={panel.slot}
            onClose={() => setPanel(null)}
            onBooked={(a) => setPanel({ kind: 'details', id: a.id })}
          />
        )}
        {selected && <AppointmentPanel appointment={selected} onClose={() => setPanel(null)} />}
      </div>
    </>
  );
}

function AppointmentCard({
  appointment: a,
  active,
  showDoctor,
  onClick,
}: {
  appointment: Appointment;
  active: boolean;
  showDoctor?: boolean;
  onClick: () => void;
}) {
  const inactive = a.status === 'cancelled' || a.status === 'no_show';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md border border-l-4 border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50',
        STATUS_BORDER[a.status],
        active && 'ring-2 ring-ring',
        inactive && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">
          {a.type === 'walk_in' ? t.calendar.walkIn : manilaTime(a.startAt)}
        </span>
        <StatusBadge status={a.status} />
      </div>
      <p className={cn('mt-0.5 truncate', inactive && 'line-through')}>
        {a.patient.lastName}, {a.patient.firstName}
      </p>
      {showDoctor && <p className="truncate text-xs text-muted-foreground">{a.doctorName}</p>}
    </button>
  );
}

const OPEN_PREVIEW = 6;

function DayView({
  date,
  doctors,
  appointments,
  panel,
  onSelect,
}: {
  date: string;
  doctors: Doctor[];
  appointments: Appointment[];
  panel: PanelState;
  onSelect: (p: PanelState) => void;
}) {
  const bookable = date >= todayManila();
  const slots = useSlotsFor(
    doctors.map((d) => d.id),
    date,
    bookable,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className={cn('grid gap-4', doctors.length > 1 && 'lg:grid-cols-2 2xl:grid-cols-3')}>
      {doctors.map((doctor, i) => {
        const own = appointments.filter((a) => a.doctorId === doctor.id);
        const open = slots[i]?.data ?? [];
        const items = [
          ...own.map((a) => ({ at: a.startAt, appointment: a })),
          ...(expanded[doctor.id] ? open : open.slice(0, OPEN_PREVIEW)).map((s) => ({
            at: s.startAt,
            slot: s,
          })),
        ].sort((x, y) => x.at.localeCompare(y.at));

        return (
          <Card key={doctor.id} className="p-4">
            <h2 className="mb-3 font-semibold">{doctor.name}</h2>
            {items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {bookable ? t.calendar.noHours : t.calendar.empty}
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) =>
                  'appointment' in item && item.appointment ? (
                    <AppointmentCard
                      key={item.appointment.id}
                      appointment={item.appointment}
                      active={panel?.kind === 'details' && panel.id === item.appointment.id}
                      onClick={() => onSelect({ kind: 'details', id: item.appointment.id })}
                    />
                  ) : 'slot' in item && item.slot ? (
                    <button
                      key={item.at}
                      type="button"
                      onClick={() =>
                        onSelect({ kind: 'book', doctorId: doctor.id, slot: item.slot })
                      }
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary',
                        panel?.kind === 'book' &&
                          panel.slot.startAt === item.at &&
                          panel.doctorId === doctor.id &&
                          'border-primary text-primary',
                      )}
                    >
                      <span className="tabular-nums">{manilaTime(item.at)}</span>
                      <span className="flex items-center gap-1">
                        <Plus className="size-3.5" />
                        {t.calendar.book}
                      </span>
                    </button>
                  ) : null,
                )}
                {!expanded[doctor.id] && open.length > OPEN_PREVIEW && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setExpanded({ ...expanded, [doctor.id]: true })}
                  >
                    {t.calendar.moreOpen(open.length - OPEN_PREVIEW)}
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function WeekView({
  from,
  appointments,
  showDoctor,
  panel,
  onSelect,
  onOpenDay,
}: {
  from: string;
  appointments: Appointment[];
  showDoctor: boolean;
  panel: PanelState;
  onSelect: (p: PanelState) => void;
  onOpenDay: (date: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const today = todayManila();
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((d) => {
        const own = appointments.filter((a) => localDate(a.startAt) === d);
        return (
          <div key={d} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenDay(d)}
              className={cn(
                'mb-2 w-full rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-muted',
                d === today && 'text-primary',
              )}
            >
              {dateLabel(d)}
            </button>
            <div className="space-y-2">
              {own.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">{t.calendar.empty}</p>
              ) : (
                own.map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appointment={a}
                    showDoctor={showDoctor}
                    active={panel?.kind === 'details' && panel.id === a.id}
                    onClick={() => onSelect({ kind: 'details', id: a.id })}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
