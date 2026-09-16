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

export const talkSchema = z.object({
  endpointIds: z.array(z.coerce.number().int().positive()).min(1),
});
