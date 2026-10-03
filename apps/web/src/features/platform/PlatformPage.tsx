import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import {
  platformClinicCreateSchema,
  type ClinicStatus,
  type PlatformClinic,
  type PlatformClinicCreateInput,
  type PlatformClinicCreateResponse,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { manilaDateTime } from '@/lib/format';

export function PlatformPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<PlatformClinicCreateResponse | null>(null);
  const query = useQuery({
    queryKey: ['platform', 'clinics'],
    queryFn: () => api<PlatformClinic[]>('/platform/clinics'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClinicStatus }) =>
      api<PlatformClinic>(`/platform/clinics/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'clinics'] }),
  });
  const p = t.platform;

  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={p.subtitle}
        actions={
          !adding && (
            <Button
              onClick={() => {
                setCreated(null);
                setAdding(true);
              }}
            >
              <Plus />
              {p.new}
            </Button>
          )
        }
      />
      {created && (
        <Alert variant="success" className="mb-4 space-y-1">
          <p className="font-medium">{p.createdTitle(created.clinic.name)}</p>
          <p>
            {created.temporaryPassword
              ? p.createdWithPassword(created.adminEmail, created.temporaryPassword)
              : p.createdLinked(created.adminEmail)}
          </p>
        </Alert>
      )}
      {adding && (
        <NewClinicForm
          onCancel={() => setAdding(false)}
          onCreated={(res) => {
            setCreated(res);
            setAdding(false);
          }}
        />
      )}
      {setStatus.isError && (
        <Alert variant="destructive" className="mb-4">
          {errorMessage(setStatus.error, t.common.genericError)}
        </Alert>
      )}
      {query.isLoading ? (
        <TableSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState icon={Building2} title={p.empty} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{p.columns.clinic}</th>
                <th className="px-4 py-3 text-right font-medium">{p.columns.doctors}</th>
                <th className="px-4 py-3 text-right font-medium">{p.columns.staff}</th>
                <th className="px-4 py-3 text-right font-medium">{p.columns.patients}</th>
                <th className="px-4 py-3 font-medium">{p.columns.created}</th>
                <th className="px-4 py-3 font-medium">{p.columns.status}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {query.data.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <span className="block font-medium">{c.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">/c/{c.slug}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.doctorCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.staffCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.patientCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{manilaDateTime(c.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status === 'active' ? 'success' : 'destructive'}>
                      {p.status[c.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({
                          id: c.id,
                          status: c.status === 'active' ? 'suspended' : 'active',
                        })
                      }
                    >
                      {c.status === 'active' ? p.suspend : p.reactivate}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function NewClinicForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (res: PlatformClinicCreateResponse) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<
    PlatformClinicCreateInput,
    unknown,
    z.output<typeof platformClinicCreateSchema>
  >({
    resolver: zodResolver(platformClinicCreateSchema),
    defaultValues: {
      name: '',
      slug: '',
      adminName: '',
      adminEmail: '',
      adminIsDoctor: true,
      prcNo: '',
    },
  });
  const create = useMutation({
    mutationFn: (body: z.output<typeof platformClinicCreateSchema>) =>
      api<PlatformClinicCreateResponse>('/platform/clinics', { method: 'POST', body }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'clinics'] });
      onCreated(res);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof PlatformClinicCreateInput, { message });
        }
      }
    },
  });
  const { errors } = form.formState;
  const f = t.platform.fields;
  const isDoctor = useWatch({ control: form.control, name: 'adminIsDoctor' });

  return (
    <Card className="mb-6 max-w-2xl">
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          noValidate
        >
          {create.isError && !(create.error instanceof ApiError && create.error.details) && (
            <Alert variant="destructive">{errorMessage(create.error, t.common.genericError)}</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="name" label={f.name} error={errors.name?.message}>
              <Input
                id="name"
                autoFocus
                {...form.register('name', {
                  onChange: (e: { target: { value: string } }) => {
                    if (!form.formState.dirtyFields.slug) {
                      form.setValue(
                        'slug',
                        e.target.value
                          .toLowerCase()
                          .normalize('NFD')
                          .replace(/[̀-ͯ]/g, '')
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-|-$/g, ''),
                      );
                    }
                  },
                })}
              />
            </FormField>
            <FormField id="slug" label={f.slug} error={errors.slug?.message} hint={f.slugHint}>
              <Input id="slug" {...form.register('slug')} />
            </FormField>
            <FormField id="adminName" label={f.adminName} error={errors.adminName?.message}>
              <Input id="adminName" {...form.register('adminName')} />
            </FormField>
            <FormField
              id="adminEmail"
              label={f.adminEmail}
              error={errors.adminEmail?.message}
              hint={f.adminEmailHint}
            >
              <Input id="adminEmail" type="email" {...form.register('adminEmail')} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" {...form.register('adminIsDoctor')} />
            {f.adminIsDoctor}
          </label>
          {isDoctor && (
            <FormField id="prcNo" label={f.prcNo} error={errors.prcNo?.message}>
              <Input id="prcNo" className="max-w-xs" {...form.register('prcNo')} />
            </FormField>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t.common.saving : t.platform.create}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
