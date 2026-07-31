import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { MarlinAiController } from './ai/marlin-ai.controller'
import { MarlinAiRepository } from './ai/marlin-ai.repository'
import { MarlinAiService } from './ai/marlin-ai.service'
import { MarlinComposeController } from './compose/marlin-compose.controller'
import { MarlinComposeService } from './compose/marlin-compose.service'
import { MarlinHotspotController } from './hotspot/marlin-hotspot.controller'
import { MarlinHotspotRepository } from './hotspot/marlin-hotspot.repository'
import { MarlinHotspotScheduler } from './hotspot/marlin-hotspot.scheduler'
import { MarlinHotspotService } from './hotspot/marlin-hotspot.service'
import { MarlinMaterialController } from './material/marlin-material.controller'
import { MarlinMaterialRepository } from './material/marlin-material.repository'
import { MarlinMaterialService } from './material/marlin-material.service'
import { MarlinOpenListService } from './material/marlin-openlist.service'
import { MarlinOpsController } from './ops/marlin-ops.controller'
import { MarlinOpsService } from './ops/marlin-ops.service'
import {
  MarlinPublicReviewController,
  MarlinWorkflowController,
} from './workflow/marlin-workflow.controller'
import { MarlinWorkflowRepository } from './workflow/marlin-workflow.repository'
import { MarlinWorkflowScheduler } from './workflow/marlin-workflow.scheduler'
import { MarlinWorkflowService } from './workflow/marlin-workflow.service'

@Module({
  imports: [AiModule],
  controllers: [
    MarlinComposeController,
    MarlinMaterialController,
    MarlinWorkflowController,
    MarlinPublicReviewController,
    MarlinHotspotController,
    MarlinAiController,
    MarlinOpsController,
  ],
  providers: [
    MarlinComposeService,
    MarlinMaterialRepository,
    MarlinMaterialService,
    MarlinOpenListService,
    MarlinWorkflowRepository,
    MarlinWorkflowService,
    MarlinWorkflowScheduler,
    MarlinHotspotRepository,
    MarlinHotspotService,
    MarlinHotspotScheduler,
    MarlinAiRepository,
    MarlinAiService,
    MarlinOpsService,
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
