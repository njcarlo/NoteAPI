import { zodResolver } from '@hookform/resolvers/zod';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import {
  CLINIC_TIMEZONE,
  patientInputSchema,
  utcToZoned,
  type Appointment,
  type Doctor,
  type Patient,
  type PatientData,
  type PatientInput,
  type SlotDto,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePatients, useSavePatient } from '@/features/patients/api';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { dateLabel, manilaDateTime, manilaTime, phone, todayManila } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppointmentAction, useCreateAppointment, useSlots } from './api';

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="w-full shrink-0 p-5 xl:sticky xl:top-4 xl:w-96">
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-2 -mr-2"
          aria-label={t.calendar.close}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {children}
    </Card>
  );
}

export function BookPanel({
  doctor,
  slot,
  onClose,
  onBooked,
}: {
  doctor: Doctor | undefined;
  slot: SlotDto;
  onClose: () => void;
  onBooked: (a: Appointment) => void;
}) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState('');
  const create = useCreateAppointment();

  return (
    <Panel title={t.calendar.newAppointment} onClose={onClose}>
      <p className="mb-4 text-sm">
        <span className="font-medium">{manilaDateTime(slot.startAt)}</span>
        <br />
        <span className="text-muted-foreground">{doctor?.name}</span>
      </p>
      <div className="space-y-4">
        {patient ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span>
              <span className="block font-medium">
                {patient.lastName}, {patient.firstName}
              </span>
              <span className="text-muted-foreground">{phone(patient.mobile)}</span>
            </span>
            <Button variant="link" size="sm" onClick={() => setPatient(null)}>
              {t.booking.change}
            </Button>
          </div>
        ) : creating ? (
          <QuickPatientForm
            onCreated={(p) => (setPatient(p), setCreating(false))}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <PatientPicker onPick={setPatient} onNew={() => setCreating(true)} />
        )}
        {patient && (
          <>
            <FormField id="reason" label={t.calendar.reason}>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {create.isError && (
              <Alert variant="destructive">
                {errorMessage(create.error, t.common.genericError)}
              </Alert>
            )}
            <Button
              className="w-full"
              disabled={create.isPending || !doctor}
              onClick={() =>
                doctor &&
                create.mutate(
                  { doctorId: doctor.id, patientId: patient.id, startAt: slot.startAt, reason },
                  { onSuccess: onBooked },
                )
              }
            >
              {create.isPending ? t.common.saving : t.calendar.bookButton}
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

function PatientPicker({ onPick, onNew }: { onPick: (p: Patient) => void; onNew: () => void }) {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const results = usePatients(q, 0);
  return (
    <div className="space-y-2">
      <FormField id="patient-search" label={t.calendar.patient}>
        <Input
          id="patient-search"
          autoFocus
          placeholder={t.calendar.searchPatient}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FormField>
      {q && (
        <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {results.data?.items.slice(0, 8).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="font-medium">
                {p.lastName}, {p.firstName}
              </span>
              <span className="ml-2 text-muted-foreground">{phone(p.mobile)}</span>
            </button>
          ))}
          {results.data && results.data.items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t.patients.noMatches}</p>
          )}
        </div>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={onNew}>
        {t.calendar.newPatient}
      </Button>
    </div>
  );
}

