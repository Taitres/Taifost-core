import { Body, Get, Param, Post, Put, Query } from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { EntityIdDto } from '~/shared/dto/id.dto'

import { MarlinAiRepository } from './marlin-ai.repository'
import {
  MarlinAiAdviceDto,
  MarlinAiProviderQueryDto,
  MarlinAiRoleDto,
  MarlinUnifiedAiConfigDto,
} from './marlin-ai.schema'
import { MarlinAiService } from './marlin-ai.service'

@ApiController('marlin/ai')
@Auth()
export class MarlinAiController {
  constructor(
    private readonly repository: MarlinAiRepository,
    private readonly service: MarlinAiService,
  ) {}

  @Get('/roles')
  roles() {
    return this.repository.listRoles()
  }

  @Get('/config')
  config() {
    return this.service.getUnifiedConfig()
  }

  @Put('/config')
  saveConfig(@Body() body: MarlinUnifiedAiConfigDto) {
    return this.service.saveUnifiedConfig(body)
  }

  @Post('/config/test')
  testConnection(@Body() body: MarlinAiProviderQueryDto) {
    return this.service.testConnection(body.providerId)
  }

  @Get('/config/models')
  models(@Query() query: MarlinAiProviderQueryDto) {
    return this.service.listModels(query.providerId)
  }

  @Post('/roles')
  upsertRole(@Body() body: MarlinAiRoleDto) {
    return this.repository.upsertRole(body)
  }

  @Get('/roles/:id/usage')
  usage(@Param() { id }: EntityIdDto) {
    return this.repository.usageToday(id)
  }

  @Post('/projects/:id/advice')
  advice(@Param() { id }: EntityIdDto, @Body() body: MarlinAiAdviceDto) {
    return this.service.advise(id, body)
  }
}
