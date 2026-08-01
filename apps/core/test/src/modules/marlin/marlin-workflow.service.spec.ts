import { describe, expect, it, vi } from 'vitest'

import type { CategoryService } from '~/modules/category/category.service'
import type { ConfigsService } from '~/modules/configs/configs.service'
import type { MarlinWorkflowRepository } from '~/modules/marlin/workflow/marlin-workflow.repository'
import { MarlinWorkflowService } from '~/modules/marlin/workflow/marlin-workflow.service'
import type { PostService } from '~/modules/post/post.service'
import type { EmailService } from '~/processors/helper/helper.email.service'

const createService = () => {
  const repository = {
    attachMaterials: vi.fn(),
    createReviewRequest: vi.fn(),
    createPublication: vi.fn(),
    approveCurrentRevision: vi.fn(),
    decideReview: vi.fn(),
    deleteProject: vi.fn(),
    findProject: vi.fn(),
    findPublishedRevision: vi.fn(),
    findReview: vi.fn(),
    updateReviewEmailDelivery: vi.fn(),
  }
  const categoryService = { findCategoryById: vi.fn() }
  const postService = { create: vi.fn(), updateById: vi.fn() }
  const configsService = { waitForConfigReady: vi.fn() }
  const emailService = { checkIsReady: vi.fn(), send: vi.fn() }
  const service = new MarlinWorkflowService(
    repository as unknown as MarlinWorkflowRepository,
    categoryService as unknown as CategoryService,
    postService as unknown as PostService,
    configsService as unknown as ConfigsService,
    emailService as unknown as EmailService,
  )
  return {
    categoryService,
    configsService,
    emailService,
    postService,
    repository,
    service,
  }
}

