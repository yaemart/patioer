/**
 * DataOS degradation integration tests — ADR-03 / AC-P3-19
 *
 * Verifies all 7 registered agent runners execute successfully when
 * DataOS is unavailable (ctx.dataOS = undefined). This simulates
 * DATAOS_ENABLED=0 / tryCreateDataOsPort returning undefined.
 */
import { describe, expect, it, vi } from 'vitest'
import type { FastifyRequest } from 'fastify'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '@patioer/agent-runtime'
import { DEFAULT_GOVERNANCE_SETTINGS } from '@patioer/agent-runtime'
import { getRunner } from './agent-registry.js'

function createHarnessMock(): TenantHarness {
  return {
    tenantId: 'tenant-degradation',
    platformId: 'shopify',
    getProduct: vi.fn().mockResolvedValue(null),
    getProductsPage: vi.fn().mockResolvedValue({ items: [] }),
    getProducts: vi.fn().mockResolvedValue([
      { id: 'p-1', title: 'Widget', price: 19.99, inventory: 50 },
    ]),
    updatePrice: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    getOrdersPage: vi.fn().mockResolvedValue({ items: [] }),
    getOrders: vi.fn().mockResolvedValue([]),
    replyToMessage: vi.fn().mockResolvedValue(undefined),
    getOpenThreads: vi.fn().mockResolvedValue([]),
    getAnalytics: vi.fn().mockResolvedValue({ revenue: 1000, orders: 50 }),
  }
}

function buildCtxWithoutDataOS(): AgentContext {
  const harness = createHarnessMock()
  return {
    tenantId: 'tenant-degradation',
    agentId: 'agent-degradation',
    getHarness: () => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        title: 'Test Title',
        description: 'Test Description',
        bulletPoints: ['point1'],
        seoKeywords: ['keyword1'],
        competitorMinPrice: 15,
        competitorAvgPrice: 20,
        pricePosition: 'below',
      }),
    }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS is not available. You are operating in degraded (memoryless) mode.',
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
    dataOS: undefined,
  }
}

const fakeRequest = {
  tenantId: 'tenant-degradation',
  withDb: undefined,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as unknown as FastifyRequest

describe('DataOS degradation — all 7 agent types via registry (AC-P3-19)', () => {
  const agentTypes = [
    {
      type: 'price-sentinel',
      goalContext: JSON.stringify({
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 105, reason: 'test' }],
      }),
    },
    {
      type: 'product-scout',
      goalContext: JSON.stringify({ maxProducts: 5 }),
    },
    {
      type: 'support-relay',
      goalContext: JSON.stringify({}),
    },
    {
      type: 'ads-optimizer',
      goalContext: JSON.stringify({ targetRoas: 3.0 }),
    },
    {
      type: 'inventory-guard',
      goalContext: JSON.stringify({ safetyThreshold: 10 }),
    },
    {
      type: 'content-writer',
      goalContext: JSON.stringify({ productId: 'p-1' }),
    },
    {
      type: 'market-intel',
      goalContext: JSON.stringify({ maxProducts: 5 }),
    },
  ]

  for (const { type, goalContext } of agentTypes) {
    it(`${type} executes normally without DataOS`, async () => {
      const runner = getRunner(type)
      expect(runner).toBeDefined()

      const ctx = buildCtxWithoutDataOS()
      expect(ctx.dataOS).toBeUndefined()

      const response = await runner!(
        fakeRequest,
        { id: 'agent-001', type, goalContext },
        ctx,
      )

      expect(response.ok).toBe(true)
      expect(response.agentId).toBe('agent-001')
      expect(response.executedAt).toBeTruthy()
    })
  }

  it('all 7 agent types are registered in the runner registry', () => {
    const types = [
      'price-sentinel',
      'product-scout',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
      'content-writer',
      'market-intel',
    ]
    for (const type of types) {
      expect(getRunner(type)).toBeDefined()
    }
  })
})
