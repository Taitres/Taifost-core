import { type TSchema, Type } from '@earendil-works/pi-ai'

import { createModelRuntime } from '../src/modules/ai/runtime'

const apiKey = process.env.MARLIN_AI_SMOKE_API_KEY?.trim()
if (!apiKey) {
  throw new Error('MARLIN_AI_SMOKE_API_KEY is required')
}

const model = process.env.MARLIN_AI_SMOKE_MODEL?.trim() || 'deepseek-v4-flash'
const runtime = createModelRuntime({
  id: 'deepseek',
  name: 'DeepSeek',
  adapter: 'deepseek',
  type: 'openai-compatible',
  apiKey,
  endpoint: 'https://api.deepseek.com',
  appendV1: true,
  defaultModel: model,
  enabled: true,
})

const schema = Type.Object(
  {
    groups: Type.Array(
      Type.Object(
        {
          materialIds: Type.Array(Type.String()),
          title: Type.String(),
          confidence: Type.Number(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
) as TSchema

const models = await runtime.listModels?.()
const text = await runtime.generateText({
  prompt: '只回答 ok',
  maxTokens: 32,
  maxRetries: 0,
})
const structured = await runtime.generateStructured({
  schema,
  systemPrompt: '你是素材识别员，只返回结构化结果。',
  prompt: '素材 a 和 b 主题一致，请把它们分为一组。',
  maxTokens: 256,
  maxRetries: 1,
})
const group = (structured.output as { groups?: unknown[] }).groups?.[0]

if (!text.text?.trim() || !group) {
  throw new Error('DeepSeek smoke test returned an incomplete response')
}

console.info(
  JSON.stringify({
    ok: true,
    model,
    models: models?.map(({ id }) => id),
    textGenerated: true,
    structuredGroup: group,
    totalTokens: structured.usage?.totalTokens,
  }),
)
