import type { z } from 'zod'

import type {
  MarlinMaterialImportSchema,
  MarlinMaterialListSchema,
} from './marlin-material.schema'

export type MarlinMaterialImportInput = z.infer<
  typeof MarlinMaterialImportSchema
>
export type MarlinMaterialListInput = z.infer<typeof MarlinMaterialListSchema>

export interface MarlinMaterialImportRecordInput {
  sourceType: MarlinMaterialImportInput['sourceType']
  sourceRef?: string
  originalFilename?: string
  metadata: Record<string, unknown>
}

export interface MarlinFrozenMaterialInput {
  kind: MarlinMaterialImportInput['kind']
  title: string
  content: string
  originalContent: string
  contentHash: string
  mimeType: string
  byteSize: number
}
