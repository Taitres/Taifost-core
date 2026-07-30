import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'

import { PG_POOL_TOKEN } from '~/constants/system.constant'
import { ConfigsService } from '~/modules/configs/configs.service'
import { RedisService } from '~/processors/redis/redis.service'
import { PKG } from '~/utils/pkg.util'

import { MarlinHotspotRepository } from '../hotspot/marlin-hotspot.repository'
import { MarlinOpenListService } from '../material/marlin-openlist.service'

type HealthStatus = 'ok' | 'degraded' | 'down' | 'disabled'

interface HealthComponent {
  status: HealthStatus
  label: string
  latencyMs?: number
  message: string
  details?: Record<string, unknown>
}

@Injectable()
export class MarlinOpsService {
  constructor(
    @Inject(PG_POOL_TOKEN) private readonly postgres: Pool,
    private readonly redisService: RedisService,
    private readonly configsService: ConfigsService,
    private readonly openListService: MarlinOpenListService,
    private readonly hotspotRepository: MarlinHotspotRepository,
  ) {}

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error'
  }

  private async checkPostgres(): Promise<HealthComponent> {
    const startedAt = Date.now()
    try {
      await this.postgres.query('SELECT 1')
      return {
        status: 'ok',
        label: 'PostgreSQL',
        latencyMs: Date.now() - startedAt,
        message: 'Database is reachable',
      }
    } catch (error) {
      return {
        status: 'down',
        label: 'PostgreSQL',
        latencyMs: Date.now() - startedAt,
        message: this.errorMessage(error),
      }
    }
  }

  private async checkRedis(): Promise<HealthComponent> {
    const startedAt = Date.now()
    try {
      const pong = await this.redisService.getClient().ping()
      if (pong !== 'PONG') throw new Error(`Unexpected PING response: ${pong}`)
      return {
        status: 'ok',
        label: 'Redis',
        latencyMs: Date.now() - startedAt,
        message: 'Cache and task queue are reachable',
      }
    } catch (error) {
      return {
        status: 'down',
        label: 'Redis',
        latencyMs: Date.now() - startedAt,
        message: this.errorMessage(error),
        details: { clientStatus: this.redisService.getStatus() },
      }
    }
  }

  private async checkOpenList(): Promise<HealthComponent> {
    const result = await this.openListService.checkHealth()
    if (!result.configured) {
      return {
        status: 'disabled',
        label: 'OpenList',
        latencyMs: result.latencyMs,
        message: result.message,
      }
    }
    return {
      status: result.reachable ? 'ok' : 'degraded',
      label: 'OpenList',
      latencyMs: result.latencyMs,
      message: result.message,
    }
  }

  private async checkMail(): Promise<HealthComponent> {
    try {
      const mail = await this.configsService.get('mailOptions')
      if (!mail.enable) {
        return {
          status: 'disabled',
          label: 'Email',
          message: 'Email delivery is disabled',
          details: { provider: mail.provider },
        }
      }
      const configured =
        mail.provider === 'resend'
          ? Boolean(mail.resend?.apiKey && mail.from)
          : Boolean(
              mail.smtp?.host &&
                mail.smtp?.port &&
                (mail.smtp?.user || mail.from),
            )
      return {
        status: configured ? 'ok' : 'degraded',
        label: 'Email',
        message: configured
          ? `${mail.provider.toUpperCase()} configuration is ready`
          : `${mail.provider.toUpperCase()} configuration is incomplete`,
        details: { provider: mail.provider, configured },
      }
    } catch (error) {
      return {
        status: 'degraded',
        label: 'Email',
        message: this.errorMessage(error),
      }
    }
  }

  private async checkBackup(): Promise<HealthComponent> {
    try {
      const backup = await this.configsService.get('backupOptions')
      return {
        status: backup.enable ? 'ok' : 'disabled',
        label: 'Backup',
        message: backup.enable
          ? 'Portable ZIP backup is enabled'
          : 'Backup generation is disabled',
        details: { enabled: backup.enable },
      }
    } catch (error) {
      return {
        status: 'degraded',
        label: 'Backup',
        message: this.errorMessage(error),
      }
    }
  }

  private async checkHotspots(): Promise<HealthComponent> {
    try {
      const sources = await this.hotspotRepository.listSources()
      const enabled = sources.filter((source) => source.enabled)
      const failed = enabled.filter((source) => Boolean(source.lastError))
      const neverFetched = enabled.filter((source) => !source.lastFetchedAt)
      return {
        status: failed.length ? 'degraded' : 'ok',
        label: 'Hotspot sources',
        message: failed.length
          ? `${failed.length} enabled source(s) reported an error`
          : enabled.length
            ? 'Enabled sources have no reported errors'
            : 'No hotspot source is enabled',
        details: {
          total: sources.length,
          enabled: enabled.length,
          failed: failed.length,
          neverFetched: neverFetched.length,
          failures: failed.slice(0, 10).map((source) => ({
            id: String(source.id),
            name: source.name,
            lastFetchedAt: source.lastFetchedAt,
            lastError: source.lastError,
          })),
        },
      }
    } catch (error) {
      return {
        status: 'degraded',
        label: 'Hotspot sources',
        message: this.errorMessage(error),
      }
    }
  }

  async health() {
    const [postgres, redis, openList, mail, backup, hotspots] =
      await Promise.all([
        this.checkPostgres(),
        this.checkRedis(),
        this.checkOpenList(),
        this.checkMail(),
        this.checkBackup(),
        this.checkHotspots(),
      ])
    const components = { postgres, redis, openList, mail, backup, hotspots }
    const criticalDown = [postgres, redis].some(
      ({ status }) => status === 'down',
    )
    const optionalDegraded = [openList, mail, backup, hotspots].some(
      ({ status }) => status === 'degraded' || status === 'down',
    )

    return {
      status: criticalDown ? 'down' : optionalDegraded ? 'degraded' : 'ok',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: PKG.version,
      components,
    }
  }
}
