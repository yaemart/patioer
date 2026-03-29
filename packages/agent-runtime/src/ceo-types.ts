export interface CeoAgentRunInput {
  enforceDailyWindow?: boolean
  timeZone?: string
}

export interface AgentStatusSummary {
  agentId: string
  recentEventCount: number
  lastEventAt: string | null
  hasErrors: boolean
  pendingApprovals: number
}

export interface ConflictDetection {
  agentA: string
  agentB: string
  conflictType: 'budget_contention' | 'inventory_vs_ads' | 'price_conflict' | 'resource_overlap'
  description: string
  resolution: string
}

export interface CoordinationReport {
  date: string
  agentStatuses: AgentStatusSummary[]
  conflicts: ConflictDetection[]
  recommendations: string[]
  ticketsCreated: number
}

export interface CeoAgentResult {
  runId: string
  report: CoordinationReport | null
  agentsChecked: number
  conflictsFound: number
  ticketsCreated: number
}

export const CEO_AGENT_HEARTBEAT_MS = 24 * 60 * 60 * 1000
