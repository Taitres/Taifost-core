import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { createdAt, pkText, refText, tsCol, updatedAt } from './columns'

/**
 * Frozen source material used by the MARLIN editorial workflow.
 *
 * There is intentionally no mutable content timestamp: imported content is
 * immutable. Metadata and analysis can evolve without rewriting the evidence.
 */
export const marlinMaterials = pgTable(
  'marlin_materials',
  {
    id: pkText(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    mimeType: text('mime_type').notNull().default('text/plain'),
    byteSize: integer('byte_size').notNull(),
    status: text('status').notNull().default('ready'),
    analysis: jsonb('analysis').$type<Record<string, unknown> | null>(),
    analyzedAt: tsCol('analyzed_at'),
    archivedAt: tsCol('archived_at'),
    purgedAt: tsCol('purged_at'),
  },
  (table) => [
    uniqueIndex('marlin_materials_content_hash_uniq').on(table.contentHash),
    index('marlin_materials_created_at_idx').on(table.createdAt),
    index('marlin_materials_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
)

/**
 * Every import attempt is retained as evidence, including attempts deduplicated
 * to an existing frozen material.
 */
export const marlinMaterialImports = pgTable(
  'marlin_material_imports',
  {
    id: pkText(),
    materialId: refText('material_id')
      .notNull()
      .references(() => marlinMaterials.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref'),
    originalFilename: text('original_filename'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('marlin_material_imports_material_created_idx').on(
      table.materialId,
      table.createdAt,
    ),
  ],
)
