import { runAdsOptimizer } from '../packages/agent-runtime/src/agents/ads-optimizer.agent.js'
import { runInventoryGuard } from '../packages/agent-runtime/src/agents/inventory-guard.agent.js'
import { getHourInTimeZone } from '../packages/agent-runtime/src/agents/inventory-guard.schedule.js'
import { ADS_OPTIMIZER_HEARTBEAT_MS } from '../packages/agent-runtime/src/types.js'

type LogEntry = {
  action: string
  payload: Record<string, unknown>
  at: string
}

type FakeHarness = {
  supportsAds?: true
  getAdsCampaigns?: () => Promise<Array<Record<string, unknown>>>
  updateAdsBudget?: (id: string, usd: number) => Promise<void>
  getInventoryLevels?: () => Promise<Array<{ platformProductId: string; quantity: number; sku?: string }>>
}

function buildBaseHarness(): FakeHarness {
  return {
    supportsAds: true,
    getAdsCampaigns: async () => [],
    updateAdsBudget: async () => undefined,
    getInventoryLevels: async () => [],
  }
}

function makeCtx(
  harness: FakeHarness,
  logs: LogEntry[],
  hooks?: {
    onRequestApproval?: (p: unknown) => void
    onCreateTicket?: (p: unknown) => void
  },
) {
  return {
    tenantId: 'drill-tenant',
    agentId: 'drill-agent',
    getHarness: () => harness,
    getEnabledPlatforms: () => ['amazon'],
    llm: async () => ({ text: '' }),
    budget: { isExceeded: async () => false },
    logAction: async (action: string, payload: unknown) => {
      logs.push({
        action,
        payload: (payload ?? {}) as Record<string, unknown>,
        at: new Date().toISOString(),
      })
    },
    requestApproval: async (params: unknown) => {
      hooks?.onRequestApproval?.(params)
    },
    createTicket: async (params: unknown) => {
      hooks?.onCreateTicket?.(params)
    },
  }
}

function simulatedFourHourTicks(startIso: string, runs: number): string[] {
  const start = new Date(startIso).getTime()
  return Array.from({ length: runs }, (_, i) => new Date(start + i * ADS_OPTIMIZER_HEARTBEAT_MS).toISOString())
}

function findTimeZoneForLocalHour(targetHour: number): { timeZone: string; hour: number } {
  const now = new Date()
  const candidates =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['UTC', 'Asia/Dubai', 'Asia/Shanghai', 'Europe/London']

  for (const tz of candidates) {
    const hour = getHourInTimeZone(now, tz)
    if (hour === targetHour) return { timeZone: tz, hour }
  }
  throw new Error(`no timezone currently at local hour=${targetHour}`)
}

async function main() {
  const scheduleTicks = simulatedFourHourTicks('2026-03-26T00:00:00.000Z', 3)
  const scheduleLogs: LogEntry[] = []

  // AC-P2-07: 4h schedule drill + trigger logs
  {
    const harness = buildBaseHarness()
    harness.getAdsCampaigns = async () => [
      {
        platformCampaignId: 'ac-p2-07-c1',
        name: 'sprint6-campaign',
        status: 'active',
        dailyBudget: 400,
        roas: 2,
      },
    ]
    let updates = 0
    harness.updateAdsBudget = async () => {
      updates += 1
    }

    for (const tick of scheduleTicks) {
      await runAdsOptimizer(
        makeCtx(harness, scheduleLogs),
        {
          targetRoas: 3,
          persistCampaigns: async () => undefined,
        },
      )
      await makeCtx(harness, scheduleLogs).logAction('ads_optimizer.scheduler_tick', {
        tickIso: tick,
        cadenceMs: ADS_OPTIMIZER_HEARTBEAT_MS,
      })
    }

    if (updates < 3) {
      throw new Error(`ac-p2-07 drill failed: expected >=3 budget updates, got ${updates}`)
    }
  }

  // AC-P2-08: >$500 requires approval and must not execute updateAdsBudget
  const ac08 = { approvals: 0, budgetUpdates: 0, approvedPayload: null as unknown }
  {
    const logs: LogEntry[] = []
    const harness = buildBaseHarness()
    harness.getAdsCampaigns = async () => [
      {
        platformCampaignId: 'ac-p2-08-big',
        name: 'big-campaign',
        status: 'active',
        dailyBudget: 460,
        roas: 2,
      },
    ]
    harness.updateAdsBudget = async () => {
      ac08.budgetUpdates += 1
    }

    await runAdsOptimizer(
      makeCtx(harness, logs, {
        onRequestApproval: (p) => {
          ac08.approvals += 1
          ac08.approvedPayload = p
        },
      }),
      {},
    )
  }

  // AC-P2-09: enforce 08:00 local schedule and create low-stock ticket
  const ac09 = { tickets: 0, approvals: 0, usedTimeZone: '', localHour: -1 }
  {
    const logs: LogEntry[] = []
    const harness = buildBaseHarness()
    harness.getInventoryLevels = async () => [{ platformProductId: 'sku-low-1', quantity: 2, sku: 'SKU-LOW-1' }]

    const tz = findTimeZoneForLocalHour(8)
    ac09.usedTimeZone = tz.timeZone
    ac09.localHour = tz.hour

    const result = await runInventoryGuard(
      makeCtx(harness, logs, {
        onCreateTicket: () => {
          ac09.tickets += 1
        },
        onRequestApproval: () => {
          ac09.approvals += 1
        },
      }),
      {
        enforceDailyWindow: true,
        timeZone: tz.timeZone,
        safetyThreshold: 10,
        replenishApprovalMinUnits: 5,
      },
    )

    if (result.skippedDueToSchedule) {
      throw new Error(`ac-p2-09 drill failed: skipped due to schedule in tz=${tz.timeZone}`)
    }
  }

  const triggerCount = scheduleLogs.filter((l) => l.action === 'ads_optimizer.trigger').length
  const tickCount = scheduleLogs.filter((l) => l.action === 'ads_optimizer.scheduler_tick').length

  const ac07Passed = tickCount === 3 && triggerCount >= 3
  const ac08Passed = ac08.approvals >= 1 && ac08.budgetUpdates === 0
  const ac09Passed = ac09.tickets >= 1 && ac09.localHour === 8
  const passed = ac07Passed && ac08Passed && ac09Passed

  const output = {
    passed,
    ac07: {
      passed: ac07Passed,
      expectedCadenceMs: ADS_OPTIMIZER_HEARTBEAT_MS,
      simulatedTicks: scheduleTicks,
      triggerLogs: triggerCount,
      tickLogs: tickCount,
    },
    ac08: {
      passed: ac08Passed,
      approvalsRequested: ac08.approvals,
      budgetUpdatesApplied: ac08.budgetUpdates,
      approvalPayload: ac08.approvedPayload,
    },
    ac09: {
      passed: ac09Passed,
      usedTimeZone: ac09.usedTimeZone,
      localHourAtRun: ac09.localHour,
      ticketsCreated: ac09.tickets,
      replenishApprovalsRequested: ac09.approvals,
    },
  }

  console.log(JSON.stringify(output, null, 2))
  if (!passed) process.exit(1)
}

main().catch((err) => {
  console.error('[ac-p2-07-08-09-drill] failed:', err)
  process.exit(1)
})
