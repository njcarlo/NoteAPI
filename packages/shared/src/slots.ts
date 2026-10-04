import { fromMinutes, toMinutes, zonedToUtc } from './time';

export interface ScheduleBlock {
  startTime: string;
  endTime: string;
  slotMinutes: number;
  /** Cap on scheduled appointments starting in this block; null for no cap beyond slots. */
  maxPatients: number | null;
}

export interface DayException {
  isClosed: boolean;
  startTime: string | null;
  endTime: string | null;
}

export interface BusyRange {
  startAt: Date;
  endAt: Date;
}

export interface Slot {
  startAt: Date;
  endAt: Date;
}

export interface SlotInput {
  date: string;
  timeZone: string;
  /** The doctor's weekly blocks for this weekday. */
  blocks: ScheduleBlock[];
  exception: DayException | null;
  /** The doctor's active scheduled appointments that day. */
  busy: BusyRange[];
  now: Date;
  /** Slots starting sooner than this are not offered. */
  minLeadMinutes: number;
}

const DEFAULT_SLOT_MINUTES = 15;

/** Bookable slots for one doctor on one day: schedule, minus exceptions, caps and existing bookings. */
export function generateSlots(input: SlotInput): Slot[] {
  if (input.exception?.isClosed) return [];

  const blocks: ScheduleBlock[] =
    input.exception?.startTime && input.exception.endTime
      ? [
          {
            startTime: input.exception.startTime,
            endTime: input.exception.endTime,
            slotMinutes: input.blocks[0]?.slotMinutes ?? DEFAULT_SLOT_MINUTES,
            maxPatients: null,
          },
        ]
      : input.blocks;

  const earliest = input.now.getTime() + input.minLeadMinutes * 60_000;
  const slots: Slot[] = [];

  for (const block of blocks) {
    const blockStart = zonedToUtc(input.date, block.startTime, input.timeZone);
    const blockEnd = zonedToUtc(input.date, block.endTime, input.timeZone);
    if (block.maxPatients !== null) {
      const booked = input.busy.filter(
        (b) => b.startAt >= blockStart && b.startAt < blockEnd,
      ).length;
      if (booked >= block.maxPatients) continue;
    }

    const end = toMinutes(block.endTime);
    for (let m = toMinutes(block.startTime); m + block.slotMinutes <= end; m += block.slotMinutes) {
      const startAt = zonedToUtc(input.date, fromMinutes(m), input.timeZone);
      const endAt = new Date(startAt.getTime() + block.slotMinutes * 60_000);
      if (startAt.getTime() < earliest) continue;
      if (input.busy.some((b) => b.startAt < endAt && b.endAt > startAt)) continue;
      slots.push({ startAt, endAt });
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
