import { describe, expect, it, vi } from 'vitest'

import type { MarlinAiRepository } from '~/modules/marlin/ai/marlin-ai.repository'
import type { MarlinAiService } from '~/modules/marlin/ai/marlin-ai.service'
import { MarlinWritingPipelineService } from '~/modules/marlin/ai/marlin-writing-pipeline.service'

describe('MarlinWritingPipelineService', () => {
  it('uses the material recognizer and rejects material IDs outside the inbox', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      output: {
        groups: [
          {
            materialIds: ['material-new', 'material-related', 'invented-id'],
            title: '同一主题',
            instruction: '合并两份互补资料',
            reason: '主题一致且证据互补',
            confidence: 0.92,
          },
        ],
      },
      usage: { totalTokens: 12 },
    })
    const ai = {
      resolveRoleRuntime: vi.fn().mockResolvedValue({
        runtime: { generateStructured },
        role: { id: 'recognizer-role', dailyBudgetCents: 0 },
        provider: { id: 'deepseek' },
        model: 'deepseek-chat',
        settings: {
          systemPrompt: 'recognize',
          temperature: 0.1,
          maxTokens: 512,
        },
      }),
    }
    const repository = {
      usageToday: vi.fn().mockResolvedValue({ costCents: 0 }),
      recordUsage: vi.fn().mockResolvedValue({}),
    }
    const service = new MarlinWritingPipelineService(
      ai as unknown as MarlinAiService,
      repository as unknown as MarlinAiRepository,
    )

    const result = await service.recognizeMaterialGroups({
      focusMaterialId: 'material-new',
      materials: [
        {
          id: 'material-new',
          title: '新资料',
          content: '内容',
          analysis: null,
        },
        {
          id: 'material-related',
          title: '补充资料',
          content: '补充',
          analysis: null,
        },
      ],
    })

    expect(ai.resolveRoleRuntime).toHaveBeenCalledWith('material-recognizer')
    expect(result.group.materialIds).toEqual([
      'material-new',
      'material-related',
    ])
    expect(result.stage.key).toBe('materialGrouping')
  })

  it('runs analysis through SEO in order and returns only the reviewed content', async () => {
    const outputs = [
      {
        summary: '素材摘要',
        keyFacts: ['事实一'],
        sourceGaps: [],
      },
      {
        audience: '普通读者',
        angle: '解释影响',
        tone: '克制',
        outline: ['背景', '影响'],
      },
      {
        title: '初稿标题',
        slug: 'draft-title',
        summary: '初稿摘要',
        content: '# 初稿\n\n未经终审。',
        tags: ['初稿'],
        category: '默认',
      },
      {
        verdict: 'revise',
        issues: [
          {
            severity: 'high',
            claim: '未经支持的结论',
            reason: '来源没有说明',
            suggestion: '删除',
          },
        ],
      },
      {
        draft: {
          title: '终审标题',
          slug: 'reviewed-title',
          summary: '终审摘要',
          content: '# 终审稿\n\n已删除无证据结论。',
          tags: ['终审'],
          category: '技术',
        },
        reviewNotes: ['删除无证据结论'],
        remainingRisks: [],
      },
      {
        title: '最终标题',
        slug: 'final-title',
        summary: '最终摘要',
        tags: ['事实', '技术'],
        category: '技术',
      },
    ]
    const generateStructured = vi.fn().mockImplementation(async () => ({
      output: outputs.shift(),
      usage: { totalTokens: 10, promptTokens: 6, completionTokens: 4 },
    }))
    const slots: string[] = []
    const ai = {
      resolveRoleRuntime: vi.fn().mockImplementation(async (slot: string) => {
        slots.push(slot)
        return {
          runtime: { generateStructured },
          role: {
            id: `role-${slot}`,
            dailyBudgetCents: 0,
          },
          provider: { id: 'provider-1' },
          model: 'model-1',
          settings: {
            systemPrompt: `prompt-${slot}`,
            temperature: 0.2,
            maxTokens: 4096,
          },
        }
      }),
    }
    const repository = {
      usageToday: vi.fn().mockResolvedValue({ costCents: 0, totalTokens: 0 }),
      recordUsage: vi.fn().mockResolvedValue({}),
    }
    const service = new MarlinWritingPipelineService(
      ai as unknown as MarlinAiService,
      repository as unknown as MarlinAiRepository,
    )

    const result = await service.run({
      sourceTitle: '来源',
      sourceContent: '来源正文',
      instruction: '写给普通读者',
      categoryChoices: '默认 (default)、技术 (tech)',
    })

    expect(slots).toEqual([
      'material-analyst',
      'topic-planner',
      'writer',
      'fact-checker',
      'reviewer',
      'seo-editor',
    ])
    expect(result.output).toEqual({
      title: '最终标题',
      slug: 'final-title',
      summary: '最终摘要',
      content: '# 终审稿\n\n已删除无证据结论。',
      tags: ['事实', '技术'],
      category: '技术',
    })
    expect(result.stages).toHaveLength(6)
    expect(result.usage.totalTokens).toBe(60)
    expect(repository.recordUsage).toHaveBeenCalledTimes(6)
  })
})
