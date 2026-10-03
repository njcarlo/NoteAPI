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
