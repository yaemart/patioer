import type { TenantHarness } from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import type { DataOsPort } from './dataos-types.js'

export interface LlmParams {
  prompt: string
  systemPrompt?: string
}

export interface LlmResponse {
  text: string
}

export interface ApprovalRequest {
  action: string
  payload: unknown
  reason: string
}

export interface TicketParams {
  title: string
  body: string
}

export interface HarnessPort {
  getHarness(tenantId: string, agentId: string, platform?: string): TenantHarness
  getEnabledPlatforms(tenantId: string, agentId: string): string[]
}

export interface BudgetPort {
  isExceeded(tenantId: string, agentId: string): Promise<boolean>
}

export interface AuditPort {
  logAction(
    tenantId: string,
    agentId: string,
    action: string,
    payload: unknown,
  ): Promise<void>
}

export interface ApprovalPort {
  requestApproval(
    tenantId: string,
    agentId: string,
    params: ApprovalRequest,
  ): Promise<void>
}

export interface TicketPort {
  createTicket(tenantId: string, agentId: string, params: TicketParams): Promise<void>
}

export interface PendingApprovalItem {
  id: string
  action: string
  payload: unknown
  createdAt: Date | string | null
}

export interface ApprovalsQueryPort {
  listPending(tenantId: string, agentId: string): Promise<PendingApprovalItem[]>
}

export interface RecentAgentEvent {
  id: string
  action: string
  payload: unknown
  createdAt: Date | string | null
}

export interface EventsPort {
  getRecent(tenantId: string, agentId: string, limit: number): Promise<RecentAgentEvent[]>
}

export interface LlmPort {
  complete(
    params: LlmParams,
    context: { tenantId: string; agentId: string },
  ): Promise<LlmResponse>
}

export interface AgentContextOptions {
  tenantId: string
  agentId: string
}

export interface CreateAgentContextDeps {
  harness: HarnessPort
  budget: BudgetPort
  audit: AuditPort
  approvals: ApprovalPort
  tickets: TicketPort
  llm: LlmPort
  market?: MarketContext
  approvalsQuery?: ApprovalsQueryPort
  events?: EventsPort
  dataOS?: DataOsPort
}
