import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  checkInSchema,
  SEXES,
  vitalsSchema,
  walkInSchema,
  type Appointment,
  type CheckInInput,
  type Patient,
  type QueueItem,
  type Vitals,
  type WalkInInput,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel } from '@/features/calendar/panels';
import { useDoctors } from '@/features/calendar/api';
import { usePatient } from '@/features/patients/api';
import { PatientPicker, QuickPatientForm } from '@/features/patients/PatientPicker';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { ageFrom, manilaTime, phone } from '@/lib/format';
import { useCheckIn, useSaveVitals, useWalkIn } from './api';
import { VitalsFields } from './VitalsFields';

type CheckInData = z.output<typeof checkInSchema>;

function applyFieldErrors(error: unknown, setError: (path: never, e: { message: string }) => void) {
  if (!(error instanceof ApiError)) return;
  for (const [path, message] of Object.entries(error.fieldErrors))
    setError(path as never, { message });
}

/** Birthdate/sex when missing, plus allergies and conditions (always confirmable at the desk). */
function ProfileFields({
  patient,
  register,
}: {
  patient: Patient;
  register: ReturnType<typeof useForm<CheckInInput, unknown, CheckInData>>['register'];
}) {
  const f = t.patients.fields;
  const missing = !patient.birthdate || !patient.sex;
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-medium">{t.today.completeProfile}</legend>
      {missing && <p className="text-xs text-muted-foreground">{t.today.profileHint}</p>}
      <div className="grid grid-cols-2 gap-3">
        {!patient.birthdate && (
          <FormField id="ci-birthdate" label={f.birthdate}>
            <Input
              id="ci-birthdate"
              type="date"
              {...register('patient.birthdate', { setValueAs: (v: string) => v || undefined })}
            />
          </FormField>
        )}
        {!patient.sex && (
          <FormField id="ci-sex" label={f.sex}>
            <Select
              id="ci-sex"
              {...register('patient.sex', { setValueAs: (v: string) => v || undefined })}
            >
              <option value="">{t.patients.sex.unset}</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>
                  {t.patients.sex[s]}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>
      <FormField id="ci-allergies" label={f.allergies}>
        <Textarea id="ci-allergies" rows={2} {...register('patient.allergies')} />
      </FormField>
      <FormField id="ci-conditions" label={f.conditions}>
        <Textarea id="ci-conditions" rows={2} {...register('patient.conditions')} />
      </FormField>
    </fieldset>
  );
}

export function CheckInPanel({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: (a: Appointment) => void;
}) {
  const patient = usePatient(appointment.patient.id);
  return (
    <Panel title={t.today.checkInTitle} onClose={onClose}>
      <p className="mb-4 text-sm">
        <span className="block font-medium">
          {appointment.patient.lastName}, {appointment.patient.firstName}
        </span>
        <span className="text-muted-foreground">
          {manilaTime(appointment.startAt)} · {appointment.doctorName}
        </span>
      </p>
      {patient.isLoading || !patient.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <CheckInForm
          key={patient.data.id}
          appointment={appointment}
          patient={patient.data}
          onDone={onDone}
        />
      )}
    </Panel>
  );
}

function CheckInForm({
  appointment,
  patient,
  onDone,
}: {
  appointment: Appointment;
  patient: Patient;
  onDone: (a: Appointment) => void;
}) {
  const checkIn = useCheckIn();
  const form = useForm<CheckInInput, unknown, CheckInData>({
    resolver: zodResolver(checkInSchema),
    defaultValues: {
      patient: { allergies: patient.allergies ?? '', conditions: patient.conditions ?? '' },
      vitals: {},
    },
  });
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={form.handleSubmit((body) =>
        checkIn.mutate(
          { id: appointment.id, ...body },
          { onSuccess: onDone, onError: (e) => applyFieldErrors(e, form.setError) },
        ),
      )}
    >
      <ProfileFields patient={patient} register={form.register} />
      <VitalsFields
        register={form.register}
        errors={form.formState.errors.vitals}
        prefix="vitals."
      />
      {checkIn.isError && !(checkIn.error instanceof ApiError && checkIn.error.details) && (
        <Alert variant="destructive">{errorMessage(checkIn.error, t.common.genericError)}</Alert>
      )}
      <Button type="submit" className="w-full" disabled={checkIn.isPending}>
        {checkIn.isPending ? t.common.saving : t.today.submitCheckIn}
      </Button>
    </form>
  );
}

