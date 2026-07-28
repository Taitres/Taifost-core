import { Injectable, Logger } from '@nestjs/common'

import { CronOnce } from '~/common/decorators/cron-once.decorator'

import { MarlinHotspotService } from './marlin-hotspot.service'

@Injectable()
export class MarlinHotspotScheduler {
  private readonly logger = new Logger(MarlinHotspotScheduler.name)

  constructor(private readonly service: MarlinHotspotService) {}

  @CronOnce('0 7 * * *', { name: 'marlinDailyHotspots' })
  async collectDaily() {
    const results = await this.service.collectAll()
    this.logger.log(`Collected ${results.length} configured hotspot source(s)`)
  }
}
