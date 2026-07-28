import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { MarlinMaterialRepository } from './marlin-material.repository'
import type { MarlinMaterialImportInput } from './marlin-material.types'

@Injectable()
export class MarlinMaterialService {
  constructor(private readonly repository: MarlinMaterialRepository) {}

  import(input: MarlinMaterialImportInput) {
    const contentHash = createHash('sha256')
      .update(input.content, 'utf8')
      .digest('hex')

    return this.repository.importFrozen(
      {
        kind: input.kind,
        title: input.title,
        content: input.content,
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
}
