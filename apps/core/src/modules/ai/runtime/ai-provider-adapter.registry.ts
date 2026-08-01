import type { AIProviderAdapterId, AIProviderConfig } from '../ai.types'
import { AIProviderType } from '../ai.types'

export interface AIProviderAdapterDefinition {
  id: AIProviderAdapterId
  name: string
  description: string
  type: AIProviderType
  endpoint?: string
  appendV1: boolean
  defaultModel: string
  customEndpoint: boolean
}

const adapters = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI 官方 Chat Completions 接口',
    type: AIProviderType.OpenAICompatible,
    endpoint: 'https://api.openai.com/v1',
    appendV1: false,
    defaultModel: 'gpt-5.2',
    customEndpoint: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 官方 OpenAI 兼容接口',
    type: AIProviderType.OpenAICompatible,
    endpoint: 'https://api.deepseek.com',
    appendV1: true,
    defaultModel: 'deepseek-chat',
    customEndpoint: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'OpenRouter 多模型统一接口',
    type: AIProviderType.OpenAICompatible,
    endpoint: 'https://openrouter.ai/api/v1',
    appendV1: false,
    defaultModel: 'openai/gpt-5.2',
    customEndpoint: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic Messages API',
    type: AIProviderType.Anthropic,
    endpoint: 'https://api.anthropic.com',
    appendV1: false,
    defaultModel: 'claude-sonnet-4-5',
    customEndpoint: false,
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容服务',
    description: '自定义服务地址、模型和模型列表接口',
    type: AIProviderType.OpenAICompatible,
    appendV1: true,
    defaultModel: 'model-name',
    customEndpoint: true,
  },
] as const satisfies readonly AIProviderAdapterDefinition[]

const adapterMap = new Map(adapters.map((adapter) => [adapter.id, adapter]))

export function listAIProviderAdapters(): AIProviderAdapterDefinition[] {
  return adapters.map((adapter) => ({ ...adapter }))
}

function inferAdapter(config: AIProviderConfig): AIProviderAdapterId {
  if (config.adapter && adapterMap.has(config.adapter)) return config.adapter
  const endpoint = config.endpoint?.toLowerCase() || ''
  if (endpoint.includes('api.openai.com')) return 'openai'
  if (endpoint.includes('api.deepseek.com')) return 'deepseek'
  if (endpoint.includes('openrouter.ai')) return 'openrouter'
  if (
    config.type === AIProviderType.Anthropic ||
    endpoint.includes('api.anthropic.com')
  ) {
    return 'anthropic'
  }
  return 'openai-compatible'
}

/**
 * Resolves the persisted provider into one canonical transport configuration.
 * All model execution, connection tests and model discovery pass this seam.
 */
export function resolveAIProviderAdapter(
  config: AIProviderConfig,
): AIProviderConfig & { adapter: AIProviderAdapterId } {
  const adapterId = inferAdapter(config)
  const adapter = adapterMap.get(adapterId)!
  const custom = adapter.customEndpoint
  const usesExplicitAdapter = Boolean(config.adapter)

  return {
    ...config,
    adapter: adapterId,
    type:
      custom && !usesExplicitAdapter && config.type === AIProviderType.Generic
        ? AIProviderType.Generic
        : adapter.type,
    endpoint: custom ? config.endpoint : adapter.endpoint,
    appendV1: custom ? (config.appendV1 ?? adapter.appendV1) : adapter.appendV1,
    defaultModel:
      config.defaultModel && config.defaultModel !== 'model-name'
        ? config.defaultModel
        : adapter.defaultModel,
  }
}
