import type { AgentContext } from '../context.js'
import type { LakeEventRow } from '../dataos-types.js'
import { errorMessage } from '../error-message.js'
import { extractFirstJsonObject } from '../extract-json.js'
import type {
  FinanceAgentRunInput,
  FinanceAgentResult,
  PnlLineItem,
  PnlReport,
} from '../finance-types.js'
import { randomRunId } from '../run-id.js'

function monthRangeMs(month: number, year: number): { startMs: number; endMs: number } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 1, 0, 0, 0, 0)
  return { startMs: start.getTime(), endMs: end.getTime() }
}

function classifyEvent(row: LakeEventRow): PnlLineItem | null {
  const p = row.payload as Record<string, unknown> | null
  if (!p) return null

  const platform = (typeof p.platform === 'string' ? p.platform : undefined) ?? 'unknown'
  const amount = typeof p.amount === 'number' ? p.amount : (typeof p.revenue === 'number' ? p.revenue : 0)
  const currency = typeof p.currency === 'string' ? p.currency : 'USD'

  switch (row.eventType) {
    case 'order_synced':
    case 'order_completed':
      return { category: 'revenue', platform, amount, currency, itemCount: 1 }
    case 'ads_budget_applied':
    case 'ads_budget_set':
      return {
        category: 'ads_spend',
        platform,
        amount: typeof p.dailyBudget === 'number' ? p.dailyBudget : amount,
        currency,
        itemCount: 1,
      }
    case 'return_processed':
      return { category: 'returns', platform, amount, currency, itemCount: 1 }
    default:
      return null
  }
}

function aggregateLineItems(items: PnlLineItem[]): {
  totalRevenue: number
  totalAdsSpend: number
  totalCogs: number
  totalReturns: number
} {
  let totalRevenue = 0
  let totalAdsSpend = 0
  let totalCogs = 0
  let totalReturns = 0

  for (const item of items) {
    switch (item.category) {
      case 'revenue':
        totalRevenue += item.amount
        break
      case 'ads_spend':
        totalAdsSpend += item.amount
        break
      case 'cogs':
        totalCogs += item.amount
        break
      case 'returns':
        totalReturns += item.amount
        break
      default:
        break
    }
  }

  return { totalRevenue, totalAdsSpend, totalCogs, totalReturns }
}

function buildPnlPrompt(report: Omit<PnlReport, 'insights'>, memories: unknown[]): string {
  const lines: string[] = [
    `Generate business insights for this monthly P&L report.`,
    `Month: ${report.month}/${report.year}`,
    `Total Revenue: $${report.totalRevenue.toFixed(2)}`,
    `Total Ads Spend: $${report.totalAdsSpend.toFixed(2)}`,
    `Total COGS: $${report.totalCogs.toFixed(2)}`,
    `Total Returns: $${report.totalReturns.toFixed(2)}`,
    `Gross Profit: $${report.grossProfit.toFixed(2)}`,
    `Gross Margin: ${report.grossMarginPct.toFixed(1)}%`,
    `Line Items: ${report.lineItems.length}`,
  ]

  if (memories.length > 0) {
    lines.push(`\nPrevious P&L reports for context:`)
    for (const m of memories.slice(0, 3)) {
      lines.push(JSON.stringify(m))
    }
  }

  lines.push(`
Respond with valid JSON in this exact shape:
{
  "insights": ["insight1", "insight2", ...]
}
Provide 3-5 actionable business insights based on the P&L data.`)

  return lines.join('\n')
}

function parseLlmInsights(text: string): string[] {
  try {
    const jsonMatch = extractFirstJsonObject(text)
    if (!jsonMatch) return [text.slice(0, 500)]
    const parsed = JSON.parse(jsonMatch) as Record<string, unknown>
    if (Array.isArray(parsed.insights)) {
      return parsed.insights.filter((i): i is string => typeof i === 'string')
    }
    return [text.slice(0, 500)]
  } catch {
    return [text.slice(0, 500)]
  }
}

