import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import {
  createModelRuntime,
  resolveAIProviderAdapter,
} from '~/modules/ai/runtime'
import type { AIConfig } from '~/modules/configs/configs.schema'
import { ConfigsService } from '~/modules/configs/configs.service'

import { MarlinWorkflowRepository } from '../workflow/marlin-workflow.repository'
import { MarlinAiRepository } from './marlin-ai.repository'
import {
  type MarlinAiAdviceOutput,
  MarlinAiAdviceOutputSchema,
  type MarlinAiAssignment,
  marlinAiSlots,
  type MarlinAiTaskKey,
  type MarlinUnifiedAiConfigInput,
} from './marlin-ai.schema'

const taskToRole = {
  materialAnalysis: 'material-analyst',
  topicPlanning: 'topic-planner',
  writing: 'writer',
  quickRewrite: 'quick-rewriter',
  review: 'reviewer',
  factCheck: 'fact-checker',
  seo: 'seo-editor',
} as const satisfies Partial<
  Record<MarlinAiTaskKey, (typeof marlinAiSlots)[number]>
>

const roleToTask = Object.fromEntries(
  Object.entries(taskToRole).map(([task, role]) => [role, task]),
) as Record<(typeof marlinAiSlots)[number], MarlinAiTaskKey>

const taskToCoreConfig = {
  writing: 'writerModel',
  summary: 'summaryModel',
  commentReview: 'commentReviewModel',
  translation: 'translationModel',
  translationReview: 'translationReviewModel',
  insights: 'insightsModel',
  insightsTranslation: 'insightsTranslationModel',
} as const satisfies Partial<Record<MarlinAiTaskKey, keyof AIConfig>>

const defaultRoleSettings: Record<
  (typeof marlinAiSlots)[number],
  { systemPrompt: string; temperature: number; maxTokens: number }
> = {
  'material-analyst': {
    systemPrompt:
      '你是严谨的中文资料分析员。只提取来源中存在的事实、观点、引用和不确定性，禁止补造信息。',
    temperature: 0.2,
    maxTokens: 4096,
  },
  'topic-planner': {
    systemPrompt:
      '你是个人博客的选题策划。基于资料确定受众、角度和结构，优先清晰、真实与可读性。',
    temperature: 0.35,
    maxTokens: 4096,
  },
  writer: {
    systemPrompt:
      '你是资深中文主笔。严格依据资料与计划写出完整 Markdown 文章，不伪造事实、引语或来源。',
    temperature: 0.4,
    maxTokens: 16_000,
  },
  'quick-rewriter': {
    systemPrompt:
      '你是中文改写编辑。在不改变事实与含义的前提下提升表达，直接给出可替换文本。',
    temperature: 0.35,
    maxTokens: 8192,
  },
  reviewer: {
    systemPrompt:
      '你是严格的终审编辑。修正结构、逻辑、重复与表达问题，保留证据边界，输出完整可发布成稿。',
    temperature: 0.2,
    maxTokens: 16_000,
  },
  'fact-checker': {
    systemPrompt:
      '你是事实核验员。逐项对照来源识别无证据、夸大、矛盾和需要人工确认的表述，不自行补造证据。',
    temperature: 0.1,
    maxTokens: 4096,
  },
  'seo-editor': {
    systemPrompt:
      '你是克制的博客 SEO 编辑。生成准确自然的标题、摘要、slug、标签与分类，禁止标题党和关键词堆砌。',
    temperature: 0.2,
    maxTokens: 4096,
  },
}

export function parseMarlinAiAdvice(text: string): MarlinAiAdviceOutput {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(normalized)
  } catch {
    throw new BadRequestException('AI returned invalid JSON advice')
  }
  const parsed = MarlinAiAdviceOutputSchema.safeParse(value)
  if (!parsed.success) {
    throw new BadRequestException('AI advice did not match the required schema')
  }
  return parsed.data
}

@Injectable()
export class MarlinAiService {
  constructor(
    private readonly repository: MarlinAiRepository,
    private readonly workflowRepository: MarlinWorkflowRepository,
    private readonly configsService: ConfigsService,
  ) {}

