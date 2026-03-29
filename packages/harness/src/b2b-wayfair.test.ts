import { describe, it, expect, vi } from 'vitest'
import {
  buildWayfairTiers,
  buildWayfairPriceSchedule,
  toB2BConfig,
  createWayfairB2BHarness,
  isWayfairPO,
  type WayfairPartnerConfig,
} from './b2b-wayfair.js'
import type { B2BBackendAdapter } from './b2b.harness.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_WAYFAIR_CONFIG: WayfairPartnerConfig = {
  apiBaseUrl: 'https://api.wayfair.example.com',
  apiKey: 'wf-api-key-secret',
  tenantId: 'tenant-wf-001',
  supplierId: 'SUPPLIER-WF-12345',
  currency: 'USD',
  moqDefault: 5,
}

function createMockBackend(): B2BBackendAdapter {
  return {
    fetchProducts: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn().mockResolvedValue(null),
    updatePriceSchedule: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    fetchOrders: vi.fn().mockResolvedValue([]),
    submitEDIOrder: vi.fn().mockResolvedValue({ id: 'ord-wf-001', status: 'pending', totalPrice: 3000 }),
    fetchAnalytics: vi.fn().mockResolvedValue({ revenue: 10000, orders: 5, truncated: false }),
  }
}

// ─── buildWayfairTiers ───────────────────────────────────────────────────────

describe('buildWayfairTiers', () => {
  it('creates 3 tiers with 5% and 12% discounts', () => {
    const tiers = buildWayfairTiers(100)
    expect(tiers).toHaveLength(3)
    expect(tiers[0]).toEqual({ minQty: 1, maxQty: 49, unitPrice: 100 })
    expect(tiers[1]).toEqual({ minQty: 50, maxQty: 199, unitPrice: 95 })
    expect(tiers[2]).toEqual({ minQty: 200, maxQty: null, unitPrice: 88 })
  })

  it('rounds fractional prices to 2 decimals', () => {
    const tiers = buildWayfairTiers(33.33)
    expect(tiers[1].unitPrice).toBe(31.66)
    expect(tiers[2].unitPrice).toBe(29.33)
  })

  it('tier break points differ from generic B2B defaults', () => {
    const tiers = buildWayfairTiers(50)
    expect(tiers[0].maxQty).toBe(49)
    expect(tiers[1].minQty).toBe(50)
    expect(tiers[1].maxQty).toBe(199)
    expect(tiers[2].minQty).toBe(200)
  })
})

// ─── buildWayfairPriceSchedule ───────────────────────────────────────────────

describe('buildWayfairPriceSchedule', () => {
  it('builds a complete schedule with Wayfair tiers', () => {
    const schedule = buildWayfairPriceSchedule('prod-001', 80, 'USD')
    expect(schedule.productId).toBe('prod-001')
    expect(schedule.basePricePerUnit).toBe(80)
    expect(schedule.tiers).toHaveLength(3)
    expect(schedule.currency).toBe('USD')
  })

  it('defaults to USD when currency is omitted', () => {
    const schedule = buildWayfairPriceSchedule('prod-002', 50)
    expect(schedule.currency).toBe('USD')
  })
})

// ─── toB2BConfig ─────────────────────────────────────────────────────────────

describe('toB2BConfig', () => {
  it('converts WayfairPartnerConfig to B2BHarnessConfig', () => {
    const config = toB2BConfig(MOCK_WAYFAIR_CONFIG)
    expect(config.credentials.apiBaseUrl).toBe('https://api.wayfair.example.com')
    expect(config.credentials.apiKey).toBe('wf-api-key-secret')
    expect(config.credentials.tenantId).toBe('tenant-wf-001')
    expect(config.defaultCurrency).toBe('USD')
    expect(config.moqDefault).toBe(5)
  })

  it('defaults currency to USD and moqDefault to 1 when omitted', () => {
    const minimal: WayfairPartnerConfig = {
      apiBaseUrl: 'https://api.wayfair.example.com',
      apiKey: 'key',
      tenantId: 't-1',
      supplierId: 'S-1',
    }
    const config = toB2BConfig(minimal)
    expect(config.defaultCurrency).toBe('USD')
    expect(config.moqDefault).toBe(1)
  })

  it('passes ediEndpoint through to credentials', () => {
    const withEdi: WayfairPartnerConfig = {
      ...MOCK_WAYFAIR_CONFIG,
      ediEndpoint: 'sftp://edi.wayfair.example.com:22/inbound',
    }
    const config = toB2BConfig(withEdi)
    expect(config.credentials.ediEndpoint).toBe('sftp://edi.wayfair.example.com:22/inbound')
  })
})

// ─── createWayfairB2BHarness ─────────────────────────────────────────────────

describe('createWayfairB2BHarness', () => {
  it('creates a B2BHarness with correct tenantId and platformId', () => {
    const backend = createMockBackend()
    const harness = createWayfairB2BHarness(MOCK_WAYFAIR_CONFIG, backend)
    expect(harness.tenantId).toBe('tenant-wf-001')
    expect(harness.platformId).toBe('b2b')
  })

  it('delegates getProduct to backend adapter', async () => {
    const backend = createMockBackend()
    const harness = createWayfairB2BHarness(MOCK_WAYFAIR_CONFIG, backend)
    const result = await harness.getProduct('prod-001')
    expect(result).toBeNull()
    expect(backend.fetchProduct).toHaveBeenCalledWith('prod-001')
  })

  it('can receive EDI orders through the B2B harness', async () => {
    const backend = createMockBackend()
    const harness = createWayfairB2BHarness(MOCK_WAYFAIR_CONFIG, backend)
    const edi = 'BEG*00*NE*WF-PO-100**20260301~PO1*1*200*EA*15.00*PE*SK*PATIO-CHAIR~'
    const order = await harness.receiveEDIOrder(edi)
    expect(order.id).toBe('ord-wf-001')
    expect(backend.submitEDIOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        poNumber: 'WF-PO-100',
        lineItems: [expect.objectContaining({ quantity: 200, unitPrice: 15, sku: 'PATIO-CHAIR' })],
      }),
    )
  })

  it('getAnalytics delegates to backend', async () => {
    const backend = createMockBackend()
    const harness = createWayfairB2BHarness(MOCK_WAYFAIR_CONFIG, backend)
    const range = { from: new Date('2026-01-01'), to: new Date('2026-01-31') }
    const analytics = await harness.getAnalytics(range)
    expect(analytics.revenue).toBe(10000)
  })
})

// ─── isWayfairPO ─────────────────────────────────────────────────────────────

describe('isWayfairPO', () => {
  it('returns true for "Wayfair LLC"', () => {
    expect(isWayfairPO('Wayfair LLC')).toBe(true)
  })

  it('returns true for "WAYFAIR INC"', () => {
    expect(isWayfairPO('WAYFAIR INC')).toBe(true)
  })

  it('returns true for "wayfair" (case insensitive)', () => {
    expect(isWayfairPO('wayfair')).toBe(true)
  })

  it('returns false for unrelated company names', () => {
    expect(isWayfairPO('Amazon Logistics')).toBe(false)
    expect(isWayfairPO('Acme Corp')).toBe(false)
  })
})
