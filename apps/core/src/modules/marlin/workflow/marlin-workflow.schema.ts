import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { zEntityId } from '~/common/zod'
import { BasicPagerSchema } from '~/shared/dto/pager.dto'

export const MarlinProjectCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  goal: z.string().trim().max(5000).default(''),
})

export const MarlinProjectPatchSchema = MarlinProjectCreateSchema.partial()

export const MarlinProjectListSchema = BasicPagerSchema.extend({
  status: z
    .enum([
      'draft',
      'ready',
      'in_review',
      'approved',
      'changes_requested',
      'scheduled',
      'published',
      'withdrawn',
    ])
    .optional(),
  search: z.string().trim().max(200).optional(),
})

export const MarlinAttachMaterialsSchema = z.object({
  materialIds: z.array(zEntityId).min(1).max(100),
})

export const MarlinRevisionCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2000).nullable().default(null),
  content: z.string().min(1).max(5_000_000),
  categoryId: zEntityId,
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  copyright: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const MarlinReviewCreateSchema = z.object({
  revisionId: zEntityId.optional(),
  expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
  reviewerEmail: z.email().max(320).optional(),
})

export const MarlinReviewAccessSchema = z.object({
  passcode: z.string().regex(/^\d{6}$/),
})

export const MarlinReviewDecisionSchema = MarlinReviewAccessSchema.extend({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(5000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
})

export const MarlinPublishSchema = z.object({
  revisionId: zEntityId.optional(),
  scheduledAt: z.coerce.date().optional(),
})

export class MarlinProjectCreateDto extends createZodDto(
  MarlinProjectCreateSchema,
) {}
export class MarlinProjectPatchDto extends createZodDto(
  MarlinProjectPatchSchema,
) {}
export class MarlinProjectListDto extends createZodDto(
  MarlinProjectListSchema,
) {}
export class MarlinAttachMaterialsDto extends createZodDto(
  MarlinAttachMaterialsSchema,
) {}
export class MarlinRevisionCreateDto extends createZodDto(
  MarlinRevisionCreateSchema,
) {}
export class MarlinReviewCreateDto extends createZodDto(
  MarlinReviewCreateSchema,
) {}
export class MarlinReviewAccessDto extends createZodDto(
  MarlinReviewAccessSchema,
) {}
export class MarlinReviewDecisionDto extends createZodDto(
  MarlinReviewDecisionSchema,
) {}
export class MarlinPublishDto extends createZodDto(MarlinPublishSchema) {}

export type MarlinProjectCreateInput = z.infer<typeof MarlinProjectCreateSchema>
export type MarlinProjectPatchInput = z.infer<typeof MarlinProjectPatchSchema>
export type MarlinProjectListInput = z.infer<typeof MarlinProjectListSchema>
export type MarlinRevisionCreateInput = z.infer<
  typeof MarlinRevisionCreateSchema
>
export type MarlinReviewDecisionInput = z.infer<
  typeof MarlinReviewDecisionSchema
>
