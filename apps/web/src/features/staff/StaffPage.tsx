import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  ROLES,
  staffCreateSchema,
  type Staff,
  type StaffCreateInput,
  type StaffUpdateInput,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/auth/session';
import { t } from '@/i18n';
import { api, errorMessage } from '@/lib/api';

export function StaffPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: ['staff'], queryFn: () => api<Staff[]>('/staff') });
  const update = useMutation({
    mutationFn: ({ id, ...body }: StaffUpdateInput & { id: string }) =>
      api<Staff>(`/staff/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  return (
    <>
      <PageHeader
        title={t.staff.title}
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              {t.staff.new}
            </Button>
          )
        }
      />
      {adding && <AddStaffForm onDone={() => setAdding(false)} />}
      {update.isError && (
        <Alert variant="destructive" className="mb-4">
          {errorMessage(update.error, t.common.genericError)}
        </Alert>
      )}
      {query.isLoading ? (
        <TableSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t.staff.columns.name}</th>
                <th className="px-4 py-3 font-medium">{t.staff.columns.email}</th>
                <th className="px-4 py-3 font-medium">{t.staff.columns.roles}</th>
                <th className="px-4 py-3 font-medium">{t.staff.columns.status}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">{s.email}</td>
                  <td className="space-x-1 px-4 py-3">
                    {s.roles.map((r) => (
                      <Badge key={r}>{t.roles[r]}</Badge>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={s.isActive ? 'success' : 'muted'}>
                      {s.isActive ? t.staff.active : t.staff.inactive}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.id !== user?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: s.id, isActive: !s.isActive })}
                      >
                        {s.isActive ? t.staff.deactivate : t.staff.activate}
                      </Button>
                    )}
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

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<StaffCreateInput>({
    resolver: zodResolver(staffCreateSchema),
    defaultValues: { name: '', email: '', roles: ['secretary'], password: '' },
  });
  const create = useMutation({
    mutationFn: (body: StaffCreateInput) => api<Staff>('/staff', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      onDone();
    },
  });
  const { errors } = form.formState;
  const f = t.staff.fields;

  return (
    <Card className="mb-6 max-w-2xl">
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          noValidate
        >
          {create.isError && (
            <Alert variant="destructive">{errorMessage(create.error, t.common.genericError)}</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="name" label={f.name} error={errors.name?.message}>
              <Input id="name" autoFocus {...form.register('name')} />
            </FormField>
            <FormField id="email" label={f.email} error={errors.email?.message}>
              <Input id="email" type="email" {...form.register('email')} />
            </FormField>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{f.roles}</legend>
            <div className="flex gap-4 text-sm">
              {ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    value={role}
                    className="size-4"
                    {...form.register('roles')}
                  />
                  {t.roles[role]}
                </label>
              ))}
            </div>
            {errors.roles && <p className="text-xs text-destructive">{errors.roles.message}</p>}
          </fieldset>
          <FormField
            id="password"
            label={f.password}
            error={errors.password?.message}
            hint={t.staff.passwordHint}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t.common.saving : t.common.save}
            </Button>
            <Button type="button" variant="outline" onClick={onDone}>
              {t.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
