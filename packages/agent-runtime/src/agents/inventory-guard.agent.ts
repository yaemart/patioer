import { isInventoryCapable } from '@patioer/harness'
import type { HarnessInventoryLevel } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import {
  INVENTORY_GUARD_HEARTBEAT_MS,
  type InventoryGuardPersistRow,
  type InventoryGuardRunInput,
  type InventoryGuardRunResult,
} from '../commerce-types.js'
import { errorMessage } from '../error-message.js'
import {
  deriveInventoryStatus,
  effectiveReplenishApprovalMinUnits,
  effectiveSafetyThreshold,
  suggestedRestockUnits,
} from './inventory-guard.decision.js'
import { blockGuard, noBusinessGuard, type BusinessGuard } from './business-guard.js'
import { getHourInTimeZone, INVENTORY_GUARD_LOCAL_HOUR } from './inventory-guard.schedule.js'
import { randomRunId } from '../run-id.js'
import { runAgentPreflight } from './preflight.js'

function resolveTimeZone(input: InventoryGuardRunInput): string {
  if (input.timeZone && input.timeZone.length > 0) return input.timeZone
  if (typeof process !== 'undefined' && process.env?.INVENTORY_GUARD_TZ) {
    return process.env.INVENTORY_GUARD_TZ
  }
  return 'UTC'
}

type InventoryBusinessContext = {
  suggestionByKey: Map<string, { daysOfStock: number; suggestedQty: number; dailyVelocity: number }>
  nextInboundByKey: Map<string, { quantity: number; expectedArrival: string | null; supplier: string | null }>
}

const LOW_STOCK_RUNWAY_DAYS = 14

async function loadInventoryBusinessContext(ctx: AgentContext): Promise<InventoryBusinessContext | null> {
  if (!ctx.business?.inventoryPlanning) return null

  try {
    const [suggestions, inboundShipments] = await Promise.all([
      ctx.business.inventoryPlanning.getReplenishmentSuggestions(),
      ctx.business.inventoryPlanning.getInboundShipments(),
    ])

    const suggestionByKey = new Map<string, { daysOfStock: number; suggestedQty: number; dailyVelocity: number }>()
    for (const item of suggestions) {
      suggestionByKey.set(`${item.platform}:${item.productId}`, {
        daysOfStock: item.daysOfStock,
        suggestedQty: item.suggestedQty,
        dailyVelocity: item.dailyVelocity,
      })
    }

    const nextInboundByKey = new Map<string, { quantity: number; expectedArrival: string | null; supplier: string | null }>()
    for (const item of inboundShipments) {
      const key = `${item.platform}:${item.productId}`
      if (!nextInboundByKey.has(key) && item.status === 'in_transit') {
        nextInboundByKey.set(key, {
          quantity: item.quantity,
          expectedArrival: item.expectedArrival,
          supplier: item.supplier,
        })
      }
    }

    return { suggestionByKey, nextInboundByKey }
  } catch (err) {
    await ctx.logAction('inventory_guard.business_context_degraded', {
      agentId: ctx.agentId,
      port: 'inventoryPlanning',
      error: errorMessage(err),
    })
    return null
  }
}

function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null
  const target = new Date(dateString)
  if (Number.isNaN(target.getTime())) return null
  const diffMs = target.getTime() - Date.now()
  return Math.ceil(diffMs / 86400000)
}

function resolveInventoryBusinessGuard(
  alert: InventoryGuardPersistRow & { platform: string },
  businessContext: InventoryBusinessContext | null,
): BusinessGuard {
  if (!businessContext) return noBusinessGuard()

  const key = `${alert.platform}:${alert.platformProductId}`
  const insight = businessContext.suggestionByKey.get(key)
  const inbound = businessContext.nextInboundByKey.get(key)

  if (alert.status === 'low' && insight && insight.daysOfStock >= LOW_STOCK_RUNWAY_DAYS) {
    return blockGuard(`days_of_stock ${insight.daysOfStock} >= ${LOW_STOCK_RUNWAY_DAYS}d runway`)
  }

  if (inbound && insight) {
    const etaDays = daysUntil(inbound.expectedArrival)
    // Treat same-day ETA (etaDays === 0) as non-blocking; only block for future ETAs
    if (etaDays !== null && etaDays > 0 && insight.daysOfStock >= etaDays) {
      return blockGuard(`inbound ${inbound.quantity} arriving in ${etaDays}d before projected stockout`)
    }
  }

  return noBusinessGuard()
}

/**
 * Syncs inventory levels, persists to `inventory_levels`, opens Tickets when below safety stock.
 * Sprint 4 Day 6–7: never calls `updateInventory` from this runner — large restocks use
 * `requestApproval` (`inventory.adjust`); approved writes run in `approval-execute-worker`.
 */
