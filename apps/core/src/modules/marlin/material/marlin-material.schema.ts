import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { BasicPagerSchema } from '~/shared/dto/pager.dto'

const materialKinds = ['url', 'markdown', 'html', 'json', 'text'] as const
const sourceTypes = [
  'url',
  'chatgpt-share',
  'claude-share',
  'upload',
  'manual',
] as const
const materialStatuses = ['ready', 'analyzed', 'archived', 'purged'] as const

export const MarlinMaterialImportSchema = z.object({
  kind: z.enum(materialKinds),
  title: z.string().trim().min(1).max(300),
  content: z.string().min(1).max(5_000_000),
  mimeType: z.string().trim().min(1).max(120).default('text/plain'),
  sourceType: z.enum(sourceTypes),
  sourceRef: z.string().trim().max(2048).optional(),
  originalFilename: z.string().trim().max(512).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const MarlinMaterialListSchema = BasicPagerSchema.extend({
  status: z.enum(materialStatuses).optional(),
  kind: z.enum(materialKinds).optional(),
  search: z.string().trim().max(200).optional(),
})

export const MarlinMaterialUrlImportSchema = z.object({
  url: z.url().max(2048),
  title: z.string().trim().min(1).max(300).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const MarlinMaterialAnalyzeSchema = z.object({
  force: z.boolean().default(false),
  archiveImages: z.boolean().default(true),
})

export class MarlinMaterialImportDto extends createZodDto(
  MarlinMaterialImportSchema,
) {}
export class MarlinMaterialListDto extends createZodDto(
  MarlinMaterialListSchema,
) {}
export class MarlinMaterialUrlImportDto extends createZodDto(
  MarlinMaterialUrlImportSchema,
) {}
export class MarlinMaterialAnalyzeDto extends createZodDto(
  MarlinMaterialAnalyzeSchema,
) {}
