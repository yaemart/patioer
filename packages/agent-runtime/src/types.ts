import type { HarnessAdsCampaign, HarnessInventoryLevel, TenantHarness } from '@patioer/harness'
import type { MarketContext } from '@patioer/market'

export interface LlmParams {
  prompt: string
  /** Optional system-level instruction; overrides any factory-level system prompt when set. */
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
  /**
   * Returns the harness for `platform` when set; when omitted, returns the **default** harness
   * for this execution (first connected platform per API / `x-platform` resolution).
   */
  getHarness(tenantId: string, agentId: string, platform?: string): TenantHarness
  /** Platform ids with stored credentials for this tenant (e.g. `shopify`, `amazon`). */
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

/** Phase 3 · DataOS (optional; degraded when unavailable). */
export type DataOsFeatureSnapshot = Record<string, unknown>

export interface LakeEventRow {
  agentId: string
  eventType: string
  entityId?: string
  payload: unknown
  createdAt: string
}

export interface DataOsPort {
  getFeatures(platform: string, productId: string): Promise<DataOsFeatureSnapshot | null>
  recallMemory(agentId: string, context: unknown, opts?: { limit?: number; minSimilarity?: number }): Promise<unknown[] | null>
  recordMemory(input: {
    agentId: string
    platform?: string
    entityId?: string
    context: unknown
    action: unknown
  }): Promise<string | null>
  recordLakeEvent(input: {
    agentId: string
    eventType: string
    entityId?: string
    payload: unknown
    metadata?: unknown
  }): Promise<void>
  recordPriceEvent(input: {
    platform?: string
    productId: string
    priceBefore: number
    priceAfter: number
    changePct: number
    approved: boolean
  }): Promise<void>

  writeOutcome(decisionId: string, outcome: unknown): Promise<boolean>
  upsertFeature(input: {
    platform: string
    productId: string
    [key: string]: unknown
  }): Promise<boolean>
  getCapabilities(): Promise<unknown | null>

