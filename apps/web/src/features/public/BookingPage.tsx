import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import type { z } from 'zod';
import {
  addDays,
  formatPhMobile,
  publicBookingSchema,
  SEXES,
  type PublicBookingInput,
  type PublicBookingResult,
  type PublicClinic,
  type PublicDay,
  type SlotDto,
} from '@clinic/shared';
import { FormField } from '@/components/FormField';
import { EmptyState, ErrorState } from '@/components/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { api, ApiError, errorMessage } from '@/lib/api';
import { dateLabel, manilaTime, todayManila } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PublicLayout, Step } from './PublicLayout';

type BookingData = z.output<typeof publicBookingSchema>;

export function BookingPage() {
  const { slug = '' } = useParams();
  const clinic = useQuery({
    queryKey: ['public', slug],
    queryFn: () => api<PublicClinic>(`/public/clinics/${slug}`),
  });
  const [result, setResult] = useState<PublicBookingResult | null>(null);

  if (clinic.isLoading) {
    return (
      <PublicLayout>
        <Skeleton className="mb-3 h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </PublicLayout>
    );
  }
  if (clinic.isError || !clinic.data) {
    return (
      <PublicLayout>
        {clinic.error instanceof ApiError && clinic.error.status === 404 ? (
          <EmptyState title={t.booking.clinicNotFound} />
        ) : (
          <ErrorState error={clinic.error} onRetry={() => clinic.refetch()} />
        )}
      </PublicLayout>
    );
  }

  const c = clinic.data;
  return (
    <PublicLayout>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {c.address && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              {c.address}
            </p>
          )}
          {c.contactNumber && (
            <p className="flex items-center gap-2">
              <Phone className="size-4" />
              <a href={`tel:${c.contactNumber}`}>{formatPhMobile(c.contactNumber)}</a>
            </p>
          )}
        </div>
      </header>
      {result ? (
        <Confirmation result={result} onAgain={() => setResult(null)} />
      ) : c.doctors.length === 0 ? (
        <EmptyState title={t.booking.noDoctors} />
      ) : (
        <BookingFlow clinic={c} onBooked={setResult} />
      )}
    </PublicLayout>
  );
}

