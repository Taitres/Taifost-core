import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { createModelRuntime } from '~/modules/ai/runtime'
import { ConfigsService } from '~/modules/configs/configs.service'

import { MarlinWorkflowRepository } from '../workflow/marlin-workflow.repository'
import { MarlinAiRepository } from './marlin-ai.repository'
import {
  type MarlinAiAdviceOutput,
  MarlinAiAdviceOutputSchema,
} from './marlin-ai.schema'

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
    if (
      role.dailyBudgetCents > 0 &&
      usage.costCents >= role.dailyBudgetCents
    ) {
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
    const costCents = Math.max(
      0,
      Math.ceil((usageResult?.cost ?? 0) * 100),
    )
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
