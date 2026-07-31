import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { CategoryService } from '~/modules/category/category.service'
import { ConfigsService } from '~/modules/configs/configs.service'
import { PostService } from '~/modules/post/post.service'
import { EmailService } from '~/processors/helper/helper.email.service'
import { ContentFormat } from '~/shared/types/content-format.type'

import { MarlinWorkflowRepository } from './marlin-workflow.repository'
import type {
  MarlinProjectCreateInput,
  MarlinProjectPatchInput,
  MarlinReviewDecisionInput,
  MarlinRevisionCreateInput,
} from './marlin-workflow.schema'

@Injectable()
export class MarlinWorkflowService {
  constructor(
    private readonly repository: MarlinWorkflowRepository,
    private readonly categoryService: CategoryService,
    private readonly postService: PostService,
    private readonly configsService: ConfigsService,
    private readonly emailService: EmailService,
  ) {}

  createProject(input: MarlinProjectCreateInput) {
    return this.repository.createProject(input)
  }

  async patchProject(id: string, patch: MarlinProjectPatchInput) {
    const project = await this.repository.patchProject(id, patch)
    if (!project) throw new NotFoundException('MARLIN project not found')
    return project
  }

  async attachMaterials(projectId: string, materialIds: string[]) {
    const result = await this.repository.attachMaterials(projectId, materialIds)
    if (!result) throw new NotFoundException('MARLIN project not found')
    if (result.missingMaterial) {
      throw new BadRequestException('One or more materials do not exist')
    }
    if (result.pendingMaterial) {
      throw new ConflictException(
        'Pending materials must resolve or explicitly ignore every remote image before entering a project',
      )
    }
    return result
  }

  async createRevision(projectId: string, input: MarlinRevisionCreateInput) {
    const category = await this.categoryService.findCategoryById(
      input.categoryId,
    )
    if (!category) throw new BadRequestException('Category does not exist')
    const revision = await this.repository.createRevision(projectId, input)
    if (!revision) throw new NotFoundException('MARLIN project not found')
    return revision
  }

  private hashPasscode(passcode: string) {
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(passcode, salt, 32).toString('hex')
    return `${salt}:${hash}`
  }