export async function runFinanceAgent(
  ctx: AgentContext,
  input: FinanceAgentRunInput,
): Promise<FinanceAgentResult> {
  const runId = randomRunId()
  const { month, year } = input
  const platforms = input.platforms ?? ctx.getEnabledPlatforms()

  await ctx.logAction('finance_agent.run.started', { runId, month, year, platforms })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('finance_agent.budget_exceeded', { runId })
    return { runId, report: null, platforms, eventsFetched: 0 }
  }

  const { startMs, endMs } = monthRangeMs(month, year)
  const sinceMs = Date.now() - startMs
  const dateRange = { from: new Date(startMs), to: new Date(endMs) }

  let lakeEvents: LakeEventRow[] = []
  let eventsFetched = 0

  if (ctx.dataOS?.queryLakeEvents) {
    try {
      lakeEvents = await ctx.dataOS.queryLakeEvents({ limit: 10_000, sinceMs })
      eventsFetched = lakeEvents.length
    } catch (err) {
      await ctx.logAction('finance_agent.dataos_degraded', {
        runId,
        op: 'queryLakeEvents',
        error: errorMessage(err),
      })
    }
  }

  let analyticsRevenue = 0
  let analyticsOrders = 0
  for (const platform of platforms) {
    try {
      const analytics = await ctx.getHarness(platform).getAnalytics(dateRange)
      analyticsRevenue += analytics.revenue
      analyticsOrders += analytics.orders
    } catch (err) {
      await ctx.logAction('finance_agent.harness_degraded', {
        runId,
        platform,
        error: errorMessage(err),
      })
    }
  }

  const lineItems: PnlLineItem[] = []
  for (const event of lakeEvents) {
    const item = classifyEvent(event)
    if (item) lineItems.push(item)
  }

  if (lineItems.filter((i) => i.category === 'revenue').length === 0 && analyticsRevenue > 0) {
    for (const platform of platforms) {
      lineItems.push({
        category: 'revenue',
        platform,
        amount: analyticsRevenue / platforms.length,
        currency: 'USD',
        itemCount: Math.ceil(analyticsOrders / platforms.length),
      })
    }
  }

  const totals = aggregateLineItems(lineItems)
  const grossProfit = totals.totalRevenue - totals.totalAdsSpend - totals.totalCogs - totals.totalReturns
  const grossMarginPct = totals.totalRevenue > 0 ? (grossProfit / totals.totalRevenue) * 100 : 0

  const partialReport: Omit<PnlReport, 'insights'> = {
    month,
    year,
    ...totals,
    grossProfit,
    grossMarginPct,
    lineItems,
  }

  let memories: unknown[] = []
  if (ctx.dataOS) {
    try {
      memories = (await ctx.dataOS.recallMemory('finance-agent', { month, year })) ?? []
    } catch (err) {
      await ctx.logAction('finance_agent.dataos_degraded', {
        runId,
        op: 'recallMemory',
        error: errorMessage(err),
      })
    }
  }

  let insights: string[]
  try {
    const prompt = buildPnlPrompt(partialReport, memories)
    const dataOsContext = ctx.describeDataOsCapabilities()
    const llmResponse = await ctx.llm({
      prompt,
      systemPrompt: `You are a financial analyst for an e-commerce business. Generate concise, actionable P&L insights. Always respond with valid JSON.\n\nData context: ${dataOsContext}`,
    })
    insights = parseLlmInsights(llmResponse.text)
  } catch (err) {
    await ctx.logAction('finance_agent.llm_failed', { runId, error: errorMessage(err) })
    insights = ['P&L report generated but LLM insights unavailable.']
  }

  const report: PnlReport = { ...partialReport, insights }

  if (ctx.dataOS) {
    try {
      await ctx.dataOS.recordMemory({
        agentId: 'finance-agent',
        entityId: `pnl-${year}-${String(month).padStart(2, '0')}`,
        context: { month, year, platforms },
        action: { report },
      })
    } catch (err) {
      await ctx.logAction('finance_agent.dataos_write_failed', {
        runId,
        op: 'recordMemory',
        error: errorMessage(err),
      })
    }
    try {
      await ctx.dataOS.recordLakeEvent({
        agentId: ctx.agentId,
        eventType: 'pnl_report_generated',
        entityId: `pnl-${year}-${String(month).padStart(2, '0')}`,
        payload: report,
        metadata: { agentType: 'finance-agent', month, year },
      })
    } catch (err) {
      await ctx.logAction('finance_agent.dataos_write_failed', {
        runId,
        op: 'recordLakeEvent',
        error: errorMessage(err),
      })
    }
  }

  await ctx.logAction('finance_agent.run.completed', {
    runId,
    month,
    year,
    totalRevenue: report.totalRevenue,
    grossProfit: report.grossProfit,
    grossMarginPct: report.grossMarginPct,
    lineItemCount: report.lineItems.length,
    insightCount: report.insights.length,
    eventsFetched,
  })

  return { runId, report, platforms, eventsFetched }
}
