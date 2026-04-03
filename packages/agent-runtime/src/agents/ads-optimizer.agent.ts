import { isAdsCapable } from '@patioer/harness'
import type { HarnessAdsCampaign } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import {
  ADS_OPTIMIZER_HEARTBEAT_MS,
  type AdsOptimizerRunInput,
  type AdsOptimizerRunResult,
} from '../commerce-types.js'
import { errorMessage } from '../error-message.js'
import {
  APPROVAL_BUDGET_THRESHOLD_USD,
  decideBudgetOptimization,
} from './ads-optimizer.decision.js'
import {
  blockGuard,
  composeGuardedReason,
  guardBlocksExecution,
  guardRequiresApproval,
  noBusinessGuard,
  requireApprovalGuard,
  type BusinessGuard,
} from './business-guard.js'
import { randomRunId } from '../run-id.js'
import { runAgentPreflight } from './preflight.js'

async function loadPlatformHealthContext(
  ctx: AgentContext,
  platform: string,
): Promise<Record<string, string | number> | null> {
  if (!ctx.business?.accountHealth) return null
  try {
    const summary = await ctx.business.accountHealth.getHealthSummary(platform)
    return {
      overallStatus: summary.overallStatus,
      openIssues: summary.openIssues,
      resolvedLast30d: summary.resolvedLast30d,
    }
  } catch (err) {
    await ctx.logAction('ads_optimizer.business_context_degraded', {
      platform,
      port: 'accountHealth',
      error: errorMessage(err),
    })
    return null
  }
}

function resolveAdsBusinessGuard(
  healthContext: Record<string, string | number> | null,
): BusinessGuard {
  const overallStatus = healthContext?.overallStatus
  const openIssues = Number(healthContext?.openIssues ?? 0)

  if (overallStatus === 'critical') {
    return blockGuard('account health critical — suspend budget increase')
  }

  if (overallStatus === 'at_risk' || openIssues >= 3) {
    return requireApprovalGuard('account health at risk — manual review required before budget increase')
  }

  return noBusinessGuard()
}

/**
 * Syncs campaigns, persists, then applies ROAS/budget rules (Sprint 4 Day 5).
 * Proposed daily budget **greater than** {@link APPROVAL_BUDGET_THRESHOLD_USD} → `requestApproval` only (no `updateAdsBudget`).
 */
