import { BadRequestException, Injectable } from '@nestjs/common'

import { CategoryService } from '~/modules/category/category.service'
import type { EntityId } from '~/shared/id/entity-id'

import { MarlinWritingPipelineService } from '../ai/marlin-writing-pipeline.service'
import { MarlinMaterialService } from '../material/marlin-material.service'
import { MarlinWorkflowService } from '../workflow/marlin-workflow.service'
import type { MarlinComposeInput } from './marlin-compose.schema'

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
    private readonly pipeline: MarlinWritingPipelineService,
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
    await this.pipeline.assertReady()
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
      media?: Array<{ status: string }>
    }
    const pipelineResult = await this.pipeline.run({
      sourceTitle: analyzed.material.title,
      sourceContent,
      instruction,
      categoryChoices,
    })
    const output = pipelineResult.output
    const generation = {
      mode: 'ai-pipeline',
      ...pipelineResult.usage,
      stages: pipelineResult.stages,
      review: pipelineResult.review,
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
      generationMode: 'ai' as const,
      pipeline: pipelineResult.stages,
      review: pipelineResult.review,
      ignoredImages:
        analysis.media?.filter(({ status }) => status === 'ignored').length ??
        0,
    }
  }
}
