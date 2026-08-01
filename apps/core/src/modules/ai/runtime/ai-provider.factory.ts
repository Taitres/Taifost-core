import type { AIProviderConfig } from '../ai.types'
import { AIProviderType } from '../ai.types'
import { resolveAIProviderAdapter } from './ai-provider-adapter.registry'
import type { IModelRuntime } from './model-runtime.interface'
import { PiRuntimeAdapter } from './pi-runtime.adapter'
import type { RuntimeConfig } from './types'

export function createModelRuntime(
  config: AIProviderConfig,
  modelOverride?: string,
): IModelRuntime {
  if (!Object.values(AIProviderType).includes(config.type)) {
    throw new Error(`Unsupported provider type: ${config.type as string}`)
  }
  const resolved = resolveAIProviderAdapter(config)
  const model = modelOverride || resolved.defaultModel

  const runtimeConfig: RuntimeConfig = {
    apiKey: resolved.apiKey,
    endpoint: resolved.endpoint,
    modelListUrl: resolved.modelListUrl,
    appendV1: resolved.appendV1,
    model,
    providerType: resolved.type,
    providerId: resolved.id,
  }

  switch (resolved.type) {
    case AIProviderType.Anthropic:
    case AIProviderType.OpenAICompatible:
    case AIProviderType.Generic: {
      return new PiRuntimeAdapter({
        ...runtimeConfig,
        contextWindow: resolved.contextWindow ?? undefined,
        maxTokens: resolved.maxTokens ?? undefined,
      })
    }

    default: {
      throw new Error(`Unsupported provider type: ${resolved.type as string}`)
    }
  }
}

export function createRuntimeForModelList(
  type: AIProviderType,
  apiKey: string,
  endpoint?: string,
  modelListUrl?: string,
): IModelRuntime {
  const config: AIProviderConfig = {
    id: 'temp',
    name: 'temp',
    type,
    apiKey,
    endpoint,
    modelListUrl,
    defaultModel: 'temp',
    enabled: true,
  }

  return createModelRuntime(config)
}
