import { ageOn, CLINIC_TIMEZONE, formatPhMobile, todayIn } from '@clinic/shared';

export const fullName = (p: { firstName: string; middleName?: string | null; lastName: string }) =>
  [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

export const ageFrom = (birthdate: string | null) =>
  birthdate ? ageOn(birthdate, todayIn(CLINIC_TIMEZONE)) : null;

export const phone = formatPhMobile;

const dateTimeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: CLINIC_TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Displays a UTC ISO timestamp in Manila time. */
export const manilaDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: CLINIC_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
});
/** "8:15 AM" in Manila time. */
export const manilaTime = (iso: string) => timeFormat.format(new Date(iso));

const longDateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const shortDateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** Formats a calendar date (YYYY-MM-DD) without shifting it across timezones. */
export const dateLabel = (date: string, style: 'long' | 'short' = 'short') =>
  (style === 'long' ? longDateFormat : shortDateFormat).format(new Date(`${date}T00:00:00Z`));

export const todayManila = () => todayIn(CLINIC_TIMEZONE);

interface VitalsLike {
  bpSystolic: number | null;
  bpDiastolic: number | null;
  temperatureC: number | null;
  heartRate: number | null;
  o2Sat: number | null;
  weightKg: number | null;
}

/** Compact one-line vitals, e.g. "BP 120/80 · T 36.8° · HR 78 · SpO₂ 98% · 62.5 kg". */
export function vitalsSummary(v: VitalsLike): string | null {
  const parts = [
    v.bpSystolic != null && v.bpDiastolic != null && `BP ${v.bpSystolic}/${v.bpDiastolic}`,
    v.temperatureC != null && `T ${v.temperatureC}°`,
    v.heartRate != null && `HR ${v.heartRate}`,
    v.o2Sat != null && `SpO₂ ${v.o2Sat}%`,
    v.weightKg != null && `${v.weightKg} kg`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export const minutesSince = (iso: string | null, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)) : 0;
