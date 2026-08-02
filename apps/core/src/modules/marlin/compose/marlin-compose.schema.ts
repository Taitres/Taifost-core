import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const MarlinComposeSchema = z.object({
  source: z.string().trim().min(1).max(5_000_000),
  instruction: z.string().trim().max(20_000).default(''),
  reviewerEmail: z.string().trim().email().optional(),
})

export class MarlinComposeDto extends createZodDto(MarlinComposeSchema) {}

export type MarlinComposeInput = z.infer<typeof MarlinComposeSchema>
