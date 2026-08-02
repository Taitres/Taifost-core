import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { RequestCaseNormalizationPipe } from '~/common/pipes/case-normalization.pipe'
import type { ConfigsService } from '~/modules/configs/configs.service'
import type { MarlinAiRepository } from '~/modules/marlin/ai/marlin-ai.repository'
import {
  MarlinAiAdviceSchema,
  MarlinUnifiedAiConfigSchema,
} from '~/modules/marlin/ai/marlin-ai.schema'
import {
  MarlinAiService,
  parseMarlinAiAdvice,
} from '~/modules/marlin/ai/marlin-ai.service'
import type { MarlinWorkflowRepository } from '~/modules/marlin/workflow/marlin-workflow.repository'

describe('parseMarlinAiAdvice', () => {
  it('accepts the nested snake_case payload sent by Studio', () => {
    const normalized = new RequestCaseNormalizationPipe().transform(
      {
        providers: [
          {
            id: 'main',
            name: '主模型',
            type: 'openai-compatible',
            api_key: 'secret',
            default_model: 'model-1',
            enabled: true,
          },
        ],
        default_provider_id: 'main',
        default_model: 'model-1',
        assignments: {
          material_analysis: {
            provider_id: 'main',
            model: 'model-1',
          },
        },
      },
      { type: 'body', metatype: undefined, data: undefined },
    )

    expect(MarlinUnifiedAiConfigSchema.parse(normalized)).toMatchObject({
      providers: [
        expect.objectContaining({
          apiKey: 'secret',
          defaultModel: 'model-1',
        }),
      ],
      assignments: {
        materialAnalysis: { providerId: 'main', model: 'model-1' },
      },
    })
  })

  it('accepts the fixed quick-rewriter workflow slot', () => {
    expect(
      MarlinAiAdviceSchema.parse({
        slot: 'quick-rewriter',
        instruction: '改写选中段落',
      }).slot,
    ).toBe('quick-rewriter')
  })

  it('validates a fenced structured response', () => {
    expect(
      parseMarlinAiAdvice(`\`\`\`json
      {
        "advice": "聚焦 Core v3 迁移价值",
        "risks": ["接口兼容性"],
        "suggestedOutline": ["背景", "迁移", "验证"],
        "confidence": 0.86
      }
      \`\`\``),
    ).toEqual({
      advice: '聚焦 Core v3 迁移价值',
      risks: ['接口兼容性'],
      suggestedOutline: ['背景', '迁移', '验证'],
      confidence: 0.86,
    })
  })

  it('rejects unstructured AI prose', () => {
    expect(() => parseMarlinAiAdvice('我建议直接发布。')).toThrow(
      BadRequestException,
    )
  })

  it('synchronizes one default model across Core features and all MARLIN roles', async () => {
    let aiConfig: Record<string, any> = { providers: [] }
    const repository = {
      listRoles: vi.fn().mockResolvedValue([]),
      upsertRole: vi.fn().mockImplementation(async (role) => ({
        id: `role-${role.slot}`,
        ...role,
      })),
    }
    const configs = {
      get: vi.fn().mockImplementation(async () => aiConfig),
      getForResponse: vi.fn().mockImplementation(async () => ({
        ...aiConfig,
        providers: (aiConfig.providers || []).map((provider: any) => ({
          ...provider,
          apiKey: '',
        })),
      })),
      patchAndValid: vi.fn().mockImplementation(async (_key, patch) => {
        aiConfig = { ...aiConfig, ...patch }
        return aiConfig
      }),
    }
    const service = new MarlinAiService(
      repository as unknown as MarlinAiRepository,
      {} as MarlinWorkflowRepository,
      configs as unknown as ConfigsService,
    )
    const input = MarlinUnifiedAiConfigSchema.parse({
      providers: [
        {
          id: 'main',
          name: '主模型',
          type: 'openai-compatible',
          apiKey: 'secret',
          endpoint: 'https://example.com/v1',
          defaultModel: 'model-1',
          enabled: true,
        },
      ],
      defaultProviderId: 'main',
      defaultModel: 'model-1',
      assignments: {
        review: { providerId: 'main', model: 'model-review' },
      },
    })

    const result = await service.saveUnifiedConfig(input)

    expect(configs.patchAndValid).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({
        writerModel: { providerId: 'main', model: 'model-1' },
        summaryModel: { providerId: 'main', model: 'model-1' },
        translationModel: { providerId: 'main', model: 'model-1' },
      }),
    )
    expect(repository.upsertRole).toHaveBeenCalledTimes(8)
    expect(repository.upsertRole).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: 'material-recognizer',
        providerId: 'main',
        model: 'model-1',
      }),
    )
    expect(repository.upsertRole).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: 'reviewer',
        providerId: 'main',
        model: 'model-review',
      }),
    )
    expect(result).toMatchObject({
      ready: true,
      defaultProviderId: 'main',
      defaultModel: 'model-1',
    })
  })

  it('preserves an existing provider credential when Studio sends an empty key', async () => {
    let aiConfig: Record<string, any> = {
      providers: [
        {
          id: 'main',
          name: '主模型',
          type: 'openai-compatible',
          apiKey: 'persisted-secret',
          endpoint: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          enabled: true,
        },
      ],
    }
    const repository = {
      listRoles: vi.fn().mockResolvedValue([]),
      upsertRole: vi.fn().mockImplementation(async (role) => role),
    }
    const configs = {
      get: vi.fn().mockImplementation(async () => aiConfig),
      getForResponse: vi.fn().mockImplementation(async () => ({
        ...aiConfig,
        providers: aiConfig.providers.map((provider: any) => ({
          ...provider,
          apiKey: '',
        })),
      })),
      patchAndValid: vi.fn().mockImplementation(async (_key, patch) => {
        aiConfig = { ...aiConfig, ...patch }
        return aiConfig
      }),
    }
    const service = new MarlinAiService(
      repository as unknown as MarlinAiRepository,
      {} as MarlinWorkflowRepository,
      configs as unknown as ConfigsService,
    )

    await service.saveUnifiedConfig(
      MarlinUnifiedAiConfigSchema.parse({
        providers: [
          {
            id: 'main',
            name: '主模型',
            adapter: 'deepseek',
            type: 'openai-compatible',
            apiKey: '',
            defaultModel: 'deepseek-chat',
            enabled: true,
          },
        ],
        defaultProviderId: 'main',
        defaultModel: 'deepseek-chat',
        assignments: {},
      }),
    )

    expect(configs.patchAndValid).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            adapter: 'deepseek',
            apiKey: 'persisted-secret',
            endpoint: 'https://api.deepseek.com',
            appendV1: true,
          }),
        ],
      }),
    )
  })
})
