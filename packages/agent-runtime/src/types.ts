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

export interface CreateAgentContextDeps {
  harness: HarnessPort
  budget: BudgetPort
  audit: AuditPort
  approvals: ApprovalPort
  tickets: TicketPort
  llm: LlmPort
  /**
   * When set, `ctx.market` and `ctx.getMarket()` are available for tax / FX / compliance (see `@patioer/market`).
   * Injected by `apps/api` agent execute route with Redis-backed `createMarketContext`.
   */
  market?: MarketContext
  /** When set, `ctx.listPendingApprovals()` returns pending approvals for this agent. */
  approvalsQuery?: ApprovalsQueryPort
  /** When set, `ctx.getRecentEvents(n)` returns the last n agent_events for this agent. */
  events?: EventsPort
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