  private verifyPasscode(passcode: string, stored: string) {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const actual = scryptSync(passcode, salt, 32)
    const expected = Buffer.from(hash, 'hex')
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    )
  }

  async requestReview(
    projectId: string,
    input: {
      revisionId?: string
      expiresInHours: number
      reviewerEmail?: string
    },
  ) {
    const project = await this.repository.findProject(projectId)
    if (!project) throw new NotFoundException('MARLIN project not found')
    const revisionId = input.revisionId ?? project.currentRevisionId
    if (!revisionId) {
      throw new BadRequestException(
        'Create a revision before requesting review',
      )
    }
    const configuredPasscode = process.env.MARLIN_REVIEW_PASSCODE?.trim()
    if (configuredPasscode && !/^\d{6}$/.test(configuredPasscode)) {
      throw new BadRequestException(
        'MARLIN_REVIEW_PASSCODE must contain exactly six digits',
      )
    }
    const passcode =
      configuredPasscode || randomInt(0, 1_000_000).toString().padStart(6, '0')
    const result = await this.repository.createReviewRequest({
      projectId,
      revisionId,
      passcodeHash: this.hashPasscode(passcode),
      expiresAt: new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000),
      reviewerEmail: input.reviewerEmail,
    })
    if (!result) {
      throw new BadRequestException('Revision does not belong to this project')
    }
    let emailDelivery:
      | { status: 'not_requested' }
      | { status: 'sent'; to: string }
      | { status: 'failed'; to: string; error: string } = {
      status: 'not_requested',
    }
    if (input.reviewerEmail) {
      try {
        const [{ url, seo, mailOptions }, ready] = await Promise.all([
          this.configsService.waitForConfigReady(),
          this.emailService.checkIsReady(),
        ])
        if (!ready || !mailOptions.enable) {
          throw new Error('Core email delivery is not configured')
        }
        const senderEmail = mailOptions.from || mailOptions.smtp?.user
        if (!senderEmail) throw new Error('Core email sender is not configured')
        const reviewUrl = new URL(
          `/studio/review/${result.request.id}`,
          url.webUrl || 'http://localhost:2323',
        ).href
        await this.emailService.send({
          from: `"${seo.title || 'MARLIN.LOG'}" <${senderEmail}>`,
          to: input.reviewerEmail,
          subject: `[MARLIN 审阅] ${project.title} · v${result.revision.version}`,
          text: [
            `请审阅：${project.title}`,
            `修订版本：v${result.revision.version}`,
            `审阅地址：${reviewUrl}`,
            '请使用站主另行提供的长期六位审批口令。',
            `有效期至：${result.request.expiresAt.toISOString()}`,
            '审阅通过不会自动发布，最终发布仍由站点所有者确认。',
          ].join('\n'),
        })
        await this.repository.updateReviewEmailDelivery(result.request.id, {
          status: 'sent',
        })
        emailDelivery = { status: 'sent', to: input.reviewerEmail }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.repository.updateReviewEmailDelivery(result.request.id, {
          status: 'failed',
          error: message,
        })
        emailDelivery = {
          status: 'failed',
          to: input.reviewerEmail,
          error: message,
        }
      }
    }
    const { passcodeHash: _, ...request } =
      (await this.repository.findReview(result.request.id))?.request ??
      result.request
    return {
      request,
      passcode: configuredPasscode ? null : passcode,
      passcodeConfigured: Boolean(configuredPasscode),
      reviewPath: `/studio/review/${request.id}`,
      emailDelivery,
    }
  }

  private async accessReview(id: string, passcode: string) {
    const result = await this.repository.findReview(id)
    if (!result) throw new NotFoundException('Review request not found')
    if (
      result.request.expiresAt.getTime() < Date.now() ||
      !this.verifyPasscode(passcode, result.request.passcodeHash)
    ) {
      throw new ForbiddenException('Review passcode is invalid or expired')
    }
    return result
  }

  async previewReview(id: string, passcode: string) {
    const { request, revision, project } = await this.accessReview(id, passcode)
    const { passcodeHash: _, ...safeRequest } = request
    return {
      request: safeRequest,
      project: { id: project.id, title: project.title },
      revision,
    }
  }

  async decideReview(id: string, input: MarlinReviewDecisionInput) {
    await this.accessReview(id, input.passcode)
    const result = await this.repository.decideReview({
      requestId: id,
      decision: input.decision,
      comment: input.comment,
      idempotencyKey: input.idempotencyKey,
    })
    if (!result)
      throw new ConflictException('Review request is no longer pending')
    return result
  }

  private async publishToCore(projectId: string, revisionId: string) {
    const result = await this.repository.findPublishedRevision(
      projectId,
      revisionId,
    )
    if (!result) throw new NotFoundException('Project revision not found')
    const { project, revision } = result
    if (
      project.approvedRevisionId !== revision.id &&
      !(await this.repository.hasApprovedReview(revision.id))
    ) {
      throw new ConflictException(
        'Only the exact approved revision can be published',
      )
    }

    const postInput = {
      title: revision.title,
      slug: revision.slug,
      summary: revision.summary,
      text: revision.content,
      content: null,
      contentFormat: ContentFormat.Markdown,
      categoryId: revision.categoryId,
      tags: revision.tags,
      copyright: revision.copyright,
      isPublished: true,
      isPremium: false,
      images: [],
      meta: {
        ...revision.metadata,
        marlinProjectId: project.id,
        marlinRevisionId: revision.id,
        marlinRevisionVersion: revision.version,
      },
    }
    const post = project.corePostId
      ? await this.postService.updateById(project.corePostId, postInput as any)
      : await this.postService.create(postInput as any)
    if (!post) throw new Error('Core post publication failed')
    return post
  }

  async publish(
    projectId: string,
    input: { revisionId?: string; scheduledAt?: Date },
  ) {
    const project = await this.repository.findProject(projectId)
    if (!project) throw new NotFoundException('MARLIN project not found')
    const revisionId = input.revisionId ?? project.approvedRevisionId
    if (!revisionId || revisionId !== project.approvedRevisionId) {
      throw new ConflictException(
        'Publication must pin the exact approved revision',
      )
    }

    if (input.scheduledAt && input.scheduledAt.getTime() > Date.now()) {
      return this.repository.createPublication({
        projectId,
        revisionId,
        status: 'scheduled',
        scheduledAt: input.scheduledAt,
      })
    }

    const post = await this.publishToCore(projectId, revisionId)
    return this.repository.createPublication({
      projectId,
      revisionId,
      status: 'published',
      corePostId: post.id,
    })
  }

  /**
   * Personal publishing path: the owner explicitly clicks Publish, while the
   * internal approval pointer remains an implementation detail.
   */
  async publishCurrent(projectId: string, input: { scheduledAt?: Date }) {
    const project = await this.repository.findProject(projectId)
    if (!project) throw new NotFoundException('MARLIN project not found')
    if (!project.currentRevisionId) {
      throw new BadRequestException('Save the article before publishing')
    }
    const revisionId = String(project.currentRevisionId)
    const approved = await this.repository.approveCurrentRevision(
      projectId,
      revisionId,
    )
    if (!approved) {
      throw new ConflictException('The current article changed; please retry')
    }
    return this.publish(projectId, {
      revisionId,
      scheduledAt: input.scheduledAt,
    })
  }

  async publishDue() {
    const publications = await this.repository.findScheduledPublications(
      new Date(),
    )
    const results: Array<{ id: string; status: string }> = []
    for (const publication of publications) {
      try {
        const post = await this.publishToCore(
          publication.projectId,
          publication.revisionId,
        )
        await this.repository.markPublicationPublished(publication.id, post.id)
        results.push({ id: publication.id, status: 'published' })
      } catch (error) {
        await this.repository.markPublicationFailed(
          publication.id,
          error instanceof Error ? error.message : String(error),
        )
        results.push({ id: publication.id, status: 'failed' })
      }
    }
    return results
  }

  async withdraw(projectId: string) {
    const project = await this.repository.findProject(projectId)
    if (!project) throw new NotFoundException('MARLIN project not found')
    if (!project.corePostId) {
      throw new ConflictException('Project has no published Core post')
    }
    await this.postService.updateById(project.corePostId, {
      isPublished: false,
    })
    return this.repository.withdrawProject(projectId)
  }
}
