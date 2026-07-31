import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { parseHTML } from 'linkedom'

import { MarlinMaterialRepository } from './marlin-material.repository'
import type { MarlinMaterialImportInput } from './marlin-material.types'
import { MarlinOpenListService } from './marlin-openlist.service'
import { fetchPublicRemote } from './marlin-remote-fetch.util'

@Injectable()
export class MarlinMaterialService {
  constructor(
    private readonly repository: MarlinMaterialRepository,
    private readonly openList: MarlinOpenListService,
  ) {}

  private htmlToMarkdown(html: string, baseUrl?: string) {
    const { document } = parseHTML(html)
    document
      .querySelectorAll('script,style,noscript,template,iframe,svg,form')
      .forEach((element) => element.remove())
    const root =
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.body
    if (!root) return ''

    const render = (node: any): string => {
      if (node.nodeType === 3) return String(node.textContent || '')
      if (node.nodeType !== 1 && node !== root) return ''
      const tag = String(node.localName || '').toLowerCase()
      const inner = Array.from(node.childNodes || [], (child) => render(child))
        .join('')
        .trim()
      if (!tag) return inner
      if (/^h[1-6]$/.test(tag)) {
        return `\n\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`
      }
      if (tag === 'p' || tag === 'section' || tag === 'div') {
        return inner ? `\n\n${inner}\n\n` : ''
      }
      if (tag === 'br') return '\n'
      if (tag === 'strong' || tag === 'b') return `**${inner}**`
      if (tag === 'em' || tag === 'i') return `*${inner}*`
      if (tag === 'code' && node.parentElement?.localName !== 'pre') {
        return `\`${inner}\``
      }
      if (tag === 'pre')
        return `\n\n\`\`\`\n${node.textContent || ''}\n\`\`\`\n\n`
      if (tag === 'blockquote') {
        return `\n\n${inner
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}\n\n`
      }
      if (tag === 'li') return `\n- ${inner}`
      if (tag === 'ul' || tag === 'ol') return `\n${inner}\n`
      if (tag === 'hr') return '\n\n---\n\n'
      if (tag === 'a') {
        const href = node.getAttribute('href')
        if (!href) return inner
        try {
          const url = new URL(href, baseUrl || 'https://invalid.local')
          if (url.hostname === 'invalid.local') return inner
          return ['http:', 'https:'].includes(url.protocol)
            ? `[${inner || url.href}](${url.href})`
            : inner
        } catch {
          return inner
        }
      }
      if (tag === 'img') {
        const src = node.getAttribute('src')
        if (!src) return ''
        try {
          const url = new URL(src, baseUrl || 'https://invalid.local')
          if (url.hostname === 'invalid.local') return ''
          if (!['http:', 'https:'].includes(url.protocol)) return ''
          return `![${node.getAttribute('alt') || ''}](${url.href})`
        } catch {
          return ''
        }
      }
      return inner
    }

    return render(root)
      .replaceAll(/[\t ]+\n/g, '\n')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim()
  }

  private normalizeContent(
    kind: MarlinMaterialImportInput['kind'],
    content: string,
    baseUrl?: string,
  ) {
    if (kind === 'html' || kind === 'url') {
      return this.htmlToMarkdown(content, baseUrl)
    }
    if (kind === 'json') {
      let normalized = content
      try {
        normalized = JSON.stringify(JSON.parse(content), null, 2)
      } catch {
        // Preserve invalid JSON exactly inside a fenced block for inspection.
      }
      return `\`\`\`json\n${normalized}\n\`\`\``
    }
    return content
  }

  import(input: MarlinMaterialImportInput) {
    const contentHash = createHash('sha256')
      .update(input.content, 'utf8')
      .digest('hex')

    return this.repository.importFrozen(
      {
        kind: input.kind,
        title: input.title,
        content: this.normalizeContent(
          input.kind,
          input.content,
          input.sourceRef,
        ),
        originalContent: input.content,
        contentHash,
        mimeType: input.mimeType,
        byteSize: Buffer.byteLength(input.content, 'utf8'),
      },
      {
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        originalFilename: input.originalFilename,
        metadata: input.metadata,
      },
    )
  }

