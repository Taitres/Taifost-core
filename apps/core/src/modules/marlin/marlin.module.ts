import { Module } from '@nestjs/common'

import { MarlinMaterialController } from './material/marlin-material.controller'
import { MarlinMaterialRepository } from './material/marlin-material.repository'
import { MarlinMaterialService } from './material/marlin-material.service'
import {
  MarlinPublicReviewController,
  MarlinWorkflowController,
} from './workflow/marlin-workflow.controller'
import { MarlinWorkflowRepository } from './workflow/marlin-workflow.repository'
import { MarlinWorkflowScheduler } from './workflow/marlin-workflow.scheduler'
import { MarlinWorkflowService } from './workflow/marlin-workflow.service'

@Module({
  controllers: [
    MarlinMaterialController,
    MarlinWorkflowController,
    MarlinPublicReviewController,
  ],
  providers: [
    MarlinMaterialRepository,
    MarlinMaterialService,
    MarlinWorkflowRepository,
    MarlinWorkflowService,
    MarlinWorkflowScheduler,
  ],
  exports: [
    MarlinMaterialRepository,
    MarlinMaterialService,
    MarlinWorkflowRepository,
    MarlinWorkflowService,
  ],
})
export class MarlinModule {}
