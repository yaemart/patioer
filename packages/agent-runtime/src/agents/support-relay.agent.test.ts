import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from '../context.js'
import { runSupportRelay } from './support-relay.agent.js'

function createMockContext(
  threads: Array<{ id: string; subject: string }> = [],
  overrides: Partial<AgentContext> = {},
): AgentContext {
  const harness = {
    getProduct: vi.fn(),
    getProducts: vi.fn(),
    getProductsPage: vi.fn(),
    updatePrice: vi.fn(),
    updateInventory: vi.fn(),
    getOrders: vi.fn(),
    getOrdersPage: vi.fn(),
    replyToMessage: vi.fn().mockResolvedValue(undefined),
    getOpenThreads: vi.fn().mockResolvedValue(threads),
    getAnalytics: vi.fn(),
    tenantId: 'tenant-1',
    platformId: 'shopify',
  } as never
  return {
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: 'Thanks for reaching out! We are on it.' }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('runSupportRelay', () => {
  it('returns empty when budget is exceeded', async () => {
    const ctx = createMockContext([], {
      budget: {
        isExceeded: vi.fn().mockResolvedValue(true),
      },
    })

    const result = await runSupportRelay(ctx, {})
    expect(result.relayed).toEqual([])
    expect(ctx.logAction).toHaveBeenCalledWith('support_relay.budget_exceeded', expect.any(Object))
  })

  it('auto-replies to non-refund threads', async () => {
    const threads = [{ id: 't1', subject: 'Where is my package?' }]
    const ctx = createMockContext(threads)

    const result = await runSupportRelay(ctx, {})
    expect(result.relayed).toHaveLength(1)
    expect(result.relayed[0]!.action).toBe('auto_replied')
    expect(result.relayed[0]!.replyBody).toBeTruthy()
    expect(ctx.llm).toHaveBeenCalledOnce()
    const harness = ctx.getHarness()
    expect(harness.replyToMessage).toHaveBeenCalledWith('t1', expect.any(String))
  })

  it('escalates refund-related threads', async () => {
    const threads = [{ id: 't1', subject: 'I want a refund for order 123' }]
    const ctx = createMockContext(threads)

    const result = await runSupportRelay(ctx, {})
    expect(result.relayed).toHaveLength(1)
    expect(result.relayed[0]!.action).toBe('escalated')
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.escalate',
        reason: 'refund-related thread requires human review',
      }),
    )
    expect(ctx.llm).not.toHaveBeenCalled()
  })

  it('escalates all threads when policy is all_manual', async () => {
    const threads = [
      { id: 't1', subject: 'Shipping question' },
      { id: 't2', subject: 'Product details' },
    ]
    const ctx = createMockContext(threads)

    const result = await runSupportRelay(ctx, { autoReplyPolicy: 'all_manual' })
    expect(result.relayed).toHaveLength(2)
    expect(result.relayed.every((r) => r.action === 'escalated')).toBe(true)
    expect(ctx.llm).not.toHaveBeenCalled()
  })

  it('detects various refund keywords', async () => {
    const keywords = ['refund', 'Return my item', 'money back please', 'cancel order', 'chargeback']
    for (const subject of keywords) {
      const ctx = createMockContext([{ id: 't1', subject }])
      const result = await runSupportRelay(ctx, {})
      expect(result.relayed[0]!.action).toBe('escalated')
    }
  })

  it('handles empty thread list', async () => {
    const ctx = createMockContext([])

    const result = await runSupportRelay(ctx, {})
    expect(result.relayed).toEqual([])
    expect(ctx.logAction).toHaveBeenCalledWith('support_relay.run.completed', {
      totalThreads: 0,
      autoReplied: 0,
      escalated: 0,
    })
  })

  it('logs started and completed events', async () => {
    const threads = [
      { id: 't1', subject: 'Question' },
      { id: 't2', subject: 'Refund please' },
    ]
    const ctx = createMockContext(threads)

    await runSupportRelay(ctx, {})
    expect(ctx.logAction).toHaveBeenCalledWith('support_relay.run.started', {
      policy: 'auto_reply_non_refund',
      recentEventCount: 0,
    })
    expect(ctx.logAction).toHaveBeenCalledWith('support_relay.run.completed', {
      totalThreads: 2,
      autoReplied: 1,
      escalated: 1,
    })
  })

  it('includes llm prompt with thread subject', async () => {
    const threads = [{ id: 't1', subject: 'Shipping delay' }]
    const ctx = createMockContext(threads)

    await runSupportRelay(ctx, {})
    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Shipping delay'),
      }),
    )
  })

  it('handles mixed threads correctly', async () => {
    const threads = [
      { id: 't1', subject: 'Order status' },
      { id: 't2', subject: 'I want to return this' },
      { id: 't3', subject: 'Product info' },
    ]
    const ctx = createMockContext(threads)

    const result = await runSupportRelay(ctx, {})
    expect(result.relayed).toHaveLength(3)
    expect(result.relayed[0]!.action).toBe('auto_replied')
    expect(result.relayed[1]!.action).toBe('escalated')
    expect(result.relayed[2]!.action).toBe('auto_replied')
  })
})
