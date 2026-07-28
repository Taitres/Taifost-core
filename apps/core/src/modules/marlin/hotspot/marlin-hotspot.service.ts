import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { MarlinMaterialService } from '../material/marlin-material.service'
import { MarlinWorkflowService } from '../workflow/marlin-workflow.service'
import { parseHotspotPayload } from './marlin-hotspot.parser'
import { MarlinHotspotRepository } from './marlin-hotspot.repository'

const MAX_SOURCE_BYTES = 5_000_000

const canonicalUrl = (value?: string) => {
  if (!value) return ''
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of url.searchParams.keys()) {
      if (/^(?:utm_|spm$|from$|ref$)/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return value.trim()
  }
}

const eventHashOf = (title: string, url?: string) =>
  createHash('sha256')
    .update(
      `${title.toLocaleLowerCase().replaceAll(/\s+/g, ' ').trim()}\n${canonicalUrl(url)}`,
    )
    .digest('hex')

@Injectable()
export class MarlinHotspotService {
  constructor(
    private readonly repository: MarlinHotspotRepository,
    private readonly materialService: MarlinMaterialService,
    private readonly workflowService: MarlinWorkflowService,
  ) {}

  async collect(sourceId: string) {
    const source = await this.repository.findSource(sourceId)
    if (!source) throw new NotFoundException('Hotspot source not found')
    if (!source.enabled)
      throw new BadRequestException('Hotspot source disabled')
    const theme = source.themeId
      ? await this.repository.findTheme(source.themeId)
      : null
    if (theme && !theme.enabled) {
      throw new BadRequestException('Hotspot theme disabled')
    }

    try {
      const response = await fetch(source.url, {
        headers: {
          accept:
            source.format === 'json'
              ? 'application/json'
              : 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          'user-agent': 'MARLIN.LOG Hotspot Collector/1.0',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(`Source returned HTTP ${response.status}`)
      }
      const declaredSize = Number(response.headers.get('content-length') ?? 0)
      if (declaredSize > MAX_SOURCE_BYTES) {
        throw new Error('Source payload exceeds 5 MB')
      }
      const body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > MAX_SOURCE_BYTES) {
        throw new Error('Source payload exceeds 5 MB')
      }
      if (!['rss', 'atom', 'json'].includes(source.format)) {
        throw new Error(`Unsupported source format: ${source.format}`)
      }
      const parsed = parseHotspotPayload(
        source.format as 'rss' | 'atom' | 'json',
        body,
        source.config,
      )
      const counts = await this.repository.countToday(source.id, source.themeId)
      const sourceRemaining = Math.max(0, source.dailyQuota - counts.source)
      const themeRemaining = theme
        ? Math.max(0, theme.dailyQuota - counts.theme)
        : sourceRemaining
      const quota = Math.min(sourceRemaining, themeRemaining)
      const keywords = theme?.keywords.map((word) => word.toLowerCase()) ?? []
      const candidates = parsed.slice(0, quota).map((item) => {
        const haystack = `${item.title}\n${item.summary ?? ''}`.toLowerCase()
        const score = keywords.reduce(
          (total, keyword) => total + (haystack.includes(keyword) ? 10 : 0),
          0,
        )
        return {
          id: this.repository.nextId(),
          sourceId: source.id,
          themeId: source.themeId,
          eventHash: eventHashOf(item.title, item.url),
          title: item.title,
          url: canonicalUrl(item.url) || null,
          summary: item.summary ?? null,
          publishedAt: item.publishedAt ?? null,
          score,
          raw: item.raw,
        }
      })
      const inserted = await this.repository.insertCandidates(candidates)
      await this.repository.markSourceFetched(source.id)
      return {
        sourceId: source.id,
        fetched: parsed.length,
        accepted: inserted.length,
        deduplicated: candidates.length - inserted.length,
        quotaRemaining: Math.max(0, quota - inserted.length),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.repository.markSourceFetched(source.id, message)
      throw new BadRequestException(`Hotspot collection failed: ${message}`)
    }
  }

  async collectAll() {
    const sources = await this.repository.listSources()
    const results: Array<
      | Awaited<ReturnType<MarlinHotspotService['collect']>>
      | { sourceId: string; error: string }
    > = []
    for (const source of sources.filter(({ enabled }) => enabled)) {
      try {
        results.push(await this.collect(source.id))
      } catch (error) {
        results.push({
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return results
  }

  async selectCandidate(id: string) {
    const candidate = await this.repository.findCandidate(id)
    if (!candidate) throw new NotFoundException('Hotspot candidate not found')
    if (candidate.status === 'selected') {
      return {
        candidate,
        materialId: candidate.raw.marlinMaterialId ?? null,
        projectId: candidate.raw.marlinProjectId ?? null,
        replayed: true,
      }
    }

    const imported = candidate.url
      ? await this.materialService.importUrl({
          url: candidate.url,
          title: candidate.title,
          metadata: {
            hotspotCandidateId: candidate.id,
            hotspotSourceId: candidate.sourceId,
          },
        })
      : await this.materialService.import({
          kind: 'markdown',
          title: candidate.title,
          content: [`# ${candidate.title}`, candidate.summary ?? '']
            .filter(Boolean)
            .join('\n\n'),
          mimeType: 'text/markdown',
          sourceType: 'manual',
          sourceRef: `hotspot:${candidate.id}`,
          metadata: {
            hotspotCandidateId: candidate.id,
            hotspotSourceId: candidate.sourceId,
          },
        })
    const analysis = await this.materialService.analyze(imported.material.id, {
      force: false,
      archiveImages: true,
    })
    if (analysis?.material?.status === 'pending') {
      throw new ConflictException(
        'Hotspot material has unresolved remote images; resolve it in the material library before selecting again',
      )
    }

    const project = await this.workflowService.createProject({
      title: candidate.title,
      goal: [
        '基于入选热点形成一篇可审核的原创文章。',
        candidate.summary,
        candidate.url ? `公开来源：${candidate.url}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    })
    await this.workflowService.attachMaterials(project.id, [
      imported.material.id,
    ])
    const selected = await this.repository.markCandidateSelected(id, {
      materialId: imported.material.id,
      projectId: project.id,
    })
    return {
      candidate: selected,
      material: analysis?.material ?? imported.material,
      project,
      replayed: false,
    }
  }
}