type WalkInData = z.output<typeof walkInSchema>;

export function WalkInPanel({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (a: Appointment) => void;
}) {
  const doctors = useDoctors();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Panel title={t.today.walkInTitle} onClose={onClose}>
      {patient ? (
        <div className="space-y-4">
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
          {doctors.data && (
            <WalkInForm key={patient.id} patient={patient} doctors={doctors.data} onDone={onDone} />
          )}
        </div>
      ) : creating ? (
        <QuickPatientForm
          onCreated={(p) => (setPatient(p), setCreating(false))}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <PatientPicker onPick={setPatient} onNew={() => setCreating(true)} />
      )}
    </Panel>
  );
}

function WalkInForm({
  patient,
  doctors,
  onDone,
}: {
  patient: Patient;
  doctors: { id: string; name: string }[];
  onDone: (a: Appointment) => void;
}) {
  const walkIn = useWalkIn();
  const form = useForm<WalkInInput, unknown, WalkInData>({
    resolver: zodResolver(walkInSchema),
    defaultValues: {
      patientId: patient.id,
      doctorId: doctors[0]?.id ?? '',
      reason: '',
      patient: { allergies: patient.allergies ?? '', conditions: patient.conditions ?? '' },
      vitals: {},
    },
  });
  const register = form.register as unknown as ReturnType<
    typeof useForm<CheckInInput, unknown, CheckInData>
  >['register'];
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={form.handleSubmit((body) =>
        walkIn.mutate(body, {
          onSuccess: onDone,
          onError: (e) => applyFieldErrors(e, form.setError),
        }),
      )}
    >
      {doctors.length > 1 && (
        <FormField id="wi-doctor" label={t.booking.doctor}>
          <Select id="wi-doctor" {...form.register('doctorId')}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField id="wi-reason" label={t.calendar.reason}>
        <Input id="wi-reason" {...form.register('reason')} />
      </FormField>
      <ProfileFields patient={patient} register={register} />
      <VitalsFields
        register={form.register}
        errors={form.formState.errors.vitals}
        prefix="vitals."
      />
      {walkIn.isError && !(walkIn.error instanceof ApiError && walkIn.error.details) && (
        <Alert variant="destructive">{errorMessage(walkIn.error, t.common.genericError)}</Alert>
      )}
      <Button type="submit" className="w-full" disabled={walkIn.isPending}>
        {walkIn.isPending ? t.common.saving : t.today.submitWalkIn}
      </Button>
    </form>
  );
}

export function VitalsPanel({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const save = useSaveVitals();
  const form = useForm<Vitals, unknown, Vitals>({
    resolver: zodResolver(vitalsSchema),
    defaultValues: item.vitals,
  });
  const age = ageFrom(item.patient.birthdate);
  return (
    <Panel title={t.vitals.edit} onClose={onClose}>
      <p className="mb-4 text-sm">
        <span className="block font-medium">
          {t.today.queueNumber(item.queueNumber ?? 0)} · {item.patient.lastName},{' '}
          {item.patient.firstName}
        </span>
        {age !== null && <span className="text-muted-foreground">{t.patients.years(age)}</span>}
      </p>
      <form
        className="space-y-4"
        noValidate
        onSubmit={form.handleSubmit((vitals) =>
          save.mutate(
            { id: item.appointmentId, vitals },
            { onSuccess: onClose, onError: (e) => applyFieldErrors(e, form.setError) },
          ),
        )}
      >
        <VitalsFields register={form.register} errors={form.formState.errors} prefix="" />
        {save.isError && !(save.error instanceof ApiError && save.error.details) && (
          <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
        )}
        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending ? t.common.saving : t.common.save}
        </Button>
      </form>
    </Panel>
  );
}
