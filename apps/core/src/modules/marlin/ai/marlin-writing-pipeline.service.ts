import { type TSchema, Type } from '@earendil-works/pi-ai'
import { ConflictException, Injectable } from '@nestjs/common'

import type { IModelRuntime } from '~/modules/ai/runtime'

import { MarlinAiRepository } from './marlin-ai.repository'
import { type marlinAiSlots } from './marlin-ai.schema'
import { MarlinAiService } from './marlin-ai.service'

const AnalysisSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 3_000 }),
    keyFacts: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 40,
    }),
    sourceGaps: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 20,
    }),
  },
  { additionalProperties: false },
)

const MaterialGroupsSchema = Type.Object(
  {
    groups: Type.Array(
      Type.Object(
        {
          materialIds: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            maxItems: 12,
          }),
          title: Type.String({ minLength: 1, maxLength: 300 }),
          instruction: Type.String({ minLength: 1, maxLength: 2_000 }),
          reason: Type.String({ minLength: 1, maxLength: 2_000 }),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 12 },
    ),
  },
  { additionalProperties: false },
)

const PlanSchema = Type.Object(
  {
    audience: Type.String({ minLength: 1, maxLength: 1_000 }),
    angle: Type.String({ minLength: 1, maxLength: 2_000 }),
    tone: Type.String({ minLength: 1, maxLength: 1_000 }),
    outline: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      minItems: 2,
      maxItems: 30,
    }),
  },
  { additionalProperties: false },
)

const DraftSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 300 }),
    slug: Type.String({ minLength: 1, maxLength: 300 }),
    summary: Type.String({ maxLength: 2_000 }),
    content: Type.String({ minLength: 1, maxLength: 5_000_000 }),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
      maxItems: 20,
    }),
    category: Type.String({ maxLength: 300 }),
  },
  { additionalProperties: false },
)

const FactCheckSchema = Type.Object(
  {
    verdict: Type.Union([
      Type.Literal('pass'),
      Type.Literal('needs-review'),
      Type.Literal('revise'),
    ]),
    issues: Type.Array(
      Type.Object(
        {
          severity: Type.Union([
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
          ]),
          claim: Type.String({ minLength: 1, maxLength: 2_000 }),
          reason: Type.String({ minLength: 1, maxLength: 2_000 }),
          suggestion: Type.String({ minLength: 1, maxLength: 2_000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 30 },
    ),
  },
  { additionalProperties: false },
)

const ReviewSchema = Type.Object(
  {
    draft: DraftSchema,
    reviewNotes: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 30,
    }),
    remainingRisks: Type.Array(
      Type.String({ minLength: 1, maxLength: 2_000 }),
      { maxItems: 30 },
    ),
  },
  { additionalProperties: false },
)

const SeoSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 300 }),
    slug: Type.String({ minLength: 1, maxLength: 300 }),
    summary: Type.String({ maxLength: 2_000 }),
    tags: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
      maxItems: 20,
    }),
    category: Type.String({ maxLength: 300 }),
  },
  { additionalProperties: false },
)

type PipelineSlot = (typeof marlinAiSlots)[number]

interface StageResult<T> {
  output: T
  stage: {
    key: string
    label: string
    status: 'completed'
    durationMs: number
    providerId: string
    model: string
    totalTokens: number
  }
}

@Injectable()
export class MarlinWritingPipelineService {
  constructor(
    private readonly ai: MarlinAiService,
    private readonly repository: MarlinAiRepository,
  ) {}

  async assertReady() {
    await Promise.all([
      this.ai.resolveRoleRuntime('material-recognizer'),
      this.ai.resolveRoleRuntime('material-analyst'),
    ])
  }

