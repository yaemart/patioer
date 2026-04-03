import { isAdsCapable, HarnessError } from '@patioer/harness'
import type { HarnessAdsCampaign } from '@patioer/harness'
import type {
  DecisionPipeline,
  GovernedDecision,
} from '../decision-pipeline.js'
import { NO_DEGRADATION } from '../decision-pipeline.js'
import { detectDegradation, applyDegradation } from '../decision-degradation.js'
import { errorMessage } from '../error-message.js'
import { buildPromptStack, flattenPromptStack } from '../prompt-stack.js'
import { decideBudgetOptimization, APPROVAL_BUDGET_THRESHOLD_USD } from './ads-optimizer.decision.js'
import { runAgentPreflight } from './preflight.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdsOptimizerInput {
  targetRoas?: number
  platforms?: string[]
}

export interface AdsBudgetProposal {
  platformCampaignId: string
  platform: string
  campaignName: string
  currentDailyBudget: number
  proposedDailyBudget: number
  currentRoas: number | null
  action: 'increase' | 'decrease' | 'hold' | 'pause'
  reason: string
  confidence: number
}

// ---------------------------------------------------------------------------
// LLM prompt + parser
// ---------------------------------------------------------------------------

function buildAdsReasoningPrompt(
  campaigns: Array<{
    platformCampaignId: string
    platform: string
    name: string
    dailyBudget: number
    roas: number | null
    totalSpend: number | null
    status: string
    pastDecision?: unknown
  }>,
  goalContext: Record<string, unknown> | null,
  targetRoas: number,
): string {
  const goalSection = goalContext
    ? `\nOPERATING CONTEXT:\n${JSON.stringify(goalContext)}\n`
    : ''

  return `Analyze these ad campaigns and recommend budget optimizations.
Target ROAS: ${targetRoas}x
${goalSection}
CAMPAIGNS:
${JSON.stringify(campaigns)}

Each campaign may include a "pastDecision" field with the last budget decision and its outcome.
Use this history to inform your recommendations — avoid repeating ineffective adjustments.

For each ACTIVE campaign, output a JSON object with:
- platformCampaignId (string)
- action ("increase", "decrease", "hold", or "pause")
- proposedDailyBudget (number in USD, 0 if pause)
- reason (string, 1-2 sentences)
- confidence (number 0-1)

Rules:
- If ROAS >= target: hold or consider slight increase
- If ROAS < target and ROAS > 0: increase budget by 5-15%
- If ROAS is null or very poor: consider pausing
- If campaign is underperforming severely (ROAS < 0.5x target): recommend pause
- Never propose negative budgets

Respond ONLY with a JSON array. No other text.`
}

function parseAdsReasoningResponse(
  text: string,
  campaigns: Array<{ platformCampaignId: string; platform: string; name: string; dailyBudget: number; roas: number | null }>,
): AdsBudgetProposal[] {
  let parsed: unknown[]
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as unknown[]
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const campaignMap = new Map(campaigns.map((c) => [c.platformCampaignId, c]))

  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const cid = String(item.platformCampaignId ?? '')
      const campaign = campaignMap.get(cid)
      if (!campaign) return null

      const rawAction = String(item.action ?? 'hold')
      const action = rawAction === 'increase' ? 'increase'
        : rawAction === 'decrease' ? 'decrease'
        : rawAction === 'pause' ? 'pause'
        : 'hold'

      const proposedBudget = action === 'hold'
        ? campaign.dailyBudget
        : action === 'pause'
        ? 0
        : (typeof item.proposedDailyBudget === 'number' && item.proposedDailyBudget >= 0
          ? Math.round(item.proposedDailyBudget * 100) / 100
          : campaign.dailyBudget)

      return {
        platformCampaignId: cid,
        platform: campaign.platform,
        campaignName: campaign.name,
        currentDailyBudget: campaign.dailyBudget,
        proposedDailyBudget: proposedBudget,
        currentRoas: campaign.roas,
        action,
        reason: typeof item.reason === 'string' ? item.reason : 'No reason provided',
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.5,
      } satisfies AdsBudgetProposal
    })
    .filter((p): p is AdsBudgetProposal => p !== null)
}

// ---------------------------------------------------------------------------
// Fallback: rule-based reasoning using existing decideBudgetOptimization
// ---------------------------------------------------------------------------

