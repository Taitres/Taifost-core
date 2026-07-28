import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, ilike, type SQL, sql } from 'drizzle-orm'

import { PG_DB_TOKEN } from '~/constants/system.constant'
import { marlinMaterialImports, marlinMaterials } from '~/database/schema'
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

  async updateAnalysis(id: string, analysis: Record<string, unknown>) {
    const [row] = await this.db
      .update(marlinMaterials)
      .set({
        analysis,
        analyzedAt: new Date(),
        status: 'analyzed',
        updatedAt: new Date(),
      })
      .where(eq(marlinMaterials.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }
}
