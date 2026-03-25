import type { DataOsServices } from '@patioer/dataos'

/** Weekly Monday 09:00 UTC: backfill decision_memory outcomes (placeholder metrics). */
export function scheduleInsightAgent(services: DataOsServices): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = new Date()
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 9 || now.getUTCMinutes() >= 10) {
      return
    }
    void runInsightTick(services).catch((err) => console.error('[dataos-insight-agent]', err))
  }, 60_000)
}

async function runInsightTick(services: DataOsServices): Promise<void> {
  const pending = await services.decisionMemory.listPendingOutcomesOlderThan(7)
  for (const row of pending) {
    const outcome = { revenue_7d: 0, conv_rate_7d: 0, source: 'insight_agent_placeholder' }
    await services.decisionMemory.writeOutcome(row.id, row.tenant_id, outcome)
  }
}