function ruleBasedReason(
  campaigns: Array<{ platformCampaignId: string; platform: string; name: string; dailyBudget: number; roas: number | null; status: string; totalSpend: number | null }>,
  targetRoas: number,
  approvalThresholdUsd: number,
): AdsBudgetProposal[] {
  const proposals: AdsBudgetProposal[] = []
  for (const c of campaigns) {
    const decision = decideBudgetOptimization(
      { platformCampaignId: c.platformCampaignId, name: c.name, status: c.status as 'active', dailyBudget: c.dailyBudget, roas: c.roas, totalSpend: c.totalSpend } as HarnessAdsCampaign,
      { targetRoas, approvalThresholdUsd },
    )
    if (decision.action === 'none') continue

    const proposed = decision.proposedDailyBudgetUsd
    const direction = proposed > c.dailyBudget ? 'increase' : proposed < c.dailyBudget ? 'decrease' : 'hold' as const
    if (direction === 'hold') continue

    proposals.push({
      platformCampaignId: c.platformCampaignId,
      platform: c.platform,
      campaignName: c.name,
      currentDailyBudget: c.dailyBudget,
      proposedDailyBudget: proposed,
      currentRoas: c.roas,
      action: direction,
      reason: `ROAS ${c.roas?.toFixed(2) ?? 'N/A'} vs target ${targetRoas}x — budget ${direction === 'increase' ? '+' : ''}${(((proposed - c.dailyBudget) / (c.dailyBudget || 1)) * 100).toFixed(0)}%`,
      confidence: 0.7,
    })
  }
  return proposals
}

// ---------------------------------------------------------------------------
// Pipeline implementation
// ---------------------------------------------------------------------------

