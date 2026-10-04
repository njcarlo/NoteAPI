import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import type { Vitals } from '@clinic/shared';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

/** Number fields that turn an empty input into null instead of NaN. */
const asNumber = {
  setValueAs: (v: string | number | null) => (v === '' || v == null ? null : Number(v)),
};

type Prefix = '' | 'vitals.';

export function VitalsFields<F extends Record<string, unknown>>({
  register,
  errors,
  prefix,
}: {
  register: UseFormRegister<F>;
  errors: FieldErrors<Vitals> | undefined;
  prefix: Prefix;
}) {
  const v = t.vitals;
  const reg = (name: keyof Vitals) =>
    register(`${prefix}${name}` as Parameters<UseFormRegister<F>>[0], asNumber);
  const field = (name: keyof Vitals, label: string, step = '1') => (
    <label className="text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        aria-invalid={!!errors?.[name]}
        {...reg(name)}
      />
      {errors?.[name] && (
        <span className="mt-1 block text-destructive">{errors[name]?.message}</span>
      )}
    </label>
  );

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">{v.title}</legend>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-muted-foreground">
          {v.bp}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              placeholder={v.systolic}
              aria-label={v.systolic}
              {...reg('bpSystolic')}
            />
            <span className="text-muted-foreground">/</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={v.diastolic}
              aria-label={v.diastolic}
              {...reg('bpDiastolic')}
            />
          </div>
          {(errors?.bpSystolic || errors?.bpDiastolic) && (
            <span className="mt-1 block text-destructive">
              {(errors.bpSystolic ?? errors.bpDiastolic)?.message}
            </span>
          )}
        </label>
        {field('temperatureC', v.temperatureC, '0.1')}
        {field('heartRate', v.heartRate)}
        {field('respiratoryRate', v.respiratoryRate)}
        {field('o2Sat', v.o2Sat)}
        {field('weightKg', v.weightKg, '0.1')}
        {field('heightCm', v.heightCm, '0.1')}
      </div>
    </fieldset>
  );
}
