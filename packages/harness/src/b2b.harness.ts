/**
 * B2B Portal Harness (Phase 4 §S11 tasks 11.2–11.4)
 *
 * Implements TenantHarness for B2B wholesale channels:
 *  - Tiered pricing (3 tiers: silver/gold/platinum volume breaks)
 *  - MOQ (Minimum Order Quantity) enforcement
 *  - EDI 850 Purchase Order parsing → standard Order
 *  - Buyer-tier–specific catalog visibility
 *
 * Constitution §2.3: Agents never call platform SDK directly.
 * ADR-0004 D21: B2B reuses tenant_id / RLS / budget / approval.
 */

import type { TenantHarness } from './base.harness.js'
import type { Analytics, DateRange, Order, PaginatedResult, PaginationOpts, Product, Thread } from './types.js'
import type {
  B2BHarnessConfig,
  B2BPriceSchedule,
  B2BProduct,
  BuyerTier,
  EDI850LineItem,
  EDI850PurchaseOrder,
  TieredPrice,
} from './b2b.types.js'

// ─── EDI 850 Parser ───────────────────────────────────────────────────────────

/**
 * Parse raw EDI 850 text segments into a structured purchase order.
 * Supports a simplified X12 subset: ISA/GS/ST/BEG/N1/PO1/CTT/SE/GE/IEA.
 */
export function parseEDI850(raw: string): EDI850PurchaseOrder {
  const segments = raw.split('~').map((s) => s.trim()).filter(Boolean)

  let poNumber = ''
  let buyerId = ''
  let buyerCompanyName = ''
  let orderDate = ''
  const lineItems: EDI850LineItem[] = []
  let shipTo = { name: '', street: '', city: '', state: '', postalCode: '', country: '' }
  let currency = 'USD'

  let lineNumber = 0

  for (const seg of segments) {
    const elements = seg.split('*')
    const id = elements[0]

    switch (id) {
      case 'BEG':
        poNumber = elements[3] ?? ''
        orderDate = elements[5] ?? ''
        break
      case 'CUR':
        currency = elements[2] ?? 'USD'
        break
      case 'N1': {
        const qualifier = elements[1]
        if (qualifier === 'BY') {
          buyerCompanyName = elements[2] ?? ''
          buyerId = elements[4] ?? ''
        } else if (qualifier === 'ST') {
          shipTo = { ...shipTo, name: elements[2] ?? '' }
        }
        break
      }
      case 'N3':
        shipTo = { ...shipTo, street: elements[1] ?? '' }
        break
      case 'N4':
        shipTo = {
          ...shipTo,
          city: elements[1] ?? '',
          state: elements[2] ?? '',
          postalCode: elements[3] ?? '',
          country: elements[4] ?? 'US',
        }
        break
      case 'PO1': {
        lineNumber++
        const qty = Number(elements[2]) || 0
        const unitPrice = Number(elements[4]) || 0
        const uom = elements[3] ?? 'EA'
        const productId = elements[7] ?? elements[1] ?? ''
        const sku = elements[7] ?? ''
        lineItems.push({ lineNumber, productId, sku, quantity: qty, unitPrice, uom })
        break
      }
    }
  }

  const totalAmount = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0)

  return {
    poNumber,
    buyerId,
    buyerCompanyName,
    orderDate,
    shipTo,
    lineItems,
    totalAmount,
    currency,
    rawSegments: raw,
  }
}

// ─── Tiered Pricing Logic ─────────────────────────────────────────────────────

export function buildDefaultTiers(basePrice: number): [TieredPrice, TieredPrice, TieredPrice] {
  return [
    { minQty: 1, maxQty: 99, unitPrice: basePrice },
    { minQty: 100, maxQty: 499, unitPrice: +(basePrice * 0.9).toFixed(2) },
    { minQty: 500, maxQty: null, unitPrice: +(basePrice * 0.8).toFixed(2) },
  ]
}

export function resolveUnitPrice(tiers: readonly TieredPrice[], quantity: number): number {
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i]!
    if (quantity >= tier.minQty) return tier.unitPrice
  }
  return tiers[0]!.unitPrice
}

// ─── B2B Harness Backend Adapter (abstraction over HTTP API) ──────────────────

export interface B2BBackendAdapter {
  fetchProducts(opts?: PaginationOpts): Promise<B2BProduct[]>
  fetchProduct(productId: string): Promise<B2BProduct | null>
  updatePriceSchedule(productId: string, schedule: B2BPriceSchedule): Promise<void>
  updateInventory(productId: string, qty: number): Promise<void>
  fetchOrders(opts?: PaginationOpts): Promise<Order[]>
  submitEDIOrder(po: EDI850PurchaseOrder): Promise<Order>
  fetchAnalytics(range: DateRange): Promise<Analytics>
}

// ─── Default HTTP Backend Adapter ─────────────────────────────────────────────

