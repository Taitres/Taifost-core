import { describe, expect, it, vi } from 'vitest'

import type { MarlinHotspotRepository } from '~/modules/marlin/hotspot/marlin-hotspot.repository'
import { MarlinHotspotService } from '~/modules/marlin/hotspot/marlin-hotspot.service'
import type { MarlinMaterialService } from '~/modules/marlin/material/marlin-material.service'
import type { MarlinWorkflowService } from '~/modules/marlin/workflow/marlin-workflow.service'

describe('MarlinHotspotService', () => {
  it('turns a selected candidate into an analyzed material and project', async () => {
    const repository = {
      findCandidate: vi.fn().mockResolvedValue({
        id: 'candidate-1',
        sourceId: 'source-1',
        title: 'Core v3 released',
        url: 'https://example.com/core-v3',
        summary: 'Release summary',
        status: 'inbox',
        raw: {},
      }),
      markCandidateSelected: vi.fn().mockImplementation(async (_id, input) => ({
        id: 'candidate-1',
        status: 'selected',
        raw: input,
      })),
    }
    const materialService = {
      importUrl: vi.fn().mockResolvedValue({
        material: { id: 'material-1', status: 'ready' },
      }),
      analyze: vi.fn().mockResolvedValue({
        material: { id: 'material-1', status: 'analyzed' },
      }),
    }
    const workflowService = {
      createProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
      attachMaterials: vi.fn().mockResolvedValue({ attached: [{}] }),
    }
    const service = new MarlinHotspotService(
      repository as unknown as MarlinHotspotRepository,
      materialService as unknown as MarlinMaterialService,
      workflowService as unknown as MarlinWorkflowService,
    )

    const result = await service.selectCandidate('candidate-1')

    expect(materialService.importUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/core-v3' }),
    )
    expect(workflowService.attachMaterials).toHaveBeenCalledWith('project-1', [
      'material-1',
    ])
    expect(repository.markCandidateSelected).toHaveBeenCalledWith(
      'candidate-1',
      { materialId: 'material-1', projectId: 'project-1' },
    )
    expect(result).toMatchObject({
      replayed: false,
      project: { id: 'project-1' },
    })
  })
})
