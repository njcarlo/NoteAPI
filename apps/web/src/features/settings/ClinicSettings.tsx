import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  clinicProfileInputSchema,
  type ClinicProfile,
  type ClinicProfileInput,
  type ImageUpload as ImageBody,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { ImageUpload } from '@/components/ImageUpload';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';

const c = t.clinicSettings;

export function ClinicSettings() {
  const profile = useQuery({ queryKey: ['clinic'], queryFn: () => api<ClinicProfile>('/clinic') });
  if (profile.isLoading) return <TableSkeleton rows={5} />;
  if (profile.isError || !profile.data)
    return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  return <ClinicForm profile={profile.data} />;
}

function ClinicForm({ profile }: { profile: ClinicProfile }) {
  const queryClient = useQueryClient();
  const onSaved = (data: ClinicProfile) => queryClient.setQueryData(['clinic'], data);
  const form = useForm<ClinicProfileInput, unknown, z.output<typeof clinicProfileInputSchema>>({
    resolver: zodResolver(clinicProfileInputSchema),
    defaultValues: {
      name: profile.name,
      address: profile.address ?? '',
      contactNumber: profile.contactNumber ?? '',
      email: profile.email ?? '',
      smsSenderName: profile.smsSenderName ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (body: z.output<typeof clinicProfileInputSchema>) =>
      api<ClinicProfile>('/clinic', { method: 'PUT', body }),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.fieldErrors))
          form.setError(path as keyof ClinicProfileInput, { message });
      }
    },
  });
  const logo = useMutation({
    mutationFn: (body: ImageBody | null) =>
      body
        ? api<ClinicProfile>('/clinic/logo', { method: 'PUT', body })
        : api<ClinicProfile>('/clinic/logo', { method: 'DELETE' }),
    onSuccess: onSaved,
  });
  const { errors } = form.formState;
  const bookingUrl = `${window.location.origin}/c/${profile.slug}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{c.title}</CardTitle>
        <CardDescription>{c.hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{c.logo}</p>
          <ImageUpload
            hasImage={profile.hasLogo}
            previewUrl={`/api/public/clinics/${profile.slug}/logo?v=${logo.submittedAt}`}
            disabled={logo.isPending}
            onUpload={(body) => logo.mutate(body)}
            onRemove={() => logo.mutate(null)}
          />
          <p className="text-xs text-muted-foreground">{c.logoHint}</p>
          {logo.isError && (
            <Alert variant="destructive">{errorMessage(logo.error, t.common.genericError)}</Alert>
          )}
        </div>
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="clinic-name" label={c.name} error={errors.name?.message}>
              <Input id="clinic-name" {...form.register('name')} />
            </FormField>
            <FormField
              id="clinic-contact"
              label={c.contactNumber}
              error={errors.contactNumber?.message}
            >
              <Input id="clinic-contact" type="tel" {...form.register('contactNumber')} />
            </FormField>
          </div>
          <FormField id="clinic-address" label={c.address} error={errors.address?.message}>
            <Input id="clinic-address" {...form.register('address')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="clinic-email"
              label={c.email}
              hint={c.emailHint}
              error={errors.email?.message}
            >
              <Input id="clinic-email" type="email" {...form.register('email')} />
            </FormField>
            <FormField
              id="clinic-sender"
              label={c.smsSenderName}
              hint={c.smsSenderHint}
              error={errors.smsSenderName?.message}
            >
              <Input id="clinic-sender" maxLength={11} {...form.register('smsSenderName')} />
            </FormField>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">{c.bookingLink}: </span>
            <a
              className="text-primary hover:underline"
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
            >
              {bookingUrl}
            </a>
          </p>
          {save.isSuccess && <Alert variant="success">{c.saved}</Alert>}
          {save.isError && !(save.error instanceof ApiError && save.error.details) && (
            <Alert variant="destructive">{errorMessage(save.error, t.common.genericError)}</Alert>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t.common.saving : t.common.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
