import type { TenantHarness } from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import type {
  AgentContextOptions,
  ApprovalRequest,
  CreateAgentContextDeps,
  DataOsPort,
  LlmParams,
  LlmResponse,
  PendingApprovalItem,
  RecentAgentEvent,
  TicketParams,
} from './types.js'

export interface AgentContext {
  tenantId: string
  agentId: string

  /** Phase 3 · DataOS; present when API wires `deps.dataOS`. */
  dataOS?: DataOsPort

  /**
   * Without `platform`, returns the default harness for this run (same as single-platform Phase 1).
   * With `platform`, returns that store’s harness when the tenant has credentials; otherwise throws.
   */
  getHarness(platform?: string): TenantHarness
  /** Platforms the tenant has connected (credential rows present), stable order (shopify → … → shopee). */
  getEnabledPlatforms(): string[]
  /**
   * Injected `MarketContext` when `deps.market` is set (Phase 2 / `@patioer/market`).
   * Same object as `getMarket()` when present.
   */
  market?: MarketContext
  /** Present when `CreateAgentContextDeps.market` is set (e.g. API execute route + Redis). */
  getMarket?(): MarketContext

  llm(params: LlmParams): Promise<LlmResponse>

  budget: {
    isExceeded(): Promise<boolean>
  }

  logAction(action: string, payload: unknown): Promise<void>
  requestApproval(params: ApprovalRequest): Promise<void>
  createTicket(params: TicketParams): Promise<void>
  /** Returns pending approvals created by this agent (requires `deps.approvalsQuery`; otherwise `[]`). */
  listPendingApprovals?: () => Promise<PendingApprovalItem[]>
  /** Returns the last `limit` agent_events for this agent (requires `deps.events`; otherwise `[]`). */
  getRecentEvents?: (limit: number) => Promise<RecentAgentEvent[]>
}

export function createAgentContext(
  options: AgentContextOptions,
  deps: CreateAgentContextDeps,
): AgentContext {
  const { tenantId, agentId } = options

  const ctx: AgentContext = {
    tenantId,
    agentId,

    getHarness(platform?: string): TenantHarness {
      return deps.harness.getHarness(tenantId, agentId, platform)
    },

    getEnabledPlatforms(): string[] {
      return deps.harness.getEnabledPlatforms(tenantId, agentId)
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

  ctx.listPendingApprovals = () => {
    if (!deps.approvalsQuery) return Promise.resolve([])
    return deps.approvalsQuery.listPending(tenantId, agentId)
  }

  ctx.getRecentEvents = (limit: number) => {
    if (!deps.events) return Promise.resolve([])
    return deps.events.getRecent(tenantId, agentId, limit)
  }

  if (deps.dataOS) {
    ctx.dataOS = deps.dataOS
  }

  if (deps.market) {
    const market = deps.market
    ctx.market = market
    ctx.getMarket = () => market
  }

  return ctx
}