export const adsOptimizerPipeline: DecisionPipeline<AdsOptimizerInput, AdsBudgetProposal> = {
  scope: 'ads-optimizer',

  async gather(ctx, input) {
    const preflight = await runAgentPreflight(ctx, {
      agentKey: 'ads_optimizer',
      humanInLoopAction: 'ads.full_run',
    })
    if (preflight.reason !== 'continue') {
      return {
        governance: preflight.governance,
        sopGoalContext: null,
        sopSystemPrompt: null,
        degradation: { ...NO_DEGRADATION },
        platformData: { preflight: preflight.reason, campaigns: [], pendingApprovals: [] },
      }
    }

    const governance = await ctx.getEffectiveGovernance('ads-optimizer')
    const sop = await ctx.getActiveSop('ads-optimizer')
    const platforms = input.platforms ?? ctx.getEnabledPlatforms()

    const degradation = await detectDegradation(ctx, {
      scope: 'ads-optimizer',
      platform: platforms[0],
    })

    const allCampaigns: Array<{
      platformCampaignId: string
      platform: string
      name: string
      dailyBudget: number
      roas: number | null
      totalSpend: number | null
      status: string
    }> = []

    for (const platform of platforms) {
      try {
        const harness = ctx.getHarness(platform)
        if (!isAdsCapable(harness)) {
          await ctx.logAction('ads_optimizer.platform.skipped', { platform, reason: 'not_ads_capable' })
          continue
        }
        const campaigns = await harness.getAdsCampaigns()
        for (const c of campaigns) {
          allCampaigns.push({
            platformCampaignId: c.platformCampaignId,
            platform,
            name: c.name,
            dailyBudget: c.dailyBudget ?? 0,
            roas: c.roas ?? null,
            totalSpend: c.totalSpend ?? null,
            status: c.status,
          })
        }
      } catch (err) {
        await ctx.logAction('ads_optimizer.gather_error', { platform, error: errorMessage(err) })
      }
    }

    if (ctx.dataOS) {
      for (const c of allCampaigns) {
        try {
          const memory = await ctx.dataOS.recallMemory('ads-optimizer', { campaignId: c.platformCampaignId })
          if (memory) {
            (c as Record<string, unknown>).pastDecision = memory
          }
        } catch { /* memory recall degradation */ }
      }
    }

    let healthContext: Record<string, string | number> | null = null
    if (ctx.business?.accountHealth && platforms[0]) {
      try {
        const summary = await ctx.business.accountHealth.getHealthSummary(platforms[0])
        healthContext = {
          overallStatus: summary.overallStatus,
          openIssues: summary.openIssues,
          resolvedLast30d: summary.resolvedLast30d,
        }
      } catch {
        /* degrade gracefully */
      }
    }

    return {
      governance,
      sopGoalContext: sop?.extractedGoalContext ?? null,
      sopSystemPrompt: sop?.extractedSystemPrompt ?? null,
      degradation,
      platformData: {
        campaigns: allCampaigns,
        healthContext,
        pendingApprovals: preflight.pendingApprovals,
        targetRoas: input.targetRoas,
      },
    }
  },

  async reason(ctx, context, input) {
    const campaigns = (context.platformData.campaigns ?? []) as Array<{
      platformCampaignId: string; platform: string; name: string;
      dailyBudget: number; roas: number | null; totalSpend: number | null; status: string
    }>

    if (campaigns.length === 0 || context.platformData.preflight) return []

    const targetRoas = (input.targetRoas ?? 3)
    const approvalThresholdUsd = context.governance.adsBudgetApproval ?? APPROVAL_BUDGET_THRESHOLD_USD

    const activeCampaigns = campaigns.filter((c) => c.status === 'active')
    if (activeCampaigns.length === 0) return []

    if (context.sopGoalContext || context.sopSystemPrompt) {
      const sopForPrompt = context.sopSystemPrompt
        ? { extractedSystemPrompt: context.sopSystemPrompt, extractedGoalContext: context.sopGoalContext }
        : null
      const stack = buildPromptStack(ctx, sopForPrompt)
      const taskPrompt = buildAdsReasoningPrompt(activeCampaigns, context.sopGoalContext, targetRoas)
      const { systemPrompt, prompt } = flattenPromptStack(stack, taskPrompt)

      const response = await ctx.llm({ systemPrompt, prompt })
      const llmProposals = parseAdsReasoningResponse(response.text, activeCampaigns)
      if (llmProposals.length > 0) return llmProposals
    }

    return ruleBasedReason(activeCampaigns, targetRoas, approvalThresholdUsd)
  },

  async govern(_ctx, decisions, context) {
    const approvalThresholdUsd = context.governance.adsBudgetApproval ?? APPROVAL_BUDGET_THRESHOLD_USD
    const healthContext = context.platformData.healthContext as Record<string, string | number> | null
    const governed: GovernedDecision<AdsBudgetProposal>[] = []

    for (const decision of decisions) {
      if (decision.action === 'hold') {
        governed.push({
          decision,
          action: 'auto_execute',
          reason: 'No budget change recommended',
          confidence: decision.confidence,
          guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
        })
        continue
      }

      let action: 'auto_execute' | 'requires_approval' | 'blocked' = 'auto_execute'
      let reason = decision.reason
      let constitutionTriggered = false
      let businessGuardTriggered = false

      if (decision.action === 'pause') {
        action = 'requires_approval'
        reason = `${decision.reason} — pausing campaign requires human confirmation`
        constitutionTriggered = true
      }

      if (decision.proposedDailyBudget > approvalThresholdUsd) {
        action = 'requires_approval'
        reason = `${decision.reason} — proposed $${decision.proposedDailyBudget} exceeds $${approvalThresholdUsd} threshold`
        constitutionTriggered = true
      }

      const budgetDeltaPct = decision.currentDailyBudget > 0
        ? Math.abs((decision.proposedDailyBudget - decision.currentDailyBudget) / decision.currentDailyBudget) * 100
        : 0
      if (budgetDeltaPct > 30) {
        action = 'requires_approval'
        reason = `${decision.reason} — budget change ${budgetDeltaPct.toFixed(0)}% exceeds 30% threshold (Constitution §5.2)`
        constitutionTriggered = true
      }

      if (healthContext) {
        if (healthContext.overallStatus === 'critical') {
          action = 'blocked'
          reason = `${decision.reason} — account health critical, ad spending suspended`
          businessGuardTriggered = true
        } else if (healthContext.overallStatus === 'at_risk' || Number(healthContext.openIssues ?? 0) >= 3) {
          action = 'requires_approval'
          reason = `${decision.reason} — account health at risk, manual review required`
          businessGuardTriggered = true
        }
      }

      const degraded = applyDegradation('ads-optimizer', action, context.degradation)
      const finalAction = degraded.action as typeof action | 'degraded_suggest_only'

      governed.push({
        decision,
        action: finalAction,
        reason: degraded.reasons.length > 0 ? `${reason}; ${degraded.reasons.join('; ')}` : reason,
        confidence: decision.confidence,
        guard: {
          degraded: degraded.reasons.length > 0,
          constitutionTriggered,
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

    for (const g of governed) {
      if (g.decision.action === 'hold') continue

      switch (g.action) {
        case 'blocked':
          blockedCount++
          await ctx.logAction('ads_optimizer.blocked', {
            campaignId: g.decision.platformCampaignId,
            platform: g.decision.platform,
            reason: g.reason,
          })
          break

        case 'degraded_suggest_only':
          degradedCount++
          await ctx.logAction('ads_optimizer.suggestion', {
            campaignId: g.decision.platformCampaignId,
            platform: g.decision.platform,
            proposedBudget: g.decision.proposedDailyBudget,
            reason: g.reason,
            confidence: g.confidence,
          })
          break

        case 'requires_approval': {
          const isDuplicate = pendingApprovals.some((a) => {
            if (a.action !== 'ads.set_budget') return false
            const p = (a.payload ?? {}) as Record<string, unknown>
            return (
              p.platformCampaignId === g.decision.platformCampaignId &&
              Number(p.proposedDailyBudgetUsd) === g.decision.proposedDailyBudget
            )
          })
          if (isDuplicate) {
            await ctx.logAction('ads_optimizer.approval_duplicate_skipped', {
              campaignId: g.decision.platformCampaignId,
            })
            break
          }
          approvalCount++
          await ctx.requestApproval({
            action: 'ads.set_budget',
            payload: {
              platform: g.decision.platform,
              platformCampaignId: g.decision.platformCampaignId,
              campaignName: g.decision.campaignName,
              proposedDailyBudgetUsd: g.decision.proposedDailyBudget,
              currentDailyBudgetUsd: g.decision.currentDailyBudget,
              currentRoas: g.decision.currentRoas,
              confidence: g.confidence,
              displayTitle: `Adjust "${g.decision.campaignName}" budget to $${g.decision.proposedDailyBudget.toFixed(2)}/day`,
              impactPreview: g.decision.reason,
              rollbackPlan: `Revert to $${g.decision.currentDailyBudget.toFixed(2)}/day`,
            },
            reason: g.reason,
          })
          break
        }

        case 'auto_execute': {
          try {
            const harness = ctx.getHarness(g.decision.platform)
            if (isAdsCapable(harness)) {
              await harness.updateAdsBudget(g.decision.platformCampaignId, g.decision.proposedDailyBudget)
              executedCount++
              await ctx.logAction('ads_optimizer.budget_applied', {
                campaignId: g.decision.platformCampaignId,
                platform: g.decision.platform,
                oldBudget: g.decision.currentDailyBudget,
                newBudget: g.decision.proposedDailyBudget,
                confidence: g.confidence,
              })
            }
          } catch (err) {
            const code = err instanceof HarnessError ? err.code : 'unknown'
            await ctx.logAction('ads_optimizer.harness_error', {
              type: 'harness_error',
              platform: g.decision.platform,
              code,
              campaignId: g.decision.platformCampaignId,
              message: errorMessage(err),
            })
          }
          break
        }
      }
    }

    return { decisions: governed, executedCount, approvalCount, blockedCount, degradedCount }
  },

  async remember(ctx, result, _context) {
    if (!ctx.dataOS) return

    for (const g of result.decisions) {
      if (g.decision.action === 'hold') continue
      try {
        const memId = await ctx.dataOS.recordMemory({
          agentId: 'ads-optimizer',
          platform: g.decision.platform,
          entityId: g.decision.platformCampaignId,
          context: { currentBudget: g.decision.currentDailyBudget, roas: g.decision.currentRoas },
          action: { proposedBudget: g.decision.proposedDailyBudget, action: g.decision.action },
        })
        if (memId && g.action === 'auto_execute') {
          await ctx.dataOS.writeOutcome(memId, {
            applied: true,
            newBudget: g.decision.proposedDailyBudget,
            appliedAt: new Date().toISOString(),
          })
        }
      } catch { /* memory write degradation */ }

      try {
        await ctx.dataOS.recordLakeEvent({
          platform: g.decision.platform,
          agentId: ctx.agentId,
          eventType: g.action === 'auto_execute' ? 'ads_budget_changed' : 'ads_budget_pending',
          entityId: g.decision.platformCampaignId,
          payload: {
            currentBudget: g.decision.currentDailyBudget,
            proposedBudget: g.decision.proposedDailyBudget,
            action: g.action,
            confidence: g.confidence,
          },
          metadata: { agentType: 'ads-optimizer' },
        })
      } catch {
        /* lake write degradation — non-fatal */
      }
    }
  },
}
