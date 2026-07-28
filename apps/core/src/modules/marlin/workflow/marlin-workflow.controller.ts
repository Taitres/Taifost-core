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

import { MarlinWorkflowRepository } from './marlin-workflow.repository'
import {
  MarlinAttachMaterialsDto,
  MarlinProjectCreateDto,
  MarlinProjectListDto,
  MarlinProjectPatchDto,
  MarlinPublishDto,
  MarlinReviewAccessDto,
  MarlinReviewCreateDto,
  MarlinReviewDecisionDto,
  MarlinRevisionCreateDto,
} from './marlin-workflow.schema'
import { MarlinWorkflowService } from './marlin-workflow.service'

@ApiController('marlin/projects')
@Auth()
export class MarlinWorkflowController {
  constructor(
    private readonly service: MarlinWorkflowService,
    private readonly repository: MarlinWorkflowRepository,
  ) {}

  @Post('/')
  create(@Body() body: MarlinProjectCreateDto) {
    return this.service.createProject(body)
  }

  @Get('/')
  async list(@Query() query: MarlinProjectListDto) {
    const result = await this.repository.listProjects(query)
    return withMeta(
      result.data,
      new MetaObjectBuilder().pagination(result.pagination).build(),
    )
  }

  @Get('/:id')
  async get(@Param() { id }: EntityIdDto) {
    const project = await this.repository.findProject(id)
    if (!project) throw new NotFoundException('MARLIN project not found')
    return project
  }

  @Patch('/:id')
  patch(@Param() { id }: EntityIdDto, @Body() body: MarlinProjectPatchDto) {
    return this.service.patchProject(id, body)
  }

  @Post('/:id/materials')
  attachMaterials(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinAttachMaterialsDto,
  ) {
    return this.service.attachMaterials(id, body.materialIds)
  }

  @Post('/:id/revisions')
  createRevision(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinRevisionCreateDto,
  ) {
    return this.service.createRevision(id, body)
  }

  @Post('/:id/reviews')
  requestReview(
    @Param() { id }: EntityIdDto,
    @Body() body: MarlinReviewCreateDto,
  ) {
    return this.service.requestReview(id, body)
  }

  @Post('/:id/publish')
  publish(@Param() { id }: EntityIdDto, @Body() body: MarlinPublishDto) {
    return this.service.publish(id, body)
  }

  @Post('/:id/withdraw')
  withdraw(@Param() { id }: EntityIdDto) {
    return this.service.withdraw(id)
  }
}

@ApiController('marlin/reviews')
export class MarlinPublicReviewController {
  constructor(private readonly service: MarlinWorkflowService) {}

  @Post('/:id/preview')
  preview(@Param() { id }: EntityIdDto, @Body() body: MarlinReviewAccessDto) {
    return this.service.previewReview(id, body.passcode)
  }

  @Post('/:id/decision')
  decide(@Param() { id }: EntityIdDto, @Body() body: MarlinReviewDecisionDto) {
    return this.service.decideReview(id, body)
  }
}
