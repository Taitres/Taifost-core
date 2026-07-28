import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

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
  constructor(private readonly repository: MarlinHotspotRepository) {}

  async collect(sourceId: string) {
    const source = await this.repository.findSource(sourceId)
    if (!source) throw new NotFoundException('Hotspot source not found')
    if (!source.enabled) throw new BadRequestException('Hotspot source disabled')
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
      const counts = await this.repository.countToday(
        source.id,
        source.themeId,
      )
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
}
