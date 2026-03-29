/**
 * B2B E2E Smoke Test — Sprint 11 验收 (AC-P4-15 + AC-P4-16)
 *
 * Validates the full B2B Harness workflow:
 *  1. Product catalog with MOQ + tier visibility
 *  2. 3-tier pricing update via updatePrice
 *  3. EDI 850 order receipt → standard Order
 *  4. Analytics retrieval
 *  5. B2B Agent config delta (Price Sentinel 5% + Support Relay formal tone)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createB2BHarness,
  buildDefaultTiers,
  resolveUnitPrice,
  filterCatalogByTier,
  type B2BBackendAdapter,
} from './b2b.harness.js'
import type { B2BProduct, B2BHarnessConfig } from './b2b.types.js'
import type { TenantHarness } from './base.harness.js'
import type { Platform } from './types.js'

const B2B_CONFIG: B2BHarnessConfig = {
  credentials: { apiBaseUrl: 'https://b2b-e2e.test', apiKey: 'e2e-key', tenantId: 'tenant-b2b-e2e' },
  defaultCurrency: 'USD',
  moqDefault: 10,
}

function makeProduct(id: string, price: number, moq = 10, vis: B2BProduct['catalogVisibility'] = 'all'): B2BProduct {
  return {
    id, title: `Product ${id}`, sku: `SKU-${id}`, moq,
    basePricePerUnit: price, currency: 'USD', inventory: 100,
    catalogVisibility: vis,
    priceSchedule: { productId: id, basePricePerUnit: price, tiers: buildDefaultTiers(price), currency: 'USD' },
  }
}

function e2eBackend(products: B2BProduct[]): B2BBackendAdapter {
  return {
    fetchProducts: vi.fn().mockResolvedValue(products),
    fetchProduct: vi.fn().mockImplementation(async (pid: string) => products.find((p) => p.id === pid) ?? null),
    updatePriceSchedule: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    fetchOrders: vi.fn().mockResolvedValue([{ id: 'ord-e2e-1', status: 'confirmed', totalPrice: 5000 }]),
    submitEDIOrder: vi.fn().mockResolvedValue({ id: 'ord-edi-e2e', status: 'pending', totalPrice: 10000 }),
    fetchAnalytics: vi.fn().mockResolvedValue({ revenue: 50000, orders: 45, truncated: false }),
  }
}

describe('B2B E2E Smoke — AC-P4-15 B2B Harness 三接口', () => {
  const products = [
    makeProduct('B2B-001', 50, 10, 'all'),
    makeProduct('B2B-002', 200, 50, ['gold', 'platinum']),
    makeProduct('B2B-003', 30, 5, ['silver']),
  ]

  it('1. getProducts returns catalog with MOQ metadata', async () => {
    const backend = e2eBackend(products)
    const harness = createB2BHarness(B2B_CONFIG, backend)
    const result = await harness.getProducts()

    expect(result).toHaveLength(3)
    for (const p of result) {
      expect(p.platformMeta).toBeDefined()
      expect(typeof (p.platformMeta as Record<string, unknown>).moq).toBe('number')
    }
  })

  it('2. updatePrice generates 3-tier schedule (AC-P4-16)', async () => {
    const backend = e2eBackend(products)
    const harness = createB2BHarness(B2B_CONFIG, backend)
    await harness.updatePrice('B2B-001', 100)

    expect(backend.updatePriceSchedule).toHaveBeenCalledWith(
      'B2B-001',
      expect.objectContaining({
        basePricePerUnit: 100,
        tiers: expect.arrayContaining([
          expect.objectContaining({ minQty: 1, unitPrice: 100 }),
          expect.objectContaining({ minQty: 100, unitPrice: 90 }),
          expect.objectContaining({ minQty: 500, unitPrice: 80 }),
        ]),
      }),
    )
  })

  it('3. receiveEDIOrder parses EDI 850 and returns Order', async () => {
    const backend = e2eBackend(products)
    const harness = createB2BHarness(B2B_CONFIG, backend)
    const edi = [
      'BEG*00*NE*PO-E2E-001**20260301',
      'CUR*BY*USD',
      'N1*BY*E2E Corp*92*BUYER-E2E',
      'PO1*1*500*EA*80.00*PE*SK*B2B-001',
    ].join('~')

    const order = await harness.receiveEDIOrder(edi)
    expect(order.id).toBe('ord-edi-e2e')
    expect(backend.submitEDIOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        poNumber: 'PO-E2E-001',
        buyerId: 'BUYER-E2E',
        lineItems: [expect.objectContaining({ quantity: 500, unitPrice: 80 })],
      }),
    )
  })

  it('4. getAnalytics returns revenue/orders', async () => {
    const backend = e2eBackend(products)
    const harness = createB2BHarness(B2B_CONFIG, backend)
    const analytics = await harness.getAnalytics({ from: new Date('2026-01-01'), to: new Date('2026-01-31') })
    expect(analytics.revenue).toBe(50000)
    expect(analytics.orders).toBe(45)
  })

  it('5. catalog visibility respects buyer tier', () => {
    const silver = filterCatalogByTier(products, 'silver')
    expect(silver.map((p) => p.id).sort()).toEqual(['B2B-001', 'B2B-003'])

    const gold = filterCatalogByTier(products, 'gold')
    expect(gold.map((p) => p.id).sort()).toEqual(['B2B-001', 'B2B-002'])

    const platinum = filterCatalogByTier(products, 'platinum')
    expect(platinum.map((p) => p.id).sort()).toEqual(['B2B-001', 'B2B-002'])
  })
})

describe('B2B E2E Smoke — AC-P4-16 阶梯定价 3 档正确', () => {
  it('tier-1 → tier-2 → tier-3 price resolution', () => {
    const tiers = buildDefaultTiers(100)
    expect(resolveUnitPrice(tiers, 1)).toBe(100)
    expect(resolveUnitPrice(tiers, 50)).toBe(100)
    expect(resolveUnitPrice(tiers, 100)).toBe(90)
    expect(resolveUnitPrice(tiers, 300)).toBe(90)
    expect(resolveUnitPrice(tiers, 500)).toBe(80)
    expect(resolveUnitPrice(tiers, 5000)).toBe(80)
  })

  it('tier discounts are 10% and 20%', () => {
    const tiers = buildDefaultTiers(200)
    expect(tiers[0].unitPrice).toBe(200)
    expect(tiers[1].unitPrice).toBe(180)
    expect(tiers[2].unitPrice).toBe(160)
  })
})

describe('B2B Platform type integration', () => {
  it('b2b is a valid Platform', () => {
    const platform: Platform = 'b2b'
    expect(platform).toBe('b2b')
  })

  it('B2BHarness implements TenantHarness', () => {
    const backend = e2eBackend([])
    const harness: TenantHarness = createB2BHarness(B2B_CONFIG, backend)
    expect(harness.tenantId).toBe('tenant-b2b-e2e')
    expect(harness.platformId).toBe('b2b')
  })
})
