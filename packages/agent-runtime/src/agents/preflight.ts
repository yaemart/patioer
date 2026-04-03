import type { AgentContext } from '../context.js'
import type { GovernanceSettings, PendingApprovalItem } from '../ports.js'

export type AgentPreflightReason = 'continue' | 'human_in_loop' | 'budget_exceeded'

export interface AgentPreflightOptions {
  agentKey: string
  humanInLoopAction: string
  payload?: Record<string, unknown>
  reason?: string
}

export interface AgentPreflightResult {
  reason: AgentPreflightReason
  governance: GovernanceSettings
  pendingApprovals: PendingApprovalItem[]
}

/**
 * Canonical pre-flight order for agent-native execution:
 * governance -> humanInLoop -> budget -> pending approvals -> execute.
 */
export async function runAgentPreflight(
  ctx: AgentContext,
  options: AgentPreflightOptions,
): Promise<AgentPreflightResult> {
  const governance = await ctx.getGovernanceSettings()

  if (await ctx.isHumanInLoop()) {
    await ctx.logAction(`${options.agentKey}.human_in_loop`, options.payload ?? {})
    await ctx.requestApproval({
      action: options.humanInLoopAction,
      payload: options.payload ?? {},
      reason: options.reason ?? 'Agent is in human-in-loop mode — all actions require approval',
    })
    return {
      reason: 'human_in_loop',
      governance,
      pendingApprovals: [],
    }
  }

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction(`${options.agentKey}.budget_exceeded`, options.payload ?? {})
    return {
      reason: 'budget_exceeded',
      governance,
      pendingApprovals: [],
    }
  }

  return {
    reason: 'continue',
    governance,
    pendingApprovals: await ctx.listPendingApprovals(),
  }
}
