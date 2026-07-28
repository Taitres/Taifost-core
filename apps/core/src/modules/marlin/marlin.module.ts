import { Module } from '@nestjs/common'

import { MarlinAiController } from './ai/marlin-ai.controller'
import { MarlinAiRepository } from './ai/marlin-ai.repository'
import { MarlinAiService } from './ai/marlin-ai.service'
import { MarlinHotspotController } from './hotspot/marlin-hotspot.controller'
import { MarlinHotspotRepository } from './hotspot/marlin-hotspot.repository'
import { MarlinHotspotScheduler } from './hotspot/marlin-hotspot.scheduler'
import { MarlinHotspotService } from './hotspot/marlin-hotspot.service'
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
    MarlinHotspotController,
    MarlinAiController,
  ],
  providers: [
    MarlinMaterialRepository,
    MarlinMaterialService,
    MarlinWorkflowRepository,
    MarlinWorkflowService,
    MarlinWorkflowScheduler,
    MarlinHotspotRepository,
    MarlinHotspotService,
    MarlinHotspotScheduler,
    MarlinAiRepository,
    MarlinAiService,
  ],
  exports: [
    MarlinMaterialRepository,
    MarlinMaterialService,
    MarlinWorkflowRepository,
    MarlinWorkflowService,
    MarlinHotspotRepository,
    MarlinHotspotService,
    MarlinAiRepository,
    MarlinAiService,
  ],
})
export class MarlinModule {}
