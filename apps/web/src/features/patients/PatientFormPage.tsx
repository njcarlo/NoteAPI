import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { patientInputSchema, SEXES, type PatientData, type PatientInput } from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { t } from '@/i18n';
import { ApiError, errorMessage } from '@/lib/api';
import { phone } from '@/lib/format';
import { usePatient, useSavePatient } from './api';

const blank: PatientInput = {
  firstName: '',
  middleName: '',
  lastName: '',
  birthdate: null,
  sex: null,
  mobile: '',
  email: '',
  address: '',
  allergies: '',
  conditions: '',
  smsOptIn: true,
  emailOptIn: true,
};

export function PatientFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = usePatient(id);
  const save = useSavePatient(id);
  const form = useForm<PatientInput, unknown, PatientData>({
    resolver: zodResolver(patientInputSchema),
    defaultValues: blank,
  });

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    form.reset({
      ...p,
      middleName: p.middleName ?? '',
      email: p.email ?? '',
      address: p.address ?? '',
      allergies: p.allergies ?? '',
      conditions: p.conditions ?? '',
      mobile: phone(p.mobile).replace(/\s/g, ''),
    });
  }, [existing.data, form]);

  if (id && existing.isLoading) return <TableSkeleton rows={8} />;
  if (id && existing.isError)
    return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;

  const { errors } = form.formState;
  const f = t.patients.fields;

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (patient) => navigate(`/patients/${patient.id}`, { replace: true }),
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [path, message] of Object.entries(error.fieldErrors)) {
            form.setError(path as keyof PatientInput, { message });
          }
        }
      },
    }),
  );

  const text = (name: keyof PatientInput, label: string, props: Record<string, unknown> = {}) => (
    <FormField id={name} label={label} error={errors[name]?.message}>
      <Input id={name} aria-invalid={!!errors[name]} {...props} {...form.register(name)} />
    </FormField>
  );

  return (
    <>
      <PageHeader title={id ? t.common.edit : t.patients.new} />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <form className="space-y-6" onSubmit={onSubmit} noValidate>
            {save.isError && !(save.error instanceof ApiError && save.error.details) && (
              <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              {text('firstName', f.firstName, { autoFocus: true })}
              {text('middleName', f.middleName)}
              {text('lastName', f.lastName)}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="birthdate" label={f.birthdate} error={errors.birthdate?.message}>
                <Input
                  id="birthdate"
                  type="date"
                  {...form.register('birthdate', { setValueAs: (v: string) => v || null })}
                />
              </FormField>
              <FormField id="sex" label={f.sex}>
                <Select
                  id="sex"
                  {...form.register('sex', { setValueAs: (v: string) => v || null })}
                >
                  <option value="">{t.patients.sex.unset}</option>
                  {SEXES.map((s) => (
                    <option key={s} value={s}>
                      {t.patients.sex[s]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                id="mobile"
                label={f.mobile}
                error={errors.mobile?.message}
                hint={t.patients.mobileHint}
              >
                <Input
                  id="mobile"
                  type="tel"
                  inputMode="tel"
                  aria-invalid={!!errors.mobile}
                  {...form.register('mobile')}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {text('email', f.email, { type: 'email' })}
              {text('address', f.address)}
            </div>
            <FormField id="allergies" label={f.allergies} error={errors.allergies?.message}>
              <Textarea id="allergies" rows={2} {...form.register('allergies')} />
            </FormField>
            <FormField id="conditions" label={f.conditions} error={errors.conditions?.message}>
              <Textarea id="conditions" rows={2} {...form.register('conditions')} />
            </FormField>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4" {...form.register('smsOptIn')} />
                {f.smsOptIn}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4" {...form.register('emailOptIn')} />
                {f.emailOptIn}
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? t.common.saving : t.common.save}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
