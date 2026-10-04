import { z } from 'zod';
import { toMinutes } from '../time';
import { isoDateSchema } from './common';

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const scheduleBlockSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: timeSchema,
    endTime: timeSchema,
    slotMinutes: z.number().int().min(5).max(120),
    maxPatients: z.number().int().min(1).max(200).nullable(),
  })
  .refine((b) => toMinutes(b.endTime) - toMinutes(b.startTime) >= b.slotMinutes, {
    path: ['endTime'],
    message: 'The block must fit at least one slot',
  });
export type ScheduleBlockInput = z.infer<typeof scheduleBlockSchema>;

export const weeklyScheduleSchema = z
  .object({ blocks: z.array(scheduleBlockSchema).max(50) })
  .superRefine(({ blocks }, ctx) => {
    blocks.forEach((a, i) => {
      blocks.slice(i + 1).forEach((b, offset) => {
        const overlaps =
          a.dayOfWeek === b.dayOfWeek &&
          toMinutes(a.startTime) < toMinutes(b.endTime) &&
          toMinutes(b.startTime) < toMinutes(a.endTime);
        if (overlaps) {
          ctx.addIssue({
            code: 'custom',
            path: ['blocks', i + offset + 1, 'startTime'],
            message: 'Overlaps another block on the same day',
          });
        }
      });
    });
  });
export type WeeklyScheduleInput = z.infer<typeof weeklyScheduleSchema>;

export const scheduleExceptionInputSchema = z
  .object({
    date: isoDateSchema,
    isClosed: z.boolean(),
    startTime: timeSchema.nullable().optional(),
    endTime: timeSchema.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (e) =>
      e.isClosed || (e.startTime && e.endTime && toMinutes(e.endTime) > toMinutes(e.startTime)),
    {
      path: ['endTime'],
      message: 'Set opening hours or mark the day closed',
    },
  );
export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionInputSchema>;

export const scheduleExceptionSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  isClosed: z.boolean(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  note: z.string().nullable(),
});
export type ScheduleException = z.infer<typeof scheduleExceptionSchema>;

export const doctorScheduleSchema = z.object({
  blocks: z.array(
    z.object({
      dayOfWeek: z.number(),
      startTime: z.string(),
      endTime: z.string(),
      slotMinutes: z.number(),
      maxPatients: z.number().nullable(),
    }),
  ),
  exceptions: z.array(scheduleExceptionSchema),
});
export type DoctorSchedule = z.infer<typeof doctorScheduleSchema>;

export const doctorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  specialty: z.string().nullable(),
});
export type Doctor = z.infer<typeof doctorSchema>;

export const slotSchema = z.object({ startAt: z.string(), endAt: z.string() });
export type SlotDto = z.infer<typeof slotSchema>;

export const slotQuery = z.object({ date: isoDateSchema });
