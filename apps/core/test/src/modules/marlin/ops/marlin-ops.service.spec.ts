import { describe, expect, it, vi } from 'vitest'

import { MarlinOpsService } from '~/modules/marlin/ops/marlin-ops.service'

const makeService = (overrides: Record<string, unknown> = {}) => {
  const postgres = {
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  }
  const redisClient = { ping: vi.fn().mockResolvedValue('PONG') }
  const redis = {
    getClient: () => redisClient,
    getStatus: () => 'ready',
  }
  const configs = {
    get: vi.fn(async (key: string) =>
      key === 'mailOptions'
        ? {
            enable: true,
            provider: 'smtp',
            from: 'owner@example.com',
            smtp: {
              user: 'owner@example.com',
              host: 'smtp.example.com',
              port: 465,
            },
          }
        : { enable: true },
    ),
  }
  const openList = {
    checkHealth: vi.fn().mockResolvedValue({
      configured: true,
      reachable: true,
      latencyMs: 4,
      message: 'OpenList API is reachable',
    }),
  }
  const hotspots = {
    listSources: vi.fn().mockResolvedValue([
      {
        id: 1n,
        name: 'feed',
        enabled: true,
        lastFetchedAt: new Date(),
        lastError: null,
      },
    ]),
  }
  const dependencies = {
    postgres,
    redis,
    configs,
    openList,
    hotspots,
    ...overrides,
  }
  const service = new MarlinOpsService(
    dependencies.postgres as never,
    dependencies.redis as never,
    dependencies.configs as never,
    dependencies.openList as never,
    dependencies.hotspots as never,
  )
  return { service, dependencies, redisClient }
}

describe('MarlinOpsService', () => {
  it('reports a healthy system without exposing configuration secrets', async () => {
    const { service } = makeService()

    const result = await service.health()

    expect(result.status).toBe('ok')
    expect(result.components.postgres.status).toBe('ok')
    expect(result.components.redis.status).toBe('ok')
    expect(result.components.openList.status).toBe('ok')
    expect(result.components.mail.details).toEqual({
      provider: 'smtp',
      configured: true,
    })
    expect(JSON.stringify(result)).not.toContain('owner@example.com')
  })

  it('keeps returning component diagnostics when dependencies fail', async () => {
    const { service, dependencies, redisClient } = makeService()
    dependencies.postgres.query.mockRejectedValueOnce(
      new Error('database unavailable'),
    )
    redisClient.ping.mockRejectedValueOnce(new Error('redis unavailable'))
    dependencies.openList.checkHealth.mockResolvedValueOnce({
      configured: true,
      reachable: false,
      latencyMs: 5000,
      message: 'request timed out',
    })
    dependencies.hotspots.listSources.mockRejectedValueOnce(
      new Error('source query failed'),
    )

    const result = await service.health()

    expect(result.status).toBe('down')
    expect(result.components.postgres.status).toBe('down')
    expect(result.components.redis.status).toBe('down')
    expect(result.components.openList.status).toBe('degraded')
    expect(result.components.hotspots.status).toBe('degraded')
  })

  it('treats unconfigured optional services as disabled', async () => {
    const { service, dependencies } = makeService()
    dependencies.openList.checkHealth.mockResolvedValueOnce({
      configured: false,
      reachable: false,
      latencyMs: 0,
      message: 'OpenList is not configured',
    })
    dependencies.configs.get.mockImplementation(async (key: string) =>
      key === 'mailOptions'
        ? { enable: false, provider: 'smtp' }
        : { enable: false },
    )

    const result = await service.health()

    expect(result.status).toBe('ok')
    expect(result.components.openList.status).toBe('disabled')
    expect(result.components.mail.status).toBe('disabled')
    expect(result.components.backup.status).toBe('disabled')
  })
})
