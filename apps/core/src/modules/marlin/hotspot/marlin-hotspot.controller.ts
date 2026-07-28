import {
  Body,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'

import { ApiController } from '~/common/decorators/api-controller.decorator'
import { Auth } from '~/common/decorators/auth.decorator'
import { withMeta } from '~/common/response/envelope.types'
import { MetaObjectBuilder } from '~/common/response/meta-builder'
import { EntityIdDto } from '~/shared/dto/id.dto'

import { MarlinHotspotRepository } from './marlin-hotspot.repository'
import {
  MarlinHotspotCandidateListDto,
  MarlinHotspotCandidateStatusDto,
  MarlinHotspotSourceDto,
  MarlinHotspotSourcePatchDto,
  MarlinHotspotThemeDto,
  MarlinHotspotThemePatchDto,
} from './marlin-hotspot.schema'
import { MarlinHotspotService } from './marlin-hotspot.service'

@ApiController('marlin/hotspots')
@Auth()
export class MarlinHotspotController {
  constructor(
    private readonly repository: MarlinHotspotRepository,
    private readonly service: MarlinHotspotService,
  ) {}

  @Get('/themes')
  themes() {
    return this.repository.listThemes()
  }

  @Post('/themes')
  createTheme(@Body() body: MarlinHotspotThemeDto) {
    return this.repository.createTheme(body)
  }

  @Patch('/themes/:id')
  async patchTheme(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinHotspotThemePatchDto,
  ) {
    const theme = await this.repository.patchTheme(id, body)
    if (!theme) throw new NotFoundException('Hotspot theme not found')
    return theme
  }

  @Get('/sources')
  sources() {
    return this.repository.listSources()
  }

  @Post('/sources')
  createSource(@Body() body: MarlinHotspotSourceDto) {
    return this.repository.createSource(body)
  }

  @Patch('/sources/:id')
  async patchSource(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinHotspotSourcePatchDto,
  ) {
    const source = await this.repository.patchSource(id, body)
    if (!source) throw new NotFoundException('Hotspot source not found')
    return source
  }

  @Post('/sources/:id/collect')
  collect(@Param() { id }: EntityIdDto) {
    return this.service.collect(id)
  }

  @Post('/collect')
  collectAll() {
    return this.service.collectAll()
  }

  @Get('/candidates')
  async candidates(@Query() query: MarlinHotspotCandidateListDto) {
    const result = await this.repository.listCandidates(query)
    return withMeta(
      result.data,
      new MetaObjectBuilder().pagination(result.pagination).build(),
    )
  }

  @Patch('/candidates/:id/status')
  async setCandidateStatus(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinHotspotCandidateStatusDto,
  ) {
    const candidate = await this.repository.setCandidateStatus(id, body.status)
    if (!candidate) throw new NotFoundException('Hotspot candidate not found')
    return candidate
  }
}
