import 'dotenv-expand/config'

import { NestFactory } from '@nestjs/core'

import { initializeApp } from '../src/global/index.global'

initializeApp()

const [{ AppModule }, { MarlinComposeService }] = await Promise.all([
  import('../src/app.module'),
  import('../src/modules/marlin/compose/marlin-compose.service'),
])

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
})

try {
  const compose = app.get(MarlinComposeService)
  const result = await compose.compose({
    source: [
      '# AI 流水线生产验收',
      '',
      '这是 2026 年 8 月 2 日创建的一份内部验收素材。',
      '目标是验证系统能够冻结 Markdown 素材、识别可合写资料、自动撰写文章，并把未发布草稿交给 MX Space 原生编辑器审核。',
      '本文不包含外部事实，也不应补造引用。',
    ].join('\n'),
    instruction:
      '写成一篇简短的系统验收记录，明确说明这是测试草稿，不添加素材中不存在的事实。',
  })

  console.info(
    JSON.stringify({
      ok: true,
      materialId: result.material.id,
      groupedMaterialIds: result.recognition.materialIds,
      projectId: result.project.id,
      revisionId: result.revision.id,
      coreDraftId: result.coreDraft.id,
      coreEditorHash: result.coreDraft.editorHash,
      reviewRequestId: result.reviewRequest.request.id,
      reviewEmailStatus: result.reviewRequest.emailDelivery.status,
      pipelineStages: result.pipeline.map(({ key }) => key),
    }),
  )
} finally {
  await app.close()
}
