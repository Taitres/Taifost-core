import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gte, type SQL, sql } from 'drizzle-orm'

import { PG_DB_TOKEN } from '~/constants/system.constant'
import {
  marlinHotspotCandidates,
  marlinHotspotSources,
  marlinHotspotThemes,
} from '~/database/schema'
import {
  BaseRepository,
  type PaginationResult,
} from '~/processors/database/base.repository'
import type { AppDatabase } from '~/processors/database/postgres.provider'
import { SnowflakeService } from '~/shared/id/snowflake.service'

import type {
  MarlinHotspotCandidateListInput,
  MarlinHotspotSourceInput,
  MarlinHotspotThemeInput,
} from './marlin-hotspot.schema'

@Injectable()
export class MarlinHotspotRepository extends BaseRepository {
  constructor(
    @Inject(PG_DB_TOKEN) db: AppDatabase,
    private readonly snowflake: SnowflakeService,
  ) {
    super(db)
  }

  async createTheme(input: MarlinHotspotThemeInput) {
    const [row] = await this.db
      .insert(marlinHotspotThemes)
      .values({ id: this.snowflake.nextId(), ...input })
      .returning()
    return row
  }

  listThemes() {
    return this.db
      .select()
      .from(marlinHotspotThemes)
      .orderBy(desc(marlinHotspotThemes.createdAt))
  }

  async patchTheme(id: string, patch: Partial<MarlinHotspotThemeInput>) {
    const [row] = await this.db
      .update(marlinHotspotThemes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(marlinHotspotThemes.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async createSource(input: MarlinHotspotSourceInput) {
    const [row] = await this.db
      .insert(marlinHotspotSources)
      .values({
        id: this.snowflake.nextId(),
        ...input,
        themeId: input.themeId ?? null,
      })
      .returning()
    return row
  }

  listSources() {
    return this.db
      .select()
      .from(marlinHotspotSources)
      .orderBy(desc(marlinHotspotSources.createdAt))
  }

  async findSource(id: string) {
    const [row] = await this.db
      .select()
      .from(marlinHotspotSources)
      .where(eq(marlinHotspotSources.id, this.toDbId(id)))
      .limit(1)
    return row ?? null
  }

  async findTheme(id: string) {
    const [row] = await this.db
      .select()
      .from(marlinHotspotThemes)
      .where(eq(marlinHotspotThemes.id, this.toDbId(id)))
      .limit(1)
    return row ?? null
  }

  async patchSource(id: string, patch: Partial<MarlinHotspotSourceInput>) {
    const [row] = await this.db
      .update(marlinHotspotSources)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(marlinHotspotSources.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async countToday(sourceId: string, themeId?: string | null) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const [[{ sourceCount }], [{ themeCount }]] = await Promise.all([
      this.db
        .select({ sourceCount: sql<number>`count(*)::int` })
        .from(marlinHotspotCandidates)
        .where(
          and(
            eq(marlinHotspotCandidates.sourceId, this.toDbId(sourceId)),
            gte(marlinHotspotCandidates.createdAt, start),
          ),
        ),
      themeId
        ? this.db
            .select({ themeCount: sql<number>`count(*)::int` })
            .from(marlinHotspotCandidates)
            .where(
              and(
                eq(marlinHotspotCandidates.themeId, this.toDbId(themeId)),
                gte(marlinHotspotCandidates.createdAt, start),
              ),
            )
        : Promise.resolve([{ themeCount: 0 }]),
    ])
    return {
      source: Number(sourceCount ?? 0),
      theme: Number(themeCount ?? 0),
    }
  }

  async insertCandidates(
    items: Array<typeof marlinHotspotCandidates.$inferInsert>,
  ) {
    if (!items.length) return []
    return this.db
      .insert(marlinHotspotCandidates)
      .values(items)
      .onConflictDoNothing({ target: marlinHotspotCandidates.eventHash })
      .returning()
  }

  async markSourceFetched(id: string, error?: string) {
    await this.db
      .update(marlinHotspotSources)
      .set({
        lastFetchedAt: new Date(),
        lastError: error?.slice(0, 5000) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(marlinHotspotSources.id, this.toDbId(id)))
  }

  async listCandidates(
    input: MarlinHotspotCandidateListInput,
  ): Promise<PaginationResult<typeof marlinHotspotCandidates.$inferSelect>> {
    const conditions: SQL[] = []
    if (input.status) {
      conditions.push(eq(marlinHotspotCandidates.status, input.status))
    }
    if (input.themeId) {
      conditions.push(
        eq(marlinHotspotCandidates.themeId, this.toDbId(input.themeId)),
      )
    }
    const where = conditions.length ? and(...conditions) : undefined
    const page = input.page ?? 1
    const size = input.size ?? 10
    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(marlinHotspotCandidates)
        .where(where)
        .orderBy(
          desc(marlinHotspotCandidates.score),
          desc(marlinHotspotCandidates.createdAt),
        )
        .limit(size)
        .offset((page - 1) * size),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(marlinHotspotCandidates)
        .where(where),
    ])
    return {
      data: rows,
      pagination: this.paginationOf(Number(count ?? 0), page, size),
    }
  }

  async setCandidateStatus(
    id: string,
    status: 'inbox' | 'selected' | 'dismissed',
  ) {
    const [row] = await this.db
      .update(marlinHotspotCandidates)
      .set({ status })
      .where(eq(marlinHotspotCandidates.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  nextId() {
    return this.snowflake.nextId()
  }
}