  /** Query Event Lake rows with filters; used by Finance Agent for monthly P&L aggregation. */
  queryLakeEvents?(params: {
    agentId?: string
    eventType?: string
    limit?: number
    sinceMs?: number
  }): Promise<LakeEventRow[]>
}

export interface CreateAgentContextDeps {
  harness: HarnessPort
  budget: BudgetPort
  audit: AuditPort
  approvals: ApprovalPort
  tickets: TicketPort
  llm: LlmPort
  /**
   * When set, `ctx.market` is available for tax / FX / compliance (see `@patioer/market`).
   * Injected by `apps/api` agent execute route with Redis-backed `createMarketContext`.
   */
  market?: MarketContext
  /** When set, `ctx.listPendingApprovals()` returns pending approvals for this agent. */
  approvalsQuery?: ApprovalsQueryPort
  /** When set, `ctx.getRecentEvents(n)` returns the last n agent_events for this agent. */
  events?: EventsPort
  /** Phase 3 · DataOS client (Feature Store / Decision Memory / Event Lake). */
  dataOS?: DataOsPort
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
  /** When set, run compliance checks for these markets before listing. */
  complianceMarkets?: string[]
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
  /** Override the default LLM system prompt for tone control (e.g. formal B2B tone). */
  toneSystemPrompt?: string
}

export interface RelayedThread {
  threadId: string
  subject: string
  action: 'auto_replied' | 'escalated'
  replyBody?: string
}

/** Optional `goalContext.targetRoas` overrides default 3.0 (Sprint 4). */
export interface AdsOptimizerRunInput {
  targetRoas?: number
  persistCampaigns?: (args: {
    platform: string
    campaigns: HarnessAdsCampaign[]
  }) => Promise<void>
  /**
   * When set (API execute route), skips duplicate `requestApproval` if an identical
   * `ads.set_budget` row is already **pending** (Sprint 4 Day 7 governance).
   */
  hasPendingAdsBudgetApproval?: (args: {
    platform: string
    platformCampaignId: string
    proposedDailyBudgetUsd: number
  }) => Promise<boolean>
}

export interface AdsOptimizerPlatformResult {
  platform: string
  ok: boolean
  count: number
  skipReason?: 'not_ads_capable' | 'harness_error' | 'no_harness'
}

export interface AdsOptimizerRunResult {
  runId: string
  synced: number
  perPlatform: AdsOptimizerPlatformResult[]
  budgetExceeded?: boolean
  /** `requestApproval` calls for budgets above the $500 threshold. */
  approvalsRequested?: number
  /** Successful `updateAdsBudget` calls (below threshold). */
  budgetUpdatesApplied?: number
}

/** Paperclip (or cron) should call `POST .../agents/:id/execute` at this interval for ads-optimizer. */
export const ADS_OPTIMIZER_HEARTBEAT_MS = 4 * 60 * 60 * 1000

/** Daily cadence hint; actual 08:00 local uses cron + `CRON_TZ` (see `inventory-guard.schedule.ts`). */
export const INVENTORY_GUARD_HEARTBEAT_MS = 24 * 60 * 60 * 1000

export interface InventoryGuardPersistRow extends HarnessInventoryLevel {
  status: 'normal' | 'low' | 'out_of_stock'
  safetyThreshold: number
}

export interface InventoryGuardRunInput {
  /** Overrides default safety stock threshold (default 10). */
  safetyThreshold?: number
  /** Min suggested restock units before opening an `inventory.adjust` approval (default 50). */
  replenishApprovalMinUnits?: number
  /** IANA zone for optional `enforceDailyWindow` (default `INVENTORY_GUARD_TZ` env or `UTC`). */
  timeZone?: string
  /**
   * When true, no-op unless the current local hour in `timeZone` is 08:00.
   * Leave false for manual `POST .../execute` (default).
   */
  enforceDailyWindow?: boolean
  persistInventoryLevels?: (args: {
    platform: string
    levels: InventoryGuardPersistRow[]
  }) => Promise<number>
  /**
   * Skips duplicate `requestApproval` when the same replenishment is already **pending**
   * (Sprint 4 Day 7). Agent never calls `updateInventory`; approved writes run in the worker.
   */
  hasPendingInventoryAdjust?: (args: {
    platform: string
    platformProductId: string
    targetQuantity: number
  }) => Promise<boolean>
}

export interface InventoryGuardPlatformResult {
  platform: string
  ok: boolean
  count: number
  skipReason?: 'not_inventory_capable' | 'harness_error' | 'no_harness'
}

export interface InventoryGuardRunResult {
  runId: string
  synced: number
  perPlatform: InventoryGuardPlatformResult[]
  budgetExceeded?: boolean
  /** Rows upserted into `inventory_levels` when `persistInventoryLevels` is wired. */
  levelsPersisted?: number
  ticketsCreated?: number
  /** `requestApproval` calls for large restock (`inventory.adjust`); harness write only after approval in worker. */
  replenishApprovalsRequested?: number
  skippedDueToSchedule?: boolean
}

// ---------------------------------------------------------------------------
// Content Writer (E-07) — Phase 3 Sprint 5
// ---------------------------------------------------------------------------

export interface ContentWriterRunInput {
  productId: string
  platform?: string
  tone?: 'professional' | 'casual' | 'luxury' | 'value'
  maxLength?: number
}

export interface ContentWriterResult {
  productId: string
  title: string
  description: string
  bulletPoints: string[]
  seoKeywords: string[]
}

// ---------------------------------------------------------------------------
// Market Intel (E-08) — Phase 3 Sprint 5
// ---------------------------------------------------------------------------

export interface MarketIntelRunInput {
  platforms?: string[]
  maxProducts?: number
}

export interface MarketIntelCompetitorInsight {
  productId: string
  platform: string
  competitorMinPrice: number
  competitorAvgPrice: number
  pricePosition: 'below' | 'at' | 'above'
  recommendation?: string
}

export interface MarketIntelResult {
  runId: string
  analyzedProducts: number
  insights: MarketIntelCompetitorInsight[]
  featuresUpdated: number
}

// ---------------------------------------------------------------------------
// Finance Agent (E-09) — Phase 4 Sprint 10
// ---------------------------------------------------------------------------

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

/** Monthly on the 1st (see Phase 4 Agent Schedule). */
export const FINANCE_AGENT_HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// CEO Agent (E-01) — Phase 4 Sprint 10
// ---------------------------------------------------------------------------

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

/** Daily 08:00 (see Phase 4 Agent Schedule). */
export const CEO_AGENT_HEARTBEAT_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Customer Success Agent (E-10) — Phase 5 Sprint 19
// Platform-level agent: not owned by any tenant; scans ALL active tenants.
// ---------------------------------------------------------------------------

export interface CustomerSuccessRunInput {
  tenantIds?: string[]
}

export interface TenantHealthDimension {
  dimension: 'heartbeat_rate' | 'login_frequency' | 'approval_response' | 'gmv_trend'
  rawValue: number
  score: number
  weight: number
}

export interface TenantHealthResult {
  tenantId: string
  score: number
  dimensions: TenantHealthDimension[]
  action: 'none' | 'intervention' | 'upsell_suggestion' | 'review_invitation'
}

export interface CustomerSuccessResult {
  runId: string
  tenantsScanned: number
  results: TenantHealthResult[]
  interventionsSent: number
  upsellsSuggested: number
}

/** Daily 09:00 (see Phase 5 Agent Schedule). */
export const CS_AGENT_HEARTBEAT_MS = 24 * 60 * 60 * 1000
