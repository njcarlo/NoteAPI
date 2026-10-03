import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  ROLES,
  staffCreateSchema,
  type Role,
  type Staff,
  type StaffCreateInput,
  type StaffCreateResponse,
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
import { api, ApiError, errorMessage } from '@/lib/api';

const isSecretaryOnly = (roles: Role[]) => roles.includes('secretary') && !roles.includes('doctor');

function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: StaffUpdateInput & { id: string }) =>
      api<Staff>(`/staff/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function StaffPage() {
  const { user } = useSession();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['staff'], queryFn: () => api<Staff[]>('/staff') });
  const update = useUpdateStaff();
  const doctors = (query.data ?? []).filter((s) => s.isActive && s.roles.includes('doctor'));
  const doctorName = (id: string) => query.data?.find((s) => s.id === id)?.name ?? '';

  return (
    <>
      <PageHeader
        title={t.staff.title}
        actions={
          !adding && (
            <Button
              onClick={() => {
                setNotice(null);
                setAdding(true);
              }}
            >
              <Plus />
              {t.staff.new}
            </Button>
          )
        }
      />
      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {adding && (
        <AddStaffForm
          onDone={(created) => {
            setAdding(false);
            if (created?.linkedExistingAccount) setNotice(t.staff.linked(created.name));
          }}
        />
      )}
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
                <th className="px-4 py-3 font-medium">{t.staff.columns.roles}</th>
                <th className="px-4 py-3 font-medium">{t.staff.fields.doctors}</th>
                <th className="px-4 py-3 font-medium">{t.staff.columns.status}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.email}</span>
                    </td>
                    <td className="space-x-1 px-4 py-3">
                      {s.roles.map((r) => (
                        <Badge key={r}>{t.roles[r]}</Badge>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isSecretaryOnly(s.roles)
                        ? s.doctorIds.length
                          ? s.doctorIds.map(doctorName).join(', ')
                          : t.staff.allDoctors
                        : t.common.none}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={s.isActive ? 'success' : 'muted'}>
                        {s.isActive ? t.staff.active : t.staff.inactive}
                      </Badge>
                    </td>
                    <td className="space-x-2 px-4 py-3 text-right whitespace-nowrap">
                      {s.id !== user?.id && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t.common.edit} ${s.name}`}
                            onClick={() => setEditing(editing === s.id ? null : s.id)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: s.id, isActive: !s.isActive })}
                          >
                            {s.isActive ? t.staff.deactivate : t.staff.activate}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editing === s.id && (
                    <tr className="border-b border-border bg-muted/30">
                      <td colSpan={5} className="px-4 py-4">
                        <EditStaff staff={s} doctors={doctors} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function EditStaff({
  staff,
  doctors,
  onDone,
}: {
  staff: Staff;
  doctors: Staff[];
  onDone: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>(staff.roles);
  const [doctorIds, setDoctorIds] = useState<string[]>(staff.doctorIds);
  const update = useUpdateStaff();
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="space-y-4">
      {update.isError && (
        <Alert variant="destructive">{errorMessage(update.error, t.common.genericError)}</Alert>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t.staff.fields.roles}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={roles.includes(role)}
                onChange={() => setRoles(toggle(roles, role))}
              />
              {t.roles[role]}
            </label>
          ))}
        </div>
      </fieldset>
      {isSecretaryOnly(roles) && doctors.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t.staff.fields.doctors}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {doctors.map((d) => (
              <label key={d.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={doctorIds.includes(d.id)}
                  onChange={() => setDoctorIds(toggle(doctorIds, d.id))}
                />
                {d.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t.staff.doctorsHint}</p>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!roles.length || update.isPending}
          onClick={() =>
            update.mutate(
              { id: staff.id, roles, ...(isSecretaryOnly(roles) ? { doctorIds } : {}) },
              { onSuccess: onDone },
            )
          }
        >
          {update.isPending ? t.common.saving : t.common.save}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

function AddStaffForm({ onDone }: { onDone: (created?: StaffCreateResponse) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<StaffCreateInput>({
    resolver: zodResolver(staffCreateSchema),
    defaultValues: { name: '', email: '', roles: ['secretary'], password: '' },
  });
  const create = useMutation({
    mutationFn: (body: StaffCreateInput) =>
      api<StaffCreateResponse>('/staff', { method: 'POST', body }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      onDone(created);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof StaffCreateInput, { message });
        }
      }
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
          {create.isError && !(create.error instanceof ApiError && create.error.details) && (
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
            <Button type="button" variant="outline" onClick={() => onDone()}>
              {t.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
