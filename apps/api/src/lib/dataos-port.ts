import type { DataOsPort } from '@patioer/agent-runtime'
import { createDataOsClientFromEnv } from '@patioer/dataos-client'

export function tryCreateDataOsPort(tenantId: string, defaultPlatform: string): DataOsPort | undefined {
  const client = createDataOsClientFromEnv(tenantId)
  if (!client) return undefined

  return {
    getFeatures: (platform, productId) => client.getFeatures(platform, productId),
    recallMemory: (agentId, context) => client.recallMemory(agentId, context),
    recordMemory: (input) =>
      client.recordMemory({
        ...input,
        platform: input.platform ?? defaultPlatform,
      }),
    recordLakeEvent: async (input) => {
      await client.recordLakeEvent({
        tenantId,
        platform: defaultPlatform,
        agentId: input.agentId,
        eventType: input.eventType,
        entityId: input.entityId,
        payload: input.payload,
        metadata: input.metadata,
      })
    },
    recordPriceEvent: async (input) => {
      await client.recordPriceEvent({
        tenantId,
        platform: defaultPlatform,
        ...input,
      })
    },
  }
}
