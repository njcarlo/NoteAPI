import { TZDate } from '@date-fns/tz';

/** Converts a wall-clock date (YYYY-MM-DD) and time (HH:mm) in `timeZone` to a UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, timeZone).getTime());
}

/** Calendar date (YYYY-MM-DD) and time (HH:mm) of a UTC instant in `timeZone`. */
export function utcToZoned(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const z = new TZDate(new Date(instant).getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`,
    time: `${pad(z.getHours())}:${pad(z.getMinutes())}`,
  };
}

/** Adds whole days to a calendar date string. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (independent of timezone). */
export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Monday of the week containing `date`. */
export const startOfWeek = (date: string) => addDays(date, -((dayOfWeek(date) + 6) % 7));

/** UTC bounds [start, end) of a calendar day in `timeZone`. */
export function dayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedToUtc(date, '00:00', timeZone),
    end: zonedToUtc(addDays(date, 1), '00:00', timeZone),
  };
}

/** Minutes since midnight for "HH:mm" or "HH:mm:ss". */
export function toMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}

export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Normalizes Postgres `time` output ("08:00:00") to "08:00". */
export const hhmm = (time: string) => time.slice(0, 5);
