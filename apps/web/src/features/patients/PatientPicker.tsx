import { zodResolver } from '@hookform/resolvers/zod';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  patientInputSchema,
  type Patient,
  type PatientData,
  type PatientInput,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api';
import { phone } from '@/lib/format';
import { usePatients, useSavePatient } from './api';

export function PatientPicker({
  onPick,
  onNew,
}: {
  onPick: (p: Patient) => void;
  onNew: () => void;
}) {
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

export function QuickPatientForm({
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
