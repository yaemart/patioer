import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from '../context.js'
import { runProductScout } from './product-scout.agent.js'

function createMockContext(
  products: Array<{ id: string; title: string; price: number; inventory: number }> = [],
  overrides: Partial<AgentContext> = {},
): AgentContext {
  const harness = {
    getProduct: vi.fn().mockResolvedValue(null),
    getProducts: vi.fn().mockResolvedValue(products),
    getProductsPage: vi.fn(),
    updatePrice: vi.fn(),
    updateInventory: vi.fn(),
    getOrders: vi.fn(),
    getOrdersPage: vi.fn(),
    replyToMessage: vi.fn(),
    getOpenThreads: vi.fn(),
    getAnalytics: vi.fn(),
    tenantId: 'tenant-1',
    platformId: 'shopify',
  } as never
  return {
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn(),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    describeDataOsCapabilities: () => 'DataOS not available',
    ...overrides,
  }
}

describe('runProductScout', () => {
  it('returns empty when budget is exceeded', async () => {
    const ctx = createMockContext([], {
      budget: {
        isExceeded: vi.fn().mockResolvedValue(true),
      },
    })

    const result = await runProductScout(ctx, {})
    expect(result.scouted).toEqual([])
    expect(ctx.logAction).toHaveBeenCalledWith('product_scout.budget_exceeded', expect.any(Object))
  })

  it('scans products and classifies them as normal', async () => {
    const products = [
      { id: 'p1', title: 'Widget', price: 10, inventory: 100 },
      { id: 'p2', title: 'Gadget', price: 20, inventory: 50 },
    ]
    const ctx = createMockContext(products)

    const result = await runProductScout(ctx, {})
    expect(result.scouted).toHaveLength(2)
    expect(result.scouted[0]!.flag).toBe('normal')
    expect(result.scouted[1]!.flag).toBe('normal')
    expect(ctx.createTicket).not.toHaveBeenCalled()
  })

  it('flags low inventory products and creates a ticket', async () => {
    const products = [
      { id: 'p1', title: 'Almost Out', price: 10, inventory: 3 },
      { id: 'p2', title: 'In Stock', price: 20, inventory: 50 },
    ]
    const ctx = createMockContext(products)

    const result = await runProductScout(ctx, {})
    expect(result.scouted[0]!.flag).toBe('low_inventory')
    expect(result.scouted[1]!.flag).toBe('normal')
    expect(ctx.createTicket).toHaveBeenCalledOnce()
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Product Scout: 1 product(s) flagged',
      }),
    )
  })

  it('flags high price products', async () => {
    const products = [{ id: 'p1', title: 'Luxury', price: 15000, inventory: 100 }]
    const ctx = createMockContext(products)

    const result = await runProductScout(ctx, {})
    expect(result.scouted[0]!.flag).toBe('high_price')
  })

  it('low_inventory takes priority over high_price', async () => {
    const products = [{ id: 'p1', title: 'Rare Luxury', price: 15000, inventory: 2 }]
    const ctx = createMockContext(products)

    const result = await runProductScout(ctx, {})
    expect(result.scouted[0]!.flag).toBe('low_inventory')
  })

  it('respects maxProducts from input', async () => {
    const products = [{ id: 'p1', title: 'Widget', price: 10, inventory: 100 }]
    const ctx = createMockContext(products)

    await runProductScout(ctx, { maxProducts: 10 })
    const harness = ctx.getHarness()
    expect(harness.getProducts).toHaveBeenCalledWith({ limit: 10 })
  })

  it('uses default maxProducts of 50', async () => {
    const ctx = createMockContext([])

    await runProductScout(ctx, {})
    const harness = ctx.getHarness()
    expect(harness.getProducts).toHaveBeenCalledWith({ limit: 50 })
  })

  it('logs started and completed events', async () => {
    const ctx = createMockContext([
      { id: 'p1', title: 'Widget', price: 10, inventory: 100 },
    ])

    await runProductScout(ctx, {})
    expect(ctx.logAction).toHaveBeenCalledWith('product_scout.run.started', { maxProducts: 50, complianceMarkets: [] })
    expect(ctx.logAction).toHaveBeenCalledWith('product_scout.run.completed', {
      scannedCount: 1,
      flaggedCount: 0,
      complianceBlockedCount: 0,
    })
  })

  it('creates ticket with multiple flagged items', async () => {
    const products = [
      { id: 'p1', title: 'Low A', price: 5, inventory: 1 },
      { id: 'p2', title: 'Expensive B', price: 20000, inventory: 100 },
      { id: 'p3', title: 'Normal C', price: 50, inventory: 50 },
    ]
    const ctx = createMockContext(products)

    const result = await runProductScout(ctx, {})
    expect(result.scouted.filter((s) => s.flag !== 'normal')).toHaveLength(2)
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Product Scout: 2 product(s) flagged',
      }),
    )
  })
})
