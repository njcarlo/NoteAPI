import { describe, expect, it } from 'vitest';
import { dayBounds, dayOfWeek, startOfWeek, utcToZoned, zonedToUtc } from './time';

describe('time helpers', () => {
  it('round-trips Manila wall time', () => {
    const instant = zonedToUtc('2026-10-05', '00:30', 'Asia/Manila');
    expect(instant.toISOString()).toBe('2026-10-04T16:30:00.000Z');
    expect(utcToZoned(instant, 'Asia/Manila')).toEqual({ date: '2026-10-05', time: '00:30' });
  });

  it('computes weekdays and week starts from calendar dates', () => {
    expect(dayOfWeek('2026-10-04')).toBe(0);
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
  });

  it('bounds a Manila day in UTC', () => {
    const { start, end } = dayBounds('2026-10-05', 'Asia/Manila');
    expect(start.toISOString()).toBe('2026-10-04T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });
});
