import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FACILITY_KINDS, facilityInputSchema, type FacilityInput } from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { ErrorState, TableSkeleton } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useFacilities, useFacilityActions } from '@/features/labs/api';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { phone } from '@/lib/format';

const f = t.facilities;

export function FacilitiesSettings() {
  const facilities = useFacilities(true);
  const { create, update } = useFacilityActions();
  const form = useForm<FacilityInput, unknown, z.output<typeof facilityInputSchema>>({
    resolver: zodResolver(facilityInputSchema),
    defaultValues: { name: '', kind: 'laboratory', address: '', contactNumber: '' },
  });
  const { errors } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{f.title}</CardTitle>
        <CardDescription>{f.hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {facilities.isLoading ? (
          <TableSkeleton rows={3} />
        ) : facilities.isError ? (
          <ErrorState error={facilities.error} onRetry={() => facilities.refetch()} />
        ) : !facilities.data?.length ? (
          <p className="text-sm text-muted-foreground">{f.none}</p>
        ) : (
          <ul className="divide-y divide-border">
            {facilities.data.map((facility) => (
              <li key={facility.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {facility.name}{' '}
                    {!facility.isActive && <Badge variant="muted">{f.inactive}</Badge>}
                  </p>
                  <p className="text-muted-foreground">
                    {[
                      f.kinds[facility.kind],
                      facility.address,
                      facility.contactNumber && phone(facility.contactNumber),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: facility.id, isActive: !facility.isActive })}
                >
                  {facility.isActive ? f.deactivate : f.activate}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-4 border-t border-border pt-4"
          noValidate
          onSubmit={form.handleSubmit((values) =>
            create.mutate(values, { onSuccess: () => form.reset() }),
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="facility-name" label={f.name} error={errors.name?.message}>
              <Input id="facility-name" aria-invalid={!!errors.name} {...form.register('name')} />
            </FormField>
            <FormField id="facility-kind" label={f.kind}>
              <Select id="facility-kind" {...form.register('kind')}>
                {FACILITY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {f.kinds[kind]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="facility-address" label={f.address}>
              <Input id="facility-address" {...form.register('address')} />
            </FormField>
            <FormField id="facility-contact" label={f.contactNumber}>
              <Input id="facility-contact" {...form.register('contactNumber')} />
            </FormField>
          </div>
          {(create.isError || update.isError) && (
            <Alert variant="destructive">
              {errorMessage(create.error ?? update.error, t.common.genericError)}
            </Alert>
          )}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t.common.saving : f.add}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
