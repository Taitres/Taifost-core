import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { zEntityId } from '~/common/zod'
import { BasicPagerSchema } from '~/shared/dto/pager.dto'

export const MarlinHotspotThemeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  dailyQuota: z.coerce.number().int().min(1).max(1000).default(20),
  enabled: z.boolean().default(true),
})

export const MarlinHotspotSourceSchema = z.object({
  themeId: zEntityId.nullable().optional(),
  name: z.string().trim().min(1).max(200),
  url: z.url().refine((value) => /^https?:\/\//i.test(value), {
    message: 'Only HTTP(S) sources are supported',
  }),
  format: z.enum(['rss', 'atom', 'json']),
  config: z.record(z.string(), z.unknown()).default({}),
  dailyQuota: z.coerce.number().int().min(1).max(1000).default(20),
  enabled: z.boolean().default(true),
})

export const MarlinHotspotCandidateListSchema = BasicPagerSchema.extend({
  status: z.enum(['inbox', 'selected', 'dismissed']).optional(),
  themeId: zEntityId.optional(),
})

export const MarlinHotspotCandidateStatusSchema = z.object({
  status: z.enum(['inbox', 'selected', 'dismissed']),
})

export class MarlinHotspotThemeDto extends createZodDto(
  MarlinHotspotThemeSchema,
) {}
export class MarlinHotspotThemePatchDto extends createZodDto(
  MarlinHotspotThemeSchema.partial(),
) {}
export class MarlinHotspotSourceDto extends createZodDto(
  MarlinHotspotSourceSchema,
) {}
export class MarlinHotspotSourcePatchDto extends createZodDto(
  MarlinHotspotSourceSchema.partial(),
) {}
export class MarlinHotspotCandidateListDto extends createZodDto(
  MarlinHotspotCandidateListSchema,
) {}
export class MarlinHotspotCandidateStatusDto extends createZodDto(
  MarlinHotspotCandidateStatusSchema,
) {}

export type MarlinHotspotThemeInput = z.infer<
  typeof MarlinHotspotThemeSchema
>
export type MarlinHotspotSourceInput = z.infer<
  typeof MarlinHotspotSourceSchema
>
export type MarlinHotspotCandidateListInput = z.infer<
  typeof MarlinHotspotCandidateListSchema
>
