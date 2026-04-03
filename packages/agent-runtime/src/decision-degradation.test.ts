import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from './context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from './ports.js'
import { detectDegradation, applyDegradation, buildDegradedModeError } from './decision-degradation.js'
import { NO_DEGRADATION } from './decision-pipeline.js'

function createCtxWithBusiness(overrides?: {
  overviewData?: unknown[]
  healthStatus?: string
}): AgentContext {
  return {
    tenantId: 'tenant-test',
    agentId: 'agent-test',
    getHarness: () => { throw new Error('not wired') },
    getEnabledPlatforms: () => ['amazon'],
    llm: vi.fn().mockResolvedValue({ text: '{}' }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS unavailable',
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
    business: {
      unitEconomics: {
        getSkuEconomics: vi.fn().mockResolvedValue(null),
        getDailyOverview: vi.fn().mockResolvedValue(overrides?.overviewData ?? [
          { contributionMargin: 100 },
          { contributionMargin: 150 },
          { contributionMargin: 80 },
        ]),
      },
      inventoryPlanning: {
        getInboundShipments: vi.fn().mockResolvedValue([]),
        getReplenishmentSuggestions: vi.fn().mockResolvedValue([]),
      },
      accountHealth: {
        getHealthSummary: vi.fn().mockResolvedValue({
          platform: 'amazon',
          overallStatus: overrides?.healthStatus ?? 'healthy',
          openIssues: 0,
          resolvedLast30d: 0,
          metrics: {},
        }),
        getListingIssues: vi.fn().mockResolvedValue([]),
      },
      serviceOps: {
        getCases: vi.fn().mockResolvedValue([]),
        getRefundSummary: vi.fn().mockResolvedValue({ totalRefunds: 0, totalAmount: 0, byReason: {} }),
      },
    },
  }
}

describe('detectDegradation', () => {
  it('returns no degradation when business data is healthy', async () => {
    const ctx = createCtxWithBusiness()
    const flags = await detectDegradation(ctx, { scope: 'price-sentinel', platform: 'amazon' })
    expect(flags).toEqual(NO_DEGRADATION)
  })

  it('flags profitDataMissing when overview is empty', async () => {
    const ctx = createCtxWithBusiness({ overviewData: [] })
    const flags = await detectDegradation(ctx, { scope: 'price-sentinel' })
    expect(flags.profitDataMissing).toBe(true)
  })

  it('flags profitDataMissing when no business port wired', async () => {
    const ctx = createCtxWithBusiness()
    delete (ctx as unknown as Record<string, unknown>).business
    const flags = await detectDegradation(ctx, { scope: 'price-sentinel' })
    expect(flags.profitDataMissing).toBe(true)
  })

  it('flags accountHealthCritical when platform health is critical', async () => {
    const ctx = createCtxWithBusiness({ healthStatus: 'critical' })
    const flags = await detectDegradation(ctx, { scope: 'ads-optimizer', platform: 'amazon' })
    expect(flags.accountHealthCritical).toBe(true)
  })

  it('does not check health without platform param', async () => {
    const ctx = createCtxWithBusiness({ healthStatus: 'critical' })
    const flags = await detectDegradation(ctx, { scope: 'ads-optimizer' })
    expect(flags.accountHealthCritical).toBe(false)
  })

  it('flags cashFlowTight when 3+ of last 7 days have negative margin', async () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      contributionMargin: i < 5 ? 100 : -50,
    }))
    const ctx = createCtxWithBusiness({ overviewData: data })
    const flags = await detectDegradation(ctx, { scope: 'inventory-guard' })
    expect(flags.cashFlowTight).toBe(true)
  })

  it('does not flag cashFlowTight with fewer than 3 negative days', async () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      contributionMargin: i < 8 ? 200 : -10,
    }))
    const ctx = createCtxWithBusiness({ overviewData: data })
    const flags = await detectDegradation(ctx, { scope: 'price-sentinel' })
    expect(flags.cashFlowTight).toBe(false)
  })
})

