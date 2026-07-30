import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarlinOpenListService } from '~/modules/marlin/material/marlin-openlist.service'

const envKeys = [
  'MARLIN_OPENLIST_URL',
  'MARLIN_OPENLIST_TOKEN',
  'MARLIN_OPENLIST_USERNAME',
  'MARLIN_OPENLIST_PASSWORD',
] as const
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('MarlinOpenListService health', () => {
  it('authenticates with credentials without exposing them', async () => {
    process.env.MARLIN_OPENLIST_URL = 'https://openlist.example.com'
    delete process.env.MARLIN_OPENLIST_TOKEN
    process.env.MARLIN_OPENLIST_USERNAME = 'owner'
    process.env.MARLIN_OPENLIST_PASSWORD = 'secret'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 200, data: { token: 'api-token' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new MarlinOpenListService().checkHealth()

    expect(result).toMatchObject({ configured: true, reachable: true })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://openlist.example.com/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'owner',
          password: 'secret',
          otp_code: '',
        }),
      }),
    )
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(secondRequest.headers).get('authorization')).toBe(
      'api-token',
    )
    expect(JSON.stringify(result)).not.toContain('owner')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('reports disabled when neither token nor credentials are configured', async () => {
    process.env.MARLIN_OPENLIST_URL = 'https://openlist.example.com'
    delete process.env.MARLIN_OPENLIST_TOKEN
    delete process.env.MARLIN_OPENLIST_USERNAME
    delete process.env.MARLIN_OPENLIST_PASSWORD

    const result = await new MarlinOpenListService().checkHealth()

    expect(result).toMatchObject({
      configured: false,
      reachable: false,
      message: 'OpenList is not configured',
    })
  })
})
