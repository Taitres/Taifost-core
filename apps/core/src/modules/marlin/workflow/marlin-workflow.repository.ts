import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, ilike, inArray, max, type SQL, sql } from 'drizzle-orm'

import { PG_DB_TOKEN } from '~/constants/system.constant'
import {
  marlinMaterials,
  marlinProjectMaterials,
  marlinProjects,
  marlinPublications,
  marlinReviewDecisions,
  marlinReviewRequests,
  marlinRevisions,
} from '~/database/schema'
import {
  BaseRepository,
  type PaginationResult,
} from '~/processors/database/base.repository'
import type { AppDatabase } from '~/processors/database/postgres.provider'
import { SnowflakeService } from '~/shared/id/snowflake.service'

import type {
  MarlinProjectCreateInput,
  MarlinProjectListInput,
  MarlinProjectPatchInput,
  MarlinRevisionCreateInput,
} from './marlin-workflow.schema'

@Injectable()
export class MarlinWorkflowRepository extends BaseRepository {
  constructor(
    @Inject(PG_DB_TOKEN) db: AppDatabase,
    private readonly snowflake: SnowflakeService,
  ) {
    super(db)
  }

  async createProject(input: MarlinProjectCreateInput) {
    const [row] = await this.db
      .insert(marlinProjects)
      .values({ id: this.snowflake.nextId(), ...input })
      .returning()
    return row
  }

