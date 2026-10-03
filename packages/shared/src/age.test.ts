import { describe, expect, it } from 'vitest';
import { ageOn, todayIn } from './age';

describe('ageOn', () => {
  it('counts full years only', () => {
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36);
  });

  it('handles leap-day birthdays', () => {
    expect(ageOn('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageOn('2000-02-29', '2025-03-01')).toBe(25);
  });
});

describe('todayIn', () => {
  it('uses Manila date, not UTC date', () => {
    expect(todayIn('Asia/Manila', new Date('2026-01-01T17:00:00Z'))).toBe('2026-01-02');
  });
});