describe('applyDegradation', () => {
  it('returns base action when no flags set', () => {
    const result = applyDegradation('price-sentinel', 'auto_execute', { ...NO_DEGRADATION })
    expect(result.action).toBe('auto_execute')
    expect(result.reasons).toEqual([])
  })

  it('escalates price-sentinel to degraded_suggest_only on profitDataMissing', () => {
    const result = applyDegradation('price-sentinel', 'auto_execute', {
      profitDataMissing: true,
      accountHealthCritical: false,
      cashFlowTight: false,
    })
    expect(result.action).toBe('degraded_suggest_only')
    expect(result.reasons).toHaveLength(1)
  })

  it('escalates ads-optimizer to blocked on accountHealthCritical', () => {
    const result = applyDegradation('ads-optimizer', 'auto_execute', {
      profitDataMissing: false,
      accountHealthCritical: true,
      cashFlowTight: false,
    })
    expect(result.action).toBe('blocked')
  })

  it('escalates inventory-guard to degraded_suggest_only on cashFlowTight', () => {
    const result = applyDegradation('inventory-guard', 'auto_execute', {
      profitDataMissing: false,
      accountHealthCritical: false,
      cashFlowTight: true,
    })
    expect(result.action).toBe('degraded_suggest_only')
  })

  it('picks highest severity when multiple flags set', () => {
    const result = applyDegradation('ads-optimizer', 'auto_execute', {
      profitDataMissing: true,
      accountHealthCritical: true,
      cashFlowTight: true,
    })
    expect(result.action).toBe('blocked')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('does not downgrade a higher-severity base action', () => {
    const result = applyDegradation('price-sentinel', 'blocked', {
      profitDataMissing: true,
      accountHealthCritical: false,
      cashFlowTight: false,
    })
    expect(result.action).toBe('blocked')
  })

  it('returns base action for unknown scope', () => {
    const result = applyDegradation('unknown-agent', 'auto_execute', {
      profitDataMissing: true,
      accountHealthCritical: true,
      cashFlowTight: true,
    })
    expect(result.action).toBe('auto_execute')
  })
})

describe('buildDegradedModeError', () => {
  it('returns missing_profit_data error when flag set', () => {
    const err = buildDegradedModeError('agent-1', {
      profitDataMissing: true,
      accountHealthCritical: false,
      cashFlowTight: false,
    })
    expect(err).toEqual({ type: 'degraded_mode', reason: 'missing_profit_data', agentId: 'agent-1' })
  })

  it('returns account_health_risk error when flag set', () => {
    const err = buildDegradedModeError('agent-2', {
      profitDataMissing: false,
      accountHealthCritical: true,
      cashFlowTight: false,
    })
    expect(err).toEqual({ type: 'degraded_mode', reason: 'account_health_risk', agentId: 'agent-2' })
  })

  it('returns cash_flow_pressure error when flag set', () => {
    const err = buildDegradedModeError('agent-3', {
      profitDataMissing: false,
      accountHealthCritical: false,
      cashFlowTight: true,
    })
    expect(err).toEqual({ type: 'degraded_mode', reason: 'cash_flow_pressure', agentId: 'agent-3' })
  })

  it('returns null when no flags set', () => {
    const err = buildDegradedModeError('agent-4', {
      profitDataMissing: false,
      accountHealthCritical: false,
      cashFlowTight: false,
    })
    expect(err).toBeNull()
  })

  it('prioritizes profitDataMissing over other flags', () => {
    const err = buildDegradedModeError('agent-5', {
      profitDataMissing: true,
      accountHealthCritical: true,
      cashFlowTight: true,
    })
    expect(err?.type).toBe('degraded_mode')
    expect((err as { reason: string }).reason).toBe('missing_profit_data')
  })
})
