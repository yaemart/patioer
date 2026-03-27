import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataOsServices } from '@patioer/dataos'
import { _runInsightAgentTick, _generateInsightReport, startInsightAgentInterval } from './insight-agent.js'
import {
  insightAgentTicks,
  insightAgentOutcomesWritten,
  insightAgentOutcomesFailed,
  insightAgentPendingDecisions,
} from '../metrics.js'

vi.mock('../metrics.js', () => ({
  insightAgentTicks: { inc: vi.fn() },
  insightAgentOutcomesWritten: { inc: vi.fn() },
  insightAgentOutcomesFailed: { inc: vi.fn() },
  insightAgentPendingDecisions: { set: vi.fn() },
}))

const listPendingOutcomesOlderThan = vi.fn()
const writeOutcome = vi.fn()
const queryEvents = vi.fn()
const queryPriceEvents = vi.fn()

function makeServices(): DataOsServices {
  return {
    decisionMemory: {
      listPendingOutcomesOlderThan,
      writeOutcome,
    } as unknown as DataOsServices['decisionMemory'],
    eventLake: {
      queryEvents,
      queryPriceEvents,
    } as unknown as DataOsServices['eventLake'],
  } as unknown as DataOsServices
}

const NOW = '2026-03-15T00:00:00.000Z'
const NOW_MS = new Date(NOW).getTime()

function makePendingDecision(overrides?: Partial<{
  id: string
  tenant_id: string
  agent_id: string
  platform: string
  entity_id: string | null
  context: unknown
  action: unknown
  decided_at: string
}>) {
  return {
    id: overrides?.id ?? 'dec-1',
    tenant_id: overrides?.tenant_id ?? 'tenant-a',
    agent_id: overrides?.agent_id ?? 'price-sentinel',
    platform: overrides?.platform ?? 'shopify',
    entity_id: overrides?.entity_id ?? 'sku-100',
    context: overrides?.context ?? { query: 'test' },
    action: overrides?.action ?? { priceBefore: 29.99, newPrice: 24.99 },
    decided_at: overrides?.decided_at ?? NOW,
  }
}

function makeEvent(created_at: string) {
  return { created_at, event_type: 'page_view', entity_id: 'sku-100' }
}

function makePriceEvent(created_at: string, conv_rate_7d = 0.12, revenue_7d = 500) {
  return { created_at, conv_rate_7d, revenue_7d }
}

