import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataOsServices } from '@patioer/dataos'
import { _runFeatureAgentTick, startFeatureAgentInterval } from './feature-agent.js'
import {
  featureAgentTicks,
  featureAgentItemsProcessed,
  featureAgentBudgetUtilization,
} from '../metrics.js'

// Mock metrics before importing feature-agent
vi.mock('../metrics.js', () => ({
  featureAgentTicks: { inc: vi.fn() },
  featureAgentItemsProcessed: { inc: vi.fn() },
  featureAgentBudgetUtilization: { set: vi.fn() },
}))

const aggregateRecentEntityEvents = vi.fn()
const upsert = vi.fn()

function makeServices(): DataOsServices {
  return {
    eventLake: { aggregateRecentEntityEvents } as unknown as DataOsServices['eventLake'],
    featureStore: { upsert } as unknown as DataOsServices['featureStore'],
  } as unknown as DataOsServices
}

function makeRow(productId = 'sku-1') {
  return { tenant_id: 't1', platform: 'shopify', product_id: productId, evts: '5' }
}

describe('_runFeatureAgentTick', () => {
  beforeEach(() => {
    aggregateRecentEntityEvents.mockReset()
    upsert.mockReset().mockResolvedValue(undefined)
    vi.mocked(featureAgentTicks.inc).mockClear()
    vi.mocked(featureAgentItemsProcessed.inc).mockClear()
    vi.mocked(featureAgentBudgetUtilization.set).mockClear()
  })

  it('calls aggregateRecentEntityEvents with intervalDays=1', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([])
    await _runFeatureAgentTick(makeServices(), {})
    expect(aggregateRecentEntityEvents).toHaveBeenCalledWith({ intervalDays: 1, limit: 500 })
  })

  it('upserts one row per aggregation result', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([makeRow('p1'), makeRow('p2')])
    await _runFeatureAgentTick(makeServices(), {})
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('skips rows where platform is empty — harness platform isolation (Constitution §2.3)', async () => {
    const noPlatformRow = { tenant_id: 't1', platform: '', product_id: 'sku-x', evts: '3' }
    aggregateRecentEntityEvents.mockResolvedValue([makeRow('p1'), noPlatformRow, makeRow('p2')])
    await _runFeatureAgentTick(makeServices(), {})
    expect(upsert).toHaveBeenCalledTimes(2)
    const platforms = upsert.mock.calls.map((c: unknown[]) => (c[0] as { platform: string }).platform)
    expect(platforms).not.toContain('')
    expect(platforms).not.toContain('unknown')
  })

  it('is a no-op (no upsert called) when aggregation returns empty array', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([])
    await _runFeatureAgentTick(makeServices(), {})
    expect(upsert).not.toHaveBeenCalled()
  })

  it('respects maxItemsPerTick budget (passes limit to aggregateRecentEntityEvents)', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([])
    await _runFeatureAgentTick(makeServices(), { maxItemsPerTick: 100 })
    expect(aggregateRecentEntityEvents).toHaveBeenCalledWith({ intervalDays: 1, limit: 100 })
  })

  it('increments featureAgentTicks counter on each execution', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([])
    await _runFeatureAgentTick(makeServices(), {})
    expect(featureAgentTicks.inc).toHaveBeenCalledTimes(1)
  })

  it('increments featureAgentItemsProcessed per upserted row', async () => {
    aggregateRecentEntityEvents.mockResolvedValue([makeRow(), makeRow('p2'), makeRow('p3')])
    await _runFeatureAgentTick(makeServices(), {})
    expect(featureAgentItemsProcessed.inc).toHaveBeenCalledTimes(3)
  })

  it('sets featureAgentBudgetUtilization gauge (Constitution Ch8.1)', async () => {
    aggregateRecentEntityEvents.mockResolvedValue(Array.from({ length: 250 }, (_, i) => makeRow(`p${i}`)))
    await _runFeatureAgentTick(makeServices(), { maxItemsPerTick: 500 })
    expect(featureAgentBudgetUtilization.set).toHaveBeenCalledWith(0.5)
  })

  it('caps budget utilization gauge at 1 when rows exceed maxItems', async () => {
    // 500 rows, maxItems=500 → utilization = min(500/500, 1) = 1
    aggregateRecentEntityEvents.mockResolvedValue(Array.from({ length: 500 }, (_, i) => makeRow(`p${i}`)))
    await _runFeatureAgentTick(makeServices(), { maxItemsPerTick: 500 })
    expect(featureAgentBudgetUtilization.set).toHaveBeenCalledWith(1)
  })

  it('errors are caught and logged without crashing (startFeatureAgentInterval)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    aggregateRecentEntityEvents.mockRejectedValue(new Error('ch down'))
    const svc = makeServices()
    const timer = startFeatureAgentInterval(svc, 100, {})
    await new Promise((r) => setTimeout(r, 200))
    clearInterval(timer)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('startFeatureAgentInterval returns a timer handle (can be cleared)', () => {
    aggregateRecentEntityEvents.mockResolvedValue([])
    const timer = startFeatureAgentInterval(makeServices(), 9999999, {})
    expect(timer).toBeDefined()
    clearInterval(timer)
  })

  describe('budget_exceeded structured log (Constitution Ch4.3 / Ch5.3)', () => {
    it('logs budget_exceeded with { type, agentId, limit, actual } when rows.length >= maxItems', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rows = Array.from({ length: 50 }, (_, i) => makeRow(`p${i}`))
      aggregateRecentEntityEvents.mockResolvedValue(rows)
      await _runFeatureAgentTick(makeServices(), { maxItemsPerTick: 50 })
      expect(consoleWarn).toHaveBeenCalledWith(
        '[dataos-feature-agent] budget_exceeded',
        expect.objectContaining({
          type: 'budget_exceeded',
          agentId: 'feature-agent',
          limit: 50,
          actual: 50,
        }),
      )
      consoleWarn.mockRestore()
    })

    it('does NOT log budget_exceeded when rows.length < maxItems', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      aggregateRecentEntityEvents.mockResolvedValue([makeRow()])
      await _runFeatureAgentTick(makeServices(), { maxItemsPerTick: 500 })
      expect(consoleWarn).not.toHaveBeenCalledWith(
        '[dataos-feature-agent] budget_exceeded',
        expect.anything(),
      )
      consoleWarn.mockRestore()
    })
  })

})