export async function runInventoryGuard(
  ctx: AgentContext,
  input: InventoryGuardRunInput,
): Promise<InventoryGuardRunResult> {
  const runId = randomRunId()
  const platforms = ctx.getEnabledPlatforms()
  const safetyThreshold = effectiveSafetyThreshold(input.safetyThreshold)
  const replenishMin = effectiveReplenishApprovalMinUnits(input.replenishApprovalMinUnits)
  const timeZone = resolveTimeZone(input)

  await ctx.logAction('inventory_guard.run.started', {
    runId,
    agentId: ctx.agentId,
    platforms,
    heartbeatMsExpected: INVENTORY_GUARD_HEARTBEAT_MS,
    safetyThreshold,
    replenishApprovalMinUnits: replenishMin,
    timeZone,
    enforceDailyWindow: input.enforceDailyWindow ?? false,
  })

  const preflight = await runAgentPreflight(ctx, {
    agentKey: 'inventory_guard',
    humanInLoopAction: 'inventory_guard.full_run',
    payload: {
      runId,
      platforms,
      safetyThreshold,
      replenishApprovalMinUnits: replenishMin,
      timeZone,
      enforceDailyWindow: input.enforceDailyWindow ?? false,
    },
  })
  if (preflight.reason === 'human_in_loop') {
    return { runId, synced: 0, perPlatform: [], replenishApprovalsRequested: 1 }
  }
  if (preflight.reason === 'budget_exceeded') {
    return { runId, synced: 0, perPlatform: [], budgetExceeded: true }
  }

  if (input.enforceDailyWindow) {
    const hour = getHourInTimeZone(new Date(), timeZone)
    if (hour !== INVENTORY_GUARD_LOCAL_HOUR) {
      await ctx.logAction('inventory_guard.skipped.schedule', {
        runId,
        hour,
        timeZone,
        expectedLocalHour: INVENTORY_GUARD_LOCAL_HOUR,
      })
      return { runId, synced: 0, perPlatform: [], skippedDueToSchedule: true }
    }
  }

  if (platforms.length === 0) {
    await ctx.logAction('inventory_guard.no_platforms', { runId })
    return { runId, synced: 0, perPlatform: [] }
  }

  const perPlatform: InventoryGuardRunResult['perPlatform'] = []
  let synced = 0
  let levelsPersisted = 0
  const alerts: Array<InventoryGuardPersistRow & { platform: string }> = []
  const pendingApprovals = preflight.pendingApprovals
  const businessContext = await loadInventoryBusinessContext(ctx)

  for (const platform of platforms) {
    let harness: ReturnType<AgentContext['getHarness']>
    try {
      harness = ctx.getHarness(platform)
    } catch {
      perPlatform.push({
        platform,
        ok: false,
        count: 0,
        skipReason: 'no_harness',
      })
      await ctx.logAction('inventory_guard.platform.skipped', {
        runId,
        platform,
        reason: 'no_harness',
      })
      continue
    }

    if (!isInventoryCapable(harness)) {
      perPlatform.push({
        platform,
        ok: false,
        count: 0,
        skipReason: 'not_inventory_capable',
      })
      await ctx.logAction('inventory_guard.platform.skipped', {
        runId,
        platform,
        reason: 'not_inventory_capable',
      })
      continue
    }

    let levels: HarnessInventoryLevel[]
    try {
      levels = await harness.getInventoryLevels()
    } catch (err) {
      perPlatform.push({
        platform,
        ok: false,
        count: 0,
        skipReason: 'harness_error',
      })
      await ctx.logAction('inventory_guard.platform.fetch_failed', {
        runId,
        platform,
        error: errorMessage(err),
      })
      continue
    }

    synced += levels.length

    const rows: InventoryGuardPersistRow[] = []
    for (const level of levels) {
      const status = deriveInventoryStatus(level.quantity, safetyThreshold)
      const row: InventoryGuardPersistRow = { ...level, status, safetyThreshold }
      rows.push(row)
      if (status !== 'normal') {
        alerts.push({ ...row, platform })
      }
    }

    if (input.persistInventoryLevels) {
      const n = await input.persistInventoryLevels({ platform, levels: rows })
      levelsPersisted += n
    }

    perPlatform.push({ platform, ok: true, count: levels.length })
    await ctx.logAction('inventory_guard.platform.synced', {
      runId,
      platform,
      count: levels.length,
      lowOrOos: rows.filter((r) => r.status !== 'normal').length,
    })
  }

  const actionableAlerts = []
  let businessGuardDeferred = 0
  for (const alert of alerts) {
    const businessGuard = resolveInventoryBusinessGuard(alert, businessContext)
    if (businessGuard.effect === 'block') {
      businessGuardDeferred += 1
      await ctx.logAction('inventory_guard.business_guard_deferred', {
        runId,
        platform: alert.platform,
        platformProductId: alert.platformProductId,
        status: alert.status,
        businessGuardReason: businessGuard.reason,
      })
      continue
    }
    actionableAlerts.push(alert)
  }

  let ticketsCreated = 0
  if (actionableAlerts.length > 0) {
    const body = actionableAlerts
      .map((a) => {
        const suggest = suggestedRestockUnits(a.quantity, a.safetyThreshold)
        const insight = businessContext?.suggestionByKey.get(`${a.platform}:${a.platformProductId}`)
        const inbound = businessContext?.nextInboundByKey.get(`${a.platform}:${a.platformProductId}`)
        return (
          `- [${a.status}] ${a.platform} platformProductId=${a.platformProductId}` +
          (a.sku ? ` sku=${a.sku}` : '') +
          ` qty=${a.quantity} safety=${a.safetyThreshold} suggest_restock+=${suggest}` +
          (insight ? ` days_of_stock=${insight.daysOfStock} velocity=${insight.dailyVelocity.toFixed(2)}` : '') +
          (inbound ? ` next_inbound=${inbound.quantity}@${inbound.expectedArrival ?? 'unknown'}` : '')
        )
      })
      .join('\n')
    await ctx.createTicket({
      title: `Inventory Guard: ${actionableAlerts.length} SKU(s) need restock`,
      body,
    })
    ticketsCreated = 1
    await ctx.logAction('inventory_guard.ticket_created', {
      runId,
      alertCount: actionableAlerts.length,
      keyword: 'INVENTORY_GUARD_LOW_STOCK',
    })
  }

  let replenishApprovalsRequested = 0
  for (const a of actionableAlerts) {
    const suggest = suggestedRestockUnits(a.quantity, a.safetyThreshold)
    if (suggest < replenishMin) continue

    const insight = businessContext?.suggestionByKey.get(`${a.platform}:${a.platformProductId}`)
    const inbound = businessContext?.nextInboundByKey.get(`${a.platform}:${a.platformProductId}`)

    const targetQuantity = a.quantity + suggest
    const dup = input.hasPendingInventoryAdjust
      ? await input.hasPendingInventoryAdjust({
        platform: a.platform,
        platformProductId: a.platformProductId,
        targetQuantity,
      })
      : pendingApprovals.some((item) => {
        if (item.action !== 'inventory.adjust') return false
        const payload = (item.payload ?? {}) as Record<string, unknown>
        return (
          payload.platform === a.platform &&
          payload.platformProductId === a.platformProductId &&
          Number(payload.targetQuantity) === targetQuantity
        )
      })
    if (dup) {
      await ctx.logAction('inventory_guard.replenish_approval_duplicate_skipped', {
        runId,
        platform: a.platform,
        platformProductId: a.platformProductId,
        targetQuantity,
        keyword: 'INVENTORY_REPLENISH_PENDING_DEDUPE',
      })
      continue
    }

    await ctx.requestApproval({
      action: 'inventory.adjust',
      payload: {
        platform: a.platform,
        platformProductId: a.platformProductId,
        targetQuantity,
        suggestedRestockUnits: suggest,
        currentQuantity: a.quantity,
        safetyThreshold: a.safetyThreshold,
        status: a.status,
        businessContext: {
          daysOfStock: insight?.daysOfStock ?? null,
          dailyVelocity: insight?.dailyVelocity ?? null,
          suggestedQty30d: insight?.suggestedQty ?? null,
          nextInboundQuantity: inbound?.quantity ?? null,
          nextInboundExpectedArrival: inbound?.expectedArrival ?? null,
          nextInboundSupplier: inbound?.supplier ?? null,
        },
      },
      reason:
        `Restock ${suggest} units to reach target ${targetQuantity} for product ${a.platformProductId} ` +
        `(suggested restock ≥ ${replenishMin} — requires approval before updateInventory)`,
    })
    replenishApprovalsRequested += 1
    await ctx.logAction('inventory_guard.replenish_approval_requested', {
      runId,
      platform: a.platform,
      platformProductId: a.platformProductId,
      targetQuantity,
      keyword: 'INVENTORY_ADJUST_APPROVAL',
    })
  }

  await ctx.logAction('inventory_guard.run.completed', {
    runId,
    synced,
    levelsPersisted,
    ticketsCreated,
    replenishApprovalsRequested,
    businessGuardDeferred,
    platforms: perPlatform,
    keyword: 'INVENTORY_GUARD_RUN_SUMMARY',
  })

  return {
    runId,
    synced,
    perPlatform,
    levelsPersisted: input.persistInventoryLevels ? levelsPersisted : undefined,
    ticketsCreated: ticketsCreated > 0 ? ticketsCreated : undefined,
    replenishApprovalsRequested: replenishApprovalsRequested > 0 ? replenishApprovalsRequested : undefined,
  }
}
