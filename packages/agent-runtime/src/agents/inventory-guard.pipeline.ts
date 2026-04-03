import { isInventoryCapable, HarnessError } from '@patioer/harness'
import type {
  DecisionPipeline,
  GovernedDecision,
} from '../decision-pipeline.js'
import { NO_DEGRADATION } from '../decision-pipeline.js'
import { detectDegradation, applyDegradation } from '../decision-degradation.js'
import { errorMessage } from '../error-message.js'
import { buildPromptStack, flattenPromptStack } from '../prompt-stack.js'
import {
  deriveInventoryStatus,
  effectiveReplenishApprovalMinUnits,
  effectiveSafetyThreshold,
  suggestedRestockUnits,
} from './inventory-guard.decision.js'
import { runAgentPreflight } from './preflight.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InventoryGuardInput {
  safetyThreshold?: number
  replenishApprovalMinUnits?: number
  replenishApprovalMinUsd?: number
  estimatedUnitCostUsd?: number
  platforms?: string[]
}

export interface InventoryReplenishProposal {
  platformProductId: string
  platform: string
  sku: string | null
  currentQuantity: number
  targetQuantity: number
  restockUnits: number
  status: 'low' | 'out_of_stock'
  reason: string
  confidence: number
  daysOfStock: number | null
  dailyVelocity: number | null
  nextInboundQty: number | null
  nextInboundEta: string | null
}

// ---------------------------------------------------------------------------
// LLM prompt + parser
// ---------------------------------------------------------------------------

function buildInventoryReasoningPrompt(
  alerts: Array<{
    platformProductId: string; platform: string; currentQuantity: number; safetyThreshold: number;
    status: string; daysOfStock: number | null; dailyVelocity: number | null;
    nextInboundQty: number | null; nextInboundEta: string | null;
    pastDecision?: Record<string, unknown> | null
  }>,
  goalContext: Record<string, unknown> | null,
): string {
  const goalSection = goalContext
    ? `\nOPERATING CONTEXT:\n${JSON.stringify(goalContext)}\n`
    : ''

  return `Analyze these low-inventory products and recommend restock priorities.
${goalSection}
ALERTS:
${JSON.stringify(alerts)}

Each alert may include a "pastDecision" field with the last restock decision and its outcome.
Use this history to refine restock quantities — avoid over-ordering if prior restocks arrived late.

For each product, output a JSON object with:
- platformProductId (string)
- restockUnits (number, 0 if no action needed)
- priority ("critical", "high", "medium", "low")
- reason (string, 1-2 sentences; reference past decision outcome when relevant)
- confidence (number 0-1)

Rules:
- Out-of-stock items are highest priority
- Consider inbound shipments — if ETA is soon enough, reduce or skip restock
- Consider daily velocity when calculating restock quantity
- Target at least 2x safety threshold for restock target

Respond ONLY with a JSON array. No other text.`
}

function parseLlmProposals(
  text: string,
  alertMap: Map<string, { platform: string; sku: string | null; currentQuantity: number; safetyThreshold: number; status: 'low' | 'out_of_stock'; daysOfStock: number | null; dailyVelocity: number | null; nextInboundQty: number | null; nextInboundEta: string | null }>,
): InventoryReplenishProposal[] {
  let parsed: unknown[]
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as unknown[]
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const pid = String(item.platformProductId ?? '')
      const alert = alertMap.get(pid)
      if (!alert) return null

      const restockUnits = typeof item.restockUnits === 'number' && item.restockUnits >= 0
        ? Math.floor(item.restockUnits)
        : suggestedRestockUnits(alert.currentQuantity, alert.safetyThreshold)

      if (restockUnits === 0) return null

      return {
        platformProductId: pid,
        platform: alert.platform,
        sku: alert.sku,
        currentQuantity: alert.currentQuantity,
        targetQuantity: alert.currentQuantity + restockUnits,
        restockUnits,
        status: alert.status,
        reason: typeof item.reason === 'string' ? item.reason : 'Restock recommended',
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.6,
        daysOfStock: alert.daysOfStock,
        dailyVelocity: alert.dailyVelocity,
        nextInboundQty: alert.nextInboundQty,
        nextInboundEta: alert.nextInboundEta,
      } satisfies InventoryReplenishProposal
    })
    .filter((p): p is InventoryReplenishProposal => p !== null)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOW_STOCK_RUNWAY_DAYS = 14

