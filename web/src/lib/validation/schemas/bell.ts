import { z } from 'zod';

/**
 * Client-side mirror of the API's bell schema (api/src/validation/schemas.ts).
 * The rules must stay identical: the server is authoritative, this just keeps
 * the dialog from submitting something it already knows is invalid.
 */

const localDate = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD');

export const bellFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    timeOfDay: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'),
    daysOfWeek: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Select at least one weekday'),
    dateFrom: localDate.default(''),
    dateTo: localDate.default(''),
    enabled: z.boolean().default(true),
    announcementId: z.number().int().positive().nullable().default(null),
    beep: z.boolean().default(false),
    volume: z.number().int().min(0, 'Volume must be 0-100').max(100, 'Volume must be 0-100').nullable().default(null),
    zoneIds: z.array(z.number().int().positive()).default([]),
    endpointIds: z.array(z.number().int().positive()).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.dateFrom && data.dateTo && data.dateFrom > data.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'End date must be on or after the start date',
      });
    }
    if (data.zoneIds.length === 0 && data.endpointIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['zoneIds'],
        message: 'Select at least one zone or endpoint',
      });
    }
    if (data.announcementId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['announcementId'],
        message: 'Choose an announcement',
      });
    }
  });

export type BellFormInput = z.input<typeof bellFormSchema>;
export type BellFormValues = z.output<typeof bellFormSchema>;

export const bellSkipFormSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  bellId: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().max(120).default(''),
});

export type BellSkipFormInput = z.input<typeof bellSkipFormSchema>;
export type BellSkipFormValues = z.output<typeof bellSkipFormSchema>;
