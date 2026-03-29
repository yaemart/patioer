/**
 * B2B Portal Harness — Type definitions (Phase 4 §S11 task 11.1)
 *
 * Constitution §2.3: All platform interactions go through Harness.
 * ADR-0004 D21: B2B uses independent tenant_id; zero architecture change.
 */

// ─── Buyer & Tier ─────────────────────────────────────────────────────────────

export type BuyerTier = 'silver' | 'gold' | 'platinum'

export interface B2BBuyer {
  buyerId: string
  companyName: string
  tier: BuyerTier
  contactEmail: string
  ediCapable: boolean
}

// ─── Tiered Pricing ───────────────────────────────────────────────────────────

export interface TieredPrice {
  minQty: number
  maxQty: number | null
  unitPrice: number
}

export interface B2BPriceSchedule {
  productId: string
  basePricePerUnit: number
  tiers: [TieredPrice, TieredPrice, TieredPrice]
  currency: string
}

// ─── B2B Product ──────────────────────────────────────────────────────────────

export interface B2BProduct {
  id: string
  title: string
  sku: string
  moq: number
  basePricePerUnit: number
  currency: string
  inventory: number | null
  catalogVisibility: 'all' | BuyerTier[]
  priceSchedule: B2BPriceSchedule
}

// ─── EDI 850 Purchase Order ───────────────────────────────────────────────────

export interface EDI850LineItem {
  lineNumber: number
  productId: string
  sku: string
  quantity: number
  unitPrice: number
  uom: string
}

export interface EDI850PurchaseOrder {
  poNumber: string
  buyerId: string
  buyerCompanyName: string
  orderDate: string
  shipTo: EDI850Address
  lineItems: EDI850LineItem[]
  totalAmount: number
  currency: string
  rawSegments?: string
}

export interface EDI850Address {
  name: string
  street: string
  city: string
  state: string
  postalCode: string
  country: string
}

// ─── B2B Harness Configuration ────────────────────────────────────────────────

export interface B2BCredentials {
  apiBaseUrl: string
  apiKey: string
  tenantId: string
  ediEndpoint?: string
}

export interface B2BHarnessConfig {
  credentials: B2BCredentials
  defaultCurrency: string
  moqDefault: number
}

// ─── B2B-specific analytics extension ─────────────────────────────────────────

export interface B2BAnalytics {
  revenue: number
  orders: number
  truncated?: boolean
  avgOrderValue: number
  topBuyers: Array<{ buyerId: string; revenue: number }>
}
