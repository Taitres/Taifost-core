import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gte, sql } from 'drizzle-orm'

import { PG_DB_TOKEN } from '~/constants/system.constant'
import { marlinAiRoles, marlinAiUsage } from '~/database/schema'
import { BaseRepository } from '~/processors/database/base.repository'
import type { AppDatabase } from '~/processors/database/postgres.provider'
import { SnowflakeService } from '~/shared/id/snowflake.service'

import type { MarlinAiRoleInput } from './marlin-ai.schema'

@Injectable()
export class MarlinAiRepository extends BaseRepository {
  constructor(
    @Inject(PG_DB_TOKEN) db: AppDatabase,
    private readonly snowflake: SnowflakeService,
  ) {
    super(db)
  }

  listRoles() {
    return this.db.select().from(marlinAiRoles).orderBy(marlinAiRoles.slot)
  }

  async findRole(slot: string) {
    const [row] = await this.db
      .select()
      .from(marlinAiRoles)
      .where(eq(marlinAiRoles.slot, slot))
      .limit(1)
    return row ?? null
  }

  async upsertRole(input: MarlinAiRoleInput) {
    const [row] = await this.db
      .insert(marlinAiRoles)
      .values({ id: this.snowflake.nextId(), ...input })
      .onConflictDoUpdate({
        target: marlinAiRoles.slot,
        set: { ...input, updatedAt: new Date() },
      })
      .returning()
    return row
  }

  async usageToday(roleId: string) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const [row] = await this.db
      .select({
        costCents: sql<number>`coalesce(sum(${marlinAiUsage.costCents}), 0)::int`,
        totalTokens: sql<number>`coalesce(sum(${marlinAiUsage.totalTokens}), 0)::int`,
      })
      .from(marlinAiUsage)
      .where(
        and(
          eq(marlinAiUsage.roleId, this.toDbId(roleId)),
          gte(marlinAiUsage.createdAt, start),
        ),
      )
    return {
      costCents: Number(row?.costCents ?? 0),
      totalTokens: Number(row?.totalTokens ?? 0),
    }
  }

  async recordUsage(input: {
    roleId: string
    projectId?: string
    operation: string
    providerId: string
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costCents: number
  }) {
    const [row] = await this.db
      .insert(marlinAiUsage)
      .values({
        id: this.snowflake.nextId(),
        ...input,
        roleId: this.toDbId(input.roleId),
        projectId: input.projectId ? this.toDbId(input.projectId) : null,
      })
      .returning()
    return row
  }
}