describe('_runInsightAgentTick', () => {
  beforeEach(() => {
    listPendingOutcomesOlderThan.mockReset()
    writeOutcome.mockReset().mockResolvedValue(undefined)
    queryEvents.mockReset().mockResolvedValue([])
    queryPriceEvents.mockReset().mockResolvedValue([])
    vi.mocked(insightAgentTicks.inc).mockClear()
    vi.mocked(insightAgentOutcomesWritten.inc).mockClear()
    vi.mocked(insightAgentOutcomesFailed.inc).mockClear()
    vi.mocked(insightAgentPendingDecisions.set).mockClear()
  })

  it('returns { processed: 0, written: 0, failed: 0 } when no pending decisions', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([])
    const result = await _runInsightAgentTick(makeServices(), {})
    expect(result).toEqual({ processed: 0, written: 0, failed: 0 })
  })

  it('queries ClickHouse for events after decision and writes outcome', async () => {
    const decision = makePendingDecision({ agent_id: 'inventory-agent', entity_id: 'sku-200', action: null })
    listPendingOutcomesOlderThan.mockResolvedValue([decision])
    const withinWindow = new Date(NOW_MS + 3 * 24 * 60 * 60 * 1000).toISOString()
    queryEvents.mockResolvedValue([makeEvent(withinWindow), makeEvent(withinWindow)])

    const result = await _runInsightAgentTick(makeServices(), {})

    expect(queryEvents).toHaveBeenCalledWith(decision.tenant_id, {
      entityId: 'sku-200',
      sinceMs: NOW_MS,
      limit: 500,
    })
    expect(writeOutcome).toHaveBeenCalledWith(
      decision.id,
      decision.tenant_id,
      expect.objectContaining({ events_after: 2, window_days: 7 }),
    )
    expect(result).toEqual({ processed: 1, written: 1, failed: 0 })
  })

  it('queries price_events for price-sentinel decisions', async () => {
    const decision = makePendingDecision()
    listPendingOutcomesOlderThan.mockResolvedValue([decision])
    const withinWindow = new Date(NOW_MS + 2 * 24 * 60 * 60 * 1000).toISOString()
    queryPriceEvents.mockResolvedValue([makePriceEvent(withinWindow, 0.15, 800)])

    await _runInsightAgentTick(makeServices(), {})

    expect(queryPriceEvents).toHaveBeenCalledWith(decision.tenant_id, {
      productId: 'sku-100',
      sinceMs: NOW_MS,
      limit: 100,
    })
  })

  it('constructs outcome with events_after count and conv_rate_7d for price-sentinel', async () => {
    const decision = makePendingDecision()
    listPendingOutcomesOlderThan.mockResolvedValue([decision])
    const withinWindow = new Date(NOW_MS + 1 * 24 * 60 * 60 * 1000).toISOString()
    queryEvents.mockResolvedValue([makeEvent(withinWindow)])
    queryPriceEvents.mockResolvedValue([makePriceEvent(withinWindow, 0.18, 1200)])

    await _runInsightAgentTick(makeServices(), {})

    expect(writeOutcome).toHaveBeenCalledWith(
      'dec-1',
      'tenant-a',
      expect.objectContaining({
        events_after: 1,
        window_days: 7,
        conv_rate_7d: 0.18,
        revenue_7d: 1200,
        price_before: 29.99,
        price_after: 24.99,
      }),
    )
  })

  it('calls writeOutcome with correct decisionId and tenantId', async () => {
    const decision = makePendingDecision({ id: 'dec-xyz', tenant_id: 'tenant-b', agent_id: 'other' })
    listPendingOutcomesOlderThan.mockResolvedValue([decision])

    await _runInsightAgentTick(makeServices(), {})

    expect(writeOutcome).toHaveBeenCalledWith('dec-xyz', 'tenant-b', expect.any(Object))
  })

  it('increments outcomes_written counter on success', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([
      makePendingDecision({ id: 'a' }),
      makePendingDecision({ id: 'b' }),
    ])

    await _runInsightAgentTick(makeServices(), {})

    expect(insightAgentOutcomesWritten.inc).toHaveBeenCalledTimes(2)
  })

  it('increments outcomes_failed counter on writeOutcome failure', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([makePendingDecision()])
    writeOutcome.mockRejectedValue(new Error('pg down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await _runInsightAgentTick(makeServices(), {})

    expect(insightAgentOutcomesFailed.inc).toHaveBeenCalledTimes(1)
    expect(result.failed).toBe(1)
    consoleError.mockRestore()
  })

  it('continues processing remaining decisions after individual failure', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([
      makePendingDecision({ id: 'fail-1' }),
      makePendingDecision({ id: 'ok-2' }),
      makePendingDecision({ id: 'ok-3' }),
    ])
    writeOutcome
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await _runInsightAgentTick(makeServices(), {})

    expect(result).toEqual({ processed: 3, written: 2, failed: 1 })
    consoleError.mockRestore()
  })

  it('respects maxDecisionsPerTick option', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([])

    await _runInsightAgentTick(makeServices(), { maxDecisionsPerTick: 25 })

    expect(listPendingOutcomesOlderThan).toHaveBeenCalledWith(7, { limit: 25 })
  })

  it('uses default 7 days lookback when option not provided', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([])

    await _runInsightAgentTick(makeServices(), {})

    expect(listPendingOutcomesOlderThan).toHaveBeenCalledWith(7, { limit: 100, tenantId: undefined })
  })

  it('passes tenantId to listPendingOutcomesOlderThan when provided (Constitution Ch2.5)', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([])

    await _runInsightAgentTick(makeServices(), { tenantId: 'tenant-x' })

    expect(listPendingOutcomesOlderThan).toHaveBeenCalledWith(7, { limit: 100, tenantId: 'tenant-x' })
  })

  it('sets pending_decisions gauge to the count of pending decisions', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([
      makePendingDecision({ id: 'a' }),
      makePendingDecision({ id: 'b' }),
      makePendingDecision({ id: 'c' }),
    ])

    await _runInsightAgentTick(makeServices(), {})

    expect(insightAgentPendingDecisions.set).toHaveBeenCalledWith(3)
  })

  it('increments insightAgentTicks on each execution', async () => {
    listPendingOutcomesOlderThan.mockResolvedValue([])

    await _runInsightAgentTick(makeServices(), {})

    expect(insightAgentTicks.inc).toHaveBeenCalledTimes(1)
  })

  it('filters out events outside the 7-day window (upper bound)', async () => {
    const decision = makePendingDecision({ agent_id: 'other-agent', entity_id: null, action: null })
    listPendingOutcomesOlderThan.mockResolvedValue([decision])

    const inWindow = new Date(NOW_MS + 3 * 24 * 60 * 60 * 1000).toISOString()
    const outsideWindow = new Date(NOW_MS + 10 * 24 * 60 * 60 * 1000).toISOString()
    queryEvents.mockResolvedValue([makeEvent(inWindow), makeEvent(outsideWindow)])

    await _runInsightAgentTick(makeServices(), {})

    expect(writeOutcome).toHaveBeenCalledWith(
      decision.id,
      decision.tenant_id,
      expect.objectContaining({ events_after: 1 }),
    )
  })

  it('filters out events with non-string created_at (lower bound guards against ts=0)', async () => {
    const decision = makePendingDecision({ agent_id: 'other-agent', entity_id: null, action: null })
    listPendingOutcomesOlderThan.mockResolvedValue([decision])

    const validEvent = makeEvent(new Date(NOW_MS + 1 * 24 * 60 * 60 * 1000).toISOString())
    const badEvent = { created_at: 12345, event_type: 'page_view', entity_id: 'sku-100' }
    queryEvents.mockResolvedValue([validEvent, badEvent])

    await _runInsightAgentTick(makeServices(), {})

    expect(writeOutcome).toHaveBeenCalledWith(
      decision.id,
      decision.tenant_id,
      expect.objectContaining({ events_after: 1 }),
    )
  })

  it('filters out events that occurred before the decision (lower bound)', async () => {
    const decision = makePendingDecision({ agent_id: 'other-agent', entity_id: null, action: null })
    listPendingOutcomesOlderThan.mockResolvedValue([decision])

    const beforeDecision = new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString()
    const afterDecision = new Date(NOW_MS + 1 * 24 * 60 * 60 * 1000).toISOString()
    queryEvents.mockResolvedValue([makeEvent(beforeDecision), makeEvent(afterDecision)])

    await _runInsightAgentTick(makeServices(), {})

    expect(writeOutcome).toHaveBeenCalledWith(
      decision.id,
      decision.tenant_id,
      expect.objectContaining({ events_after: 1 }),
    )
  })

  it('startInsightAgentInterval catches errors without crashing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    listPendingOutcomesOlderThan.mockRejectedValue(new Error('pg down'))

    const timer = startInsightAgentInterval(makeServices(), 100, {})
    await new Promise((r) => setTimeout(r, 200))
    clearInterval(timer)

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('_generateInsightReport', () => {
  it('generates report with correct counts', () => {
    const report = _generateInsightReport({
      processed: 10,
      written: 8,
      failed: 2,
      highlights: [],
    })
    expect(report.processed).toBe(10)
    expect(report.written).toBe(8)
    expect(report.failed).toBe(2)
  })

  it('price-sentinel highlights include price and conv_rate summary', () => {
    const report = _generateInsightReport({
      processed: 1,
      written: 1,
      failed: 0,
      highlights: [{
        decisionId: 'd1',
        agentId: 'price-sentinel',
        entityId: 'sku-1',
        summary: '价格 29.99→24.99，7天转化率 0.15%，营收 800',
      }],
    })
    expect(report.highlights[0]!.summary).toContain('价格')
    expect(report.highlights[0]!.summary).toContain('转化率')
    expect(report.highlights[0]!.summary).toContain('营收')
  })

  it('other agent highlights include events_after summary', () => {
    const report = _generateInsightReport({
      processed: 1,
      written: 1,
      failed: 0,
      highlights: [{
        decisionId: 'd2',
        agentId: 'inventory-agent',
        summary: '操作完成，后续 5 个事件',
      }],
    })
    expect(report.highlights[0]!.summary).toContain('操作完成')
    expect(report.highlights[0]!.summary).toContain('事件')
  })

  it('highlights are capped at 10 items', () => {
    const highlights = Array.from({ length: 15 }, (_, i) => ({
      decisionId: `d${i}`,
      agentId: 'test',
      summary: `summary ${i}`,
    }))
    const report = _generateInsightReport({
      processed: 15,
      written: 15,
      failed: 0,
      highlights,
    })
    expect(report.highlights).toHaveLength(10)
  })

  it('generatedAt is a valid ISO timestamp', () => {
    const report = _generateInsightReport({
      processed: 0,
      written: 0,
      failed: 0,
      highlights: [],
    })
    const parsed = new Date(report.generatedAt)
    expect(parsed.toISOString()).toBe(report.generatedAt)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
  })
})