export async function runAdsOptimizer(
  ctx: AgentContext,
  input: AdsOptimizerRunInput,
): Promise<AdsOptimizerRunResult> {
  const runId = randomRunId()
  const platforms = ctx.getEnabledPlatforms()

  await ctx.logAction('ads_optimizer.run.started', {
    runId,
    agentId: ctx.agentId,
    platforms,
    heartbeatMsExpected: ADS_OPTIMIZER_HEARTBEAT_MS,
    targetRoas: input.targetRoas,
    approvalBudgetThresholdUsd: null,
  })

  const preflight = await runAgentPreflight(ctx, {
    agentKey: 'ads_optimizer',
    humanInLoopAction: 'ads.full_run',
    payload: { runId, platforms, targetRoas: input.targetRoas },
  })
  const approvalThresholdUsd =
    preflight.governance.adsBudgetApproval ?? APPROVAL_BUDGET_THRESHOLD_USD
  await ctx.logAction('ads_optimizer.governance_loaded', {
    runId,
    approvalBudgetThresholdUsd: approvalThresholdUsd,
  })

  if (preflight.reason === 'human_in_loop') {
    return { runId, synced: 0, perPlatform: [], approvalsRequested: 1 }
  }
  if (preflight.reason === 'budget_exceeded') {
    return { runId, synced: 0, perPlatform: [], budgetExceeded: true }
  }

  if (platforms.length === 0) {
    await ctx.logAction('ads_optimizer.no_platforms', { runId })
    return { runId, synced: 0, perPlatform: [] }
  }

  const perPlatform: AdsOptimizerRunResult['perPlatform'] = []
  let synced = 0
  let approvalsRequested = 0
  let budgetUpdatesApplied = 0
  const pendingApprovals = preflight.pendingApprovals

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
      await ctx.logAction('ads_optimizer.platform.skipped', {
        runId,
        platform,
        reason: 'no_harness',
      })
      continue
    }

    if (!isAdsCapable(harness)) {
      perPlatform.push({
        platform,
        ok: false,
        count: 0,
        skipReason: 'not_ads_capable',
      })
      await ctx.logAction('ads_optimizer.platform.skipped', {
        runId,
        platform,
        reason: 'not_ads_capable',
      })
      continue
    }

    let campaigns: HarnessAdsCampaign[]
    try {
      campaigns = await harness.getAdsCampaigns()
      if (ctx.market) {
        campaigns = await Promise.all(
          campaigns.map(async (c) => {
            const currency = c.currency?.toUpperCase()
            if (!currency || currency === 'USD') return c
            const toUsd = async (amount: number | null | undefined) => {
              if (amount == null || !Number.isFinite(amount)) return amount
              try { return await ctx.market!.convertPrice(amount, currency, 'USD') } catch { return amount }
            }
            return {
              ...c,
              dailyBudget: await toUsd(c.dailyBudget),
              totalSpend: await toUsd(c.totalSpend),
              currency: 'USD',
            }
          }),
        )
      }
    } catch (err) {
      perPlatform.push({
        platform,
        ok: false,
        count: 0,
        skipReason: 'harness_error',
      })
      await ctx.logAction('ads_optimizer.platform.fetch_failed', {
        runId,
        platform,
        error: errorMessage(err),
      })
      continue
    }
    const healthContext = await loadPlatformHealthContext(ctx, platform)

    if (input.persistCampaigns) {
      await input.persistCampaigns({ platform, campaigns })
    }

    synced += campaigns.length

    for (const campaign of campaigns) {
      const decision = decideBudgetOptimization(campaign, {
        targetRoas: input.targetRoas,
        approvalThresholdUsd: approvalThresholdUsd,
      })
      if (decision.action === 'none') {
        continue
      }
      const businessGuard = resolveAdsBusinessGuard(healthContext)
      const requiresApproval = guardRequiresApproval(decision.wouldRequireApproval, businessGuard)

      await ctx.logAction('ads_optimizer.trigger', {
        runId,
        keyword: 'ADS_OPTIMIZER_DECISION',
        platform,
        campaignId: campaign.platformCampaignId,
        triggerReason: decision.reason,
        roas: campaign.roas,
        proposedDailyBudgetUsd: decision.proposedDailyBudgetUsd,
        requiresApproval,
        healthContext,
        businessGuardReason: businessGuard.reason,
      })

      if (guardBlocksExecution(businessGuard)) {
        await ctx.logAction('ads_optimizer.business_guard_blocked', {
          runId,
          platform,
          campaignId: campaign.platformCampaignId,
          proposedUsd: decision.proposedDailyBudgetUsd,
          healthContext,
          businessGuardReason: businessGuard.reason,
        })
        continue
      }

      if (requiresApproval) {
        const duplicatePending =
          input.hasPendingAdsBudgetApproval
            ? await input.hasPendingAdsBudgetApproval({
              platform,
              platformCampaignId: campaign.platformCampaignId,
              proposedDailyBudgetUsd: decision.proposedDailyBudgetUsd,
            })
            : pendingApprovals.some((item) => {
              if (item.action !== 'ads.set_budget') return false
              const payload = (item.payload ?? {}) as Record<string, unknown>
              return (
                payload.platform === platform &&
                payload.platformCampaignId === campaign.platformCampaignId &&
                Number(payload.proposedDailyBudgetUsd) === decision.proposedDailyBudgetUsd
              )
            })
        if (duplicatePending) {
          await ctx.logAction('ads_optimizer.approval_duplicate_skipped', {
            runId,
            platform,
            campaignId: campaign.platformCampaignId,
            proposedUsd: decision.proposedDailyBudgetUsd,
            keyword: 'ADS_BUDGET_PENDING_DEDUPE',
          })
        } else {
          await ctx.requestApproval({
            action: 'ads.set_budget',
            payload: {
              platform,
              platformCampaignId: campaign.platformCampaignId,
              proposedDailyBudgetUsd: decision.proposedDailyBudgetUsd,
              currentDailyBudgetUsd: campaign.dailyBudget ?? null,
              thresholdUsd: approvalThresholdUsd,
              healthContext,
              businessGuardReason: businessGuard.reason,
            },
            reason: composeGuardedReason(
              decision.wouldRequireApproval
                ? `Proposed daily budget $${decision.proposedDailyBudgetUsd} exceeds $${approvalThresholdUsd} — approval required`
                : '',
              businessGuard,
            ),
          })
          await ctx.logAction('ads_optimizer.approval_requested', {
            runId,
            keyword: 'ADS_BUDGET_APPROVAL_THRESHOLD',
            platform,
            campaignId: campaign.platformCampaignId,
            proposedUsd: decision.proposedDailyBudgetUsd,
            healthContext,
            businessGuardReason: businessGuard.reason,
          })
          approvalsRequested += 1
        }
      } else {
        await harness.updateAdsBudget(campaign.platformCampaignId, decision.proposedDailyBudgetUsd)
        await ctx.logAction('ads_optimizer.budget_applied', {
          runId,
          platform,
          campaignId: campaign.platformCampaignId,
          proposedUsd: decision.proposedDailyBudgetUsd,
          healthContext,
        })
        budgetUpdatesApplied += 1
      }
    }

    perPlatform.push({ platform, ok: true, count: campaigns.length })
    await ctx.logAction('ads_optimizer.platform.synced', {
      runId,
      platform,
      count: campaigns.length,
      healthContext,
    })
  }

  await ctx.logAction('ads_optimizer.run.completed', {
    runId,
    synced,
    platforms: perPlatform,
    approvalsRequested,
    budgetUpdatesApplied,
    keyword: 'ADS_OPTIMIZER_RUN_SUMMARY',
  })

  return {
    runId,
    synced,
    perPlatform,
    approvalsRequested,
    budgetUpdatesApplied,
  }
}
