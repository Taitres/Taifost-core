import { Injectable, Logger } from '@nestjs/common'

import { CronOnce } from '~/common/decorators/cron-once.decorator'

import { MarlinWorkflowService } from './marlin-workflow.service'

@Injectable()
export class MarlinWorkflowScheduler {
  private readonly logger = new Logger(MarlinWorkflowScheduler.name)

  constructor(private readonly workflowService: MarlinWorkflowService) {}

  @CronOnce('* * * * *', { name: 'marlinScheduledPublications' })
  async publishDue() {
    const results = await this.workflowService.publishDue()
    if (results.length) {
      this.logger.log(`Processed ${results.length} scheduled publication(s)`)
    }
  }
}
