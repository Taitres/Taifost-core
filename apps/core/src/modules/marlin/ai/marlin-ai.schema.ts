import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { AIProviderType } from '~/modules/ai/ai.types'

export const marlinAiSlots = [
  'material-analyst',
  'topic-planner',
  'writer',
  'quick-rewriter',
  'reviewer',
  'fact-checker',
  'seo-editor',
] as const

export const MarlinAiRoleSchema = z.object({
  slot: z.enum(marlinAiSlots),
  providerId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
  systemPrompt: z.string().max(20_000).default(''),
  temperature: z.coerce.number().min(0).max(2).default(0.4),
  maxTokens: z.coerce.number().int().min(128).max(128_000).default(4096),
  dailyBudgetCents: z.coerce.number().int().min(0).max(10_000_000).default(0),
  enabled: z.boolean().default(true),
})

export const MarlinAiAdviceSchema = z.object({
  slot: z.enum(marlinAiSlots).default('topic-planner'),
  instruction: z.string().trim().min(1).max(20_000),
})

export const MarlinAiAdviceOutputSchema = z.object({
  advice: z.string().min(1).max(20_000),
  risks: z.array(z.string().min(1).max(1000)).max(20).default([]),
  suggestedOutline: z.array(z.string().min(1).max(1000)).max(50).default([]),
  confidence: z.number().min(0).max(1),
})

export const marlinAiTaskKeys = [
  'materialAnalysis',
  'topicPlanning',
  'writing',
  'quickRewrite',
  'review',
  'factCheck',
  'seo',
  'summary',
  'commentReview',
  'translation',
  'translationReview',
  'insights',
  'insightsTranslation',
] as const

export const MarlinAiAssignmentSchema = z.object({
  providerId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
})

export const MarlinUnifiedAiProviderSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  type: z.nativeEnum(AIProviderType),
  apiKey: z.string().trim().max(20_000).default(''),
  endpoint: z.string().trim().max(2_000).optional(),
  modelListUrl: z.string().trim().max(2_000).optional(),
  appendV1: z.boolean().optional(),
  defaultModel: z.string().trim().min(1).max(300),
  enabled: z.boolean().default(true),
  contextWindow: z.coerce.number().int().positive().nullish(),
  maxTokens: z.coerce.number().int().positive().nullish(),
})

const MarlinAiTaskAssignmentsSchema = z
  .object(
    Object.fromEntries(
      marlinAiTaskKeys.map((key) => [key, MarlinAiAssignmentSchema.optional()]),
    ) as Record<
      (typeof marlinAiTaskKeys)[number],
      z.ZodOptional<typeof MarlinAiAssignmentSchema>
    >,
  )
  .default({})

export const MarlinUnifiedAiConfigSchema = z.object({
  providers: z.array(MarlinUnifiedAiProviderSchema).max(20),
  defaultProviderId: z.string().trim().min(1).max(200).optional(),
  defaultModel: z.string().trim().min(1).max(300).optional(),
  assignments: MarlinAiTaskAssignmentsSchema,
})

export const MarlinAiProviderQuerySchema = z.object({
  providerId: z.string().trim().min(1).max(200),
})

export class MarlinAiRoleDto extends createZodDto(MarlinAiRoleSchema) {}
export class MarlinAiAdviceDto extends createZodDto(MarlinAiAdviceSchema) {}
export class MarlinUnifiedAiConfigDto extends createZodDto(
  MarlinUnifiedAiConfigSchema,
) {}
export class MarlinAiProviderQueryDto extends createZodDto(
  MarlinAiProviderQuerySchema,
) {}

export type MarlinAiRoleInput = z.infer<typeof MarlinAiRoleSchema>
export type MarlinAiAdviceOutput = z.infer<typeof MarlinAiAdviceOutputSchema>
export type MarlinAiTaskKey = (typeof marlinAiTaskKeys)[number]
export type MarlinAiAssignment = z.infer<typeof MarlinAiAssignmentSchema>
export type MarlinUnifiedAiConfigInput = z.infer<
  typeof MarlinUnifiedAiConfigSchema
>
