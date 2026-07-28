import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { BadRequestException } from '@nestjs/common'

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
]

const ipv4Number = (address: string) =>
  address
    .split('.')
    .reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0

const isPrivateAddress = (address: string) => {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Number(address)
    return PRIVATE_V4_RANGES.some(
      ([network, bits]) => value >>> (32 - bits) === network >>> (32 - bits),
    )
  }
  if (family === 6) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    )
  }
  return true
}

export const assertPublicRemoteUrl = async (input: string) => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new BadRequestException('Remote URL is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('Only HTTP and HTTPS URLs are supported')
  }
  if (url.username || url.password) {
    throw new BadRequestException('Remote URL credentials are not allowed')
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new BadRequestException(
      'Remote URL resolves to a private or reserved network',
    )
  }
  return url
}

const readLimitedBody = async (response: Response, maxBytes: number) => {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > maxBytes) {
    throw new BadRequestException(`Remote body exceeds ${maxBytes} bytes`)
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new BadRequestException(`Remote body exceeds ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  )
}

export interface MarlinRemoteResponse {
  url: URL
  contentType: string
  buffer: Buffer
}

export const fetchPublicRemote = async (
  input: string,
  options: { maxBytes: number; redirects?: number; timeoutMs?: number },
): Promise<MarlinRemoteResponse> => {
  let current = await assertPublicRemoteUrl(input)
  const redirects = options.redirects ?? 3

  for (let index = 0; index <= redirects; index++) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: {
        accept: 'text/html,text/markdown,text/plain,application/json,image/*',
        'user-agent': 'MARLIN.LOG material importer/1.0',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || index === redirects) {
        throw new BadRequestException('Remote URL has too many redirects')
      }
      current = await assertPublicRemoteUrl(new URL(location, current).href)
      continue
    }
    if (!response.ok) {
      throw new BadRequestException(
        `Remote URL returned HTTP ${response.status}`,
      )
    }
    return {
      url: current,
      contentType:
        response.headers.get('content-type')?.split(';')[0]?.trim() ||
        'application/octet-stream',
      buffer: await readLimitedBody(response, options.maxBytes),
    }
  }
  throw new BadRequestException('Remote URL fetch failed')
}
