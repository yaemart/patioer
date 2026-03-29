export interface FinanceAgentRunInput {
  month: number
  year: number
  platforms?: string[]
}

export interface PnlLineItem {
  category: 'revenue' | 'ads_spend' | 'cogs' | 'returns' | 'other'
  platform: string
  amount: number
  currency: string
  itemCount: number
}

export interface PnlReport {
  month: number
  year: number
  totalRevenue: number
  totalAdsSpend: number
  totalCogs: number
  totalReturns: number
  grossProfit: number
  grossMarginPct: number
  lineItems: PnlLineItem[]
  insights: string[]
}

export interface FinanceAgentResult {
  runId: string
  report: PnlReport | null
  platforms: string[]
  eventsFetched: number
}

export const FINANCE_AGENT_HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000
