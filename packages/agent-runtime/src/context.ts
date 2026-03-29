import type { TenantHarness } from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import type {
  AgentContextOptions,
  ApprovalRequest,
  CreateAgentContextDeps,
  LlmParams,
  LlmResponse,
  PendingApprovalItem,
  RecentAgentEvent,
  TicketParams,
} from './ports.js'
import type { DataOsPort } from './dataos-types.js'

export interface AgentContext {
  tenantId: string
  agentId: string

  /** Phase 3 · DataOS; present when API wires `deps.dataOS`. */
  dataOS?: DataOsPort

  /**
   * Returns a human-readable description of available DataOS capabilities
   * for injection into agent system prompts (Context Injection pattern).
   * When DataOS is not available, returns a short fallback string.
   */
  describeDataOsCapabilities(): string

  /**
   * Without `platform`, returns the default harness for this run (same as single-platform Phase 1).
   * With `platform`, returns that store’s harness when the tenant has credentials; otherwise throws.
   */
  getHarness(platform?: string): TenantHarness
  /** Platforms the tenant has connected (credential rows present), stable order (shopify → … → shopee). */
  getEnabledPlatforms(): string[]
  /** Injected `MarketContext` when `deps.market` is set (Phase 2 / `@patioer/market`). */
  market?: MarketContext

  llm(params: LlmParams): Promise<LlmResponse>

  budget: {
    isExceeded(): Promise<boolean>
  }

  logAction(action: string, payload: unknown): Promise<void>
  requestApproval(params: ApprovalRequest): Promise<void>
  createTicket(params: TicketParams): Promise<void>
  /** Returns pending approvals created by this agent; defaults to `[]` when no query port is wired. */
  listPendingApprovals(): Promise<PendingApprovalItem[]>
  /** Returns the last `limit` agent_events for this agent; defaults to `[]` when no events port is wired. */
  getRecentEvents(limit: number): Promise<RecentAgentEvent[]>
  /** Query events for a specific agent by ID; defaults to `[]` when no events port is wired. */
  getEventsForAgent(agentId: string, limit: number): Promise<RecentAgentEvent[]>
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

    listPendingApprovals(): Promise<PendingApprovalItem[]> {
      if (!deps.approvalsQuery) return Promise.resolve([])
      return deps.approvalsQuery.listPending(tenantId, agentId)
    },

    getRecentEvents(limit: number): Promise<RecentAgentEvent[]> {
      if (!deps.events) return Promise.resolve([])
      return deps.events.getRecent(tenantId, agentId, limit)
    },

    getEventsForAgent(targetAgentId: string, limit: number): Promise<RecentAgentEvent[]> {
      if (!deps.events) return Promise.resolve([])
      return deps.events.getRecent(tenantId, targetAgentId, limit)
    },

    describeDataOsCapabilities(): string {
      return 'DataOS is not available. You are operating in degraded (memoryless) mode.'
    },
  }

  if (deps.dataOS) {
    ctx.dataOS = deps.dataOS
    ctx.describeDataOsCapabilities = () =>
      'DataOS learning layer is available (Event Lake, Feature Store, Decision Memory).'
  }

  if (deps.market) {
    ctx.market = deps.market
  }

  return ctx
}
