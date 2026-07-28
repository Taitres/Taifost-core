import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { parseMarlinAiAdvice } from '~/modules/marlin/ai/marlin-ai.service'

describe('parseMarlinAiAdvice', () => {
  it('validates a fenced structured response', () => {
    expect(
      parseMarlinAiAdvice(`\`\`\`json
      {
        "advice": "聚焦 Core v3 迁移价值",
        "risks": ["接口兼容性"],
        "suggestedOutline": ["背景", "迁移", "验证"],
        "confidence": 0.86
      }
      \`\`\``),
    ).toEqual({
      advice: '聚焦 Core v3 迁移价值',
      risks: ['接口兼容性'],
      suggestedOutline: ['背景', '迁移', '验证'],
      confidence: 0.86,
    })
  })

  it('rejects unstructured AI prose', () => {
    expect(() => parseMarlinAiAdvice('我建议直接发布。')).toThrow(
      BadRequestException,
    )
  })
})
