import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import { createAgentContext } from './context.js'
import type { CreateAgentContextDeps } from './types.js'

function createHarnessMock(): TenantHarness {
  return {
    tenantId: 't-1',
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

function createDeps() {
  const harness = createHarnessMock()
  const deps: CreateAgentContextDeps = {
    harness: {
      getHarness: vi.fn().mockReturnValue(harness),
      getEnabledPlatforms: vi.fn().mockReturnValue(['shopify']),
    },
    budget: {
      isExceeded: vi.fn().mockResolvedValue(false),
    },
    audit: {
      logAction: vi.fn().mockResolvedValue(undefined),
    },
    approvals: {
      requestApproval: vi.fn().mockResolvedValue(undefined),
    },
    tickets: {
      createTicket: vi.fn().mockResolvedValue(undefined),
    },
    llm: {
      complete: vi.fn().mockResolvedValue({ text: 'ok' }),
    },
  }
  return { deps, harness }
}

describe('createAgentContext', () => {
  it('creates context and resolves harness', () => {
    const { deps, harness } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )

    expect(ctx.tenantId).toBe('tenant-a')
    expect(ctx.agentId).toBe('agent-a')
    expect(ctx.getHarness()).toBe(harness)
    expect(ctx.getEnabledPlatforms()).toEqual(['shopify'])
    expect(deps.harness.getHarness).toHaveBeenCalledWith('tenant-a', 'agent-a', undefined)
    expect(deps.harness.getEnabledPlatforms).toHaveBeenCalledWith('tenant-a', 'agent-a')
  })

  it('delegates budget checks to BudgetPort', async () => {
    const { deps } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )

    await expect(ctx.budget.isExceeded()).resolves.toBe(false)
    expect(deps.budget.isExceeded).toHaveBeenCalledWith('tenant-a', 'agent-a')
  })

  it('writes audit log through logAction', async () => {
    const { deps } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )

    await ctx.logAction('agent.run.started', { traceId: 'x-1' })
    expect(deps.audit.logAction).toHaveBeenCalledWith(
      'tenant-a',
      'agent-a',
      'agent.run.started',
      { traceId: 'x-1' },
    )
  })

  it('creates approval and ticket through ports', async () => {
    const { deps } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )

    await ctx.requestApproval({ action: 'price.update', payload: { delta: 20 }, reason: 'gate' })
    await ctx.createTicket({ title: 'Needs review', body: 'Delta over threshold' })

    expect(deps.approvals.requestApproval).toHaveBeenCalledWith('tenant-a', 'agent-a', {
      action: 'price.update',
      payload: { delta: 20 },
      reason: 'gate',
    })
    expect(deps.tickets.createTicket).toHaveBeenCalledWith('tenant-a', 'agent-a', {
      title: 'Needs review',
      body: 'Delta over threshold',
    })
  })

  it('propagates llm response', async () => {
    const { deps } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )

    await expect(ctx.llm({ prompt: 'hello' })).resolves.toEqual({ text: 'ok' })
    expect(deps.llm.complete).toHaveBeenCalledWith({ prompt: 'hello' }, {
      tenantId: 'tenant-a',
      agentId: 'agent-a',
    })
  })

  it('forwards optional platform key to HarnessPort', () => {
    const { deps, harness } = createDeps()
    const amazonHarness = { ...harness, platformId: 'amazon' }
    vi.mocked(deps.harness.getHarness).mockImplementation((_t: string, _a: string, p?: string) =>
      p === 'amazon' ? amazonHarness : harness,
    )
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      deps,
    )
    expect(ctx.getHarness()).toBe(harness)
    expect(ctx.getHarness('amazon')).toBe(amazonHarness)
    expect(deps.harness.getHarness).toHaveBeenCalledWith('tenant-a', 'agent-a', undefined)
    expect(deps.harness.getHarness).toHaveBeenCalledWith('tenant-a', 'agent-a', 'amazon')
  })

  it('exposes getMarket when deps.market is set (agent-native parity)', () => {
    const market: MarketContext = {
      convertPrice: vi.fn(),
      calculateTax: vi.fn(),
      checkCompliance: vi.fn(),
      isProhibited: vi.fn(),
      getRequiredCertifications: vi.fn(),
    }
    const { deps } = createDeps()
    const ctx = createAgentContext(
      { tenantId: 'tenant-a', agentId: 'agent-a' },
      { ...deps, market },
    )

    expect(ctx.getMarket).toBeDefined()
    expect(ctx.getMarket?.()).toBe(market)
    expect(ctx.market).toBe(market)
  })

})