  async importUrl(input: {
    url: string
    title?: string
    metadata: Record<string, unknown>
  }) {
    const remote = await fetchPublicRemote(input.url, {
      maxBytes: 5_000_000,
      timeoutMs: 20_000,
    })
    const content = remote.buffer.toString('utf8')
    const hostname = remote.url.hostname.toLowerCase()
    const sourceType = hostname.endsWith('chatgpt.com')
      ? 'chatgpt-share'
      : hostname.endsWith('claude.ai')
        ? 'claude-share'
        : 'url'
    const kind = remote.contentType.includes('json')
      ? 'json'
      : remote.contentType.includes('markdown')
        ? 'markdown'
        : remote.contentType.includes('html')
          ? 'html'
          : 'text'
    const lowerContent = content.toLowerCase()
    const titleStart = lowerContent.indexOf('<title')
    const titleContentStart =
      titleStart === -1 ? -1 : lowerContent.indexOf('>', titleStart) + 1
    const titleEnd =
      titleContentStart <= 0
        ? -1
        : lowerContent.indexOf('</title>', titleContentStart)
    const htmlTitle =
      kind === 'html' && titleEnd > titleContentStart
        ? content.slice(titleContentStart, titleEnd)
        : undefined
    return this.import({
      kind,
      title:
        input.title ||
        htmlTitle?.replaceAll(/<[^>]+>/g, '').trim() ||
        decodeURIComponent(remote.url.pathname.split('/').pop() || '') ||
        remote.url.hostname,
      content,
      mimeType: remote.contentType,
      sourceType,
      sourceRef: remote.url.href,
      metadata: {
        ...input.metadata,
        finalUrl: remote.url.href,
        fetchedAt: new Date().toISOString(),
      },
    })
  }

  private buildAnalysis(content: string) {
    const withoutCodeFences = content
      .split('```')
      .map((part, index) => (index % 2 === 0 ? part : ' '))
      .join(' ')
    const plain = withoutCodeFences
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/[!#()*>[\]_`-]+/g, ' ')
      .split(/\s/)
      .filter(Boolean)
      .join(' ')
      .trim()
    const headings = content
      .split(/\r?\n/)
      .flatMap((line) => {
        let level = 0
        while (line[level] === '#' && level < 6) level++
        if (level === 0 || (line[level] !== ' ' && line[level] !== '\t')) {
          return []
        }
        return [line.slice(level + 1).trim()]
      })
      .filter(Boolean)
      .slice(0, 20)
    const markdownImageUrls = Array.from(
      // eslint-disable-next-line regexp/strict
      content.matchAll(/!\[[^\]]*]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g),
      (match) => match[1],
    )
    const htmlImageUrls = Array.from(content.matchAll(/<img[^>]+>/gi))
      .map((match) => match[0].match(/\ssrc=["'](https?:\/\/[^"']+)["']/i)?.[1])
      .filter((url): url is string => Boolean(url))
    const imageUrls = [...markdownImageUrls, ...htmlImageUrls]
    const allUrls = Array.from(
      content.matchAll(/https?:\/\/[^\s"')<>\]]+/g),
      (match) => match[0],
    )
    const words =
      plain.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,30}/gu) || []
    const ignored = new Set([
      'this',
      'that',
      'with',
      'from',
      'have',
      '一个',
      '这个',
      '以及',
      '可以',
      '进行',
      '我们',
    ])
    const counts = new Map<string, number>()
    for (const word of words) {
      if (!ignored.has(word)) counts.set(word, (counts.get(word) || 0) + 1)
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([word]) => word)
    const fragments = content
      .split(/\n{2,}/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 40)
      .slice(0, 12)
      .map((value, index) => ({
        index: index + 1,
        text: value.slice(0, 800),
      }))

    return {
      summary: plain.slice(0, 500),
      categories: headings.slice(0, 8),
      tags,
      fragments,
      publicCitations: [...new Set(allUrls)]
        .filter((url) => !imageUrls.includes(url))
        .slice(0, 50)
        .map((url) => ({ url, host: new URL(url).hostname })),
      imageUrls: [...new Set(imageUrls)].slice(0, 50),
    }
  }

  async analyze(
    id: string,
    options: {
      force: boolean
      archiveImages: boolean
      ignoreFailedImages?: boolean
    },
  ) {
    const material = await this.repository.findById(id)
    if (!material) return null
    if (material.analysis && material.status !== 'pending' && !options.force) {
      return { material, analysis: material.analysis, reused: true }
    }

    const derived = this.buildAnalysis(material.content)
    const media = options.archiveImages
      ? await Promise.all(
          derived.imageUrls.map(async (sourceUrl) => {
            try {
              return await this.openList.archiveRemoteImage(sourceUrl)
            } catch (error) {
              return options.ignoreFailedImages
                ? { sourceUrl, status: 'ignored' as const }
                : {
                    sourceUrl,
                    status: 'failed' as const,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
            }
          }),
        )
      : derived.imageUrls.map((sourceUrl) => ({
          sourceUrl,
          status: options.ignoreFailedImages
            ? ('ignored' as const)
            : ('pending' as const),
        }))
    const analysis = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ...derived,
      media,
    }
    const hasUnresolvedMedia = media.some(({ status }) =>
      ['failed', 'pending'].includes(status),
    )
    const localizedContent = media.reduce(
      (content, item) =>
        item.status === 'archived'
          ? content.replaceAll(item.sourceUrl, item.archivedUrl)
          : content,
      material.content,
    )
    const fullyResolved =
      media.length > 0 &&
      media.every(({ status }) => ['archived', 'ignored'].includes(status))
    const updated = await this.repository.updateAnalysis(
      id,
      analysis,
      hasUnresolvedMedia ? 'pending' : 'analyzed',
      fullyResolved ? localizedContent : undefined,
    )
    return { material: updated, analysis, reused: false }
  }
}