function QuickPatientForm({
  onCreated,
  onCancel,
}: {
  onCreated: (p: Patient) => void;
  onCancel: () => void;
}) {
  const save = useSavePatient();
  const form = useForm<PatientInput, unknown, PatientData>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      mobile: '',
      birthdate: null,
      smsOptIn: true,
      emailOptIn: true,
    },
  });
  const { errors } = form.formState;
  const f = t.patients.fields;
  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      noValidate
      onSubmit={form.handleSubmit((v) =>
        save.mutate(v, {
          onSuccess: onCreated,
          onError: (error) => {
            if (error instanceof ApiError) {
              for (const [path, message] of Object.entries(error.fieldErrors)) {
                form.setError(path as keyof PatientInput, { message });
              }
            }
          },
        }),
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="q-first" label={f.firstName} error={errors.firstName?.message}>
          <Input id="q-first" autoFocus {...form.register('firstName')} />
        </FormField>
        <FormField id="q-last" label={f.lastName} error={errors.lastName?.message}>
          <Input id="q-last" {...form.register('lastName')} />
        </FormField>
      </div>
      <FormField id="q-mobile" label={f.mobile} error={errors.mobile?.message}>
        <Input id="q-mobile" type="tel" {...form.register('mobile')} />
      </FormField>
      <FormField id="q-birthdate" label={f.birthdate}>
        <Input
          id="q-birthdate"
          type="date"
          {...form.register('birthdate', { setValueAs: (v: string) => v || null })}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

export function AppointmentPanel({
  appointment: a,
  onClose,
}: {
  appointment: Appointment;
  onClose: () => void;
}) {
  const action = useAppointmentAction();
  const [moving, setMoving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const booked = a.status === 'booked';
  const started = new Date(a.startAt) <= new Date();

  return (
    <Panel title={t.calendar.details} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Link
              to={`/patients/${a.patient.id}`}
              className="font-medium text-primary hover:underline"
            >
              {a.patient.lastName}, {a.patient.firstName}
            </Link>
            <p className="text-muted-foreground">{phone(a.patient.mobile)}</p>
          </div>
          <StatusBadge status={a.status} />
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5">
          <dt className="text-muted-foreground">{t.booking.when}</dt>
          <dd>{a.type === 'walk_in' ? t.calendar.walkIn : manilaDateTime(a.startAt)}</dd>
          <dt className="text-muted-foreground">{t.booking.doctor}</dt>
          <dd>{a.doctorName}</dd>
          <dt className="text-muted-foreground">{t.calendar.reference}</dt>
          <dd className="font-mono">{a.referenceCode}</dd>
          {a.reason && (
            <>
              <dt className="text-muted-foreground">{t.calendar.reason}</dt>
              <dd>{a.reason}</dd>
            </>
          )}
          <dt className="text-muted-foreground" />
          <dd className="text-xs text-muted-foreground">{t.calendar.source[a.source]}</dd>
        </dl>

        {action.isError && (
          <Alert variant="destructive">{errorMessage(action.error, t.common.genericError)}</Alert>
        )}

        {booked && moving && (
          <MovePicker
            appointment={a}
            disabled={action.isPending}
            onPick={(startAt) =>
              action.mutate(
                { kind: 'move', id: a.id, startAt },
                { onSuccess: () => setMoving(false) },
              )
            }
            onCancel={() => setMoving(false)}
          />
        )}

        {booked && !moving && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setMoving(true)}>
              {t.calendar.move}
            </Button>
            {started && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate({ kind: 'no-show', id: a.id })}
              >
                {t.calendar.markNoShow}
              </Button>
            )}
            <Button
              size="sm"
              variant={confirmCancel ? 'destructive' : 'outline'}
              disabled={action.isPending}
              onClick={() =>
                confirmCancel ? action.mutate({ kind: 'cancel', id: a.id }) : setConfirmCancel(true)
              }
            >
              {confirmCancel ? t.cancel.confirm : t.calendar.cancelAppointment}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function MovePicker({
  appointment,
  disabled,
  onPick,
  onCancel,
}: {
  appointment: Appointment;
  disabled: boolean;
  onPick: (startAt: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(utcToZoned(appointment.startAt, CLINIC_TIMEZONE).date);
  const slots = useSlots(appointment.doctorId, date);
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <FormField id="move-date" label={t.calendar.moveTo}>
        <Input
          id="move-date"
          type="date"
          min={todayManila()}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </FormField>
      <p className="text-xs text-muted-foreground">{dateLabel(date, 'long')}</p>
      <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
        {slots.data?.map((s) => (
          <button
            key={s.startAt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.startAt)}
            className={cn(
              'rounded-md border border-border py-1.5 text-sm tabular-nums hover:border-primary disabled:opacity-50',
            )}
          >
            {manilaTime(s.startAt)}
          </button>
        ))}
      </div>
      {slots.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.booking.noSlots}</p>
      )}
      <Button size="sm" variant="outline" onClick={onCancel}>
        {t.common.cancel}
      </Button>
    </div>
  );
}
