import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, ilike, type SQL, sql } from 'drizzle-orm'

import { PG_DB_TOKEN } from '~/constants/system.constant'
import {
  marlinMaterialImports,
  marlinMaterials,
  marlinProjectMaterials,
  pages,
  posts,
} from '~/database/schema'
import {
  BaseRepository,
  type PaginationResult,
} from '~/processors/database/base.repository'
import type { AppDatabase } from '~/processors/database/postgres.provider'
import { SnowflakeService } from '~/shared/id/snowflake.service'

import type {
  MarlinFrozenMaterialInput,
  MarlinMaterialImportRecordInput,
  MarlinMaterialListInput,
} from './marlin-material.types'

@Injectable()
export class MarlinMaterialRepository extends BaseRepository {
  constructor(
    @Inject(PG_DB_TOKEN) db: AppDatabase,
    private readonly snowflake: SnowflakeService,
  ) {
    super(db)
  }

  async importFrozen(
    material: MarlinFrozenMaterialInput,
    evidence: MarlinMaterialImportRecordInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(marlinMaterials)
        .values({
          id: this.snowflake.nextId(),
          ...material,
        })
        .onConflictDoNothing({ target: marlinMaterials.contentHash })
        .returning()

      const row =
        created ??
        (
          await tx
            .select()
            .from(marlinMaterials)
            .where(eq(marlinMaterials.contentHash, material.contentHash))
            .limit(1)
        )[0]

      if (!row) {
        throw new Error('Material deduplication failed')
      }

      const [importRecord] = await tx
        .insert(marlinMaterialImports)
        .values({
          id: this.snowflake.nextId(),
          materialId: row.id,
          ...evidence,
        })
        .returning()

      return {
        material: row,
        importRecord,
        deduplicated: !created,
      }
    })
  }

  async list(
    input: MarlinMaterialListInput,
  ): Promise<PaginationResult<typeof marlinMaterials.$inferSelect>> {
    const page = input.page ?? 1
    const size = input.size ?? 10
    const conditions: SQL[] = []
    if (input.status) {
      conditions.push(eq(marlinMaterials.status, input.status))
    }
    if (input.kind) {
      conditions.push(eq(marlinMaterials.kind, input.kind))
    }
    if (input.search) {
      conditions.push(ilike(marlinMaterials.title, `%${input.search}%`))
    }
    const where = conditions.length ? and(...conditions) : undefined

    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(marlinMaterials)
        .where(where)
        .orderBy(desc(marlinMaterials.createdAt))
        .limit(size)
        .offset((page - 1) * size),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(marlinMaterials)
        .where(where),
    ])

    return {
      data: rows,
      pagination: this.paginationOf(Number(count ?? 0), page, size),
    }
  }

  async findById(id: string) {
    const [material] = await this.db
      .select()
      .from(marlinMaterials)
      .where(eq(marlinMaterials.id, this.toDbId(id)))
      .limit(1)
    if (!material) return null

    const imports = await this.db
      .select()
      .from(marlinMaterialImports)
      .where(eq(marlinMaterialImports.materialId, material.id))
      .orderBy(desc(marlinMaterialImports.createdAt))

    return { ...material, imports }
  }

  async delete(id: string, detach: boolean) {
    const materialId = this.toDbId(id)
    return this.db.transaction(async (tx) => {
      const [material] = await tx
        .select()
        .from(marlinMaterials)
        .where(eq(marlinMaterials.id, materialId))
        .limit(1)
        .for('update')
      if (!material) return null

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(marlinProjectMaterials)
        .where(eq(marlinProjectMaterials.materialId, materialId))
      const attachedProjects = Number(count ?? 0)
      if (attachedProjects > 0 && !detach) {
        return {
          material,
          deleted: false as const,
          detached: 0,
          attachedProjects,
        }
      }
      if (attachedProjects > 0) {
        await tx
          .delete(marlinProjectMaterials)
          .where(eq(marlinProjectMaterials.materialId, materialId))
      }
      await tx.delete(marlinMaterials).where(eq(marlinMaterials.id, materialId))
      return {
        material,
        deleted: true as const,
        detached: attachedProjects,
        attachedProjects,
      }
    })
  }

  async listMedia() {
    const [materials, postContents, pageContents] = await Promise.all([
      this.db
        .select({
          id: marlinMaterials.id,
          title: marlinMaterials.title,
          analysis: marlinMaterials.analysis,
        })
        .from(marlinMaterials)
        .where(sql`${marlinMaterials.analysis} is not null`),
      this.db
        .select({ id: posts.id, title: posts.title, text: posts.text })
        .from(posts),
      this.db
        .select({ id: pages.id, title: pages.title, text: pages.text })
        .from(pages),
    ])
    const publishedContents = [
      ...postContents.map((item) => ({ ...item, type: 'post' as const })),
      ...pageContents.map((item) => ({ ...item, type: 'page' as const })),
    ]
    const assets = new Map<
      string,
      {
        sourceUrl: string
        archivedUrl?: string
        objectPath?: string
        contentHash?: string
        mimeType?: string
        byteSize?: number
        status: string
        error?: string
        materials: Array<{ id: string; title: string }>
      }
    >()

    for (const material of materials) {
      const analysis = material.analysis as {
        media?: Array<Record<string, unknown>>
      } | null
      for (const media of analysis?.media ?? []) {
        const sourceUrl = String(media.sourceUrl ?? media.source_url ?? '')
        const archivedUrl = media.archivedUrl ?? media.archived_url
        if (!sourceUrl) continue
        const key = String(archivedUrl || sourceUrl)
        const existing = assets.get(key)
        if (existing) {
          existing.materials.push({ id: material.id, title: material.title })
          continue
        }
        assets.set(key, {
          sourceUrl,
          archivedUrl:
            typeof archivedUrl === 'string' ? archivedUrl : undefined,
          objectPath:
            typeof (media.objectPath ?? media.object_path) === 'string'
              ? String(media.objectPath ?? media.object_path)
              : undefined,
          contentHash:
            typeof (media.contentHash ?? media.content_hash) === 'string'
              ? String(media.contentHash ?? media.content_hash)
              : undefined,
          mimeType:
            typeof (media.mimeType ?? media.mime_type) === 'string'
              ? String(media.mimeType ?? media.mime_type)
              : undefined,
          byteSize:
            typeof (media.byteSize ?? media.byte_size) === 'number'
              ? Number(media.byteSize ?? media.byte_size)
              : undefined,
          status: String(media.status ?? 'pending'),
          error: typeof media.error === 'string' ? media.error : undefined,
          materials: [{ id: material.id, title: material.title }],
        })
      }
    }

    return [...assets.values()].map((asset) => {
      const usedBy = asset.archivedUrl
        ? publishedContents
            .filter(({ text }) => text?.includes(asset.archivedUrl!))
            .map(({ id, title, type }) => ({ id, title, type }))
        : []
      return {
        ...asset,
        usage:
          asset.status !== 'archived'
            ? 'unresolved'
            : usedBy.length
              ? 'used'
              : 'unused',
        usedBy,
      }
    })
  }

  async archive(id: string) {
    const [row] = await this.db
      .update(marlinMaterials)
      .set({
        status: 'archived',
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marlinMaterials.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async updateAnalysis(
    id: string,
    analysis: Record<string, unknown>,
    status: 'pending' | 'analyzed',
    localizedContent?: string,
  ) {
    const [row] = await this.db
      .update(marlinMaterials)
      .set({
        analysis,
        analyzedAt: new Date(),
        status,
        ...(localizedContent == null ? {} : { content: localizedContent }),
        updatedAt: new Date(),
      })
      .where(eq(marlinMaterials.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }
}
