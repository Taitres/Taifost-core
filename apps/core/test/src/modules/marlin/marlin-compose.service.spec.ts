import { describe, expect, it, vi } from 'vitest'

import { AppErrorCode, createAppException } from '~/common/errors'
import type { AiService } from '~/modules/ai/ai.service'
import type { CategoryService } from '~/modules/category/category.service'
import { MarlinComposeService } from '~/modules/marlin/compose/marlin-compose.service'
import type { MarlinMaterialService } from '~/modules/marlin/material/marlin-material.service'
import type { MarlinWorkflowService } from '~/modules/marlin/workflow/marlin-workflow.service'

const createService = () => {
  const materials = {
    import: vi.fn(),
    importUrl: vi.fn(),
    analyze: vi.fn(),
  }
  const workflow = {
    createProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
    attachMaterials: vi.fn().mockResolvedValue({ attached: [] }),
    createRevision: vi.fn().mockResolvedValue({ id: 'revision-1' }),
  }
  const categories = {
    findAllCategory: vi.fn().mockResolvedValue([
      { id: 'category-1', name: '默认', slug: 'default' },
      { id: 'category-2', name: '技术', slug: 'tech' },
    ]),
  }
  const runtime = {
    providerInfo: { id: 'writer', type: 'openai-compatible', model: 'model-1' },
    generateStructured: vi.fn().mockResolvedValue({
      output: {
        title: '自动生成的文章',
        slug: 'generated-article',
        summary: '自动摘要',
        content: '# 自动生成的文章\n\n完整正文。',
        tags: ['AI', '写作'],
        category: '技术',
      },
      usage: { totalTokens: 120 },
    }),
  }
  const ai = { getWriterModel: vi.fn().mockResolvedValue(runtime) }
  const service = new MarlinComposeService(
    materials as unknown as MarlinMaterialService,
    workflow as unknown as MarlinWorkflowService,
    categories as unknown as CategoryService,
    ai as unknown as AiService,
  )
  return { ai, categories, materials, runtime, service, workflow }
}

describe('MarlinComposeService', () => {
  it('turns one Markdown input into an analyzed, linked and editable draft', async () => {
    const { materials, service, workflow } = createService()
    materials.import.mockResolvedValue({
      material: { id: 'material-1', title: '来源标题' },
      deduplicated: false,
    })
    materials.analyze.mockResolvedValue({
      material: {
        id: 'material-1',
        title: '来源标题',
        content: '# 来源标题\n\n来源内容',
      },
      analysis: { media: [] },
    })

    const result = await service.compose({
      source: '# 来源标题\n\n来源内容',
      instruction: '',
    })

    expect(materials.import).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'markdown',
        title: '来源标题',
        content: '# 来源标题\n\n来源内容',
      }),
    )
    expect(materials.analyze).toHaveBeenCalledWith('material-1', {
      force: false,
      archiveImages: true,
      ignoreFailedImages: true,
    })
    expect(workflow.createProject).toHaveBeenCalledOnce()
    expect(workflow.attachMaterials).toHaveBeenCalledWith('project-1', [
      'material-1',
    ])
    expect(workflow.createRevision).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        title: '自动生成的文章',
        slug: 'generated-article',
        categoryId: 'category-2',
        content: expect.stringContaining('完整正文'),
      }),
    )
    expect(result).toMatchObject({
      project: { id: 'project-1' },
      revision: { id: 'revision-1' },
    })
  })

  it('detects a URL without asking for a source type or title', async () => {
    const { materials, service } = createService()
    materials.importUrl.mockResolvedValue({
      material: { id: 'material-2', title: '网页' },
      deduplicated: true,
    })
    materials.analyze.mockResolvedValue({
      material: { id: 'material-2', title: '网页', content: '网页正文' },
      analysis: { media: [{ status: 'ignored' }] },
    })

    const result = await service.compose({
      source: 'https://example.com/article',
      instruction: '写成简洁的评论',
    })

    expect(materials.importUrl).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      metadata: { importedFrom: 'marlin-compose' },
    })
    expect(materials.import).not.toHaveBeenCalled()
    expect(result.ignoredImages).toBe(1)
  })

  it('still delivers an editable draft when no AI provider is configured', async () => {
    const { ai, materials, service, workflow } = createService()
    ai.getWriterModel.mockRejectedValue(
      createAppException(AppErrorCode.AI_NOT_ENABLED),
    )
    materials.import.mockResolvedValue({
      material: { id: 'material-3', title: '极简创作说明' },
      deduplicated: false,
    })
    materials.analyze.mockResolvedValue({
      material: {
        id: 'material-3',
        title: '极简创作说明',
        content: '只粘贴来源，系统自动创建可编辑草稿。',
      },
      analysis: {
        summary: '只粘贴来源，系统自动创建可编辑草稿。',
        tags: ['创作', '草稿'],
        media: [],
      },
    })

    const result = await service.compose({
      source: '只粘贴来源，系统自动创建可编辑草稿。',
      instruction: '',
    })

    expect(result.generationMode).toBe('local')
    expect(workflow.createRevision).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        title: '极简创作说明',
        content: expect.stringContaining('# 极简创作说明'),
        tags: ['创作', '草稿'],
      }),
    )
  })

  it('does not hide failures from a configured AI provider', async () => {
    const { ai, materials, service } = createService()
    ai.getWriterModel.mockRejectedValue(new Error('provider unavailable'))
    materials.import.mockResolvedValue({
      material: { id: 'material-4', title: '来源' },
      deduplicated: false,
    })
    materials.analyze.mockResolvedValue({
      material: { id: 'material-4', title: '来源', content: '来源正文' },
      analysis: { media: [] },
    })

    await expect(
      service.compose({ source: '来源正文', instruction: '' }),
    ).rejects.toThrow('provider unavailable')
  })
})
