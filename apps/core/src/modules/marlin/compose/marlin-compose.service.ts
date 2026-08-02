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

    const candidateMaterials = await this.materials.listUnassignedAnalyzed(12)
    const candidates = candidateMaterials.some(
      ({ id }) => String(id) === materialId,
    )
      ? candidateMaterials
      : [analyzed.material, ...candidateMaterials].slice(0, 12)
    const recognition = await this.pipeline.recognizeMaterialGroups({
      focusMaterialId: materialId,
      materials: candidates.map((material) => ({
        id: String(material.id),
        title: material.title,
        content: material.content,
        analysis: material.analysis as Record<string, unknown> | null,
      })),
    })
    const selectedMaterials = recognition.group.materialIds
      .map((id) => candidates.find((material) => String(material.id) === id))
      .filter((material): material is (typeof candidates)[number] =>
        Boolean(material),
      )

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
      recognition.group.instruction ||
      '整理为结构清晰、可直接编辑发布的中文文章。保留有用事实与引用，不编造来源。'
    const sourceContent = selectedMaterials
      .map(
        (material, index) =>
          `## 素材 ${index + 1}：${material.title}\n\n${material.content}`,
      )
      .join('\n\n---\n\n')
      .slice(0, 80_000)
    const analysis = analyzed.analysis as {
      media?: Array<{ status: string }>
    }
    const pipelineResult = await this.pipeline.run({
      sourceTitle: recognition.group.title || analyzed.material.title,
      sourceContent,
      instruction,
      categoryChoices,
    })
    const output = pipelineResult.output
    const generation = {
      mode: 'ai-pipeline',
      ...pipelineResult.usage,
      stages: pipelineResult.stages,
      recognition: {
        ...recognition.group,
        stage: recognition.stage,
      },
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
    await this.workflow.attachMaterials(
      String(project.id),
      selectedMaterials.map(({ id }) => String(id)),
    )
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
        sourceMaterialIds: selectedMaterials.map(({ id }) => String(id)),
        materialRecognition: recognition.group,
        generation,
      },
    })
    const coreDraft = await this.workflow.createCoreDraft(
      String(project.id),
      String(revision.id),
    )
    const reviewRequest = await this.workflow.requestReview(
      String(project.id),
      {
        revisionId: String(revision.id),
        expiresInHours: 168,
        reviewerEmail: input.reviewerEmail,
      },
    )

    return {
      material: analyzed.material,
      project,
      revision,
      coreDraft: {
        id: coreDraft.id,
        editorHash: `#/posts/edit?id=${coreDraft.id}`,
      },
      reviewRequest,
      recognition: recognition.group,
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