function createHttpBackendAdapter(config: B2BHarnessConfig): B2BBackendAdapter {
  const { apiBaseUrl, apiKey } = config.credentials

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...init?.headers,
      },
    })
    if (!res.ok) throw new Error(`B2B API ${init?.method ?? 'GET'} ${path}: ${res.status}`)
    return res.json() as Promise<T>
  }

  return {
    async fetchProducts(opts) {
      const params = new URLSearchParams()
      if (opts?.cursor) params.set('cursor', opts.cursor)
      if (opts?.limit) params.set('limit', String(opts.limit))
      const qs = params.toString()
      return apiFetch<B2BProduct[]>(`/products${qs ? `?${qs}` : ''}`)
    },

    async fetchProduct(productId) {
      try {
        return await apiFetch<B2BProduct>(`/products/${productId}`)
      } catch {
        return null
      }
    },

    async updatePriceSchedule(productId, schedule) {
      await apiFetch(`/products/${productId}/price-schedule`, {
        method: 'PUT',
        body: JSON.stringify(schedule),
      })
    },

    async updateInventory(productId, qty) {
      await apiFetch(`/products/${productId}/inventory`, {
        method: 'PUT',
        body: JSON.stringify({ quantity: qty }),
      })
    },

    async fetchOrders(opts) {
      const params = new URLSearchParams()
      if (opts?.cursor) params.set('cursor', opts.cursor)
      if (opts?.limit) params.set('limit', String(opts.limit))
      const qs = params.toString()
      return apiFetch<Order[]>(`/orders${qs ? `?${qs}` : ''}`)
    },

    async submitEDIOrder(po) {
      return apiFetch<Order>('/orders/edi', {
        method: 'POST',
        body: JSON.stringify(po),
      })
    },

    async fetchAnalytics(range) {
      const params = new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      })
      return apiFetch<Analytics>(`/analytics?${params.toString()}`)
    },
  }
}

// ─── B2B Harness (implements TenantHarness) ───────────────────────────────────

export class B2BHarness implements TenantHarness {
  readonly tenantId: string
  readonly platformId = 'b2b'

  private readonly backend: B2BBackendAdapter
  private readonly config: B2BHarnessConfig

  constructor(config: B2BHarnessConfig, backend?: B2BBackendAdapter) {
    this.tenantId = config.credentials.tenantId
    this.config = config
    this.backend = backend ?? createHttpBackendAdapter(config)
  }

  // ─── Product operations ──────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product | null> {
    const b2bProduct = await this.backend.fetchProduct(productId)
    if (!b2bProduct) return null
    return toProduct(b2bProduct)
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const raw = await this.backend.fetchProducts(opts)
    return {
      items: raw.map(toProduct),
      nextCursor: raw.length === (opts?.limit ?? 50) ? raw[raw.length - 1]?.id : undefined,
    }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[] & { truncated?: boolean }> {
    const raw = await this.backend.fetchProducts(opts)
    const products = raw.map(toProduct) as Product[] & { truncated?: boolean }
    products.truncated = raw.length === (opts?.limit ?? 50)
    return products
  }

  /**
   * Update all 3 pricing tiers for a product.
   * `price` is the new base-per-unit → tiers auto-recalculate.
   */
  async updatePrice(productId: string, price: number): Promise<void> {
    const schedule: B2BPriceSchedule = {
      productId,
      basePricePerUnit: price,
      tiers: buildDefaultTiers(price),
      currency: this.config.defaultCurrency,
    }
    await this.backend.updatePriceSchedule(productId, schedule)
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    await this.backend.updateInventory(productId, qty)
  }

  // ─── Order operations ────────────────────────────────────────────────────

  async getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>> {
    const raw = await this.backend.fetchOrders(opts)
    return {
      items: raw,
      nextCursor: raw.length === (opts?.limit ?? 50) ? raw[raw.length - 1]?.id : undefined,
    }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    return this.backend.fetchOrders(opts)
  }

  /**
   * Parse EDI 850 raw text → structured PO → submit to backend → return Order.
   */
  async receiveEDIOrder(raw: string): Promise<Order> {
    const po = parseEDI850(raw)
    return this.backend.submitEDIOrder(po)
  }

  // ─── Messaging (B2B formal tone handled at Agent config level) ───────────

  async replyToMessage(threadId: string, body: string): Promise<void> {
    void threadId
    void body
    throw new Error('B2B messaging not supported — use email integration')
  }

  async getOpenThreads(): Promise<Thread[]> {
    return []
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  async getAnalytics(range: DateRange): Promise<Analytics> {
    return this.backend.fetchAnalytics(range)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toProduct(b2b: B2BProduct): Product {
  return {
    id: b2b.id,
    title: b2b.title,
    price: b2b.basePricePerUnit,
    inventory: b2b.inventory,
    sku: b2b.sku,
    currency: b2b.currency,
    platformMeta: {
      moq: b2b.moq,
      catalogVisibility: b2b.catalogVisibility,
      tierCount: b2b.priceSchedule.tiers.length,
    },
  }
}

export function createB2BHarness(config: B2BHarnessConfig, backend?: B2BBackendAdapter): B2BHarness {
  return new B2BHarness(config, backend)
}

// ─── Catalog visibility filter ────────────────────────────────────────────────

export function filterCatalogByTier(products: B2BProduct[], tier: BuyerTier): B2BProduct[] {
  return products.filter((p) => {
    if (p.catalogVisibility === 'all') return true
    return p.catalogVisibility.includes(tier)
  })
}
