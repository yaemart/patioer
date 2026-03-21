import type { TenantHarness } from '@patioer/harness'
import type {
  AgentContextOptions,
  ApprovalRequest,
  CreateAgentContextDeps,
  LlmParams,
  LlmResponse,
  TicketParams,
} from './types.js'

export interface AgentContext {
  tenantId: string
  agentId: string

  getHarness(): TenantHarness

  llm(params: LlmParams): Promise<LlmResponse>

  budget: {
    isExceeded(): Promise<boolean>
  }

  logAction(action: string, payload: unknown): Promise<void>
  requestApproval(params: ApprovalRequest): Promise<void>
  createTicket(params: TicketParams): Promise<void>
}

function assertDeps(deps: CreateAgentContextDeps): void {
  if (!deps.harness) throw new Error('AgentContext dependency missing: harness')
  if (!deps.budget) throw new Error('AgentContext dependency missing: budget')
  if (!deps.audit) throw new Error('AgentContext dependency missing: audit')
  if (!deps.approvals) throw new Error('AgentContext dependency missing: approvals')
  if (!deps.tickets) throw new Error('AgentContext dependency missing: tickets')
  if (!deps.llm) throw new Error('AgentContext dependency missing: llm')
}

export function createAgentContext(
  options: AgentContextOptions,
  deps: CreateAgentContextDeps,
): AgentContext {
  assertDeps(deps)

  const { tenantId, agentId } = options

  return {
    tenantId,
    agentId,

    getHarness(): TenantHarness {
      return deps.harness.getHarness(tenantId, agentId)
    },

    llm(params: LlmParams): Promise<LlmResponse> {
      return deps.llm.complete(params, { tenantId, agentId })
    },

    budget: {
      isExceeded(): Promise<boolean> {
        return deps.budget.isExceeded(tenantId, agentId)
      },
    },

    logAction(action: string, payload: unknown): Promise<void> {
      return deps.audit.logAction(tenantId, agentId, action, payload)
    },

    requestApproval(params: ApprovalRequest): Promise<void> {
      return deps.approvals.requestApproval(tenantId, agentId, params)
    },

    createTicket(params: TicketParams): Promise<void> {
      return deps.tickets.createTicket(tenantId, agentId, params)
    },
  }
}
