import { vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type { DataOsPort } from '../types.js'

export function createHarnessMock(): TenantHarness {
  return {
    tenantId: 'tenant-a',
    platformId: 'shopify',
    getProduct: vi.fn().mockResolvedValue(null),
    getProductsPage: vi.fn().mockResolvedValue({ items: [] }),
    getProducts: vi.fn().mockResolvedValue([]),
    updatePrice: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    getOrdersPage: vi.fn().mockResolvedValue({ items: [] }),
    getOrders: vi.fn().mockResolvedValue([]),
    replyToMessage: vi.fn().mockResolvedValue(undefined),
    getOpenThreads: vi.fn().mockResolvedValue([]),
    getAnalytics: vi.fn().mockResolvedValue({ revenue: 0, orders: 0 }),
  }
}

export function createDataOsMock(overrides?: Partial<{
  features: unknown
  memoryId: string
}>): DataOsPort {
  return {
    getFeatures: vi.fn().mockResolvedValue(overrides?.features ?? { category: 'electronics' }),
    upsertFeature: vi.fn().mockResolvedValue(true),
    recallMemory: vi.fn().mockResolvedValue([]),
    recordMemory: vi.fn().mockResolvedValue(overrides?.memoryId ?? 'mem-123'),
    writeOutcome: vi.fn().mockResolvedValue(true),
    recordLakeEvent: vi.fn().mockResolvedValue(undefined),
    recordPriceEvent: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({}),
    queryLakeEvents: vi.fn().mockResolvedValue([]),
  }
}

export function createTestContext(agentId: string, tenantId = 'tenant-test'): AgentContext {
  const harness = createHarnessMock()
  return {
    tenantId,
    agentId,
    getHarness: () => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: '{}' }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    describeDataOsCapabilities: () => 'DataOS unavailable',
  }
}
