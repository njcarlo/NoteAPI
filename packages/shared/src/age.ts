/** Age in whole years for an ISO birthdate (YYYY-MM-DD) as of an ISO date (YYYY-MM-DD). */
export function ageOn(birthdate: string, asOf: string): number {
  const [by, bm, bd] = birthdate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = asOf.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return Math.max(age, 0);
}

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
