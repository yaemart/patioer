import { describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type { DataOsPort } from '../types.js'
import { runContentWriter } from './content-writer.agent.js'
import { createHarnessMock, createDataOsMock } from './test-helpers.js'

const VALID_LLM_JSON = JSON.stringify({
  title: 'Amazing Widget Pro',
  description: 'A high-quality widget for daily use.',
  bulletPoints: ['Durable', 'Lightweight', 'Affordable'],
  seoKeywords: ['widget', 'affordable widget', 'best widget'],
})

function createCtx(overrides?: {
  budgetExceeded?: boolean
  llmText?: string
  product?: { id: string; title: string; price: number | null; inventory: number | null } | null
  withDataOS?: boolean
}): { ctx: AgentContext; harness: TenantHarness; dataOS: DataOsPort } {
  const harness = createHarnessMock()
  if (overrides?.product !== undefined) {
    vi.mocked(harness.getProduct).mockResolvedValue(overrides.product)
  }
  const dataOS = createDataOsMock()
  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'agent-cw',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: overrides?.llmText ?? VALID_LLM_JSON }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS not available',
    dataOS: overrides?.withDataOS !== false ? dataOS : undefined,
  }
  return { ctx, harness, dataOS }
}

describe('runContentWriter', () => {
  it('generates content from LLM and returns structured result', async () => {
    const { ctx } = createCtx({
      product: { id: 'p-1', title: 'Widget A', price: 19.99, inventory: 50 },
    })

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.productId).toBe('p-1')
    expect(result.title).toBe('Amazing Widget Pro')
    expect(result.description).toBe('A high-quality widget for daily use.')
    expect(result.bulletPoints).toEqual(['Durable', 'Lightweight', 'Affordable'])
    expect(result.seoKeywords).toEqual(['widget', 'affordable widget', 'best widget'])
  })

  it('skips execution when budget is exceeded', async () => {
    const { ctx } = createCtx({ budgetExceeded: true })

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result).toEqual({
      productId: 'p-1',
      title: '',
      description: '',
      bulletPoints: [],
      seoKeywords: [],
    })
    expect(ctx.llm).not.toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.budget_exceeded', { productId: 'p-1' })
  })

  it('calls LLM with correct prompt structure', async () => {
    const { ctx } = createCtx({
      product: { id: 'p-1', title: 'Widget A', price: 29.99, inventory: 10 },
    })

    await runContentWriter(ctx, { productId: 'p-1', tone: 'luxury' })

    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Widget A'),
        systemPrompt: expect.stringContaining('e-commerce content writer'),
      }),
    )
    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Tone: luxury'),
      }),
    )
  })

  it('uses default tone and maxLength when not provided', async () => {
    const { ctx } = createCtx()

    await runContentWriter(ctx, { productId: 'p-1' })

    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Tone: professional'),
      }),
    )
    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Max length: 2000'),
      }),
    )
  })

  it('returns empty content and logs parse_failed on non-JSON LLM response', async () => {
    const { ctx, dataOS } = createCtx({ llmText: 'This is just plain text without JSON' })

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result).toEqual({
      productId: 'p-1',
      title: '',
      description: '',
      bulletPoints: [],
      seoKeywords: [],
    })
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.parse_failed', { productId: 'p-1' })
    expect(dataOS.recordMemory).not.toHaveBeenCalled()
    expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
  })

  it('clamps returned content to maxLength', async () => {
    const { ctx } = createCtx({
      llmText: JSON.stringify({
        title: 'T'.repeat(300),
        description: 'D'.repeat(500),
        bulletPoints: ['B'.repeat(400)],
        seoKeywords: ['K'.repeat(200)],
      }),
    })

    const result = await runContentWriter(ctx, { productId: 'p-1', maxLength: 120 })

    expect(result.title).toHaveLength(120)
    expect(result.description).toHaveLength(120)
    expect(result.bulletPoints[0]).toHaveLength(120)
    expect(result.seoKeywords[0]).toHaveLength(100)
  })

  it('extracts JSON from LLM response with surrounding text', async () => {
    const { ctx } = createCtx({
      llmText: `Here's the content:\n${VALID_LLM_JSON}\nHope this helps!`,
    })

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
  })

  it('fetches DataOS features and memories when available', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    await runContentWriter(ctx, { productId: 'p-1' })

    expect(dataOS.getFeatures).toHaveBeenCalledWith('shopify', 'p-1')
    expect(dataOS.recallMemory).toHaveBeenCalledWith('content-writer', expect.objectContaining({ productId: 'p-1' }))
  })

  it('records memory and lake event to DataOS on success', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    await runContentWriter(ctx, { productId: 'p-1' })

    expect(dataOS.recordMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'content-writer',
        platform: 'shopify',
        entityId: 'p-1',
      }),
    )
    expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'shopify',
        eventType: 'content_generated',
        entityId: 'p-1',
        metadata: expect.objectContaining({ agentType: 'content-writer' }),
      }),
    )
  })

  it('degrades gracefully when DataOS getFeatures fails', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.getFeatures).mockRejectedValue(new Error('timeout'))

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.dataos_degraded', expect.objectContaining({
      productId: 'p-1',
      op: 'getFeatures',
    }))
  })

  it('degrades gracefully when DataOS recallMemory fails', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.recallMemory).mockRejectedValue(new Error('timeout'))

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.dataos_degraded', expect.objectContaining({
      productId: 'p-1',
      op: 'recallMemory',
    }))
  })

  it('degrades gracefully when DataOS write operations fail', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.recordMemory).mockRejectedValue(new Error('write failed'))
    vi.mocked(dataOS.recordLakeEvent).mockRejectedValue(new Error('write failed'))

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.dataos_write_failed', expect.objectContaining({
      productId: 'p-1',
      op: 'recordMemory',
    }))
  })

  it('degrades gracefully when DataOS recordLakeEvent fails alone', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.recordLakeEvent).mockRejectedValue(new Error('lake write failed'))

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(dataOS.recordMemory).toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith('content_writer.dataos_write_failed', expect.objectContaining({
      productId: 'p-1',
      op: 'recordLakeEvent',
    }))
  })

  it('works without DataOS (memoryless mode)', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: false })

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(dataOS.getFeatures).not.toHaveBeenCalled()
    expect(dataOS.recordMemory).not.toHaveBeenCalled()
  })

  it('handles HarnessError from getProduct gracefully', async () => {
    const { ctx, harness } = createCtx()
    vi.mocked(harness.getProduct).mockRejectedValue(
      new HarnessError('shopify', '429', 'rate limited'),
    )

    const result = await runContentWriter(ctx, { productId: 'p-1' })

    expect(result.title).toBe('Amazing Widget Pro')
    expect(ctx.logAction).toHaveBeenCalledWith(
      'content_writer.harness_error',
      expect.objectContaining({ type: 'harness_error', code: '429' }),
    )
  })

  it('uses productId as fallback title when product not found in harness', async () => {
    const { ctx } = createCtx({ product: null })

    await runContentWriter(ctx, { productId: 'missing-id' })

    expect(ctx.llm).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Product ID: missing-id'),
      }),
    )
  })

  it('logs started and completed actions', async () => {
    const { ctx } = createCtx()

    await runContentWriter(ctx, { productId: 'p-1', tone: 'casual' })

    expect(ctx.logAction).toHaveBeenCalledWith(
      'content_writer.run.started',
      expect.objectContaining({ productId: 'p-1', tone: 'casual' }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'content_writer.run.completed',
      expect.objectContaining({ productId: 'p-1' }),
    )
  })

  it('respects platform input parameter', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    await runContentWriter(ctx, { productId: 'p-1', platform: 'amazon' })

    expect(ctx.logAction).toHaveBeenCalledWith(
      'content_writer.run.started',
      expect.objectContaining({ platform: 'amazon' }),
    )
    expect(dataOS.recordMemory).toHaveBeenCalledWith(expect.objectContaining({ platform: 'amazon' }))
    expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(expect.objectContaining({ platform: 'amazon' }))
  })
})
