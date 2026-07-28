import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
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
    originalContent: text('original_content'),
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

export const marlinProjects = pgTable(
  'marlin_projects',
  {
    id: pkText(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    title: text('title').notNull(),
    goal: text('goal').notNull().default(''),
    status: text('status').notNull().default('draft'),
    currentRevisionId: refText('current_revision_id'),
    approvedRevisionId: refText('approved_revision_id'),
    publishedRevisionId: refText('published_revision_id'),
    corePostId: refText('core_post_id'),
  },
  (table) => [
    index('marlin_projects_status_updated_idx').on(
      table.status,
      table.updatedAt,
    ),
  ],
)

export const marlinProjectMaterials = pgTable(
  'marlin_project_materials',
  {
    projectId: refText('project_id')
      .notNull()
      .references(() => marlinProjects.id, { onDelete: 'cascade' }),
    materialId: refText('material_id')
      .notNull()
      .references(() => marlinMaterials.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('marlin_project_materials_pk').on(
      table.projectId,
      table.materialId,
    ),
    index('marlin_project_materials_material_idx').on(table.materialId),
  ],
)

/**
 * A revision is an immutable publication candidate. Editing creates the next
 * version; review and publication always bind to one exact revision ID.
 */
export const marlinRevisions = pgTable(
  'marlin_revisions',
  {
    id: pkText(),
    projectId: refText('project_id')
      .notNull()
      .references(() => marlinProjects.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    content: text('content').notNull(),
    categoryId: refText('category_id').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    copyright: boolean('copyright').notNull().default(true),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex('marlin_revisions_project_version_uniq').on(
      table.projectId,
      table.version,
    ),
    index('marlin_revisions_project_created_idx').on(
      table.projectId,
      table.createdAt,
    ),
  ],
)

export const marlinReviewRequests = pgTable(
  'marlin_review_requests',
  {
    id: pkText(),
    projectId: refText('project_id')
      .notNull()
      .references(() => marlinProjects.id, { onDelete: 'cascade' }),
    revisionId: refText('revision_id')
      .notNull()
      .references(() => marlinRevisions.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    status: text('status').notNull().default('pending'),
    passcodeHash: text('passcode_hash').notNull(),
    expiresAt: tsCol('expires_at').notNull(),
    decidedAt: tsCol('decided_at'),
    reviewerEmail: text('reviewer_email'),
    emailStatus: text('email_status').notNull().default('not_requested'),
    emailError: text('email_error'),
    emailedAt: tsCol('emailed_at'),
  },
  (table) => [
    index('marlin_review_requests_project_status_idx').on(
      table.projectId,
      table.status,
    ),
    index('marlin_review_requests_revision_idx').on(table.revisionId),
  ],
)

export const marlinReviewDecisions = pgTable(
  'marlin_review_decisions',
  {
    id: pkText(),
    requestId: refText('request_id')
      .notNull()
      .references(() => marlinReviewRequests.id, { onDelete: 'cascade' }),
    revisionId: refText('revision_id')
      .notNull()
      .references(() => marlinRevisions.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    decision: text('decision').notNull(),
    comment: text('comment'),
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (table) => [
    uniqueIndex('marlin_review_decisions_idempotency_uniq').on(
      table.idempotencyKey,
    ),
    uniqueIndex('marlin_review_decisions_request_uniq').on(table.requestId),
  ],
)

export const marlinPublications = pgTable(
  'marlin_publications',
  {
    id: pkText(),
    projectId: refText('project_id')
      .notNull()
      .references(() => marlinProjects.id, { onDelete: 'cascade' }),
    revisionId: refText('revision_id')
      .notNull()
      .references(() => marlinRevisions.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    status: text('status').notNull(),
    corePostId: refText('core_post_id'),
    scheduledAt: tsCol('scheduled_at'),
    publishedAt: tsCol('published_at'),
    withdrawnAt: tsCol('withdrawn_at'),
    error: text('error'),
  },
  (table) => [
    index('marlin_publications_project_created_idx').on(
      table.projectId,
      table.createdAt,
    ),
    index('marlin_publications_status_scheduled_idx').on(
      table.status,
      table.scheduledAt,
    ),
  ],
)

export const marlinHotspotThemes = pgTable(
  'marlin_hotspot_themes',
  {
    id: pkText(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    name: text('name').notNull(),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dailyQuota: integer('daily_quota').notNull().default(20),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [uniqueIndex('marlin_hotspot_themes_name_uniq').on(table.name)],
)

export const marlinHotspotSources = pgTable(
  'marlin_hotspot_sources',
  {
    id: pkText(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    themeId: refText('theme_id').references(() => marlinHotspotThemes.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    format: text('format').notNull(),
    config: jsonb('config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dailyQuota: integer('daily_quota').notNull().default(20),
    enabled: boolean('enabled').notNull().default(true),
    lastFetchedAt: tsCol('last_fetched_at'),
    lastError: text('last_error'),
  },
  (table) => [
    uniqueIndex('marlin_hotspot_sources_url_uniq').on(table.url),
    index('marlin_hotspot_sources_enabled_idx').on(table.enabled),
  ],
)

export const marlinHotspotCandidates = pgTable(
  'marlin_hotspot_candidates',
  {
    id: pkText(),
    createdAt: createdAt(),
    sourceId: refText('source_id')
      .notNull()
      .references(() => marlinHotspotSources.id, { onDelete: 'cascade' }),
    themeId: refText('theme_id').references(() => marlinHotspotThemes.id, {
      onDelete: 'set null',
    }),
    eventHash: text('event_hash').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    summary: text('summary'),
    publishedAt: tsCol('published_at'),
    score: integer('score').notNull().default(0),
    status: text('status').notNull().default('inbox'),
    raw: jsonb('raw')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex('marlin_hotspot_candidates_event_hash_uniq').on(
      table.eventHash,
    ),
    index('marlin_hotspot_candidates_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('marlin_hotspot_candidates_theme_created_idx').on(
      table.themeId,
      table.createdAt,
    ),
  ],
)

export const marlinAiRoles = pgTable(
  'marlin_ai_roles',
  {
    id: pkText(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    slot: text('slot').notNull(),
    providerId: text('provider_id').notNull(),
    model: text('model').notNull(),
    systemPrompt: text('system_prompt').notNull().default(''),
    temperature: real('temperature').notNull().default(0.4),
    maxTokens: integer('max_tokens').notNull().default(4096),
    dailyBudgetCents: integer('daily_budget_cents').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [uniqueIndex('marlin_ai_roles_slot_uniq').on(table.slot)],
)

export const marlinAiUsage = pgTable(
  'marlin_ai_usage',
  {
    id: pkText(),
    createdAt: createdAt(),
    roleId: refText('role_id')
      .notNull()
      .references(() => marlinAiRoles.id, { onDelete: 'restrict' }),
    projectId: refText('project_id').references(() => marlinProjects.id, {
      onDelete: 'set null',
    }),
    operation: text('operation').notNull(),
    providerId: text('provider_id').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
  },
  (table) => [
    index('marlin_ai_usage_role_created_idx').on(table.roleId, table.createdAt),
    index('marlin_ai_usage_project_created_idx').on(
      table.projectId,
      table.createdAt,
    ),
  ],
)