function daysUntil(dateString: string | null): number | null {
  if (!dateString) return null
  const target = new Date(dateString)
  if (Number.isNaN(target.getTime())) return null
  return Math.ceil((target.getTime() - Date.now()) / 86400000)
}

// ---------------------------------------------------------------------------
// Pipeline implementation
// ---------------------------------------------------------------------------

export const inventoryGuardPipeline: DecisionPipeline<InventoryGuardInput, InventoryReplenishProposal> = {
  scope: 'inventory-guard',

  async gather(ctx, input) {
    const preflight = await runAgentPreflight(ctx, {
      agentKey: 'inventory_guard',
      humanInLoopAction: 'inventory_guard.full_run',
    })
    if (preflight.reason !== 'continue') {
      return {
        governance: preflight.governance,
        sopGoalContext: null,
        sopSystemPrompt: null,
        degradation: { ...NO_DEGRADATION },
        platformData: { preflight: preflight.reason, alerts: [], pendingApprovals: [] },
      }
    }

    const governance = await ctx.getEffectiveGovernance('inventory-guard')
    const sop = await ctx.getActiveSop('inventory-guard')
    const platforms = input.platforms ?? ctx.getEnabledPlatforms()
    const safetyThreshold = effectiveSafetyThreshold(input.safetyThreshold)

    const degradation = await detectDegradation(ctx, {
      scope: 'inventory-guard',
      platform: platforms[0],
    })

    type AlertRow = {
      platformProductId: string; platform: string; sku: string | null
      currentQuantity: number; safetyThreshold: number; status: 'low' | 'out_of_stock'
      daysOfStock: number | null; dailyVelocity: number | null
      nextInboundQty: number | null; nextInboundEta: string | null
      pastDecision?: Record<string, unknown> | null
    }

    const alerts: AlertRow[] = []

    let suggestionByKey: Map<string, { daysOfStock: number; suggestedQty: number; dailyVelocity: number }> | null = null
    let nextInboundByKey: Map<string, { quantity: number; expectedArrival: string | null }> | null = null

    if (ctx.business?.inventoryPlanning) {
      try {
        const [suggestions, shipments] = await Promise.all([
          ctx.business.inventoryPlanning.getReplenishmentSuggestions(),
          ctx.business.inventoryPlanning.getInboundShipments(),
        ])
        suggestionByKey = new Map()
        for (const s of suggestions) {
          suggestionByKey.set(`${s.platform}:${s.productId}`, {
            daysOfStock: s.daysOfStock,
            suggestedQty: s.suggestedQty,
            dailyVelocity: s.dailyVelocity,
          })
        }
        nextInboundByKey = new Map()
        for (const s of shipments) {
          if (s.status === 'in_transit' && !nextInboundByKey.has(`${s.platform}:${s.productId}`)) {
            nextInboundByKey.set(`${s.platform}:${s.productId}`, {
              quantity: s.quantity,
              expectedArrival: s.expectedArrival,
            })
          }
        }
      } catch (err) {
        await ctx.logAction('inventory_guard.business_context_degraded', {
          port: 'inventoryPlanning',
          error: errorMessage(err),
        })
      }
    }

    for (const platform of platforms) {
      try {
        const harness = ctx.getHarness(platform)
        if (!isInventoryCapable(harness)) {
          await ctx.logAction('inventory_guard.platform.skipped', { platform, reason: 'not_inventory_capable' })
          continue
        }
        const levels = await harness.getInventoryLevels()
        for (const level of levels) {
          const status = deriveInventoryStatus(level.quantity, safetyThreshold)
          if (status === 'normal') continue

          const key = `${platform}:${level.platformProductId}`
          const insight = suggestionByKey?.get(key)
          const inbound = nextInboundByKey?.get(key)

          let pastDecision: Record<string, unknown> | null = null
          if (ctx.dataOS) {
            try {
              const memory = await ctx.dataOS.recallMemory('inventory-guard', { productId: level.platformProductId })
              if (memory) pastDecision = memory as unknown as Record<string, unknown>
            } catch { /* memory recall degradation */ }
          }

          alerts.push({
            platformProductId: level.platformProductId,
            platform,
            sku: level.sku ?? null,
            currentQuantity: level.quantity,
            safetyThreshold,
            status,
            daysOfStock: insight?.daysOfStock ?? null,
            dailyVelocity: insight?.dailyVelocity ?? null,
            nextInboundQty: inbound?.quantity ?? null,
            nextInboundEta: inbound?.expectedArrival ?? null,
            pastDecision,
          })
        }
      } catch (err) {
        const code = err instanceof HarnessError ? err.code : 'unknown'
        await ctx.logAction('inventory_guard.gather_error', { platform, code, error: errorMessage(err) })
      }
    }

    return {
      governance,
      sopGoalContext: sop?.extractedGoalContext ?? null,
      sopSystemPrompt: sop?.extractedSystemPrompt ?? null,
      degradation,
      platformData: {
        alerts,
        safetyThreshold,
        replenishMin: effectiveReplenishApprovalMinUnits(input.replenishApprovalMinUnits),
        replenishMinUsd: input.replenishApprovalMinUsd ?? 0,
        estimatedUnitCost: input.estimatedUnitCostUsd ?? 0,
        pendingApprovals: preflight.pendingApprovals,
      },
    }
  },

  async reason(ctx, context, _input) {
    const alerts = (context.platformData.alerts ?? []) as Array<{
      platformProductId: string; platform: string; sku: string | null
      currentQuantity: number; safetyThreshold: number; status: 'low' | 'out_of_stock'
      daysOfStock: number | null; dailyVelocity: number | null
      nextInboundQty: number | null; nextInboundEta: string | null
      pastDecision?: Record<string, unknown> | null
    }>

    if (alerts.length === 0 || context.platformData.preflight) return []

    const alertMap = new Map(alerts.map((a) => [a.platformProductId, a]))

    if (context.sopGoalContext || context.sopSystemPrompt) {
      const sopForPrompt = context.sopSystemPrompt
        ? { extractedSystemPrompt: context.sopSystemPrompt, extractedGoalContext: context.sopGoalContext }
        : null
      const stack = buildPromptStack(ctx, sopForPrompt)
      const taskPrompt = buildInventoryReasoningPrompt(alerts, context.sopGoalContext)
      const { systemPrompt, prompt } = flattenPromptStack(stack, taskPrompt)

      const response = await ctx.llm({ systemPrompt, prompt })
      const llmProposals = parseLlmProposals(response.text, alertMap)
      if (llmProposals.length > 0) return llmProposals
    }

    return alerts.map((a) => {
      const restockUnits = suggestedRestockUnits(a.currentQuantity, a.safetyThreshold)
      if (restockUnits === 0) return null
      return {
        platformProductId: a.platformProductId,
        platform: a.platform,
        sku: a.sku,
        currentQuantity: a.currentQuantity,
        targetQuantity: a.currentQuantity + restockUnits,
        restockUnits,
        status: a.status,
        reason: a.status === 'out_of_stock'
          ? `Out of stock — restock ${restockUnits} units urgently`
          : `Low stock (${a.currentQuantity}/${a.safetyThreshold}) — restock ${restockUnits} units`,
        confidence: a.status === 'out_of_stock' ? 0.9 : 0.7,
        daysOfStock: a.daysOfStock,
        dailyVelocity: a.dailyVelocity,
        nextInboundQty: a.nextInboundQty,
        nextInboundEta: a.nextInboundEta,
      } satisfies InventoryReplenishProposal
    }).filter((p): p is InventoryReplenishProposal => p !== null)
  },

  async govern(_ctx, decisions, context) {
    const replenishMin = (context.platformData.replenishMin ?? 50) as number
    const replenishMinUsd = (context.platformData.replenishMinUsd ?? 0) as number
    const estimatedUnitCost = (context.platformData.estimatedUnitCost ?? 0) as number
    const governed: GovernedDecision<InventoryReplenishProposal>[] = []

    for (const decision of decisions) {
      let action: 'auto_execute' | 'requires_approval' | 'blocked' = 'auto_execute'
      let reason = decision.reason
      let businessGuardTriggered = false

      if (decision.restockUnits >= replenishMin) {
        action = 'requires_approval'
        reason = `${decision.reason} — restock ${decision.restockUnits} ≥ ${replenishMin} units threshold`
      }

      if (replenishMinUsd > 0 && estimatedUnitCost > 0) {
        const estimatedCost = decision.restockUnits * estimatedUnitCost
        if (estimatedCost >= replenishMinUsd) {
          action = 'requires_approval'
          reason = `${decision.reason} — estimated cost $${estimatedCost.toFixed(0)} ≥ $${replenishMinUsd} threshold`
          businessGuardTriggered = true
        }
      }

      if (decision.daysOfStock !== null && decision.daysOfStock >= LOW_STOCK_RUNWAY_DAYS) {
        action = 'blocked'
        reason = `days_of_stock ${decision.daysOfStock} >= ${LOW_STOCK_RUNWAY_DAYS}d runway — defer`
        businessGuardTriggered = true
      }

      if (decision.nextInboundQty && decision.nextInboundEta && decision.daysOfStock !== null) {
        const etaDays = daysUntil(decision.nextInboundEta)
        if (etaDays !== null && etaDays >= 0 && decision.daysOfStock >= etaDays) {
          action = 'blocked'
          reason = `inbound ${decision.nextInboundQty} arriving in ${etaDays}d before projected stockout — defer`
          businessGuardTriggered = true
        }
      }

      const degraded = applyDegradation('inventory-guard', action, context.degradation)
      const finalAction = degraded.action as typeof action | 'degraded_suggest_only'

      governed.push({
        decision,
        action: finalAction,
        reason: degraded.reasons.length > 0 ? `${reason}; ${degraded.reasons.join('; ')}` : reason,
        confidence: decision.confidence,
        guard: {
          degraded: degraded.reasons.length > 0,
          constitutionTriggered: action === 'requires_approval' && decision.restockUnits >= replenishMin,
          businessGuardTriggered,
        },
      })
    }

    return governed
  },

  async execute(ctx, governed, context) {
    let executedCount = 0
    let approvalCount = 0
    let blockedCount = 0
    let degradedCount = 0

    const pendingApprovals = (context.platformData.pendingApprovals ?? []) as Array<{ action: string; payload: unknown }>

    const actionableAlerts: InventoryReplenishProposal[] = []

    for (const g of governed) {
      switch (g.action) {
        case 'blocked':
          blockedCount++
          await ctx.logAction('inventory_guard.business_guard_deferred', {
            platformProductId: g.decision.platformProductId,
            platform: g.decision.platform,
            reason: g.reason,
          })
          break

        case 'degraded_suggest_only':
          degradedCount++
          await ctx.logAction('inventory_guard.suggestion', {
            platformProductId: g.decision.platformProductId,
            platform: g.decision.platform,
            restockUnits: g.decision.restockUnits,
            reason: g.reason,
            confidence: g.confidence,
          })
          break

        case 'requires_approval': {
          const isDuplicate = pendingApprovals.some((a) => {
            if (a.action !== 'inventory.adjust') return false
            const p = (a.payload ?? {}) as Record<string, unknown>
            return (
              p.platformProductId === g.decision.platformProductId &&
              Number(p.targetQuantity) === g.decision.targetQuantity
            )
          })
          if (isDuplicate) {
            await ctx.logAction('inventory_guard.replenish_approval_duplicate_skipped', {
              platformProductId: g.decision.platformProductId,
            })
            break
          }
          approvalCount++
          await ctx.requestApproval({
            action: 'inventory.adjust',
            payload: {
              platform: g.decision.platform,
              platformProductId: g.decision.platformProductId,
              targetQuantity: g.decision.targetQuantity,
              suggestedRestockUnits: g.decision.restockUnits,
              currentQuantity: g.decision.currentQuantity,
              safetyThreshold: (context.platformData.safetyThreshold ?? 10) as number,
              status: g.decision.status,
              confidence: g.confidence,
              displayTitle: `Restock ${g.decision.platformProductId} +${g.decision.restockUnits} units`,
              impactPreview: g.decision.reason,
              rollbackPlan: 'Cancel restock order before fulfillment',
              businessContext: {
                daysOfStock: g.decision.daysOfStock,
                dailyVelocity: g.decision.dailyVelocity,
                nextInboundQuantity: g.decision.nextInboundQty,
                nextInboundExpectedArrival: g.decision.nextInboundEta,
              },
            },
            reason: g.reason,
          })
          break
        }

        case 'auto_execute':
          executedCount++
          actionableAlerts.push(g.decision)
          await ctx.logAction('inventory_guard.restock_auto', {
            platformProductId: g.decision.platformProductId,
            platform: g.decision.platform,
            restockUnits: g.decision.restockUnits,
            targetQuantity: g.decision.targetQuantity,
          })
          break
      }
    }

    if (actionableAlerts.length > 0) {
      const body = actionableAlerts
        .map((a) =>
          `- [${a.status}] ${a.platform} ${a.platformProductId}` +
          (a.sku ? ` sku=${a.sku}` : '') +
          ` qty=${a.currentQuantity} restock+=${a.restockUnits}` +
          (a.daysOfStock !== null ? ` days_of_stock=${a.daysOfStock}` : '') +
          (a.dailyVelocity !== null ? ` velocity=${a.dailyVelocity.toFixed(2)}` : ''),
        )
        .join('\n')
      await ctx.createTicket({
        title: `Inventory Guard: ${actionableAlerts.length} SKU(s) need restock`,
        body,
      })
    }

    return { decisions: governed, executedCount, approvalCount, blockedCount, degradedCount }
  },

  async remember(ctx, result, _context) {
    if (!ctx.dataOS) return

    for (const g of result.decisions) {
      if (g.action === 'blocked') continue
      try {
        const memId = await ctx.dataOS.recordMemory({
          agentId: 'inventory-guard',
          platform: g.decision.platform,
          entityId: g.decision.platformProductId,
          context: { currentQuantity: g.decision.currentQuantity, daysOfStock: g.decision.daysOfStock },
          action: { restockUnits: g.decision.restockUnits, targetQuantity: g.decision.targetQuantity },
        })
        if (memId && g.action === 'auto_execute') {
          await ctx.dataOS.writeOutcome(memId, {
            applied: true,
            restockUnits: g.decision.restockUnits,
            appliedAt: new Date().toISOString(),
          })
        }
      } catch { /* memory write degradation */ }

      try {
        await ctx.dataOS.recordLakeEvent({
          platform: g.decision.platform,
          agentId: ctx.agentId,
          eventType: g.action === 'auto_execute' ? 'inventory_restock' : 'inventory_restock_pending',
          entityId: g.decision.platformProductId,
          payload: {
            currentQuantity: g.decision.currentQuantity,
            targetQuantity: g.decision.targetQuantity,
            restockUnits: g.decision.restockUnits,
            action: g.action,
            confidence: g.confidence,
          },
          metadata: { agentType: 'inventory-guard' },
        })
      } catch {
        /* lake write degradation — non-fatal */
      }
    }
  },
}
