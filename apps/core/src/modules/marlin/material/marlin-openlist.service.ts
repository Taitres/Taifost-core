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
  private credentialToken?: string
  private credentialTokenPromise?: Promise<string>

  private getConfig() {
    const endpoint = process.env.MARLIN_OPENLIST_URL?.replace(/\/+$/, '')
    const token = process.env.MARLIN_OPENLIST_TOKEN
    const username = process.env.MARLIN_OPENLIST_USERNAME
    const password = process.env.MARLIN_OPENLIST_PASSWORD
    const directory = `/${(
      process.env.MARLIN_OPENLIST_DIRECTORY || 'marlin/assets'
    ).replaceAll(/^\/+|\/+$/g, '')}`
    const publicBase = (
      process.env.MARLIN_OPENLIST_PUBLIC_URL || endpoint
    )?.replace(/\/+$/, '')
    return { endpoint, token, username, password, directory, publicBase }
  }

  private async resolveToken(
    config: ReturnType<MarlinOpenListService['getConfig']>,
    force = false,
  ) {
    if (config.token) return config.token
    if (!config.endpoint || !config.username || !config.password) {
      throw new Error(
        'OpenList is not configured (TOKEN or USERNAME/PASSWORD required)',
      )
    }
    if (force) {
      this.credentialToken = undefined
      this.credentialTokenPromise = undefined
    }
    if (this.credentialToken) return this.credentialToken
    if (this.credentialTokenPromise) return this.credentialTokenPromise

    const login = (async () => {
      const response = await fetch(`${config.endpoint}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
          otp_code: '',
        }),
        signal: AbortSignal.timeout(5_000),
      })
      const result = (await response.json().catch(() => null)) as {
        code?: number
        message?: string
        data?: { token?: string }
      } | null
      const token = result?.data?.token
      if (
        !response.ok ||
        (result?.code != null && result.code !== 200) ||
        !token
      ) {
        throw new Error(
          result?.message || `OpenList login returned HTTP ${response.status}`,
        )
      }
      this.credentialToken = token
      return token
    })()
    this.credentialTokenPromise = login
    try {
      return await login
    } finally {
      this.credentialTokenPromise = undefined
    }
  }

  private async fetchAuthorized(
    config: ReturnType<MarlinOpenListService['getConfig']>,
    path: string,
    init: RequestInit = {},
  ) {
    const request = async (force = false) => {
      const token = await this.resolveToken(config, force)
      const headers = new Headers(init.headers)
      headers.set('authorization', token)
      return fetch(`${config.endpoint}${path}`, {
        ...init,
        headers,
      })
    }
    const response = await request()
    if (response.status === 401 && !config.token) return request(true)
    return response
  }

  async checkHealth() {
    const startedAt = Date.now()
    const config = this.getConfig()
    if (
      !config.endpoint ||
      (!config.token && !(config.username && config.password))
    ) {
      return {
        configured: false,
        reachable: false,
        latencyMs: Date.now() - startedAt,
        message: 'OpenList is not configured',
      }
    }

    try {
      const response = await this.fetchAuthorized(config, '/api/me', {
        signal: AbortSignal.timeout(5_000),
      })
      const result = (await response.json().catch(() => null)) as {
        code?: number
        message?: string
      } | null
      const reachable =
        response.ok && (result?.code == null || result.code === 200)
      return {
        configured: true,
        reachable,
        latencyMs: Date.now() - startedAt,
        message: reachable
          ? 'OpenList API is reachable'
          : result?.message || `OpenList returned HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        latencyMs: Date.now() - startedAt,
        message:
          error instanceof Error ? error.message : 'OpenList request failed',
      }
    }
  }

  async archiveRemoteImage(sourceUrl: string) {
    const config = this.getConfig()
    if (
      !config.endpoint ||
      (!config.token && !(config.username && config.password)) ||
      !config.publicBase
    ) {
      throw new Error(
        'OpenList is not configured (URL, credentials and PUBLIC_URL required)',
      )
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
    const response = await this.fetchAuthorized(config, '/api/fs/put', {
      method: 'PUT',
      headers: {
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
