import { Module } from '@nestjs/common'

import { MarlinMaterialController } from './material/marlin-material.controller'
import { MarlinMaterialRepository } from './material/marlin-material.repository'
import { MarlinMaterialService } from './material/marlin-material.service'

@Module({
  controllers: [MarlinMaterialController],
  providers: [MarlinMaterialRepository, MarlinMaterialService],
  exports: [MarlinMaterialRepository, MarlinMaterialService],
})
export class MarlinModule {}