  async recognizeMaterialGroups(input: {
    focusMaterialId: string
    materials: Array<{
      id: string
      title: string
      content: string
      analysis: Record<string, unknown> | null
    }>
  }) {
    const knownIds = new Set(input.materials.map(({ id }) => id))
    const result = await this.runStage<{
      groups: Array<{
        materialIds: string[]
        title: string
        instruction: string
        reason: string
        confidence: number
      }>
    }>({
      slot: 'material-recognizer',
      key: 'materialGrouping',
      label: '识别可合写素材',
      operation: 'pipeline-material-grouping',
      schema: MaterialGroupsSchema,
      maxTokens: 4096,
      prompt: [
        `本次新素材 ID：${input.focusMaterialId}`,
        `待识别素材：${JSON.stringify(
          input.materials.map(({ id, title, content, analysis }) => ({
            id,
            title,
            analysis,
            excerpt: content.slice(0, 4_000),
          })),
        )}`,
        '把主题一致、证据互补且可合写的素材放入同一组。必须让本次新素材出现在且只出现在一个组中；若没有可合并素材，就为它返回单素材组。不要返回列表中不存在的 ID。',
      ].join('\n\n'),
    })
    const groups = result.output.groups
      .map((group) => ({
        ...group,
        materialIds: [...new Set(group.materialIds)].filter((id) =>
          knownIds.has(id),
        ),
      }))
      .filter(({ materialIds }) => materialIds.length > 0)
    const selected = groups.find(({ materialIds }) =>
      materialIds.includes(input.focusMaterialId),
    ) ?? {
      materialIds: [input.focusMaterialId],
      title:
        input.materials.find(({ id }) => id === input.focusMaterialId)?.title ||
        '新文章',
      instruction: '把这份素材整理为结构清晰、证据边界明确的文章。',
      reason: '没有识别到可靠的合并对象，按单素材进入流水线。',
      confidence: 1,
    }
    return { group: selected, stage: result.stage }
  }

  private async runStage<T>(input: {
    slot: PipelineSlot
    key: string
    label: string
    operation: string
    schema: TSchema
    prompt: string
    maxTokens: number
  }): Promise<StageResult<T>> {
    const resolved = await this.ai.resolveRoleRuntime(input.slot)
    if (resolved.role) {
      const usage = await this.repository.usageToday(resolved.role.id)
      if (
        resolved.role.dailyBudgetCents > 0 &&
        usage.costCents >= resolved.role.dailyBudgetCents
      ) {
        throw new ConflictException(
          `${input.label}的每日 AI 预算已用完，请在配置中心调整`,
        )
      }
    }

    const startedAt = Date.now()
    const result = await (resolved.runtime as IModelRuntime).generateStructured(
      {
        schema: input.schema,
        systemPrompt: resolved.settings.systemPrompt,
        prompt: input.prompt,
        temperature: resolved.settings.temperature,
        maxTokens: Math.max(resolved.settings.maxTokens, input.maxTokens),
        maxRetries: 2,
      },
    )
    const costCents = Math.max(0, Math.ceil((result.usage?.cost ?? 0) * 100))
    if (resolved.role) {
      await this.repository.recordUsage({
        roleId: resolved.role.id,
        operation: input.operation,
        providerId: resolved.provider.id,
        model: resolved.model,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
        costCents,
      })
    }
    return {
      output: result.output as T,
      stage: {
        key: input.key,
        label: input.label,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        providerId: resolved.provider.id,
        model: resolved.model,
        totalTokens: result.usage?.totalTokens ?? 0,
      },
    }
  }

