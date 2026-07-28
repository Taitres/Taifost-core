import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { MarlinMaterialRepository } from '~/modules/marlin/material/marlin-material.repository'
import { MarlinMaterialService } from '~/modules/marlin/material/marlin-material.service'

describe('MarlinMaterialService', () => {
  it('freezes exact UTF-8 content with a stable SHA-256 hash and evidence', async () => {
    const repository = {
      importFrozen: vi.fn().mockResolvedValue({ deduplicated: false }),
    }
    const service = new MarlinMaterialService(
      repository as unknown as MarlinMaterialRepository,
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
        contentHash: createHash('sha256')
          .update(content, 'utf8')
          .digest('hex'),
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
})
