import { isAdsCapable } from '@patioer/harness'
import type { AdsCapableHarness, HarnessAdsCampaign } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type { AdsOptimizerRunInput, AdsOptimizerRunResult } from '../types.js'
import { ADS_OPTIMIZER_HEARTBEAT_MS } from '../types.js'
import {
  APPROVAL_BUDGET_THRESHOLD_USD,
  decideBudgetOptimization,
} from './ads-optimizer.decision.js'

function randomRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function hasUpdateAdsBudget(h: unknown): h is AdsCapableHarness {
  return typeof (h as AdsCapableHarness).updateAdsBudget === 'function'
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
    approvalBudgetThresholdUsd: APPROVAL_BUDGET_THRESHOLD_USD,
  })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('ads_optimizer.budget_exceeded', { runId, agentId: ctx.agentId })
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
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (input.persistCampaigns) {
      await input.persistCampaigns({ platform, campaigns })
    }

    synced += campaigns.length

    for (const campaign of campaigns) {
      const decision = decideBudgetOptimization(campaign, { targetRoas: input.targetRoas })
      if (decision.action === 'none') {
        continue
      }

      await ctx.logAction('ads_optimizer.trigger', {
        runId,
        keyword: 'ADS_OPTIMIZER_DECISION',
        platform,
        campaignId: campaign.platformCampaignId,
        triggerReason: decision.reason,
        roas: campaign.roas,
        proposedDailyBudgetUsd: decision.proposedDailyBudgetUsd,
        requiresApproval: decision.wouldRequireApproval,
      })

      if (decision.wouldRequireApproval) {
        const duplicatePending =
          input.hasPendingAdsBudgetApproval &&
          (await input.hasPendingAdsBudgetApproval({
            platform,
            platformCampaignId: campaign.platformCampaignId,
            proposedDailyBudgetUsd: decision.proposedDailyBudgetUsd,
          }))
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
              thresholdUsd: APPROVAL_BUDGET_THRESHOLD_USD,
            },
            reason: `Proposed daily budget $${decision.proposedDailyBudgetUsd} exceeds $${APPROVAL_BUDGET_THRESHOLD_USD} — approval required`,
          })
          await ctx.logAction('ads_optimizer.approval_requested', {
            runId,
            keyword: 'ADS_BUDGET_APPROVAL_THRESHOLD',
            platform,
            campaignId: campaign.platformCampaignId,
            proposedUsd: decision.proposedDailyBudgetUsd,
          })
          approvalsRequested += 1
        }
      } else if (hasUpdateAdsBudget(harness)) {
        await harness.updateAdsBudget(campaign.platformCampaignId, decision.proposedDailyBudgetUsd)
        await ctx.logAction('ads_optimizer.budget_applied', {
          runId,
          platform,
          campaignId: campaign.platformCampaignId,
          proposedUsd: decision.proposedDailyBudgetUsd,
        })
        budgetUpdatesApplied += 1
      } else {
        await ctx.logAction('ads_optimizer.budget_apply_skipped', {
          runId,
          platform,
          reason: 'updateAdsBudget_not_available',
        })
      }
    }

    perPlatform.push({ platform, ok: true, count: campaigns.length })
    await ctx.logAction('ads_optimizer.platform.synced', {
      runId,
      platform,
      count: campaigns.length,
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
