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

export const cameraStartSchema = z.object({
  endpointId: z.coerce.number().int().positive(),
});
