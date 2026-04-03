/**
 * Phase 5B Business Capability Ports
 *
 * These interfaces define the contract between Agent/Application layer and the
 * underlying data sources (DB aggregations, platform APIs via Harness adapters).
 * Agents call Ports — never raw platform SDKs. Each Port has a DB-backed
 * "local" implementation and may later gain a "live" implementation that
 * fetches real-time data from platform APIs via the Harness.
 */

import type { DateRange, Platform } from './types.js'

// ─── Unit Economics Port ──────────────────────────────────────────────────────

export interface SkuEconomics {
  productId: string
  sku: string | null
  platform: Platform | string
  grossRevenue: number
  netRevenue: number
  cogs: number
  platformFee: number
  adSpend: number
  contributionMargin: number
  acos: number
  tacos: number
  unitsSold: number
}

export interface DailyOverview {
  date: string
  totalRevenue: number
  totalCogs: number
  totalAdSpend: number
  totalPlatformFee: number
  contributionMargin: number
  marginPercent: number
  avgAcos: number
  avgTacos: number
}

export interface UnitEconomicsPort {
  getSkuEconomics(
    tenantId: string,
    platform: Platform | string,
    productId: string,
    range: DateRange,
  ): Promise<SkuEconomics | null>

  getDailyOverview(
    tenantId: string,
    range: DateRange,
  ): Promise<DailyOverview[]>
}

// ─── Inventory Planning Port ──────────────────────────────────────────────────

export interface InboundShipment {
  id: string
  sku: string
  productId: string
  platform: Platform | string
  quantity: number
  status: string
  expectedArrival: string | null
  supplier: string | null
  leadTimeDays: number | null
  landedCostPerUnit: number | null
}

export interface ReplenishmentSuggestion {
  productId: string
  sku: string
  platform: Platform | string
  currentStock: number
  dailyVelocity: number
  daysOfStock: number
  suggestedQty: number
  urgency: 'critical' | 'low' | 'ok'
}

export interface InventoryPlanningPort {
  getInboundShipments(tenantId: string): Promise<InboundShipment[]>

  getReplenishmentSuggestions(tenantId: string): Promise<ReplenishmentSuggestion[]>
}

// ─── Account Health Port ──────────────────────────────────────────────────────

export interface AccountHealthSummary {
  platform: Platform | string
  overallStatus: 'healthy' | 'at_risk' | 'critical'
  openIssues: number
  resolvedLast30d: number
  metrics: Record<string, number | string>
}

export interface ListingIssue {
  id: string
  productId: string
  platform: Platform | string
  issueType: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string
  detectedAt: string
  resolvedAt: string | null
}

export interface AccountHealthPort {
  getHealthSummary(
    tenantId: string,
    platform: Platform | string,
  ): Promise<AccountHealthSummary>

  getListingIssues(tenantId: string): Promise<ListingIssue[]>
}

// ─── Service Operations Port ──────────────────────────────────────────────────

export interface CaseFilters {
  status?: string
  caseType?: string
  platform?: Platform | string
  limit?: number
  offset?: number
}

export interface ServiceCase {
  id: string
  caseType: string
  orderId: string | null
  productId: string | null
  platform: Platform | string
  status: string
  amount: number | null
  customerMessage: string | null
  agentResponse: string | null
  escalated: boolean
  createdAt: string
}

export interface RefundSummary {
  totalRefunds: number
  totalAmount: number
  byReason: Record<string, { count: number; amount: number }>
}

export interface ServiceOpsPort {
  getCases(tenantId: string, filters?: CaseFilters): Promise<ServiceCase[]>

  getRefundSummary(tenantId: string, range: DateRange): Promise<RefundSummary>
}
