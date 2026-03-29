export type DataOsFeatureSnapshot = Record<string, unknown>

export interface LakeEventRow {
  agentId: string
  eventType: string
  entityId?: string
  payload: unknown
  createdAt: string
}

export interface DataOsPort {
  getFeatures(platform: string, productId: string): Promise<DataOsFeatureSnapshot | null>
  recallMemory(agentId: string, context: unknown, opts?: { limit?: number; minSimilarity?: number }): Promise<unknown[] | null>
  recordMemory(input: {
    agentId: string
    platform?: string
    entityId?: string
    context: unknown
    action: unknown
  }): Promise<string | null>
  recordLakeEvent(input: {
    platform?: string
    agentId: string
    eventType: string
    entityId?: string
    payload: unknown
    metadata?: unknown
  }): Promise<void>
  recordPriceEvent(input: {
    platform?: string
    productId: string
    priceBefore: number
    priceAfter: number
    changePct: number
    approved: boolean
  }): Promise<void>
  writeOutcome(decisionId: string, outcome: unknown): Promise<boolean>
  upsertFeature(input: {
    platform: string
    productId: string
    [key: string]: unknown
  }): Promise<boolean>
  getCapabilities(): Promise<unknown | null>
  queryLakeEvents?(params: {
    agentId?: string
    eventType?: string
    limit?: number
    sinceMs?: number
  }): Promise<LakeEventRow[]>
}