function BookingFlow({
  clinic,
  onBooked,
}: {
  clinic: PublicClinic;
  onBooked: (r: PublicBookingResult) => void;
}) {
  const queryClient = useQueryClient();
  const [doctorId, setDoctorId] = useState<string | null>(
    clinic.doctors.length === 1 ? clinic.doctors[0]!.id : null,
  );
  const [from, setFrom] = useState(todayManila());
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/public/clinics/${clinic.slug}`;
  const doctor = clinic.doctors.find((d) => d.id === doctorId);

  const days = useQuery({
    queryKey: ['public', clinic.slug, 'days', doctorId, from],
    queryFn: () => api<PublicDay[]>(`${base}/days?doctorId=${doctorId}&from=${from}`),
    enabled: Boolean(doctorId),
  });
  const slots = useQuery({
    queryKey: ['public', clinic.slug, 'slots', doctorId, date],
    queryFn: () => api<SlotDto[]>(`${base}/slots?doctorId=${doctorId}&date=${date}`),
    enabled: Boolean(doctorId && date),
  });

  const refreshAvailability = () =>
    queryClient.invalidateQueries({
      queryKey: ['public', clinic.slug],
      predicate: (q) => q.queryKey.length > 2,
    });

  return (
    <>
      {clinic.doctors.length > 1 && (
        <Step
          n={1}
          title={t.booking.chooseDoctor}
          action={
            doctor && (
              <Button
                variant="link"
                size="sm"
                onClick={() => (setDoctorId(null), setDate(null), setSlot(null))}
              >
                {t.booking.change}
              </Button>
            )
          }
        >
          <div className="grid gap-2">
            {(doctor ? [doctor] : clinic.doctors).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDoctorId(d.id)}
                className={cn(
                  'rounded-lg border bg-card px-4 py-3 text-left hover:border-primary',
                  d.id === doctorId ? 'border-primary ring-1 ring-primary' : 'border-border',
                )}
              >
                <span className="block font-medium">{d.name}</span>
                {d.specialty && (
                  <span className="text-sm text-muted-foreground">{d.specialty}</span>
                )}
              </button>
            ))}
          </div>
        </Step>
      )}

      {doctorId && (
        <Step n={clinic.doctors.length > 1 ? 2 : 1} title={t.booking.chooseDate}>
          {days.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : days.isError ? (
            <ErrorState error={days.error} onRetry={() => days.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {days.data?.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    disabled={d.available === 0}
                    onClick={() => (setDate(d.date), setSlot(null), setNotice(null))}
                    className={cn(
                      'rounded-md border px-1 py-2 text-center text-sm disabled:cursor-not-allowed disabled:opacity-40',
                      d.date === date
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:border-primary',
                    )}
                  >
                    <span className="block font-medium">{dateLabel(d.date)}</span>
                    <span className={cn('text-xs', d.date === date ? '' : 'text-muted-foreground')}>
                      {d.available ? t.booking.open(d.available) : t.booking.full}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={from <= todayManila()}
                  onClick={() => setFrom(addDays(from, -14))}
                >
                  <ChevronLeft />
                  {t.booking.earlier}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(days.data?.length ?? 0) < 14}
                  onClick={() => setFrom(addDays(from, 14))}
                >
                  {t.booking.later}
                  <ChevronRight />
                </Button>
              </div>
            </>
          )}
        </Step>
      )}

      {doctorId && date && (
        <Step
          n={clinic.doctors.length > 1 ? 3 : 2}
          title={`${t.booking.chooseTime} · ${dateLabel(date)}`}
        >
          {notice && (
            <Alert variant="destructive" className="mb-3">
              {notice}
            </Alert>
          )}
          {slots.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : slots.isError ? (
            <ErrorState error={slots.error} onRetry={() => slots.refetch()} />
          ) : !slots.data?.length ? (
            <p className="text-sm text-muted-foreground">{t.booking.noSlots}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.data.map((s) => (
                <button
                  key={s.startAt}
                  type="button"
                  onClick={() => setSlot(s)}
                  className={cn(
                    'rounded-md border py-2 text-sm font-medium tabular-nums',
                    s.startAt === slot?.startAt
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:border-primary',
                  )}
                >
                  {manilaTime(s.startAt)}
                </button>
              ))}
            </div>
          )}
        </Step>
      )}

      {doctorId && slot && (
        <Step n={clinic.doctors.length > 1 ? 4 : 3} title={t.booking.yourDetails}>
          <DetailsForm
            base={base}
            doctorId={doctorId}
            slot={slot}
            onBooked={onBooked}
            onSlotTaken={() => {
              setSlot(null);
              setNotice(t.booking.slotTaken);
              void refreshAvailability();
            }}
          />
        </Step>
      )}
    </>
  );
}

function DetailsForm({
  base,
  doctorId,
  slot,
  onBooked,
  onSlotTaken,
}: {
  base: string;
  doctorId: string;
  slot: SlotDto;
  onBooked: (r: PublicBookingResult) => void;
  onSlotTaken: () => void;
}) {
  const form = useForm<PublicBookingInput, unknown, BookingData>({
    resolver: zodResolver(publicBookingSchema),
    defaultValues: {
      doctorId,
      startAt: slot.startAt,
      firstName: '',
      lastName: '',
      mobile: '',
      email: '',
      reason: '',
      smsOptIn: true,
      website: '',
    },
  });
  useEffect(() => {
    form.setValue('doctorId', doctorId);
    form.setValue('startAt', slot.startAt);
  }, [form, doctorId, slot.startAt]);
  const book = useMutation({
    mutationFn: (body: BookingData) =>
      api<PublicBookingResult>(`${base}/bookings`, { method: 'POST', body }),
    onSuccess: onBooked,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) return onSlotTaken();
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof PublicBookingInput, { message });
        }
      }
    },
  });
  const { errors } = form.formState;
  const f = t.booking.fields;

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => book.mutate(v))} noValidate>
          {book.isError &&
            !(
              book.error instanceof ApiError &&
              (book.error.status === 409 || book.error.details)
            ) && (
              <Alert variant="destructive">{errorMessage(book.error, t.common.genericError)}</Alert>
            )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="firstName" label={f.firstName} error={errors.firstName?.message}>
              <Input
                id="firstName"
                autoComplete="given-name"
                aria-invalid={!!errors.firstName}
                {...form.register('firstName')}
              />
            </FormField>
            <FormField id="lastName" label={f.lastName} error={errors.lastName?.message}>
              <Input
                id="lastName"
                autoComplete="family-name"
                aria-invalid={!!errors.lastName}
                {...form.register('lastName')}
              />
            </FormField>
            <FormField id="birthdate" label={f.birthdate} error={errors.birthdate?.message}>
              <Input
                id="birthdate"
                type="date"
                autoComplete="bday"
                aria-invalid={!!errors.birthdate}
                {...form.register('birthdate')}
              />
            </FormField>
            <FormField id="sex" label={f.sex}>
              <Select id="sex" {...form.register('sex', { setValueAs: (v: string) => v || null })}>
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
                autoComplete="tel"
                aria-invalid={!!errors.mobile}
                {...form.register('mobile')}
              />
            </FormField>
            <FormField id="email" label={f.email} error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </FormField>
          </div>
          <FormField
            id="reason"
            label={f.reason}
            hint={f.reasonHint}
            error={errors.reason?.message}
          >
            <Input id="reason" {...form.register('reason')} />
          </FormField>
          {/* Honeypot: invisible to people, tempting to bots. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
            <label htmlFor="website">Website</label>
            <input id="website" tabIndex={-1} autoComplete="off" {...form.register('website')} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" {...form.register('smsOptIn')} />
            {f.smsOptIn}
          </label>
          <div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                {...form.register('privacyConsent')}
              />
              <span>
                {f.consentBefore}{' '}
                <Link to="/privacy" target="_blank" className="text-primary underline">
                  {f.consentLink}
                </Link>{' '}
                {f.consentAfter}
              </span>
            </label>
            {errors.privacyConsent && (
              <p className="mt-1 text-xs text-destructive">{errors.privacyConsent.message}</p>
            )}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={book.isPending}>
            {book.isPending ? t.booking.submitting : t.booking.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Confirmation({ result, onAgain }: { result: PublicBookingResult; onAgain: () => void }) {
  const cancelUrl = `${window.location.origin}/cancel/${result.cancelToken}`;
  return (
    <Card>
      <CardContent className="space-y-5 pt-6 text-center">
        <CalendarCheck className="mx-auto size-12 text-success" />
        <div>
          <h2 className="text-xl font-semibold">{t.booking.confirmedTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t.booking.confirmedBody}</p>
        </div>
        <div className="rounded-lg bg-muted py-4">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {t.booking.reference}
          </p>
          <p
            className="font-mono text-3xl font-semibold tracking-wider"
            data-testid="reference-code"
          >
            {result.referenceCode}
          </p>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-left text-sm">
          <dt className="text-muted-foreground">{t.booking.when}</dt>
          <dd>
            {new Intl.DateTimeFormat('en-PH', {
              timeZone: 'Asia/Manila',
              dateStyle: 'full',
              timeStyle: 'short',
            }).format(new Date(result.startAt))}
          </dd>
          <dt className="text-muted-foreground">{t.booking.doctor}</dt>
          <dd>{result.doctorName}</dd>
        </dl>
        <div className="text-left text-sm">
          <p className="text-muted-foreground">{t.booking.cancelLinkLabel}</p>
          <a className="break-all text-primary underline" href={cancelUrl}>
            {cancelUrl}
          </a>
        </div>
        <Button variant="outline" onClick={onAgain}>
          {t.booking.bookAnother}
        </Button>
      </CardContent>
    </Card>
  );
}
