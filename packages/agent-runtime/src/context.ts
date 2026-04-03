import type {
  AccountHealthSummary,
  CaseFilters,
  DateRange,
  InboundShipment,
  ListingIssue,
  RefundSummary,
  ReplenishmentSuggestion,
  ServiceCase,
  SkuEconomics,
  TenantHarness,
  DailyOverview,
} from '@patioer/harness'
import type { MarketContext } from '@patioer/market'
import type {
  AgentContextOptions,
  ApprovalRequest,
  CreateAgentContextDeps,
  GovernanceSettings,
  LlmParams,
  LlmResponse,
  PendingApprovalItem,
  RecentAgentEvent,
  SopRecord,
  TicketParams,
} from './ports.js'
import { DEFAULT_GOVERNANCE_SETTINGS, mergeGovernanceWithSop } from './ports.js'
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

  /** Tenant-level governance settings; returns defaults when no governance port is wired. */
  getGovernanceSettings(): Promise<GovernanceSettings>

  /**
   * Returns governance settings merged with the active SOP's extractedGovernance.
   * SOP values are clamped to safe ranges (priceChangeThreshold 5–30, adsBudgetApproval 100–2000).
   * Falls back to base governance when no SOP is active or SOP has no governance overrides.
   */
  getEffectiveGovernance(scope: string): Promise<GovernanceSettings>

  /**
   * Tenant-scoped business read models backed by the Phase 5B business ports.
   * Present only when API wires the corresponding implementations.
   */
  business?: {
    unitEconomics: {
      getSkuEconomics(platform: string, productId: string, range: DateRange): Promise<SkuEconomics | null>
      getDailyOverview(range: DateRange): Promise<DailyOverview[]>
    }
    inventoryPlanning: {
      getInboundShipments(): Promise<InboundShipment[]>
      getReplenishmentSuggestions(): Promise<ReplenishmentSuggestion[]>
    }
    accountHealth: {
      getHealthSummary(platform: string): Promise<AccountHealthSummary>
      getListingIssues(): Promise<ListingIssue[]>
    }
    serviceOps: {
      getCases(filters?: CaseFilters): Promise<ServiceCase[]>
      getRefundSummary(range: DateRange): Promise<RefundSummary>
    }
  }

  /**
   * Pre-flight check: returns true if this agent's type is in the humanInLoopAgents list,
   * meaning every action should route through approval. Agents should call this at the start
   * of `run()` and redirect all side-effects through `requestApproval` when true.
   */
  isHumanInLoop(): Promise<boolean>

  /**
   * Resolve the active SOP for the given agent scope.
   * Returns null when no SOP port is wired or no matching active SOP exists.
   * Uses the scope resolution rules: entity > platform > global, time-windowed > unbounded.
   * When `context` is provided, entity-level and platform-level SOPs are excluded
   * if they do not match the current execution context.
   */
  getActiveSop(scope: string, context?: { platform?: string; entityType?: string; entityId?: string }): Promise<{
    extractedGoalContext: Record<string, unknown> | null
    extractedSystemPrompt: string | null
    extractedGovernance: Record<string, unknown> | null
  } | null>
}

