import type { TenantHarness } from '@patioer/harness'
import type { ApprovalRequest, LlmParams, LlmResponse, TicketParams } from './types.js'

export interface AgentContext {
  tenantId: string
  agentId: string

  getHarness(): TenantHarness
  getGoalContext(): string

  llm(params: LlmParams): Promise<LlmResponse>

  budget: {
    isExceeded(): Promise<boolean>
    remaining(): Promise<number>
  }

  logAction(action: string, payload: unknown): Promise<void>
  requestApproval(params: ApprovalRequest): Promise<void>
  createTicket(params: TicketParams): Promise<void>
}
