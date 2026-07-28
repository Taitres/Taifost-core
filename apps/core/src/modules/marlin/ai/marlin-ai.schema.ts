import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

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

export class MarlinAiRoleDto extends createZodDto(MarlinAiRoleSchema) {}
export class MarlinAiAdviceDto extends createZodDto(MarlinAiAdviceSchema) {}

export type MarlinAiRoleInput = z.infer<typeof MarlinAiRoleSchema>
export type MarlinAiAdviceOutput = z.infer<typeof MarlinAiAdviceOutputSchema>
