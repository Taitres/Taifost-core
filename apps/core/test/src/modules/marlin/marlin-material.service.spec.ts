import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { MarlinMaterialRepository } from '~/modules/marlin/material/marlin-material.repository'
import { MarlinMaterialService } from '~/modules/marlin/material/marlin-material.service'
import type { MarlinOpenListService } from '~/modules/marlin/material/marlin-openlist.service'

describe('MarlinMaterialService', () => {
  it('freezes exact UTF-8 content with a stable SHA-256 hash and evidence', async () => {
    const repository = {
      importFrozen: vi.fn().mockResolvedValue({ deduplicated: false }),
    }
    const service = new MarlinMaterialService(
      repository as unknown as MarlinMaterialRepository,
      {} as MarlinOpenListService,
    )
    const content = '# 标题\n\n不可变的素材。'

    await service.import({
      kind: 'markdown',
      title: '示例素材',
      content,
      mimeType: 'text/markdown',
      sourceType: 'upload',
      sourceRef: 'local-upload',
      originalFilename: 'example.md',
      metadata: { importer: 'studio' },
    })

    expect(repository.importFrozen).toHaveBeenCalledWith(
      {
        kind: 'markdown',
        title: '示例素材',
        content,
        originalContent: content,
        contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
        mimeType: 'text/markdown',
        byteSize: Buffer.byteLength(content, 'utf8'),
      },
      {
        sourceType: 'upload',
        sourceRef: 'local-upload',
        originalFilename: 'example.md',
        metadata: { importer: 'studio' },
      },
    )
  })

  it('freezes original HTML while normalizing its useful body to Markdown', async () => {
    const repository = {
      importFrozen: vi.fn().mockResolvedValue({ deduplicated: false }),
    }
    const service = new MarlinMaterialService(
      repository as unknown as MarlinMaterialRepository,
      {} as MarlinOpenListService,
    )
    const html =
      '<html><head><script>alert(1)</script></head><body><article><h1>标题</h1><p>正文 <strong>重点</strong></p><img src="https://example.com/a.png"></article></body></html>'

    await service.import({
      kind: 'html',
      title: '网页',
      content: html,
      mimeType: 'text/html',
      sourceType: 'url',
      sourceRef: 'https://example.com',
      metadata: {},
    })

    expect(repository.importFrozen).toHaveBeenCalledWith(
      expect.objectContaining({
        originalContent: html,
        content: expect.stringContaining('# 标题'),
        contentHash: createHash('sha256').update(html).digest('hex'),
      }),
      expect.anything(),
    )
    expect(repository.importFrozen.mock.calls[0][0].content).not.toContain(
      'alert(1)',
    )
  })

  it('derives reusable analysis and exposes OpenList failures per image', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: '1',
        content:
          '# Core v3\n\n一段足够长的素材内容，用于生成可引用片段与关键词分析结果。\n\n![远程图](https://example.com/a.png)',
        analysis: null,
      }),
      updateAnalysis: vi
        .fn()
        .mockImplementation(async (_id, analysis) => ({ id: '1', analysis })),
    }
    const openList = {
      archiveRemoteImage: vi
        .fn()
        .mockRejectedValue(new Error('OpenList is not configured')),
    }
    const service = new MarlinMaterialService(
      repository as unknown as MarlinMaterialRepository,
      openList as unknown as MarlinOpenListService,
    )

    const result = await service.analyze('1', {
      force: false,
      archiveImages: true,
    })

    expect(result?.analysis).toMatchObject({
      version: 1,
      categories: ['Core v3'],
      imageUrls: ['https://example.com/a.png'],
      media: [
        {
          sourceUrl: 'https://example.com/a.png',
          status: 'failed',
          error: 'OpenList is not configured',
        },
      ],
    })
    expect(repository.updateAnalysis).toHaveBeenCalledOnce()
  })
})