  async run(input: {
    sourceTitle: string
    sourceContent: string
    instruction: string
    categoryChoices: string
  }) {
    const stages: StageResult<unknown>['stage'][] = []
    const source = input.sourceContent.slice(0, 70_000)

    const analysis = await this.runStage<{
      summary: string
      keyFacts: string[]
      sourceGaps: string[]
    }>({
      slot: 'material-analyst',
      key: 'analysis',
      label: '分析素材',
      operation: 'pipeline-analysis',
      schema: AnalysisSchema,
      maxTokens: 4096,
      prompt: [
        `来源标题：${input.sourceTitle}`,
        `来源内容：\n${source}`,
        '提取可用于写作的事实、核心信息和资料缺口。资料没有说的内容必须标记为缺口。',
      ].join('\n\n'),
    })
    stages.push(analysis.stage)

    const plan = await this.runStage<{
      audience: string
      angle: string
      tone: string
      outline: string[]
    }>({
      slot: 'topic-planner',
      key: 'planning',
      label: '规划文章',
      operation: 'pipeline-planning',
      schema: PlanSchema,
      maxTokens: 4096,
      prompt: [
        `写作要求：${input.instruction}`,
        `素材分析：${JSON.stringify(analysis.output)}`,
        '给出明确的目标读者、文章角度、语气与完整大纲。',
      ].join('\n\n'),
    })
    stages.push(plan.stage)

    const writing = await this.runStage<{
      title: string
      slug: string
      summary: string
      content: string
      tags: string[]
      category: string
    }>({
      slot: 'writer',
      key: 'writing',
      label: '撰写成稿',
      operation: 'pipeline-writing',
      schema: DraftSchema,
      maxTokens: 16_000,
      prompt: [
        `写作要求：${input.instruction}`,
        `可用分类：${input.categoryChoices}`,
        `写作计划：${JSON.stringify(plan.output)}`,
        `素材分析：${JSON.stringify(analysis.output)}`,
        `原始来源：\n${source}`,
        '输出完整 Markdown 成稿及准确的标题、摘要、slug、标签和分类。',
      ].join('\n\n'),
    })
    stages.push(writing.stage)

    const factCheck = await this.runStage<{
      verdict: 'pass' | 'needs-review' | 'revise'
      issues: Array<{
        severity: 'low' | 'medium' | 'high'
        claim: string
        reason: string
        suggestion: string
      }>
    }>({
      slot: 'fact-checker',
      key: 'factCheck',
      label: '核验事实',
      operation: 'pipeline-fact-check',
      schema: FactCheckSchema,
      maxTokens: 4096,
      prompt: [
        `原始来源：\n${source}`,
        `待核验文章：\n${writing.output.content.slice(0, 70_000)}`,
        '逐项找出来源无法支持、被夸大、互相矛盾或必须由人工确认的陈述。',
      ].join('\n\n'),
    })
    stages.push(factCheck.stage)

    const review = await this.runStage<{
      draft: typeof writing.output
      reviewNotes: string[]
      remainingRisks: string[]
    }>({
      slot: 'reviewer',
      key: 'review',
      label: '终审修订',
      operation: 'pipeline-review',
      schema: ReviewSchema,
      maxTokens: 16_000,
      prompt: [
        `写作要求：${input.instruction}`,
        `写作计划：${JSON.stringify(plan.output)}`,
        `事实核验：${JSON.stringify(factCheck.output)}`,
        `待审文章：${JSON.stringify(writing.output).slice(0, 90_000)}`,
        '根据核验结论直接修正文稿；无法确认的内容删除、弱化或清楚标注。输出完整修订稿、修改摘要和仍需人工关注的风险。',
      ].join('\n\n'),
    })
    stages.push(review.stage)

    const seo = await this.runStage<{
      title: string
      slug: string
      summary: string
      tags: string[]
      category: string
    }>({
      slot: 'seo-editor',
      key: 'seo',
      label: '整理发布信息',
      operation: 'pipeline-seo',
      schema: SeoSchema,
      maxTokens: 4096,
      prompt: [
        `可用分类：${input.categoryChoices}`,
        `文章标题：${review.output.draft.title}`,
        `文章摘要：${review.output.draft.summary}`,
        `正文开头：\n${review.output.draft.content.slice(0, 12_000)}`,
        '在不改变正文的前提下优化发布信息。分类必须来自可用分类，标签精简自然。',
      ].join('\n\n'),
    })
    stages.push(seo.stage)

    return {
      output: { ...review.output.draft, ...seo.output },
      stages,
      review: {
        verdict: factCheck.output.verdict,
        issues: factCheck.output.issues,
        notes: review.output.reviewNotes,
        remainingRisks: review.output.remainingRisks,
      },
      usage: {
        totalTokens: stages.reduce((sum, stage) => sum + stage.totalTokens, 0),
        models: [
          ...new Set(
            stages.map(({ providerId, model }) => `${providerId}/${model}`),
          ),
        ],
      },
    }
  }
}
