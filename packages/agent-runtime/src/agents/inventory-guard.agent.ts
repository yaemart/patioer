import { isInventoryCapable } from '@patioer/harness'
import type { HarnessInventoryLevel } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { errorMessage } from '../error-message.js'
import type {
  InventoryGuardPersistRow,
  InventoryGuardRunInput,
  InventoryGuardRunResult,
} from '../types.js'
import { INVENTORY_GUARD_HEARTBEAT_MS } from '../types.js'
import {
  deriveInventoryStatus,
  effectiveReplenishApprovalMinUnits,
  effectiveSafetyThreshold,
  suggestedRestockUnits,
} from './inventory-guard.decision.js'
import { getHourInTimeZone, INVENTORY_GUARD_LOCAL_HOUR } from './inventory-guard.schedule.js'
import { randomRunId } from '../run-id.js'

function resolveTimeZone(input: InventoryGuardRunInput): string {
  if (input.timeZone && input.timeZone.length > 0) return input.timeZone
  if (typeof process !== 'undefined' && process.env?.INVENTORY_GUARD_TZ) {
    return process.env.INVENTORY_GUARD_TZ
  }
  return 'UTC'
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

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('inventory_guard.budget_exceeded', { runId, agentId: ctx.agentId })
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

  let ticketsCreated = 0
  if (alerts.length > 0) {
    const body = alerts
      .map((a) => {
        const suggest = suggestedRestockUnits(a.quantity, a.safetyThreshold)
        return (
          `- [${a.status}] ${a.platform} platformProductId=${a.platformProductId}` +
          (a.sku ? ` sku=${a.sku}` : '') +
          ` qty=${a.quantity} safety=${a.safetyThreshold} suggest_restock+=${suggest}`
        )
      })
      .join('\n')
    await ctx.createTicket({
      title: `Inventory Guard: ${alerts.length} SKU(s) need restock`,
      body,
    })
    ticketsCreated = 1
    await ctx.logAction('inventory_guard.ticket_created', {
      runId,
      alertCount: alerts.length,
      keyword: 'INVENTORY_GUARD_LOW_STOCK',
    })
  }

  let replenishApprovalsRequested = 0
  for (const a of alerts) {
    const suggest = suggestedRestockUnits(a.quantity, a.safetyThreshold)
    if (suggest < replenishMin) continue

    const targetQuantity = a.quantity + suggest
    if (input.hasPendingInventoryAdjust) {
      const dup = await input.hasPendingInventoryAdjust({
        platform: a.platform,
        platformProductId: a.platformProductId,
        targetQuantity,
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
