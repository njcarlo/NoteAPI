import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { DoctorSchedule, ScheduleBlockInput, ScheduleExceptionInput } from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useDoctors } from '@/features/calendar/api';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { dateLabel, todayManila } from '@/lib/format';

const s = t.settings;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function SchedulesSettings() {
  const doctors = useDoctors();
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const current = doctorId ?? doctors.data?.[0]?.id ?? null;

  if (doctors.isLoading) return <TableSkeleton rows={4} />;
  if (doctors.isError)
    return <ErrorState error={doctors.error} onRetry={() => doctors.refetch()} />;
  if (!doctors.data?.length || !current) return <EmptyState title={t.calendar.noDoctors} />;

  return (
    <div className="space-y-6">
      {doctors.data.length > 1 && (
        <FormField id="doctor" label={s.doctor}>
          <Select
            id="doctor"
            className="max-w-xs"
            value={current}
            onChange={(e) => setDoctorId(e.target.value)}
          >
            {doctors.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <DoctorScheduleEditor key={current} doctorId={current} />
    </div>
  );
}

function DoctorScheduleEditor({ doctorId }: { doctorId: string }) {
  const queryClient = useQueryClient();
  const key = ['schedule', doctorId];
  const schedule = useQuery({
    queryKey: key,
    queryFn: () => api<DoctorSchedule>(`/doctors/${doctorId}/schedule`),
  });
  const onSaved = (data: DoctorSchedule) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['slots'] });
  };

  if (schedule.isLoading) return <TableSkeleton rows={6} />;
  if (schedule.isError || !schedule.data)
    return <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />;
  return (
    <>
      <WeeklyEditor doctorId={doctorId} initial={schedule.data.blocks} onSaved={onSaved} />
      <ExceptionsEditor doctorId={doctorId} schedule={schedule.data} onSaved={onSaved} />
    </>
  );
}

function WeeklyEditor({
  doctorId,
  initial,
  onSaved,
}: {
  doctorId: string;
  initial: ScheduleBlockInput[];
  onSaved: (d: DoctorSchedule) => void;
}) {
  const [blocks, setBlocks] = useState<ScheduleBlockInput[]>(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api<DoctorSchedule>(`/doctors/${doctorId}/schedule`, { method: 'PUT', body: { blocks } }),
    onSuccess: (d) => (onSaved(d), setSaved(true)),
  });
  const update = (index: number, patch: Partial<ScheduleBlockInput>) => {
    setSaved(false);
    setBlocks(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };
  const add = (dayOfWeek: number) => {
    setSaved(false);
    const last = blocks.filter((b) => b.dayOfWeek === dayOfWeek).at(-1);
    setBlocks([
      ...blocks,
      last
        ? {
            dayOfWeek,
            startTime: '13:00',
            endTime: '17:00',
            slotMinutes: last.slotMinutes,
            maxPatients: null,
          }
        : { dayOfWeek, startTime: '08:00', endTime: '12:00', slotMinutes: 15, maxPatients: null },
    ]);
  };
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{s.weekly}</CardTitle>
        <CardDescription>{s.weeklyHint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {WEEK_ORDER.map((day) => {
          const rows = blocks
            .map((b, index) => ({ b, index }))
            .filter(({ b }) => b.dayOfWeek === day);
          return (
            <div
              key={day}
              className="grid gap-2 border-b border-border pb-4 last:border-0 sm:grid-cols-[8rem_1fr]"
            >
              <p className="pt-2 text-sm font-medium">{t.weekdays[day]}</p>
              <div className="space-y-2">
                {rows.length === 0 && (
                  <p className="pt-2 text-sm text-muted-foreground">{s.noHours}</p>
                )}
                {rows.map(({ b, index }) => {
                  const err =
                    fieldErrors[`blocks.${index}.startTime`] ??
                    fieldErrors[`blocks.${index}.endTime`];
                  return (
                    <div key={index}>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs text-muted-foreground">
                          {s.from}
                          <Input
                            type="time"
                            className="w-32"
                            value={b.startTime}
                            onChange={(e) => update(index, { startTime: e.target.value })}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          {s.to}
                          <Input
                            type="time"
                            className="w-32"
                            value={b.endTime}
                            onChange={(e) => update(index, { endTime: e.target.value })}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          {s.slot}
                          <Input
                            type="number"
                            min={5}
                            max={120}
                            step={5}
                            className="w-24"
                            value={b.slotMinutes}
                            onChange={(e) => update(index, { slotMinutes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground" title={s.capHint}>
                          {s.cap}
                          <Input
                            type="number"
                            min={1}
                            className="w-24"
                            value={b.maxPatients ?? ''}
                            onChange={(e) =>
                              update(index, {
                                maxPatients: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={s.remove}
                          onClick={() => (
                            setSaved(false),
                            setBlocks(blocks.filter((_, i) => i !== index))
                          )}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
                    </div>
                  );
                })}
                <Button variant="ghost" size="sm" onClick={() => add(day)}>
                  <Plus />
                  {s.addBlock}
                </Button>
              </div>
            </div>
          );
        })}
        {save.isError && !Object.keys(fieldErrors).length && (
          <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
        )}
        {saved && <Alert variant="success">{s.saved}</Alert>}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}

function ExceptionsEditor({
  doctorId,
  schedule,
  onSaved,
}: {
  doctorId: string;
  schedule: DoctorSchedule;
  onSaved: (d: DoctorSchedule) => void;
}) {
  const blank: ScheduleExceptionInput = {
    date: todayManila(),
    isClosed: true,
    startTime: '08:00',
    endTime: '12:00',
    note: '',
  };
  const [draft, setDraft] = useState<ScheduleExceptionInput>(blank);
  const add = useMutation({
    mutationFn: () =>
      api<DoctorSchedule>(`/doctors/${doctorId}/exceptions`, { method: 'POST', body: draft }),
    onSuccess: (d) => (onSaved(d), setDraft(blank)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<DoctorSchedule>(`/doctors/${doctorId}/exceptions/${id}`, { method: 'DELETE' }),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{s.exceptions}</CardTitle>
        <CardDescription>{s.exceptionsHint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedule.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noExceptions}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {schedule.exceptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{dateLabel(e.date, 'long')}</span>
                  <span className="ml-2 text-muted-foreground">
                    {e.isClosed ? s.closed : `${e.startTime}–${e.endTime}`}
                    {e.note && ` · ${e.note}`}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={s.remove}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(e.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3">
          <label className="text-xs text-muted-foreground">
            {s.date}
            <Input
              type="date"
              min={todayManila()}
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={draft.isClosed}
              onChange={(e) => setDraft({ ...draft, isClosed: e.target.checked })}
            />
            {s.closedAllDay}
          </label>
          {!draft.isClosed && (
            <>
              <label className="text-xs text-muted-foreground">
                {s.from}
                <Input
                  type="time"
                  value={draft.startTime ?? ''}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                {s.to}
                <Input
                  type="time"
                  value={draft.endTime ?? ''}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="min-w-40 flex-1 text-xs text-muted-foreground">
            {s.note}
            <Input
              value={draft.note ?? ''}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <Button disabled={add.isPending} onClick={() => add.mutate()}>
            <Plus />
            {s.addException}
          </Button>
        </div>
        {add.isError && (
          <Alert variant="destructive">{errorMessage(add.error, t.common.genericError)}</Alert>
        )}
      </CardContent>
    </Card>
  );
}
