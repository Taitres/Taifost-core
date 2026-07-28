import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import { Injectable } from '@nestjs/common'

import { fetchPublicRemote } from './marlin-remote-fetch.util'

const safeName = (value: string) =>
  value
    .normalize('NFKD')
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 100) || 'asset'

@Injectable()
export class MarlinOpenListService {
  private getConfig() {
    const endpoint = process.env.MARLIN_OPENLIST_URL?.replace(/\/+$/, '')
    const token = process.env.MARLIN_OPENLIST_TOKEN
    const directory = `/${(
      process.env.MARLIN_OPENLIST_DIRECTORY || 'marlin/assets'
    ).replaceAll(/^\/+|\/+$/g, '')}`
    const publicBase = (
      process.env.MARLIN_OPENLIST_PUBLIC_URL || endpoint
    )?.replace(/\/+$/, '')
    return { endpoint, token, directory, publicBase }
  }

  async archiveRemoteImage(sourceUrl: string) {
    const config = this.getConfig()
    if (!config.endpoint || !config.token || !config.publicBase) {
      throw new Error('OpenList is not configured (MARLIN_OPENLIST_URL/TOKEN)')
    }

    const remote = await fetchPublicRemote(sourceUrl, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 20_000,
    })
    if (!remote.contentType.startsWith('image/')) {
      throw new Error(`Remote resource is not an image: ${remote.contentType}`)
    }

    const now = new Date()
    const sourceName =
      decodeURIComponent(posix.basename(remote.url.pathname)) || 'image'
    const digest = createHash('sha256').update(remote.buffer).digest('hex')
    const objectPath = posix.join(
      config.directory,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${digest.slice(0, 16)}-${safeName(sourceName)}`,
    )
    const response = await fetch(`${config.endpoint}/api/fs/put`, {
      method: 'PUT',
      headers: {
        authorization: config.token,
        'content-type': remote.contentType,
        'file-path': encodeURIComponent(objectPath),
      },
      body: remote.buffer as unknown as BodyInit,
      signal: AbortSignal.timeout(30_000),
    })
    const result = (await response.json().catch(() => null)) as {
      code?: number
      message?: string
    } | null
    if (!response.ok || (result?.code != null && result.code !== 200)) {
      throw new Error(
        result?.message || `OpenList upload returned HTTP ${response.status}`,
      )
    }

    return {
      sourceUrl,
      archivedUrl: `${config.publicBase}/d${objectPath}`,
      objectPath,
      contentHash: digest,
      mimeType: remote.contentType,
      byteSize: remote.buffer.byteLength,
      status: 'archived' as const,
    }
  }
}