  async patchProject(id: string, patch: MarlinProjectPatchInput) {
    const [row] = await this.db
      .update(marlinProjects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(marlinProjects.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async linkCoreDraft(projectIdInput: string, corePostId: string) {
    const [project] = await this.db
      .update(marlinProjects)
      .set({
        corePostId,
        status: 'in_review',
        updatedAt: new Date(),
      })
      .where(eq(marlinProjects.id, this.toDbId(projectIdInput)))
      .returning()
    return project ?? null
  }

  async deleteProject(id: string) {
    const projectId = this.toDbId(id)
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(marlinProjects)
        .where(eq(marlinProjects.id, projectId))
        .limit(1)
        .for('update')
      if (!project) return null

      // Review decisions cascade from requests. Requests and publications must
      // be removed before the project cascade reaches their restricted revision.
      await tx
        .delete(marlinReviewRequests)
        .where(eq(marlinReviewRequests.projectId, projectId))
      await tx
        .delete(marlinPublications)
        .where(eq(marlinPublications.projectId, projectId))
      const [deleted] = await tx
        .delete(marlinProjects)
        .where(eq(marlinProjects.id, projectId))
        .returning()
      return deleted ?? null
    })
  }

  async listProjects(
    input: MarlinProjectListInput,
  ): Promise<PaginationResult<typeof marlinProjects.$inferSelect>> {
    const page = input.page ?? 1
    const size = input.size ?? 10
    const conditions: SQL[] = []
    if (input.status) conditions.push(eq(marlinProjects.status, input.status))
    if (input.search) {
      conditions.push(ilike(marlinProjects.title, `%${input.search}%`))
    }
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(marlinProjects)
        .where(where)
        .orderBy(desc(marlinProjects.updatedAt), desc(marlinProjects.createdAt))
        .limit(size)
        .offset((page - 1) * size),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(marlinProjects)
        .where(where),
    ])
    return {
      data: rows,
      pagination: this.paginationOf(Number(count ?? 0), page, size),
    }
  }

  async findProject(id: string) {
    const projectId = this.toDbId(id)
    const [project] = await this.db
      .select()
      .from(marlinProjects)
      .where(eq(marlinProjects.id, projectId))
      .limit(1)
    if (!project) return null

    const [materials, revisions, reviews, publications] = await Promise.all([
      this.db
        .select({ material: marlinMaterials })
        .from(marlinProjectMaterials)
        .innerJoin(
          marlinMaterials,
          eq(marlinProjectMaterials.materialId, marlinMaterials.id),
        )
        .where(eq(marlinProjectMaterials.projectId, projectId))
        .orderBy(desc(marlinProjectMaterials.createdAt)),
      this.db
        .select()
        .from(marlinRevisions)
        .where(eq(marlinRevisions.projectId, projectId))
        .orderBy(desc(marlinRevisions.version)),
      this.db
        .select()
        .from(marlinReviewRequests)
        .where(eq(marlinReviewRequests.projectId, projectId))
        .orderBy(desc(marlinReviewRequests.createdAt)),
      this.db
        .select()
        .from(marlinPublications)
        .where(eq(marlinPublications.projectId, projectId))
        .orderBy(desc(marlinPublications.createdAt)),
    ])

    return {
      ...project,
      materials: materials.map(({ material }) => material),
      revisions,
      reviews: reviews.map(({ passcodeHash: _, ...review }) => review),
      publications,
    }
  }

  async attachMaterials(projectIdInput: string, materialIdsInput: string[]) {
    const projectId = this.toDbId(projectIdInput)
    const materialIds = materialIdsInput.map((id) => this.toDbId(id))
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: marlinProjects.id })
        .from(marlinProjects)
        .where(eq(marlinProjects.id, projectId))
        .limit(1)
      if (!project) return null

      const existingMaterials = await tx
        .select({ id: marlinMaterials.id, status: marlinMaterials.status })
        .from(marlinMaterials)
        .where(inArray(marlinMaterials.id, materialIds))
      if (existingMaterials.length !== new Set(materialIds).size) {
        return {
          project,
          missingMaterial: true,
          pendingMaterial: false,
          attached: [],
        }
      }
      if (existingMaterials.some(({ status }) => status === 'pending')) {
        return {
          project,
          missingMaterial: false,
          pendingMaterial: true,
          attached: [],
        }
      }

      const attached = await tx
        .insert(marlinProjectMaterials)
        .values(
          [...new Set(materialIds)].map((materialId) => ({
            projectId,
            materialId,
          })),
        )
        .onConflictDoNothing()
        .returning()
      await tx
        .update(marlinProjects)
        .set({ updatedAt: new Date() })
        .where(eq(marlinProjects.id, projectId))
      return {
        project,
        missingMaterial: false,
        pendingMaterial: false,
        attached,
      }
    })
  }

  async createRevision(
    projectIdInput: string,
    input: MarlinRevisionCreateInput,
  ) {
    const projectId = this.toDbId(projectIdInput)
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(marlinProjects)
        .where(eq(marlinProjects.id, projectId))
        .limit(1)
        .for('update')
      if (!project) return null

      const [{ latestVersion }] = await tx
        .select({ latestVersion: max(marlinRevisions.version) })
        .from(marlinRevisions)
        .where(eq(marlinRevisions.projectId, projectId))
      const version = Number(latestVersion ?? 0) + 1
      const [revision] = await tx
        .insert(marlinRevisions)
        .values({
          id: this.snowflake.nextId(),
          projectId,
          version,
          ...input,
        })
        .returning()
      await tx
        .update(marlinProjects)
        .set({
          currentRevisionId: revision.id,
          status: 'ready',
          updatedAt: new Date(),
        })
        .where(eq(marlinProjects.id, projectId))
      return revision
    })
  }

  async findRevision(id: string) {
    const [row] = await this.db
      .select()
      .from(marlinRevisions)
      .where(eq(marlinRevisions.id, this.toDbId(id)))
      .limit(1)
    return row ?? null
  }

  async approveCurrentRevision(
    projectIdInput: string,
    revisionIdInput: string,
  ) {
    const projectId = this.toDbId(projectIdInput)
    const revisionId = this.toDbId(revisionIdInput)
    const [row] = await this.db
      .update(marlinProjects)
      .set({
        status: 'approved',
        approvedRevisionId: revisionId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(marlinProjects.id, projectId),
          eq(marlinProjects.currentRevisionId, revisionId),
        ),
      )
      .returning()
    return row ?? null
  }

  async createReviewRequest(input: {
    projectId: string
    revisionId: string
    passcodeHash: string
    expiresAt: Date
    reviewerEmail?: string
  }) {
    const projectId = this.toDbId(input.projectId)
    const revisionId = this.toDbId(input.revisionId)
    return this.db.transaction(async (tx) => {
      const [revision] = await tx
        .select()
        .from(marlinRevisions)
        .where(
          and(
            eq(marlinRevisions.id, revisionId),
            eq(marlinRevisions.projectId, projectId),
          ),
        )
        .limit(1)
      if (!revision) return null

      await tx
        .update(marlinReviewRequests)
        .set({ status: 'superseded', decidedAt: new Date() })
        .where(
          and(
            eq(marlinReviewRequests.projectId, projectId),
            eq(marlinReviewRequests.status, 'pending'),
          ),
        )
      const [request] = await tx
        .insert(marlinReviewRequests)
        .values({
          id: this.snowflake.nextId(),
          projectId,
          revisionId,
          passcodeHash: input.passcodeHash,
          expiresAt: input.expiresAt,
          reviewerEmail: input.reviewerEmail,
          emailStatus: input.reviewerEmail ? 'pending' : 'not_requested',
        })
        .returning()
      await tx
        .update(marlinProjects)
        .set({ status: 'in_review', updatedAt: new Date() })
        .where(eq(marlinProjects.id, projectId))
      return { request, revision }
    })
  }

  async updateReviewEmailDelivery(
    id: string,
    delivery: { status: 'sent' | 'failed'; error?: string },
  ) {
    const [row] = await this.db
      .update(marlinReviewRequests)
      .set({
        emailStatus: delivery.status,
        emailError: delivery.error ?? null,
        emailedAt: delivery.status === 'sent' ? new Date() : null,
      })
      .where(eq(marlinReviewRequests.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async findReview(id: string) {
    const [row] = await this.db
      .select({
        request: marlinReviewRequests,
        revision: marlinRevisions,
        project: marlinProjects,
      })
      .from(marlinReviewRequests)
      .innerJoin(
        marlinRevisions,
        eq(marlinReviewRequests.revisionId, marlinRevisions.id),
      )
      .innerJoin(
        marlinProjects,
        eq(marlinReviewRequests.projectId, marlinProjects.id),
      )
      .where(eq(marlinReviewRequests.id, this.toDbId(id)))
      .limit(1)
    return row ?? null
  }

  async decideReview(input: {
    requestId: string
    decision: 'approve' | 'reject'
    comment?: string
    idempotencyKey: string
  }) {
    const requestId = this.toDbId(input.requestId)
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(marlinReviewDecisions)
        .where(eq(marlinReviewDecisions.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { decision: existing, replayed: true }

      const [request] = await tx
        .update(marlinReviewRequests)
        .set({
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(marlinReviewRequests.id, requestId),
            eq(marlinReviewRequests.status, 'pending'),
          ),
        )
        .returning()
      if (!request) return null

      const [decision] = await tx
        .insert(marlinReviewDecisions)
        .values({
          id: this.snowflake.nextId(),
          requestId,
          revisionId: request.revisionId,
          decision: input.decision,
          comment: input.comment,
          idempotencyKey: input.idempotencyKey,
        })
        .returning()
      await tx
        .update(marlinProjects)
        .set({
          status:
            input.decision === 'approve' ? 'approved' : 'changes_requested',
          approvedRevisionId:
            input.decision === 'approve' ? request.revisionId : undefined,
          updatedAt: new Date(),
        })
        .where(eq(marlinProjects.id, request.projectId))
      return { decision, replayed: false }
    })
  }

  async findPublishedRevision(projectIdInput: string, revisionIdInput: string) {
    const projectId = this.toDbId(projectIdInput)
    const revisionId = this.toDbId(revisionIdInput)
    const [row] = await this.db
      .select({ project: marlinProjects, revision: marlinRevisions })
      .from(marlinProjects)
      .innerJoin(
        marlinRevisions,
        and(
          eq(marlinRevisions.id, revisionId),
          eq(marlinRevisions.projectId, marlinProjects.id),
        ),
      )
      .where(eq(marlinProjects.id, projectId))
      .limit(1)
    return row ?? null
  }

  async hasApprovedReview(revisionIdInput: string) {
    const [row] = await this.db
      .select({ id: marlinReviewRequests.id })
      .from(marlinReviewRequests)
      .where(
        and(
          eq(marlinReviewRequests.revisionId, this.toDbId(revisionIdInput)),
          eq(marlinReviewRequests.status, 'approved'),
        ),
      )
      .limit(1)
    return Boolean(row)
  }

  async createPublication(input: {
    projectId: string
    revisionId: string
    status: 'scheduled' | 'published'
    corePostId?: string
    scheduledAt?: Date
  }) {
    return this.db.transaction(async (tx) => {
      const [publication] = await tx
        .insert(marlinPublications)
        .values({
          id: this.snowflake.nextId(),
          projectId: this.toDbId(input.projectId),
          revisionId: this.toDbId(input.revisionId),
          status: input.status,
          corePostId: input.corePostId,
          scheduledAt: input.scheduledAt,
          publishedAt: input.status === 'published' ? new Date() : undefined,
        })
        .returning()
      await tx
        .update(marlinProjects)
        .set({
          status: input.status,
          corePostId: input.corePostId,
          publishedRevisionId:
            input.status === 'published'
              ? this.toDbId(input.revisionId)
              : undefined,
          updatedAt: new Date(),
        })
        .where(eq(marlinProjects.id, this.toDbId(input.projectId)))
      return publication
    })
  }

  async findScheduledPublications(now: Date) {
    return this.db
      .select()
      .from(marlinPublications)
      .where(
        and(
          eq(marlinPublications.status, 'scheduled'),
          sql`${marlinPublications.scheduledAt} <= ${now}`,
        ),
      )
      .orderBy(marlinPublications.scheduledAt)
      .limit(20)
  }

  async markPublicationPublished(id: string, corePostId: string) {
    const [publication] = await this.db
      .update(marlinPublications)
      .set({ status: 'published', corePostId, publishedAt: new Date() })
      .where(eq(marlinPublications.id, this.toDbId(id)))
      .returning()
    if (publication) {
      await this.db
        .update(marlinProjects)
        .set({
          status: 'published',
          corePostId,
          publishedRevisionId: publication.revisionId,
          updatedAt: new Date(),
        })
        .where(eq(marlinProjects.id, publication.projectId))
    }
    return publication ?? null
  }

  async markPublicationFailed(id: string, error: string) {
    const [row] = await this.db
      .update(marlinPublications)
      .set({ status: 'failed', error: error.slice(0, 5000) })
      .where(eq(marlinPublications.id, this.toDbId(id)))
      .returning()
    return row ?? null
  }

  async withdrawProject(projectIdInput: string) {
    const projectId = this.toDbId(projectIdInput)
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(marlinProjects)
        .where(eq(marlinProjects.id, projectId))
        .limit(1)
      if (!project) return null
      await tx
        .update(marlinPublications)
        .set({ status: 'withdrawn', withdrawnAt: new Date() })
        .where(
          and(
            eq(marlinPublications.projectId, projectId),
            eq(marlinPublications.status, 'published'),
          ),
        )
      const [updated] = await tx
        .update(marlinProjects)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(eq(marlinProjects.id, projectId))
        .returning()
      return updated
    })
  }
}
