import type { AgentContext } from '../context.js'
import { errorMessage } from '../error-message.js'
import { extractFirstJsonObject } from '../extract-json.js'
import { randomRunId } from '../run-id.js'
import type {
  AgentStatusSummary,
  CeoAgentRunInput,
  CeoAgentResult,
  ConflictDetection,
  CoordinationReport,
  RecentAgentEvent,
} from '../types.js'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'

const CEO_LOCAL_HOUR = 8
const RECENT_EVENTS_LIMIT = 50

function getHourInTimeZone(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).formatToParts(date)
    const hourPart = parts.find((p) => p.type === 'hour')
    return hourPart ? Number(hourPart.value) : date.getUTCHours()
  } catch {
    return date.getUTCHours()
  }
}

function summarizeAgentStatus(agentId: string, events: RecentAgentEvent[]): AgentStatusSummary {
  const hasErrors = events.some((e) => {
    const action = typeof e.action === 'string' ? e.action : ''
    return action.includes('error') || action.includes('failed') || action.includes('degraded')
  })
  const lastEventAt = events.length > 0
    ? String(events[0]!.createdAt ?? null)
    : null

  return {
    agentId,
    recentEventCount: events.length,
    lastEventAt,
    hasErrors,
    pendingApprovals: 0,
  }
}

function detectKnownConflicts(statuses: AgentStatusSummary[], allEvents: Map<string, RecentAgentEvent[]>): ConflictDetection[] {
  const conflicts: ConflictDetection[] = []

  const adsEvents = allEvents.get('ads-optimizer') ?? []
  const inventoryEvents = allEvents.get('inventory-guard') ?? []

  const adsHasBudgetIncrease = adsEvents.some((e) => {
    const action = typeof e.action === 'string' ? e.action : ''
    return action.includes('budget') || action.includes('approval')
  })
  const inventoryHasLowStock = inventoryEvents.some((e) => {
    const action = typeof e.action === 'string' ? e.action : ''
    return action.includes('low') || action.includes('restock') || action.includes('out_of_stock')
  })

  if (adsHasBudgetIncrease && inventoryHasLowStock) {
    conflicts.push({
      agentA: 'ads-optimizer',
      agentB: 'inventory-guard',
      conflictType: 'inventory_vs_ads',
      description: 'Ads Optimizer is increasing ad spend while Inventory Guard reports low stock — risk of selling out and wasting ad budget.',
      resolution: 'Pause or reduce ad budget for low-stock SKUs until Inventory Guard confirms restock.',
    })
  }

  const errorAgents = statuses.filter((s) => s.hasErrors).map((s) => s.agentId)
  if (errorAgents.length >= 3) {
    conflicts.push({
      agentA: errorAgents[0]!,
      agentB: errorAgents[1]!,
      conflictType: 'resource_overlap',
      description: `Multiple agents experiencing errors (${errorAgents.join(', ')}). Possible shared resource contention.`,
      resolution: 'Investigate shared resources (API rate limits, DB connections) and stagger agent schedules.',
    })
  }

  return conflicts
}

function buildCoordinationPrompt(
  statuses: AgentStatusSummary[],
  ruleBasedConflicts: ConflictDetection[],
): string {
  const lines: string[] = [
    `You are the CEO Agent for an e-commerce company. Analyze agent statuses and generate a coordination report.`,
    `\nAgent Statuses:`,
    ...statuses.map((s) =>
      `- ${s.agentId}: ${s.recentEventCount} events, errors=${s.hasErrors}, pending_approvals=${s.pendingApprovals}`,
    ),
  ]

  if (ruleBasedConflicts.length > 0) {
    lines.push(`\nDetected Conflicts:`)
    for (const c of ruleBasedConflicts) {
      lines.push(`- [${c.conflictType}] ${c.agentA} vs ${c.agentB}: ${c.description}`)
    }
  }

  lines.push(`
Respond with valid JSON in this exact shape:
{
  "additionalConflicts": [
    { "agentA": "string", "agentB": "string", "conflictType": "budget_contention|inventory_vs_ads|price_conflict|resource_overlap", "description": "string", "resolution": "string" }
  ],
  "recommendations": ["recommendation1", "recommendation2", ...]
}
Provide 2-4 strategic recommendations.`)

  return lines.join('\n')
}

function parseLlmCoordination(text: string): {
  additionalConflicts: ConflictDetection[]
  recommendations: string[]
} {
  try {
    const jsonMatch = extractFirstJsonObject(text)
    if (!jsonMatch) return { additionalConflicts: [], recommendations: [text.slice(0, 500)] }
    const parsed = JSON.parse(jsonMatch) as Record<string, unknown>

    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r): r is string => typeof r === 'string')
      : []

    const additionalConflicts: ConflictDetection[] = []
    if (Array.isArray(parsed.additionalConflicts)) {
      for (const c of parsed.additionalConflicts) {
        if (
          c &&
          typeof c === 'object' &&
          typeof (c as Record<string, unknown>).agentA === 'string' &&
          typeof (c as Record<string, unknown>).agentB === 'string'
        ) {
          const obj = c as Record<string, unknown>
          additionalConflicts.push({
            agentA: obj.agentA as string,
            agentB: obj.agentB as string,
            conflictType: (['budget_contention', 'inventory_vs_ads', 'price_conflict', 'resource_overlap'] as const)
              .find((t) => t === obj.conflictType) ?? 'resource_overlap',
            description: typeof obj.description === 'string' ? obj.description : '',
            resolution: typeof obj.resolution === 'string' ? obj.resolution : '',
          })
        }
      }
    }

    return { additionalConflicts, recommendations }
  } catch {
    return { additionalConflicts: [], recommendations: [] }
  }
}

