import {
  Body,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { withMeta } from '~/common/response/envelope.types'
import { MetaObjectBuilder } from '~/common/response/meta-builder'
import { EntityIdDto } from '~/shared/dto/id.dto'

import { MarlinMaterialRepository } from './marlin-material.repository'
import {
  MarlinMaterialAnalyzeDto,
  MarlinMaterialImportDto,
  MarlinMaterialListDto,
  MarlinMaterialUrlImportDto,
} from './marlin-material.schema'
import { MarlinMaterialService } from './marlin-material.service'

@ApiController('marlin/materials')
@Auth()
export class MarlinMaterialController {
  constructor(
    private readonly service: MarlinMaterialService,
    private readonly repository: MarlinMaterialRepository,
  ) {}

  @Post('/')
  importMaterial(@Body() body: MarlinMaterialImportDto) {
    return this.service.import(body)
  }

  @Post('/from-url')
  importUrl(@Body() body: MarlinMaterialUrlImportDto) {
    return this.service.importUrl(body)
  }

  @Get('/')
  async list(@Query() query: MarlinMaterialListDto) {
    const result = await this.repository.list(query)
    return withMeta(
      result.data,
      new MetaObjectBuilder().pagination(result.pagination).build(),
    )
  }

  @Get('/:id')
  async get(@Param() { id }: EntityIdDto) {
    const material = await this.repository.findById(id)
    if (!material) throw new NotFoundException('Material not found')
    return material
  }

  @Post('/:id/analyze')
  async analyze(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinMaterialAnalyzeDto,
  ) {
    const result = await this.service.analyze(id, body)
    if (!result) throw new NotFoundException('Material not found')
    return result
  }

  @Post('/:id/archive')
  @HttpCode(200)
  async archive(@Param() { id }: EntityIdDto) {
    const material = await this.repository.archive(id)
    if (!material) throw new NotFoundException('Material not found')
    return material
  }
}
