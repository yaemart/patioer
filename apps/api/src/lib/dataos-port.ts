import type { DataOsPort } from '@patioer/agent-runtime'
import { createDataOsClientFromEnv } from '@patioer/dataos-client'

export function tryCreateDataOsPort(tenantId: string, defaultPlatform: string): DataOsPort | undefined {
  const client = createDataOsClientFromEnv(tenantId)
  if (!client) return undefined

  return {
    getFeatures: (platform, productId) => client.getFeatures(platform, productId),
    recallMemory: (agentId, context, opts) => client.recallMemory(agentId, context, opts),
    recordMemory: (input) =>
      client.recordMemory({
        ...input,
        platform: input.platform ?? defaultPlatform,
      }),
    recordLakeEvent: (input) => client.recordLakeEvent({ tenantId, platform: defaultPlatform, ...input }).then(() => undefined),
    recordPriceEvent: (input) => client.recordPriceEvent({ tenantId, platform: defaultPlatform, ...input }).then(() => undefined),

    writeOutcome: (decisionId, outcome) => client.writeOutcome(decisionId, outcome),
    upsertFeature: (input) => client.upsertFeature({ ...input, platform: input.platform ?? defaultPlatform }),
    getCapabilities: () => client.getCapabilities(),
  }
}