export async function runCeoAgent(
  ctx: AgentContext,
  input: CeoAgentRunInput,
): Promise<CeoAgentResult> {
  const runId = randomRunId()
  const timeZone = input.timeZone ?? 'UTC'

  await ctx.logAction('ceo_agent.run.started', { runId, timeZone })

  if (input.enforceDailyWindow) {
    const hour = getHourInTimeZone(new Date(), timeZone)
    if (hour !== CEO_LOCAL_HOUR) {
      await ctx.logAction('ceo_agent.skipped.schedule', { runId, hour, timeZone })
      return { runId, report: null, agentsChecked: 0, conflictsFound: 0, ticketsCreated: 0 }
    }
  }

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('ceo_agent.budget_exceeded', { runId })
    return { runId, report: null, agentsChecked: 0, conflictsFound: 0, ticketsCreated: 0 }
  }

  const allEvents = new Map<string, RecentAgentEvent[]>()
  const statuses: AgentStatusSummary[] = []

  for (const agentId of ELECTROOS_AGENT_IDS) {
    let events: RecentAgentEvent[] = []
    if (ctx.getEventsForAgent) {
      try {
        events = await ctx.getEventsForAgent(agentId, RECENT_EVENTS_LIMIT)
      } catch (err) {
        await ctx.logAction('ceo_agent.events_fetch_failed', {
          runId,
          targetAgent: agentId,
          error: errorMessage(err),
        })
      }
    }
    allEvents.set(agentId, events)
    statuses.push(summarizeAgentStatus(agentId, events))
  }

  const ruleBasedConflicts = detectKnownConflicts(statuses, allEvents)

  let llmConflicts: ConflictDetection[] = []
  let recommendations: string[]
  try {
    const prompt = buildCoordinationPrompt(statuses, ruleBasedConflicts)
    const dataOsContext = ctx.describeDataOsCapabilities()
    const llmResponse = await ctx.llm({
      prompt,
      systemPrompt: `You are the CEO Agent (E-01) coordinating all ElectroOS agents. Identify conflicts, recommend actions, and ensure smooth operations. Only create coordination tickets for real conflicts. Always respond with valid JSON.\n\nData context: ${dataOsContext}`,
    })
    const parsed = parseLlmCoordination(llmResponse.text)
    llmConflicts = parsed.additionalConflicts
    recommendations = parsed.recommendations
  } catch (err) {
    await ctx.logAction('ceo_agent.llm_failed', { runId, error: errorMessage(err) })
    recommendations = ['CEO coordination report generated but LLM analysis unavailable.']
  }

  const allConflicts = [...ruleBasedConflicts, ...llmConflicts]

  let ticketsCreated = 0
  for (const conflict of allConflicts) {
    try {
      await ctx.createTicket({
        title: `[Coordination] ${conflict.conflictType}: ${conflict.agentA} vs ${conflict.agentB}`,
        body: `**Conflict:** ${conflict.description}\n\n**Resolution:** ${conflict.resolution}\n\n_Generated by CEO Agent (${runId})_`,
      })
      ticketsCreated++
    } catch (err) {
      await ctx.logAction('ceo_agent.ticket_create_failed', {
        runId,
        conflict: conflict.conflictType,
        error: errorMessage(err),
      })
    }
  }

  const report: CoordinationReport = {
    date: new Date().toISOString().slice(0, 10),
    agentStatuses: statuses,
    conflicts: allConflicts,
    recommendations,
    ticketsCreated,
  }

  if (ctx.dataOS) {
    try {
      await ctx.dataOS.recordMemory({
        agentId: 'ceo-agent',
        entityId: `coordination-${report.date}`,
        context: { date: report.date, agentsChecked: statuses.length },
        action: { report },
      })
    } catch (err) {
      await ctx.logAction('ceo_agent.dataos_write_failed', {
        runId,
        op: 'recordMemory',
        error: errorMessage(err),
      })
    }
    try {
      await ctx.dataOS.recordLakeEvent({
        agentId: ctx.agentId,
        eventType: 'coordination_report_generated',
        payload: report,
        metadata: { agentType: 'ceo-agent', date: report.date },
      })
    } catch (err) {
      await ctx.logAction('ceo_agent.dataos_write_failed', {
        runId,
        op: 'recordLakeEvent',
        error: errorMessage(err),
      })
    }
  }

  await ctx.logAction('ceo_agent.run.completed', {
    runId,
    agentsChecked: statuses.length,
    conflictsFound: allConflicts.length,
    ticketsCreated,
    recommendationCount: recommendations.length,
  })

  return {
    runId,
    report,
    agentsChecked: statuses.length,
    conflictsFound: allConflicts.length,
    ticketsCreated,
  }
}