  async getUnifiedConfig() {
    const [aiConfig, safeConfig, roles] = await Promise.all([
      this.configsService.get('ai'),
      this.configsService.getForResponse('ai'),
      this.repository.listRoles(),
    ])
    const defaultProvider = aiConfig.providers?.find(({ enabled }) => enabled)
    const roleMap = new Map(roles.map((role) => [role.slot, role]))
    const assignments = {} as Partial<
      Record<MarlinAiTaskKey, MarlinAiAssignment>
    >

    for (const [task, configKey] of Object.entries(taskToCoreConfig) as Array<
      [MarlinAiTaskKey, keyof AIConfig]
    >) {
      const assignment = aiConfig[configKey] as MarlinAiAssignment | undefined
      if (assignment?.providerId && assignment.model) {
        assignments[task] = assignment
      }
    }
    for (const [task, slot] of Object.entries(taskToRole) as Array<
      [MarlinAiTaskKey, (typeof marlinAiSlots)[number]]
    >) {
      const role = roleMap.get(slot)
      if (role?.providerId && role.model) {
        assignments[task] = {
          providerId: role.providerId,
          model: role.model,
        }
      }
    }
    if (defaultProvider) {
      for (const task of Object.keys(assignments) as MarlinAiTaskKey[]) {
        const assignment = assignments[task]
        if (
          assignment?.providerId === defaultProvider.id &&
          assignment.model === defaultProvider.defaultModel
        ) {
          delete assignments[task]
        }
      }
    }

    return {
      ready: Boolean(defaultProvider?.apiKey && defaultProvider.defaultModel),
      defaultProviderId: defaultProvider?.id,
      defaultModel: defaultProvider?.defaultModel,
      providers: (safeConfig.providers || []).map((provider) => ({
        ...resolveAIProviderAdapter(provider),
        credentialConfigured: Boolean(
          aiConfig.providers?.find(({ id }) => id === provider.id)?.apiKey,
        ),
      })),
      assignments,
      roles,
    }
  }

  async saveUnifiedConfig(input: MarlinUnifiedAiConfigInput) {
    const ids = input.providers.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('AI provider IDs must be unique')
    }

    const current = await this.configsService.get('ai')
    const currentProviderIds = new Set(
      current.providers?.map(({ id }) => id) || [],
    )
    const providerMissingCredential = input.providers.find(
      ({ id, apiKey }) => !apiKey && !currentProviderIds.has(id),
    )
    if (providerMissingCredential) {
      throw new BadRequestException(
        `AI provider "${providerMissingCredential.name}" needs an API key`,
      )
    }

    const selectedDefault = input.defaultProviderId
      ? input.providers.find(
          ({ id, enabled }) => id === input.defaultProviderId && enabled,
        )
      : input.providers.find(({ enabled }) => enabled)
    if (input.providers.length > 0 && !selectedDefault) {
      throw new BadRequestException('Choose an enabled default AI provider')
    }

    const normalizedProviders = input.providers.map((provider) => {
      const existing = current.providers?.find(({ id }) => id === provider.id)
      return resolveAIProviderAdapter({
        ...provider,
        apiKey: provider.apiKey || existing?.apiKey || '',
      })
    })
    const normalizedDefault = selectedDefault
      ? normalizedProviders.find(({ id }) => id === selectedDefault.id)
      : undefined
    const providers = normalizedDefault
      ? [
          {
            ...normalizedDefault,
            defaultModel: input.defaultModel || normalizedDefault.defaultModel,
          },
          ...normalizedProviders.filter(
            ({ id }) => id !== normalizedDefault.id,
          ),
        ]
      : []
    const defaultAssignment = selectedDefault
      ? {
          providerId: selectedDefault.id,
          model: input.defaultModel || selectedDefault.defaultModel,
        }
      : undefined
    const resolveTask = (task: MarlinAiTaskKey) => {
      const assignment = input.assignments[task] || defaultAssignment
      if (!assignment) return undefined
      const provider = providers.find(
        ({ id, enabled }) => id === assignment.providerId && enabled,
      )
      if (!provider) {
        throw new BadRequestException(
          `Task "${task}" references an unavailable AI provider`,
        )
      }
      return assignment
    }

    const aiPatch: Partial<AIConfig> = { providers }
    for (const [task, configKey] of Object.entries(taskToCoreConfig) as Array<
      [MarlinAiTaskKey, keyof AIConfig]
    >) {
      ;(aiPatch as Record<string, unknown>)[configKey] = resolveTask(task)
    }
    await this.configsService.patchAndValid('ai', aiPatch)

