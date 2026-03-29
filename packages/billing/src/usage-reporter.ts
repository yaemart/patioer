import type { PlanName, UsageEvent } from './billing.types.js'
import { PLAN_BUDGET_USD, TOKEN_COST_PER_1K_USD } from '@patioer/shared'

export interface StripeMeterClient {
  createMeterEvent(params: {
    event_name: string
    payload: { stripe_customer_id: string; value: string }
  }): Promise<void>
}

export interface UsageStore {
  getMonthlyUsageUsd(tenantId: string): Promise<number>
  recordUsage(event: UsageEvent): Promise<void>
}

export interface EventLake {
  record(event: {
    tenantId: string
    eventType: string
    payload: Record<string, unknown>
  }): Promise<void>
}

export interface UsageReporterDeps {
  stripeMeter: StripeMeterClient
  usageStore: UsageStore
  eventLake: EventLake
}

export function createUsageReporter(deps: UsageReporterDeps) {
  const { stripeMeter, usageStore, eventLake } = deps

  async function reportTokenUsage(
    tenantId: string,
    stripeCustomerId: string,
    plan: PlanName,
    agentId: string,
    tokensUsed: number,
    model: string,
  ): Promise<UsageEvent> {
    const costUsd = (tokensUsed / 1000) * TOKEN_COST_PER_1K_USD
    const monthlyUsage = await usageStore.getMonthlyUsageUsd(tenantId)
    const budget = PLAN_BUDGET_USD[plan]
    const isOverage = (monthlyUsage + costUsd) > budget

    let reportedToStripe = false

    if (isOverage) {
      await stripeMeter.createMeterEvent({
        event_name: 'agent_token_usage',
        payload: {
          stripe_customer_id: stripeCustomerId,
          value: String(tokensUsed),
        },
      })
      reportedToStripe = true
    }

    await eventLake.record({
      tenantId,
      eventType: 'token_usage',
      payload: { agentId, tokensUsed, costUsd, model, isOverage },
    })

    const event: UsageEvent = {
      tenantId,
      agentId,
      tokensUsed,
      costUsd,
      model,
      isOverage,
      reportedToStripe,
    }

    await usageStore.recordUsage(event)

    return event
  }

  return { reportTokenUsage }
}

export type UsageReporterService = ReturnType<typeof createUsageReporter>
