import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

export const endpointCreateSchema = z.object({
  extension: z.string().regex(/^\d{2,6}$/, 'Extension must be 2-6 digits'),
  label: z.string().min(1).max(120),
  location: z.string().max(120).default(''),
  type: z.enum(['phone', 'speaker']).default('phone'),
});

export const endpointUpdateSchema = z.object({
  label: z.string().min(1).max(120),
  location: z.string().max(120).default(''),
  type: z.enum(['phone', 'speaker']),
  isActive: z.boolean().default(true),
});

export const zoneCreateSchema = z.object({
  name: z.string().min(1).max(120),
});

export const zoneUpdateSchema = z.object({
  name: z.string().min(1).max(120),
});

export const zoneMemberSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});

export const broadcastSchema = z
  .object({
    mode: z.enum(['zone', 'adhoc']).default('adhoc'),
    zoneId: z.coerce.number().int().positive().optional(),
    endpointIds: z.array(z.coerce.number().int().positive()).min(1).optional(),
    announcementId: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'zone' && !data.zoneId) {
      ctx.addIssue({ code: 'custom', path: ['zoneId'], message: 'zoneId is required for zone mode' });
    }
    if (data.mode === 'adhoc' && (!data.endpointIds || data.endpointIds.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['endpointIds'], message: 'endpointIds is required for adhoc mode' });
    }
  });

export const announcementSchema = z.object({
  name: z.string().max(120).optional(),
});

export const talkSchema = z
  .object({
    endpointIds: z
      .array(z.coerce.number().int().positive())
      .optional()
      .default([]),
    // PA groups: every receiver of each group becomes a live talk target.
    paGroupIds: z
      .array(z.coerce.number().int().positive())
      .optional()
      .default([]),
    // mic = operator microphone, device = audio already playing on the operator's
    // machine (tab/system capture). Device audio is always one-way.
    source: z.enum(["mic", "device"]).optional().default("mic"),
  })
  .refine((v) => v.endpointIds.length > 0 || v.paGroupIds.length > 0, {
    message: "Select at least one endpoint or PA group",
    path: ["endpointIds"],
  });

// ---- endpoint cameras (ONVIF + WebRTC preview) ----------------------------

export const cameraConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z
    .string()
    .trim()
    .max(190)
    .regex(/^$|^[A-Za-z0-9._-]+$/, "Enter a hostname or IP address")
    .default(""),
  port: z.coerce.number().int().min(1).max(65535).default(80),
  username: z.string().max(120).default(""),
  // Write-only: an empty string keeps the stored password.
  password: z.string().max(200).optional(),
  channel: z.coerce.number().int().min(1).max(64).default(1),
  preferredStream: z.enum(["sub", "main"]).default("sub"),
  profileToken: z.string().max(120).optional(),
});

/** Create a camera record; config can be filled in later. */
export const cameraCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(190).default(""),
  endpointId: z.coerce.number().int().positive().nullable().optional(),
});

/** Metadata / link / enable changes that skip the ONVIF probe. */
export const cameraPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(190).optional(),
  endpointId: z.coerce.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
});

/** Add a camera found by network discovery. */
export const cameraDiscoverAddSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(190)
    .regex(/^[A-Za-z0-9._-]+$/, "Enter a hostname or IP address"),
  port: z.coerce.number().int().min(1).max(65535).default(80),
  name: z.string().trim().max(120).optional(),
  location: z.string().trim().max(190).optional(),
  username: z.string().max(120).optional(),
  password: z.string().max(200).optional(),
});

/** WS-Discovery probe window; discovery is LAN-only and instant. */
export const cameraDiscoverSchema = z.object({
  timeoutMs: z.coerce.number().int().min(500).max(8000).default(3000),
});

export const cameraStartSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});

/** "Test" accepts unsaved form values so the operator can probe before saving. */
export const cameraTestSchema = z.object({
  host: z.string().trim().max(190).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  username: z.string().max(120).optional(),
  password: z.string().max(200).optional(),
});

// ---- scheduled bells ------------------------------------------------------

const localDateSchema = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v),
    "Use YYYY-MM-DD",
  );

const dayListSchema = z
  .array(z.coerce.number().int().min(1).max(7))
  .min(1, "Select at least one weekday")
  .max(7);

/**
 * 0-100 or null ("device default"). Deliberately NOT a union of
 * `z.coerce.number()` and `z.null()`: zod tries union members in order and
 * `z.coerce.number()` turns `null` into `0`, silently saving "device default"
 * as a muted bell. Normalize first, then validate a single type.
 */
const volumeSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  },
  z.number().int().min(0, "Volume must be 0-100").max(100, "Volume must be 0-100").nullable(),
);

/** Optional foreign key: absent and null both mean "none" (same trap as volume). */
const optionalId = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  },
  z.number().int().positive("Select a valid item").nullable(),
);

const bellBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  timeOfDay: z
    .string()
    .trim()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      "Time must be HH:MM (24-hour)",
    ),
  daysOfWeek: dayListSchema,
  dateFrom: localDateSchema.default(""),
  dateTo: localDateSchema.default(""),
  enabled: z.boolean().default(true),
  announcementId: optionalId,
  beep: z.boolean().default(false),
  volume: volumeSchema.optional().default(null),
  zoneIds: z.array(z.coerce.number().int().positive()).default([]),
  endpointIds: z.array(z.coerce.number().int().positive()).default([]),
});

const refineBell = (data: z.infer<typeof bellBaseSchema>, ctx: z.RefinementCtx) => {
  if (data.dateFrom && data.dateTo && data.dateFrom > data.dateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateTo"],
      message: "End date must be on or after the start date",
    });
  }
  if (data.zoneIds.length === 0 && data.endpointIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["zoneIds"],
      message: "Select at least one zone or endpoint",
    });
  }
};

export const bellCreateSchema = bellBaseSchema.superRefine(refineBell);
export const bellUpdateSchema = bellBaseSchema.superRefine(refineBell);

/** Fast enable/disable toggle from the list — no rematerialize burst. */
export const bellPatchSchema = z.object({
  enabled: z.boolean(),
});

export const bellPauseSchema = z.object({
  paused: z.boolean(),
  by: z.string().trim().max(120).optional(),
});

export const bellOccurrenceQuerySchema = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  status: z.string().trim().max(40).optional(),
  bellId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const bellSkipCreateSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  bellId: z.coerce.number().int().positive().nullable().optional(),
  reason: z.string().trim().max(120).default(""),
});

export const bellSkipOccurrenceSchema = z.object({
  reason: z.string().trim().max(120).default("manual"),
});

export const bellTestSchema = z.object({
  /** Optional overrides so "Test" works on an unsaved form. */
  announcementId: z.coerce.number().int().positive().optional(),
  zoneIds: z.array(z.coerce.number().int().positive()).optional(),
  endpointIds: z.array(z.coerce.number().int().positive()).optional(),
  beep: z.boolean().optional(),
  volume: volumeSchema.optional(),
});
