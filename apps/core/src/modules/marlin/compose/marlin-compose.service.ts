import { Type } from '@earendil-works/pi-ai'
import { BadRequestException, Injectable } from '@nestjs/common'

import { AppErrorCode } from '~/common/errors'
import { AiService } from '~/modules/ai/ai.service'
import { CategoryService } from '~/modules/category/category.service'
import type { EntityId } from '~/shared/id/entity-id'

import { MarlinMaterialService } from '../material/marlin-material.service'
import { MarlinWorkflowService } from '../workflow/marlin-workflow.service'
import type { MarlinComposeInput } from './marlin-compose.schema'

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

const publicUrl = (value: string) => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

const markdownTitle = (source: string) => {
  const line = source
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean)
  return (
    line
      ?.replace(/^#{1,6}\s+/, '')
      .replaceAll(/[*[\]_`]/g, '')
      .slice(0, 300)
      .trim() || '新文章'
  )
}

const normalizedSlug = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 300)
  return slug || `draft-${fallback}`
}

interface GeneratedDraft {
  title: string
  slug: string
  summary: string
  content: string
  tags: string[]
  category: string
}

/**
 * Deep module for the personal writing path. Its interface accepts only a
 * source and an optional intention; material freezing, analysis, media
 * archival, model selection, metadata, project linkage and the first hidden
 * revision stay inside the implementation.
 */
@Injectable()
export class MarlinComposeService {
  constructor(
    private readonly materials: MarlinMaterialService,
    private readonly workflow: MarlinWorkflowService,
    private readonly categories: CategoryService,
    private readonly ai: AiService,
  ) {}

  private async importSource(source: string) {
    const url = publicUrl(source)
    if (url) {
      return this.materials.importUrl({
        url: url.href,
        metadata: { importedFrom: 'marlin-compose' },
      })
    }
    return this.materials.import({
      kind: 'markdown',
      title: markdownTitle(source),
      content: source,
      mimeType: 'text/markdown',
      sourceType: 'manual',
      metadata: { importedFrom: 'marlin-compose' },
    })
  }

  async compose(input: MarlinComposeInput) {
    const imported = await this.importSource(input.source)
    const materialId = String(imported.material.id)
    const analyzed = await this.materials.analyze(materialId, {
      force: false,
      archiveImages: true,
      ignoreFailedImages: true,
    })
    if (!analyzed?.material) {
      throw new BadRequestException('Imported material could not be analyzed')
    }

    const categories = await this.categories.findAllCategory()
    const defaultCategory = categories[0]
    if (!defaultCategory) {
      throw new BadRequestException('Create at least one Core category first')
    }

    const categoryChoices = categories
      .map(({ name, slug }) => `${name} (${slug})`)
      .join('、')
    const instruction =
      input.instruction ||
      '整理为结构清晰、可直接编辑发布的中文文章。保留有用事实与引用，不编造来源。'
    const sourceContent = analyzed.material.content.slice(0, 80_000)
    const analysis = analyzed.analysis as {
      summary?: string
      tags?: string[]
      media?: Array<{ status: string }>
    }
    let output: GeneratedDraft
    let generation: Record<string, unknown>
    let generationMode: 'ai' | 'local'
    try {
      const runtime = await this.ai.getWriterModel()
      const result = await runtime.generateStructured({
        schema: DraftSchema,
        systemPrompt: [
          '你是个人博客的资深中文主笔。',
          '你会自动完成结构、标题、摘要、标签、分类和 Markdown 正文。',
          '严格依据来源，不得伪造事实、引语或链接。',
          '只输出结构化结果，content 必须是完整 Markdown 成稿。',
        ].join('\n'),
        prompt: [
          `写作要求：${instruction}`,
          `可用分类：${categoryChoices}`,
          `来源标题：${analyzed.material.title}`,
          `来源内容：\n${sourceContent}`,
        ].join('\n\n'),
        temperature: 0.35,
        maxTokens: 16_000,
        maxRetries: 2,
      })
      output = result.output
      generationMode = 'ai'
      generation = {
        mode: 'ai',
        providerId: runtime.providerInfo.id,
        model: runtime.providerInfo.model,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
      }
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error) ||
        error.code !== AppErrorCode.AI_NOT_ENABLED
      ) {
        throw error
      }
      const title = markdownTitle(
        analyzed.material.title || analyzed.material.content,
      )
      const content = analyzed.material.content.trim()
      output = {
        title,
        slug: normalizedSlug(title, materialId),
        summary: analysis.summary?.trim().slice(0, 2_000) || title,
        content: /^#\s+/m.test(content) ? content : `# ${title}\n\n${content}`,
        tags: (analysis.tags || []).slice(0, 20),
        category: defaultCategory.name,
      }
      generationMode = 'local'
      generation = {
        mode: 'local-fallback',
        reason: AppErrorCode.AI_NOT_ENABLED,
      }
    }

    const requestedCategory = output.category.trim().toLowerCase()
    const category =
      categories.find(
        ({ name, slug }) =>
          name.toLowerCase() === requestedCategory ||
          slug.toLowerCase() === requestedCategory,
      ) || defaultCategory
    const project = await this.workflow.createProject({
      title: output.title,
      goal: instruction,
    })
    await this.workflow.attachMaterials(String(project.id), [materialId])
    const revision = await this.workflow.createRevision(String(project.id), {
      title: output.title,
      slug: normalizedSlug(output.slug, String(project.id)),
      summary: output.summary || null,
      content: output.content,
      categoryId: String(category.id) as EntityId,
      tags: [...new Set(output.tags.map((tag) => tag.trim()).filter(Boolean))],
      copyright: true,
      metadata: {
        editor: 'marlin-compose',
        sourceMaterialId: materialId,
        generation,
      },
    })

    return {
      material: analyzed.material,
      project,
      revision,
      deduplicated: imported.deduplicated,
      generationMode,
      ignoredImages:
        analysis.media?.filter(({ status }) => status === 'ignored').length ??
        0,
    }
  }
}