    if (defaultAssignment) {
      const currentRoles = await this.repository.listRoles()
      const currentRoleMap = new Map(
        currentRoles.map((role) => [role.slot, role]),
      )
      await Promise.all(
        marlinAiSlots.map((slot) => {
          const currentRole = currentRoleMap.get(slot)
          const defaults = defaultRoleSettings[slot]
          const assignment = resolveTask(roleToTask[slot]) || defaultAssignment
          return this.repository.upsertRole({
            slot,
            providerId: assignment.providerId,
            model: assignment.model,
            systemPrompt: currentRole?.systemPrompt || defaults.systemPrompt,
            temperature: currentRole?.temperature ?? defaults.temperature,
            maxTokens: currentRole?.maxTokens ?? defaults.maxTokens,
            dailyBudgetCents: currentRole?.dailyBudgetCents ?? 0,
            enabled: true,
          })
        }),
      )
    }
    return this.getUnifiedConfig()
  }

  async testConnection(providerId: string) {
    const aiConfig = await this.configsService.get('ai')
    const provider = aiConfig.providers?.find(
      ({ id, enabled }) => id === providerId && enabled,
    )
    if (!provider?.apiKey) {
      throw new BadRequestException('AI provider is unavailable or has no key')
    }
    const runtime = createModelRuntime(provider)
    await runtime.generateText({ prompt: '只回答 ok', maxRetries: 0 })
    return { ok: true, providerId, model: provider.defaultModel }
  }

  async listModels(providerId: string) {
    const aiConfig = await this.configsService.get('ai')
    const provider = aiConfig.providers?.find(
      ({ id, enabled }) => id === providerId && enabled,
    )
    if (!provider?.apiKey) {
      throw new BadRequestException('AI provider is unavailable or has no key')
    }
    const runtime = createModelRuntime(provider)
    if (!runtime.listModels) {
      return { models: [{ id: provider.defaultModel }] }
    }
    return { models: await runtime.listModels() }
  }

  async resolveRoleRuntime(slot: (typeof marlinAiSlots)[number]) {
    const [role, aiConfig] = await Promise.all([
      this.repository.findRole(slot),
      this.configsService.get('ai'),
    ])
    const enabledRole = role?.enabled ? role : null
    const assignedProvider = enabledRole
      ? aiConfig.providers?.find(
          ({ id, enabled }) => id === enabledRole.providerId && enabled,
        )
      : undefined
    const provider =
      assignedProvider || aiConfig.providers?.find(({ enabled }) => enabled)
    if (!provider?.apiKey) {
      throw new BadRequestException(
        '请先在 AI 配置中心设置并验证一个可用的模型服务',
      )
    }
    const model =
      assignedProvider && enabledRole
        ? enabledRole.model
        : provider.defaultModel
    return {
      runtime: createModelRuntime(provider, model),
      role: enabledRole,
      provider,
      model,
      settings: enabledRole || defaultRoleSettings[slot],
    }
  }

  async advise(
    projectId: string,
    input: { slot: string; instruction: string },
  ) {
    const [role, project, aiConfig] = await Promise.all([
      this.repository.findRole(input.slot),
      this.workflowRepository.findProject(projectId),
      this.configsService.get('ai'),
    ])
    if (!project) throw new NotFoundException('MARLIN project not found')
    if (!role || !role.enabled) {
      throw new BadRequestException(`AI role "${input.slot}" is not configured`)
    }
    const provider = aiConfig.providers?.find(
      ({ id, enabled }) => id === role.providerId && enabled,
    )
    if (!provider) {
      throw new BadRequestException('Configured AI provider is unavailable')
    }
    const usage = await this.repository.usageToday(role.id)
    if (role.dailyBudgetCents > 0 && usage.costCents >= role.dailyBudgetCents) {
      throw new ConflictException('Daily AI budget has been exhausted')
    }

    const latestRevision = project.revisions[0]
    const materialContext = project.materials
      .map(
        (material) =>
          `## ${material.title}\n${material.content.slice(0, 20_000)}`,
      )
      .join('\n\n')
      .slice(0, 80_000)
    const prompt = [
      `项目：${project.title}`,
      `目标：${project.goal}`,
      latestRevision
        ? `当前修订：${latestRevision.title}\n${latestRevision.content.slice(0, 30_000)}`
        : '当前尚无修订。',
      materialContext ? `素材：\n${materialContext}` : '当前未关联素材。',
      `任务：${input.instruction}`,
      '只返回 JSON：{"advice":"...","risks":["..."],"suggestedOutline":["..."],"confidence":0.0}',
    ].join('\n\n')
    const runtime = createModelRuntime(provider, role.model)
    const result = await runtime.generateText({
      messages: [
        {
          role: 'system',
          content:
            role.systemPrompt ||
            '你是 MARLIN.LOG 的中文编辑助手。必须基于给定材料，明确不确定性，禁止编造来源。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: role.temperature,
      maxTokens: role.maxTokens,
      maxRetries: 1,
    })
    const advice = parseMarlinAiAdvice(result.text)
    const usageResult = result.usage
    const costCents = Math.max(0, Math.ceil((usageResult?.cost ?? 0) * 100))
    await this.repository.recordUsage({
      roleId: role.id,
      projectId,
      operation: 'advice',
      providerId: provider.id,
      model: role.model,
      promptTokens: usageResult?.promptTokens ?? 0,
      completionTokens: usageResult?.completionTokens ?? 0,
      totalTokens: usageResult?.totalTokens ?? 0,
      costCents,
    })
    return {
      ...advice,
      usage: {
        ...usageResult,
        costCents,
        dailyBudgetCents: role.dailyBudgetCents,
        dailySpentCents: usage.costCents + costCents,
      },
      model: { providerId: provider.id, model: role.model, slot: role.slot },
    }
  }
}