export function createAgentContext(
  options: AgentContextOptions,
  deps: CreateAgentContextDeps,
): AgentContext {
  const { tenantId, agentId, agentType } = options

  let cachedSops: SopRecord[] | null = null
  async function loadSops(): Promise<SopRecord[]> {
    if (cachedSops) return cachedSops
    if (!deps.sop) return []
    try {
      cachedSops = await deps.sop.getActiveSops(tenantId)
    } catch {
      cachedSops = []
    }
    return cachedSops
  }

  let cachedGovernance: GovernanceSettings | null = null
  async function resolveGovernance(): Promise<GovernanceSettings> {
    if (cachedGovernance) return cachedGovernance
    if (!deps.governance) return DEFAULT_GOVERNANCE_SETTINGS
    cachedGovernance = await deps.governance.getSettings(tenantId)
    return cachedGovernance
  }

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

    getGovernanceSettings(): Promise<GovernanceSettings> {
      return resolveGovernance()
    },

    async getEffectiveGovernance(scope: string): Promise<GovernanceSettings> {
      const [base, sop] = await Promise.all([
        resolveGovernance(),
        ctx.getActiveSop(scope),
      ])
      return mergeGovernanceWithSop(base, sop?.extractedGovernance ?? null)
    },

    async isHumanInLoop(): Promise<boolean> {
      if (!agentType) return false
      const settings = await resolveGovernance()
      return settings.humanInLoopAgents.includes(agentType)
    },

    async getActiveSop(scope: string, context?: { platform?: string; entityType?: string; entityId?: string }) {
      const sops = await loadSops()
      const now = new Date()

      const candidates = sops.filter((s) => {
        if (s.scope !== scope) return false
        if (s.status !== 'active') return false
        if (s.effectiveFrom && s.effectiveFrom > now) return false
        if (s.effectiveTo && s.effectiveTo < now) return false
        return true
      })

      if (candidates.length === 0) return null

      const scored = candidates.map((s) => {
        const sc = scoreSop(s, context)
        const timeVal = (s.effectiveFrom || s.effectiveTo) ? 1 : 0
        return { sop: s, sc, timeVal }
      }).filter((e) => e.sc >= 0)

      if (scored.length === 0) return null

      scored.sort((a, b) => {
        if (a.sc !== b.sc) return b.sc - a.sc
        if (a.timeVal !== b.timeVal) return b.timeVal - a.timeVal
        return b.sop.version - a.sop.version
      })

      const winner = scored[0]!.sop
      return {
        extractedGoalContext: winner.extractedGoalContext,
        extractedSystemPrompt: winner.extractedSystemPrompt,
        extractedGovernance: winner.extractedGovernance,
      }
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

  if (deps.unitEconomics || deps.inventoryPlanning || deps.accountHealth || deps.serviceOps) {
    ctx.business = {
      unitEconomics: {
        getSkuEconomics(platform: string, productId: string, range: DateRange): Promise<SkuEconomics | null> {
          if (!deps.unitEconomics) return Promise.resolve(null)
          return deps.unitEconomics.getSkuEconomics(tenantId, platform, productId, range)
        },
        getDailyOverview(range: DateRange): Promise<DailyOverview[]> {
          if (!deps.unitEconomics) return Promise.resolve([])
          return deps.unitEconomics.getDailyOverview(tenantId, range)
        },
      },
      inventoryPlanning: {
        getInboundShipments(): Promise<InboundShipment[]> {
          if (!deps.inventoryPlanning) return Promise.resolve([])
          return deps.inventoryPlanning.getInboundShipments(tenantId)
        },
        getReplenishmentSuggestions(): Promise<ReplenishmentSuggestion[]> {
          if (!deps.inventoryPlanning) return Promise.resolve([])
          return deps.inventoryPlanning.getReplenishmentSuggestions(tenantId)
        },
      },
      accountHealth: {
        getHealthSummary(platform: string): Promise<AccountHealthSummary> {
          if (!deps.accountHealth) {
            return Promise.resolve({
              platform,
              overallStatus: 'healthy',
              openIssues: 0,
              resolvedLast30d: 0,
              metrics: {},
            })
          }
          return deps.accountHealth.getHealthSummary(tenantId, platform)
        },
        getListingIssues(): Promise<ListingIssue[]> {
          if (!deps.accountHealth) return Promise.resolve([])
          return deps.accountHealth.getListingIssues(tenantId)
        },
      },
      serviceOps: {
        getCases(filters?: CaseFilters): Promise<ServiceCase[]> {
          if (!deps.serviceOps) return Promise.resolve([])
          return deps.serviceOps.getCases(tenantId, filters)
        },
        getRefundSummary(range: DateRange): Promise<RefundSummary> {
          if (!deps.serviceOps) {
            return Promise.resolve({
              totalRefunds: 0,
              totalAmount: 0,
              byReason: {},
            })
          }
          return deps.serviceOps.getRefundSummary(tenantId, range)
        },
      },
    }
  }

  return ctx
}

/**
 * Score a SOP record against the current execution context.
 * Returns -1 to exclude entity/platform SOPs that don't match the context.
 * Mirrors the priority rules from `packages/sop/src/sop-resolver.ts`.
 */
function scoreSop(
  sop: SopRecord,
  context?: { platform?: string; entityType?: string; entityId?: string },
): number {
  if (sop.entityId && sop.entityType && sop.platform) {
    if (
      context &&
      sop.entityId === context.entityId &&
      sop.entityType === context.entityType &&
      sop.platform === context.platform
    ) {
      return 3
    }
    return -1
  }

  if (sop.platform && !sop.entityId) {
    if (!context?.platform || sop.platform === context.platform) return 2
    return -1
  }

  return 1
}