describe('MarlinWorkflowService', () => {
  it('deletes a local draft and its workflow records', async () => {
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      status: 'draft',
      corePostId: null,
    })
    repository.deleteProject.mockResolvedValue({ id: 'project-1' })

    await expect(service.deleteProject('project-1')).resolves.toEqual({
      id: 'project-1',
      deleted: true,
    })
    expect(repository.deleteProject).toHaveBeenCalledWith('project-1')
  })

  it('requires withdrawing a published Core post before local deletion', async () => {
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      status: 'published',
      corePostId: 'post-1',
    })

    await expect(service.deleteProject('project-1')).rejects.toThrow(
      'Withdraw the published Core post',
    )
    expect(repository.deleteProject).not.toHaveBeenCalled()
  })

  it('blocks pending materials from entering a creation project', async () => {
    const { repository, service } = createService()
    repository.attachMaterials.mockResolvedValue({
      project: { id: 'project-1' },
      missingMaterial: false,
      pendingMaterial: true,
      attached: [],
    })

    await expect(
      service.attachMaterials('project-1', ['material-1']),
    ).rejects.toThrow('Pending materials')
  })

  it('returns a one-time review passcode while persisting only a salted hash', async () => {
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      currentRevisionId: 'revision-1',
    })
    repository.createReviewRequest.mockImplementation(async (input) => ({
      request: {
        id: 'review-1',
        projectId: input.projectId,
        revisionId: input.revisionId,
        passcodeHash: input.passcodeHash,
        expiresAt: input.expiresAt,
        status: 'pending',
      },
      revision: { id: input.revisionId },
    }))

    const result = await service.requestReview('project-1', {
      expiresInHours: 24,
    })
    const persisted = repository.createReviewRequest.mock.calls[0][0]

    expect(result.passcode).toMatch(/^\d{6}$/)
    expect(persisted.passcodeHash).not.toContain(result.passcode)
    expect(result.request).not.toHaveProperty('passcodeHash')
  })

  it('generates a one-time passcode when the compose environment is empty', async () => {
    const previousPasscode = process.env.MARLIN_REVIEW_PASSCODE
    process.env.MARLIN_REVIEW_PASSCODE = ''
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      currentRevisionId: 'revision-1',
    })
    repository.createReviewRequest.mockImplementation(async (input) => ({
      request: {
        id: 'review-1',
        projectId: input.projectId,
        revisionId: input.revisionId,
        passcodeHash: input.passcodeHash,
        expiresAt: input.expiresAt,
        status: 'pending',
      },
      revision: { id: input.revisionId },
    }))

    try {
      const result = await service.requestReview('project-1', {
        expiresInHours: 24,
      })

      expect(result.passcode).toMatch(/^\d{6}$/)
      expect(result.passcodeConfigured).toBe(false)
    } finally {
      if (previousPasscode === undefined) {
        delete process.env.MARLIN_REVIEW_PASSCODE
      } else {
        process.env.MARLIN_REVIEW_PASSCODE = previousPasscode
      }
    }
  })

  it('emails the external reviewer and records delivery status', async () => {
    const { configsService, emailService, repository, service } =
      createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      title: '待审文章',
      currentRevisionId: 'revision-1',
    })
    repository.createReviewRequest.mockImplementation(async (input) => ({
      request: {
        id: 'review-1',
        projectId: input.projectId,
        revisionId: input.revisionId,
        passcodeHash: input.passcodeHash,
        expiresAt: input.expiresAt,
        status: 'pending',
      },
      revision: { id: input.revisionId, version: 3 },
    }))
    configsService.waitForConfigReady.mockResolvedValue({
      url: { webUrl: 'https://example.com' },
      seo: { title: 'MARLIN.LOG' },
      mailOptions: {
        enable: true,
        from: 'owner@example.com',
        smtp: {},
      },
    })
    emailService.checkIsReady.mockResolvedValue(true)
    emailService.send.mockResolvedValue({ accepted: ['reviewer@example.com'] })

    const result = await service.requestReview('project-1', {
      expiresInHours: 24,
      reviewerEmail: 'reviewer@example.com',
    })

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'reviewer@example.com',
        subject: expect.stringContaining('待审文章'),
        text: expect.stringContaining(
          'https://example.com/studio/review/review-1',
        ),
      }),
    )
    expect(emailService.send.mock.calls[0][0].text).not.toContain(
      result.passcode,
    )
    expect(repository.updateReviewEmailDelivery).toHaveBeenCalledWith(
      'review-1',
      { status: 'sent' },
    )
    expect(result.emailDelivery).toEqual({
      status: 'sent',
      to: 'reviewer@example.com',
    })
  })

  it('refuses to publish a revision different from the approved snapshot', async () => {
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      approvedRevisionId: 'revision-approved',
    })

    await expect(
      service.publish('project-1', { revisionId: 'revision-working' }),
    ).rejects.toThrow('exact approved revision')
  })

  it('returns the original decision for an idempotent review replay', async () => {
    const { repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      currentRevisionId: 'revision-1',
    })
    repository.createReviewRequest.mockImplementation(async (input) => ({
      request: {
        id: 'review-1',
        projectId: input.projectId,
        revisionId: input.revisionId,
        passcodeHash: input.passcodeHash,
        expiresAt: input.expiresAt,
        status: 'pending',
      },
      revision: { id: input.revisionId },
    }))
    const issued = await service.requestReview('project-1', {
      expiresInHours: 24,
    })
    const persisted = repository.createReviewRequest.mock.calls[0][0]
    repository.findReview.mockResolvedValue({
      request: {
        id: 'review-1',
        status: 'approved',
        passcodeHash: persisted.passcodeHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
      revision: { id: 'revision-1' },
      project: { id: 'project-1' },
    })
    repository.decideReview = vi.fn().mockResolvedValue({
      decision: { id: 'decision-1', decision: 'approve' },
      replayed: true,
    })

    const result = await service.decideReview('review-1', {
      passcode: issued.passcode,
      decision: 'approve',
      idempotencyKey: 'same-request-key',
    })

    expect(result.replayed).toBe(true)
  })

  it('schedules the exact approved revision without publishing early', async () => {
    const { postService, repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      approvedRevisionId: 'revision-1',
    })
    repository.createPublication.mockResolvedValue({ id: 'publication-1' })
    const scheduledAt = new Date(Date.now() + 60_000)

    await service.publish('project-1', {
      revisionId: 'revision-1',
      scheduledAt,
    })

    expect(postService.create).not.toHaveBeenCalled()
    expect(repository.createPublication).toHaveBeenCalledWith({
      projectId: 'project-1',
      revisionId: 'revision-1',
      status: 'scheduled',
      scheduledAt,
    })
  })

  it('publishes an approved revision into a Core post', async () => {
    const { postService, repository, service } = createService()
    repository.findProject.mockResolvedValue({
      id: 'project-1',
      approvedRevisionId: 'revision-1',
    })
    repository.findPublishedRevision.mockResolvedValue({
      project: {
        id: 'project-1',
        approvedRevisionId: 'revision-1',
        corePostId: null,
      },
      revision: {
        id: 'revision-1',
        version: 1,
        title: 'Article',
        slug: 'article',
        summary: 'Summary',
        content: '# Article',
        categoryId: 'category-1',
        tags: ['marlin'],
        copyright: true,
        metadata: {},
      },
    })
    postService.create.mockResolvedValue({ id: 'post-1' })
    repository.createPublication.mockResolvedValue({ id: 'publication-1' })

    await service.publish('project-1', { revisionId: 'revision-1' })

    expect(postService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Article',
        isPublished: true,
        text: '# Article',
      }),
    )
    expect(repository.createPublication).toHaveBeenCalledWith({
      projectId: 'project-1',
      revisionId: 'revision-1',
      status: 'published',
      corePostId: 'post-1',
    })
  })

  it('publishes the current personal draft without exposing approval steps', async () => {
    const { postService, repository, service } = createService()
    repository.findProject
      .mockResolvedValueOnce({
        id: 'project-1',
        currentRevisionId: 'revision-2',
      })
      .mockResolvedValueOnce({
        id: 'project-1',
        approvedRevisionId: 'revision-2',
      })
    repository.approveCurrentRevision.mockResolvedValue({
      id: 'project-1',
      approvedRevisionId: 'revision-2',
    })
    repository.findPublishedRevision.mockResolvedValue({
      project: {
        id: 'project-1',
        approvedRevisionId: 'revision-2',
        corePostId: null,
      },
      revision: {
        id: 'revision-2',
        version: 2,
        title: 'Article',
        slug: 'article',
        summary: null,
        content: '# Article',
        categoryId: 'category-1',
        tags: [],
        copyright: true,
        metadata: {},
      },
    })
    postService.create.mockResolvedValue({ id: 'post-1' })
    repository.createPublication.mockResolvedValue({ id: 'publication-1' })

    await service.publishCurrent('project-1', {})

    expect(repository.approveCurrentRevision).toHaveBeenCalledWith(
      'project-1',
      'revision-2',
    )
    expect(postService.create).toHaveBeenCalledOnce()
  })
})
