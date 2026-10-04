import { describe, expect, it } from 'vitest';
import { generateSlots, type SlotInput } from './slots';

const base: SlotInput = {
  date: '2026-10-05',
  timeZone: 'Asia/Manila',
  blocks: [{ startTime: '08:00', endTime: '09:00', slotMinutes: 15, maxPatients: null }],
  exception: null,
  busy: [],
  now: new Date('2026-10-01T00:00:00Z'),
  minLeadMinutes: 0,
};
const times = (input: SlotInput) => generateSlots(input).map((s) => s.startAt.toISOString());

describe('generateSlots', () => {
  it('splits blocks into slots in Manila time, stored as UTC', () => {
    expect(times(base)).toEqual([
      '2026-10-05T00:00:00.000Z',
      '2026-10-05T00:15:00.000Z',
      '2026-10-05T00:30:00.000Z',
      '2026-10-05T00:45:00.000Z',
    ]);
  });

  it('drops a trailing partial slot', () => {
    const input = {
      ...base,
      blocks: [{ startTime: '08:00', endTime: '08:50', slotMinutes: 20, maxPatients: null }],
    };
    expect(times(input)).toHaveLength(2);
  });

  it('removes slots overlapping existing bookings', () => {
    const busy = [
      { startAt: new Date('2026-10-05T00:10:00Z'), endAt: new Date('2026-10-05T00:25:00Z') },
    ];
    expect(times({ ...base, busy })).toEqual([
      '2026-10-05T00:30:00.000Z',
      '2026-10-05T00:45:00.000Z',
    ]);
  });

  it('returns nothing on a closed exception day', () => {
    expect(
      times({ ...base, exception: { isClosed: true, startTime: null, endTime: null } }),
    ).toEqual([]);
  });

  it('replaces the weekly hours with custom exception hours', () => {
    const exception = { isClosed: false, startTime: '13:00', endTime: '13:30' };
    expect(times({ ...base, exception })).toEqual([
      '2026-10-05T05:00:00.000Z',
      '2026-10-05T05:15:00.000Z',
    ]);
  });

  it('closes a block once its patient cap is reached', () => {
    const blocks = [
      { startTime: '08:00', endTime: '09:00', slotMinutes: 15, maxPatients: 1 },
      { startTime: '13:00', endTime: '13:30', slotMinutes: 15, maxPatients: null },
    ];
    const busy = [
      { startAt: new Date('2026-10-05T00:45:00Z'), endAt: new Date('2026-10-05T01:00:00Z') },
    ];
    expect(times({ ...base, blocks, busy })).toEqual([
      '2026-10-05T05:00:00.000Z',
      '2026-10-05T05:15:00.000Z',
    ]);
  });

  it('hides slots inside the lead time', () => {
    const now = new Date('2026-10-05T00:05:00Z');
    expect(times({ ...base, now, minLeadMinutes: 20 })).toEqual([
      '2026-10-05T00:30:00.000Z',
      '2026-10-05T00:45:00.000Z',
    ]);
  });
});
