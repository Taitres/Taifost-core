import { Body, Post } from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'

import { MarlinComposeDto } from './marlin-compose.schema'
import { MarlinComposeService } from './marlin-compose.service'

@ApiController('marlin/compose')
@Auth()
export class MarlinComposeController {
  constructor(private readonly service: MarlinComposeService) {}

  @Post('/')
  compose(@Body() body: MarlinComposeDto) {
    return this.service.compose(body)
  }
}
