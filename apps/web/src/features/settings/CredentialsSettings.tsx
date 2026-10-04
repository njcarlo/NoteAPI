import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  doctorProfileInputSchema,
  type DoctorProfile,
  type DoctorProfileInput,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useDoctors } from '@/features/calendar/api';
import { t } from '@/i18n';
import { api, errorMessage } from '@/lib/api';

const c = t.credentials;

export function CredentialsSettings() {
  const doctors = useDoctors();
  const [picked, setPicked] = useState<string | null>(null);
  const doctorId = picked ?? doctors.data?.[0]?.id ?? null;
  const profile = useQuery({
    queryKey: ['doctor-profile', doctorId],
    queryFn: () => api<DoctorProfile>(`/doctors/${doctorId}/profile`),
    enabled: Boolean(doctorId),
  });

  if (doctors.isLoading) return <TableSkeleton rows={3} />;
  if (!doctors.data?.length || !doctorId) return <EmptyState title={t.calendar.noDoctors} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{c.title}</CardTitle>
        <CardDescription>{c.hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {doctors.data.length > 1 && (
          <Select
            className="max-w-xs"
            aria-label={t.settings.doctor}
            value={doctorId}
            onChange={(e) => setPicked(e.target.value)}
          >
            {doctors.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
        {profile.isLoading ? (
          <TableSkeleton rows={2} />
        ) : profile.isError || !profile.data ? (
          <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        ) : (
          <CredentialsForm key={doctorId} doctorId={doctorId} profile={profile.data} />
        )}
      </CardContent>
    </Card>
  );
}

function CredentialsForm({ doctorId, profile }: { doctorId: string; profile: DoctorProfile }) {
  const queryClient = useQueryClient();
  const form = useForm<DoctorProfileInput, unknown, z.output<typeof doctorProfileInputSchema>>({
    resolver: zodResolver(doctorProfileInputSchema),
    defaultValues: {
      specialty: profile.specialty ?? '',
      prcNo: profile.prcNo,
      ptrNo: profile.ptrNo ?? '',
      s2No: profile.s2No ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (body: z.output<typeof doctorProfileInputSchema>) =>
      api<DoctorProfile>(`/doctors/${doctorId}/profile`, { method: 'PUT', body }),
    onSuccess: (data) => queryClient.setQueryData(['doctor-profile', doctorId], data),
  });
  const { errors } = form.formState;
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="specialty" label={c.specialty}>
          <Input id="specialty" {...form.register('specialty')} />
        </FormField>
        <FormField id="prcNo" label={c.prcNo} error={errors.prcNo?.message}>
          <Input
            id="prcNo"
            inputMode="numeric"
            aria-invalid={!!errors.prcNo}
            {...form.register('prcNo')}
          />
        </FormField>
        <FormField id="ptrNo" label={c.ptrNo}>
          <Input id="ptrNo" {...form.register('ptrNo')} />
        </FormField>
        <FormField id="s2No" label={c.s2No}>
          <Input id="s2No" {...form.register('s2No')} />
        </FormField>
      </div>
      {save.isSuccess && <Alert variant="success">{c.saved}</Alert>}
      {save.isError && (
        <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
      )}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? t.common.saving : t.common.save}
      </Button>
    </form>
  );
}
