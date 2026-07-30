import { Get } from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { HttpCache } from '~/common/decorators/cache.decorator'

import { MarlinOpsService } from './marlin-ops.service'

@ApiController('marlin/ops')
@Auth()
export class MarlinOpsController {
  constructor(private readonly opsService: MarlinOpsService) {}

  @Get('/health')
  @HttpCache.disable
  health() {
    return this.opsService.health()
  }
}
