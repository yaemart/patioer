import type { TenantHarness } from '@patioer/harness'

export interface LlmParams {
  prompt: string
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
  getHarness(tenantId: string, agentId: string): TenantHarness
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
}

export interface PriceSentinelRunInput {
  proposals: Array<{
    productId: string
    currentPrice: number
    proposedPrice: number
    reason: string
  }>
  approvalThresholdPercent?: number
}

export interface PriceDecision {
  productId: string
  currentPrice: number
  proposedPrice: number
  deltaPercent: number
  requiresApproval: boolean
  reason: string
}

export interface ProductScoutRunInput {
  maxProducts?: number
}

export interface ScoutedProduct {
  productId: string
  title: string
  price: number
  inventory: number
  flag: 'low_inventory' | 'high_price' | 'normal'
}

export interface SupportRelayRunInput {
  autoReplyPolicy?: 'auto_reply_non_refund' | 'all_manual'
}

export interface RelayedThread {
  threadId: string
  subject: string
  action: 'auto_replied' | 'escalated'
  replyBody?: string
}
